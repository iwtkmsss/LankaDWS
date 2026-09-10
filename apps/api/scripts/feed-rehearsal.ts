import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import type { FeedListQuery, FeedListResult } from '@bert-crm/contracts'
import Database from 'better-sqlite3'
import { PrismaClient } from '../src/generated/prisma/client.js'
import type { AuthPrincipal } from '../src/common/request-context.js'
import { normalizeUserSearchValue } from '../src/common/user-search.js'
import type { PrismaService } from '../src/prisma/prisma.service.js'
import { ScopeService } from '../src/modules/authorization/scope.service.js'
import { FeedService } from '../src/modules/feed/feed.service.js'
import type { FilesService } from '../src/modules/files/files.service.js'

type RehearsalDatabase = InstanceType<typeof Database>
type ProfileName = 'smoke' | 'representative'

interface Profile {
  users: number
  groups: number
  posts: number
  comments: number
  tasks: number
  events: number
  announcements: number
  fileShares: number
  supersededPostSources: number
  postVersions: number
}

interface SeedEvidence {
  expectedVisibleHeads: number
  expectedUnreadHeads: number
  expectedPendingAcknowledgements: number
  expectedOverdueTasks: number
  expectedFavoriteHeads: number
  totalFeedItems: number
  totalHeads: number
  supersededItems: number
  liveDeltaHeads: number
  forbiddenSourceIds: Record<string, string>
  visibleGroupId: string
  visibleGroupFileShareIds: string[]
}

interface ScenarioMetric {
  samples: number
  p50Ms: number
  p95Ms: number
  meanMs: number
  maxMs: number
}

interface QueryPlanRow {
  id: number
  parent: number
  notused: number
  detail: string
}

const profiles: Record<ProfileName, Profile> = {
  smoke: {
    users: 40,
    groups: 8,
    posts: 240,
    comments: 320,
    tasks: 2_500,
    events: 48,
    announcements: 20,
    fileShares: 20,
    supersededPostSources: 20,
    postVersions: 4,
  },
  representative: {
    users: 515,
    groups: 54,
    posts: 5_573,
    comments: 7_357,
    tasks: 150_534,
    events: 639,
    announcements: 133,
    fileShares: 64,
    supersededPostSources: 200,
    postVersions: 4,
  },
}

const workspaceId = 'ws_feed_rehearsal'
const companyId = 'cmp_feed_rehearsal'
const principalId = 'usr_feed_0000'
const visibleGroupId = 'grp_feed_0000'
const hiddenGroupId = 'grp_feed_0001'
const baseTime = Date.parse('2026-07-23T18:00:00.000Z')
const sourceSpanMs = Date.parse('2026-07-23T18:00:00.000Z') - Date.parse('2018-12-01T00:00:00.000Z')

const apiRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(apiRoot, '..', '..')

function parseIntegerFlag(name: string, fallback: number, minimum: number, maximum: number): number {
  const index = process.argv.indexOf(name)
  if (index < 0) return fallback
  const parsed = Number(process.argv[index + 1])
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return parsed
}

function parseStringFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function parseProfile(): ProfileName {
  const value = parseStringFlag('--profile') ?? 'representative'
  if (value !== 'smoke' && value !== 'representative') {
    throw new Error('--profile must be smoke or representative')
  }
  return value
}

function pad(value: number, width = 7): string {
  return value.toString().padStart(width, '0')
}

function userId(index: number): string {
  return `usr_feed_${pad(index, 4)}`
}

function sourceTime(profile: Profile, index: number, typeOffset: number): string {
  const maxSources = Math.max(
    profile.posts,
    profile.tasks,
    profile.events,
    profile.announcements,
    profile.fileShares,
  )
  const position = index * 5 + typeOffset
  const denominator = maxSources * 5 + 1
  return new Date(baseTime - Math.floor((position / denominator) * sourceSpanMs)).toISOString()
}

function olderVersionTime(current: string, distance: number): string {
  return new Date(Date.parse(current) - distance).toISOString()
}

function applyMigrations(database: RehearsalDatabase): void {
  const migrationsRoot = resolve(apiRoot, 'prisma', 'migrations')
  const migrationDirectories = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  for (const migration of migrationDirectories) {
    database.exec(readFileSync(resolve(migrationsRoot, migration, 'migration.sql'), 'utf8'))
  }
}

function seedDatabase(database: RehearsalDatabase, profile: Profile): SeedEvidence {
  database.pragma('foreign_keys = ON')
  database.pragma('journal_mode = WAL')
  database.pragma('synchronous = NORMAL')
  database.pragma('busy_timeout = 5000')

  const insertWorkspace = database.prepare(
    'INSERT INTO Workspace (id, displayName, updatedAt) VALUES (?, ?, ?)',
  )
  const insertCompany = database.prepare(`
    INSERT INTO Company (
      id, workspaceId, displayName, legalName, code, timezone, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const insertUser = database.prepare(`
    INSERT INTO User (
      id, workspaceId, primaryCompanyId, displayName, username,
      normalizedUsername, normalizedDisplayName, accountType, isActive, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'USER', true, ?)
  `)
  const insertCapability = database.prepare(`
    INSERT INTO CompanyCapability (
      id, companyId, code, enabled, enabledById, enabledAt, updatedAt
    ) VALUES (?, ?, 'FEED', true, ?, ?, ?)
  `)
  const insertGroup = database.prepare(`
    INSERT INTO "Group" (
      id, workspaceId, companyId, key, name, description,
      discoverability, joinPolicy, status, ownerId, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
  `)
  const insertGroupMember = database.prepare(`
    INSERT INTO GroupMember (
      id, groupId, userId, role, notificationMode, joinedAt
    ) VALUES (?, ?, ?, ?, 'ALL', ?)
  `)
  const insertPost = database.prepare(`
    INSERT INTO FeedPost (
      id, workspaceId, companyId, groupId, authorId, body, status,
      requiresAcknowledgement, acknowledgementVersion, version,
      publishedAt, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, 'PUBLISHED', ?, ?, ?, ?, ?, ?)
  `)
  const insertPostRecipient = database.prepare(`
    INSERT INTO FeedPostRecipient (id, postId, type, recipientId, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `)
  const insertAckRecipient = database.prepare(`
    INSERT INTO FeedAcknowledgementRecipient (
      id, postId, userId, acknowledgementVersion, createdAt
    ) VALUES (?, ?, ?, ?, ?)
  `)
  const insertAcknowledgement = database.prepare(`
    INSERT INTO FeedPostAcknowledgement (
      id, postId, userId, acknowledgementVersion, acknowledgedAt
    ) VALUES (?, ?, ?, ?, ?)
  `)
  const insertMention = database.prepare(`
    INSERT INTO FeedMention (id, postId, commentId, userId, createdAt)
    VALUES (?, ?, NULL, ?, ?)
  `)
  const insertSubscription = database.prepare(`
    INSERT INTO FeedSubscription (id, postId, userId, mode, createdAt, updatedAt)
    VALUES (?, ?, ?, 'ALL', ?, ?)
  `)
  const insertFeedItem = database.prepare(`
    INSERT INTO FeedItem (
      id, workspaceId, companyId, postId, fileShareId, sourceType, sourceId,
      sourceVersion, action, eventKey, actorId, visibility, safePayload,
      countsAsUnread, occurredAt, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertHead = database.prepare(`
    INSERT INTO FeedSourceHead (
      id, workspaceId, companyId, sourceType, sourceId, itemId,
      sourceVersion, countsAsUnread, occurredAt, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertItemRecipient = database.prepare(`
    INSERT INTO FeedItemRecipient (id, itemId, userId, createdAt)
    VALUES (?, ?, ?, ?)
  `)
  const insertComment = database.prepare(`
    INSERT INTO Comment (
      id, workspaceId, companyId, entityType, entityId,
      authorId, body, visibility, createdAt
    ) VALUES (?, ?, ?, 'FEED_POST', ?, ?, ?, 'FEED_AUDIENCE', ?)
  `)
  const insertTask = database.prepare(`
    INSERT INTO Task (
      id, workspaceId, companyId, number, title, description, creatorId,
      assigneeId, status, priority, deadline, version, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'MEDIUM', ?, 1, ?, ?)
  `)
  const insertEvent = database.prepare(`
    INSERT INTO Event (
      id, workspaceId, companyId, ownerId, title, startAt, endAt,
      sourceTimezone, allDay, visibility, version, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Europe/Kyiv', false, ?, 1, ?, ?)
  `)
  const insertAnnouncement = database.prepare(`
    INSERT INTO Announcement (
      id, workspaceId, authorId, title, body, status, isPinned,
      publishAt, version, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, 'PUBLISHED', ?, ?, 1, ?, ?)
  `)
  const insertAnnouncementCompany = database.prepare(`
    INSERT INTO AnnouncementAudienceCompany (id, announcementId, companyId)
    VALUES (?, ?, ?)
  `)
  const insertAnnouncementReceipt = database.prepare(`
    INSERT INTO AnnouncementReceipt (
      id, announcementId, userId, deliveredAt, effectiveContentVersion
    ) VALUES (?, ?, ?, ?, 1)
  `)
  const insertFile = database.prepare(`
    INSERT INTO FileObject (
      id, workspaceId, companyId, storageKey, safeFilename, declaredMime,
      detectedMime, bytes, sha256, scanStatus, ownerId, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, 'text/plain', 'text/plain', ?, ?, 'CLEAN', ?, ?, ?)
  `)
  const insertFileShare = database.prepare(`
    INSERT INTO FeedFileShare (
      id, workspaceId, companyId, fileId, ownerId, audienceType, audienceKey,
      groupId, status, version, createdAt, updatedAt, revokedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertFileRecipient = database.prepare(`
    INSERT INTO FeedFileShareRecipient (id, shareId, userId, createdAt)
    VALUES (?, ?, ?, ?)
  `)
  const revokeFileShare = database.prepare(`
    UPDATE FeedFileShare
    SET status = 'REVOKED', version = 2, revokedAt = ?, updatedAt = ?
    WHERE id = ?
  `)
  const insertFavorite = database.prepare(`
    INSERT INTO FeedUserItemState (
      id, userId, feedItemId, favoritedAt, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?)
  `)

  let expectedVisibleHeads = 0
  let expectedUnreadHeads = 0
  let expectedPendingAcknowledgements = 0
  let expectedOverdueTasks = 0
  let expectedFavoriteHeads = 0
  let totalFeedItems = 0
  let supersededItems = 0
  let liveDeltaHeads = 0
  let acknowledgementOrdinal = 0
  const favoriteCandidates: string[] = []
  const visibleGroupFileShareIds: string[] = []
  const forbiddenSourceIds: Record<string, string> = {}
  const now = new Date('2026-07-23T18:00:00.000Z').toISOString()

  const seed = database.transaction(() => {
    insertWorkspace.run(workspaceId, 'Synthetic Feed Rehearsal', now)
    insertCompany.run(
      companyId,
      workspaceId,
      'Synthetic Company',
      'Synthetic Company LLC',
      'SYNTH',
      'Europe/Kyiv',
      now,
    )
    for (let index = 0; index < profile.users; index += 1) {
      const id = userId(index)
      const username = `synthetic.user.${pad(index, 4)}`
      const displayName = `Synthetic User ${pad(index, 4)}`
      insertUser.run(
        id,
        workspaceId,
        companyId,
        displayName,
        username,
        username,
        normalizeUserSearchValue(displayName),
        now,
      )
    }
    insertCapability.run('cap_feed_rehearsal', companyId, principalId, now, now)

    for (let index = 0; index < profile.groups; index += 1) {
      const groupId = `grp_feed_${pad(index, 4)}`
      const ownerId = userId((index % (profile.users - 1)) + 1)
      insertGroup.run(
        groupId,
        workspaceId,
        companyId,
        `synthetic-${pad(index, 4)}`,
        `Synthetic Group ${pad(index, 4)}`,
        'Synthetic non-PII rehearsal group.',
        index === 1 ? 'HIDDEN' : 'LISTED',
        index === 1 ? 'INVITE_ONLY' : 'REQUEST',
        ownerId,
        now,
      )
      insertGroupMember.run(`gm_feed_${pad(index, 4)}_owner`, groupId, ownerId, 'OWNER', now)
      if (index === 0) {
        insertGroupMember.run('gm_feed_visible_principal', groupId, principalId, 'MEMBER', now)
      }
    }

    for (let index = 0; index < profile.posts; index += 1) {
      const postId = `post_feed_${pad(index)}`
      const currentTime = sourceTime(profile, index, 0)
      const audiencePattern = index % 10
      const hiddenAudience = audiencePattern === 0 || audiencePattern === 1
      const authorId = hiddenAudience
        ? userId(2)
        : index % 17 === 0
          ? principalId
          : userId((index % (profile.users - 1)) + 1)
      const currentVersion = index < profile.supersededPostSources ? profile.postVersions : 1
      const liveDelta = index < Math.min(profile.posts, 200)
      const requiresAcknowledgement = !hiddenAudience
        && acknowledgementOrdinal < Math.min(140, profile.posts)
      const acknowledgementVersion = requiresAcknowledgement ? currentVersion : 0
      let groupId: string | null = null
      let recipientType = 'COMPANY'
      let recipientId = companyId
      let accessible = true
      if (audiencePattern === 0) {
        groupId = hiddenGroupId
        recipientType = 'GROUP'
        recipientId = hiddenGroupId
        accessible = false
        forbiddenSourceIds.POST ??= postId
      } else if (audiencePattern === 1) {
        recipientType = 'USER'
        recipientId = userId(2)
        accessible = false
        forbiddenSourceIds.POST ??= postId
      } else if (audiencePattern === 2) {
        groupId = visibleGroupId
        recipientType = 'GROUP'
        recipientId = visibleGroupId
      } else if (audiencePattern === 3) {
        recipientType = 'USER'
        recipientId = principalId
      }
      if (authorId === principalId) accessible = true
      insertPost.run(
        postId,
        workspaceId,
        companyId,
        groupId,
        authorId,
        `Synthetic post ${pad(index)}. Rehearsal content contains no production data.`,
        requiresAcknowledgement ? 1 : 0,
        acknowledgementVersion,
        currentVersion,
        currentTime,
        currentTime,
        currentTime,
      )
      insertPostRecipient.run(
        `frcp_feed_${pad(index)}`,
        postId,
        recipientType,
        recipientId,
        currentTime,
      )
      if (requiresAcknowledgement) {
        insertAckRecipient.run(
          `fackr_feed_${pad(index)}`,
          postId,
          principalId,
          currentVersion,
          currentTime,
        )
        if (acknowledgementOrdinal % 3 === 0) {
          insertAcknowledgement.run(
            `fack_feed_${pad(index)}`,
            postId,
            principalId,
            currentVersion,
            currentTime,
          )
        } else {
          expectedPendingAcknowledgements += 1
        }
        acknowledgementOrdinal += 1
      }
      if (accessible && index % 79 === 0) {
        insertMention.run(`fmt_feed_${pad(index)}`, postId, principalId, currentTime)
      }
      if (accessible && index % 67 === 0) {
        insertSubscription.run(
          `fsub_feed_${pad(index)}`,
          postId,
          principalId,
          currentTime,
          currentTime,
        )
      }
      for (let version = 1; version <= currentVersion; version += 1) {
        const itemId = `fitem_post_${pad(index)}_v${version}`
        const occurredAt = version === currentVersion
          ? currentTime
          : olderVersionTime(currentTime, currentVersion - version)
        insertFeedItem.run(
          itemId,
          workspaceId,
          companyId,
          postId,
          null,
          'POST',
          postId,
          version,
          version === 1 ? 'PUBLISHED' : 'EDITED',
          `feed:post:${postId}:v${version}:${version === 1 ? 'published' : 'edited'}`,
          authorId,
          recipientType,
          JSON.stringify({
            postId,
            action: version === 1 ? 'PUBLISHED' : 'EDITED',
            snippet: `Synthetic post ${pad(index)}`,
          }),
          version === currentVersion && liveDelta ? 1 : 0,
          occurredAt,
          occurredAt,
        )
        totalFeedItems += 1
        if (version < currentVersion) supersededItems += 1
        if (version === currentVersion) {
          insertHead.run(
            `fhead_post_${pad(index)}`,
            workspaceId,
            companyId,
            'POST',
            postId,
            itemId,
            currentVersion,
            liveDelta ? 1 : 0,
            currentTime,
            currentTime,
            currentTime,
          )
          if (accessible) {
            expectedVisibleHeads += 1
            if (liveDelta) expectedUnreadHeads += 1
            if (index % 83 === 0) favoriteCandidates.push(itemId)
          }
        }
      }
      if (liveDelta) liveDeltaHeads += 1
    }

    for (let index = 0; index < profile.comments; index += 1) {
      const postIndex = index % profile.posts
      const createdAt = olderVersionTime(sourceTime(profile, postIndex, 0), index + 10)
      insertComment.run(
        `cmt_feed_${pad(index)}`,
        workspaceId,
        companyId,
        `post_feed_${pad(postIndex)}`,
        userId((index % (profile.users - 1)) + 1),
        `Synthetic comment ${pad(index)}.`,
        createdAt,
      )
    }

    for (let index = 0; index < profile.tasks; index += 1) {
      const taskId = `task_feed_${pad(index)}`
      const itemId = `fitem_task_${pad(index)}`
      const currentTime = sourceTime(profile, index, 1)
      const visibilityPattern = index % 4
      const visible = visibilityPattern !== 0
      const liveDelta = index < Math.min(profile.tasks, 600)
      const creatorId = visibilityPattern === 2
        ? principalId
        : userId((index % (profile.users - 1)) + 1)
      const assigneeId = visibilityPattern === 1 || visibilityPattern === 3
        ? principalId
        : userId(((index + 1) % (profile.users - 1)) + 1)
      const status = index % 10 === 0 ? 'DONE' : 'IN_PROGRESS'
      const deadline = index % 5 === 0 ? null : '2026-07-01T12:00:00.000Z'
      insertTask.run(
        taskId,
        workspaceId,
        companyId,
        `SYN-${pad(index)}`,
        `Synthetic task ${pad(index)}`,
        'Synthetic task description.',
        creatorId,
        assigneeId,
        status,
        deadline,
        currentTime,
        currentTime,
      )
      insertFeedItem.run(
        itemId,
        workspaceId,
        companyId,
        null,
        null,
        'TASK',
        taskId,
        1,
        'ASSIGNED',
        `feed:task:${taskId}:v1:assigned`,
        creatorId,
        'PARTICIPANTS',
        JSON.stringify({
          schemaVersion: 1,
          sourceType: 'TASK',
          sourceId: taskId,
          action: 'ASSIGNED',
          historical: !liveDelta,
        }),
        liveDelta ? 1 : 0,
        currentTime,
        currentTime,
      )
      insertHead.run(
        `fhead_task_${pad(index)}`,
        workspaceId,
        companyId,
        'TASK',
        taskId,
        itemId,
        1,
        liveDelta ? 1 : 0,
        currentTime,
        currentTime,
        currentTime,
      )
      totalFeedItems += 1
      if (visible) {
        insertItemRecipient.run(
          `firec_task_${pad(index)}`,
          itemId,
          principalId,
          currentTime,
        )
        expectedVisibleHeads += 1
        if (liveDelta) expectedUnreadHeads += 1
        if (index % 997 === 0) favoriteCandidates.push(itemId)
      } else {
        forbiddenSourceIds.TASK ??= taskId
      }
      if (liveDelta) liveDeltaHeads += 1
      if (
        assigneeId === principalId
        && deadline !== null
        && status !== 'DONE'
      ) {
        expectedOverdueTasks += 1
      }
    }

    for (let index = 0; index < profile.events; index += 1) {
      const eventId = `event_feed_${pad(index)}`
      const itemId = `fitem_event_${pad(index)}`
      const currentTime = sourceTime(profile, index, 2)
      const visible = index % 5 !== 0
      const liveDelta = index < Math.min(profile.events, 100)
      const endAt = new Date(Date.parse(currentTime) + 3_600_000).toISOString()
      insertEvent.run(
        eventId,
        workspaceId,
        companyId,
        userId((index % (profile.users - 1)) + 1),
        `Synthetic event ${pad(index)}`,
        currentTime,
        endAt,
        visible ? 'INTERNAL' : 'PRIVATE',
        currentTime,
        currentTime,
      )
      insertFeedItem.run(
        itemId,
        workspaceId,
        companyId,
        null,
        null,
        'EVENT',
        eventId,
        1,
        'SCHEDULED',
        `feed:event:${eventId}:v1:scheduled`,
        userId((index % (profile.users - 1)) + 1),
        visible ? 'COMPANY' : 'PARTICIPANTS',
        JSON.stringify({
          schemaVersion: 1,
          sourceType: 'EVENT',
          sourceId: eventId,
          action: 'SCHEDULED',
          historical: !liveDelta,
        }),
        liveDelta ? 1 : 0,
        currentTime,
        currentTime,
      )
      insertHead.run(
        `fhead_event_${pad(index)}`,
        workspaceId,
        companyId,
        'EVENT',
        eventId,
        itemId,
        1,
        liveDelta ? 1 : 0,
        currentTime,
        currentTime,
        currentTime,
      )
      totalFeedItems += 1
      if (visible) {
        expectedVisibleHeads += 1
        if (liveDelta) expectedUnreadHeads += 1
      } else {
        forbiddenSourceIds.EVENT ??= eventId
      }
      if (liveDelta) liveDeltaHeads += 1
    }

    for (let index = 0; index < profile.announcements; index += 1) {
      const announcementId = `announcement_feed_${pad(index)}`
      const itemId = `fitem_announcement_${pad(index)}`
      const currentTime = sourceTime(profile, index, 3)
      const visible = index % 5 !== 0
      const liveDelta = index < Math.min(profile.announcements, 50)
      const authorId = userId((index % (profile.users - 1)) + 1)
      insertAnnouncement.run(
        announcementId,
        workspaceId,
        authorId,
        `Synthetic announcement ${pad(index)}`,
        'Synthetic announcement body.',
        index % 11 === 0 ? 1 : 0,
        currentTime,
        currentTime,
        currentTime,
      )
      insertAnnouncementCompany.run(
        `anc_feed_${pad(index)}`,
        announcementId,
        companyId,
      )
      insertFeedItem.run(
        itemId,
        workspaceId,
        companyId,
        null,
        null,
        'ANNOUNCEMENT',
        announcementId,
        1,
        'PUBLISHED',
        `feed:announcement:${announcementId}:${companyId}:v1:published`,
        authorId,
        'PARTICIPANTS',
        JSON.stringify({
          schemaVersion: 1,
          sourceType: 'ANNOUNCEMENT',
          sourceId: announcementId,
          action: 'PUBLISHED',
          historical: !liveDelta,
        }),
        liveDelta ? 1 : 0,
        currentTime,
        currentTime,
      )
      insertHead.run(
        `fhead_announcement_${pad(index)}`,
        workspaceId,
        companyId,
        'ANNOUNCEMENT',
        announcementId,
        itemId,
        1,
        liveDelta ? 1 : 0,
        currentTime,
        currentTime,
        currentTime,
      )
      totalFeedItems += 1
      if (visible) {
        insertAnnouncementReceipt.run(
          `anrec_feed_${pad(index)}`,
          announcementId,
          principalId,
          currentTime,
        )
        insertItemRecipient.run(
          `firec_announcement_${pad(index)}`,
          itemId,
          principalId,
          currentTime,
        )
        expectedVisibleHeads += 1
        if (liveDelta) expectedUnreadHeads += 1
      } else {
        forbiddenSourceIds.ANNOUNCEMENT ??= announcementId
      }
      if (liveDelta) liveDeltaHeads += 1
    }

    for (let index = 0; index < profile.fileShares; index += 1) {
      const fileId = `file_feed_${pad(index)}`
      const shareId = `fshare_feed_${pad(index)}`
      const itemId = `fitem_file_${pad(index)}`
      const currentTime = sourceTime(profile, index, 4)
      const pattern = index % 6
      const revoked = pattern === 0
      const liveDelta = true
      let audienceType = 'COMPANY'
      let audienceKey = `COMPANY:${companyId}`
      let groupId: string | null = null
      let directRecipient: string | null = null
      let visible = !revoked
      if (pattern === 1) {
        audienceType = 'GROUP'
        audienceKey = `GROUP:${hiddenGroupId}`
        groupId = hiddenGroupId
        visible = false
      } else if (pattern === 2) {
        audienceType = 'USER'
        directRecipient = userId(2)
        audienceKey = `USER:${directRecipient}`
        visible = false
      } else if (pattern === 4) {
        audienceType = 'GROUP'
        audienceKey = `GROUP:${visibleGroupId}`
        groupId = visibleGroupId
        visible = true
      } else if (pattern === 5) {
        audienceType = 'USER'
        directRecipient = principalId
        audienceKey = `USER:${principalId}`
        visible = true
      }
      insertFile.run(
        fileId,
        workspaceId,
        companyId,
        `${companyId}/${fileId}`,
        `synthetic-file-${pad(index)}.txt`,
        1_024 + index,
        index.toString(16).padStart(64, '0').slice(-64),
        userId(1),
        currentTime,
        currentTime,
      )
      insertFileShare.run(
        shareId,
        workspaceId,
        companyId,
        fileId,
        userId(1),
        audienceType,
        audienceKey,
        groupId,
        'ACTIVE',
        1,
        currentTime,
        currentTime,
        null,
      )
      if (directRecipient) {
        insertFileRecipient.run(
          `fshr_feed_${pad(index)}`,
          shareId,
          directRecipient,
          currentTime,
        )
      }
      insertFeedItem.run(
        itemId,
        workspaceId,
        companyId,
        null,
        shareId,
        'FILE',
        shareId,
        1,
        'SHARED',
        `feed:file:${shareId}:v1:shared`,
        userId(1),
        audienceType,
        JSON.stringify({
          schemaVersion: 1,
          sourceType: 'FILE',
          sourceId: shareId,
          action: 'SHARED',
          historical: false,
        }),
        1,
        currentTime,
        currentTime,
      )
      insertHead.run(
        `fhead_file_${pad(index)}`,
        workspaceId,
        companyId,
        'FILE',
        shareId,
        itemId,
        1,
        1,
        currentTime,
        currentTime,
        currentTime,
      )
      if (revoked) revokeFileShare.run(currentTime, currentTime, shareId)
      totalFeedItems += 1
      if (visible) {
        expectedVisibleHeads += 1
        expectedUnreadHeads += 1
        if (groupId === visibleGroupId) visibleGroupFileShareIds.push(shareId)
      } else {
        forbiddenSourceIds.FILE ??= shareId
      }
      if (liveDelta) liveDeltaHeads += 1
    }

    for (const [index, itemId] of favoriteCandidates.slice(0, 100).entries()) {
      insertFavorite.run(
        `fstate_feed_${pad(index)}`,
        principalId,
        itemId,
        now,
        now,
        now,
      )
      expectedFavoriteHeads += 1
    }
  })

  seed()
  database.exec('ANALYZE')
  database.pragma('optimize')
  database.pragma('synchronous = FULL')

  const totalHeads = profile.posts
    + profile.tasks
    + profile.events
    + profile.announcements
    + profile.fileShares
  return {
    expectedVisibleHeads,
    expectedUnreadHeads,
    expectedPendingAcknowledgements,
    expectedOverdueTasks,
    expectedFavoriteHeads,
    totalFeedItems,
    totalHeads,
    supersededItems,
    liveDeltaHeads,
    forbiddenSourceIds,
    visibleGroupId,
    visibleGroupFileShareIds,
  }
}

function assertCondition(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Feed rehearsal assertion failed: ${message}`)
}

function percentile(values: number[], percentileValue: number): number {
  const ordered = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil((percentileValue / 100) * ordered.length) - 1)
  return ordered[index] ?? 0
}

function metric(values: number[]): ScenarioMetric {
  const total = values.reduce((sum, value) => sum + value, 0)
  return {
    samples: values.length,
    p50Ms: Number(percentile(values, 50).toFixed(2)),
    p95Ms: Number(percentile(values, 95).toFixed(2)),
    meanMs: Number((total / values.length).toFixed(2)),
    maxMs: Number(Math.max(...values).toFixed(2)),
  }
}

function entrySourceKey(entry: FeedListResult['items'][number]): string {
  return `${entry.kind}:${entry.id}`
}

function assertPageOrder(result: FeedListResult): void {
  for (let index = 1; index < result.items.length; index += 1) {
    const previous = result.items[index - 1]
    const current = result.items[index]
    if (!previous || !current) continue
    const previousTime = previous.kind === 'POST' ? previous.publishedAt : previous.occurredAt
    const currentTime = current.kind === 'POST' ? current.publishedAt : current.occurredAt
    assertCondition(
      Date.parse(previousTime) >= Date.parse(currentTime),
      'page entries must remain in descending time order',
    )
  }
}

async function timeScenario(
  service: FeedService,
  query: FeedListQuery,
  warmup: number,
  iterations: number,
): Promise<ScenarioMetric> {
  for (let index = 0; index < warmup; index += 1) {
    await service.list(principal, query)
  }
  const samples: number[] = []
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now()
    await service.list(principal, query)
    samples.push(performance.now() - startedAt)
  }
  return metric(samples)
}

function readGitEvidence(): { commit: string | null; dirty: boolean | null } {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return { commit, dirty: status.length > 0 }
  } catch {
    return { commit: null, dirty: null }
  }
}

const principal: AuthPrincipal = {
  userId: principalId,
  workspaceId,
  username: 'synthetic.user.0000',
  displayName: 'Synthetic User 0000',
  accountType: 'USER',
  primaryCompanyId: companyId,
  allowedCompanyIds: [companyId],
  authorizationVersion: 1,
  sessionId: 'session_feed_rehearsal',
  authAssurance: 1,
  restricted: false,
}

async function main(): Promise<void> {
  const profileName = parseProfile()
  const profile = profiles[profileName]
  const iterations = parseIntegerFlag('--iterations', profileName === 'representative' ? 20 : 4, 1, 100)
  const warmup = parseIntegerFlag('--warmup', profileName === 'representative' ? 3 : 1, 0, 20)
  const outputValue = parseStringFlag('--output')
    ?? `artifacts/feed-rehearsal-${profileName}.json`
  const outputPath = resolve(repoRoot, outputValue)
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'bert-feed-rehearsal-'))
  const databasePath = resolve(temporaryRoot, 'feed-rehearsal.db')
  let prisma: PrismaClient | undefined
  let rawDatabase: RehearsalDatabase | undefined
  const startedAt = new Date()

  console.log(`Feed rehearsal: ${profileName} profile`)
  console.log(
    `Fixture: ${profile.posts} posts, ${profile.tasks} tasks, ${profile.events} events, `
    + `${profile.announcements} announcements, ${profile.fileShares} synthetic file shares`,
  )

  try {
    rawDatabase = new Database(databasePath)
    const database = rawDatabase
    applyMigrations(database)
    const seedStartedAt = performance.now()
    const seedEvidence = seedDatabase(database, profile)
    const seedDurationMs = performance.now() - seedStartedAt
    const sqliteVersion = (
      database.prepare('SELECT sqlite_version() AS version').get() as { version: string }
    ).version
    const corePlan = database.prepare(`
      EXPLAIN QUERY PLAN
      SELECT "itemId", "occurredAt"
      FROM "FeedSourceHead"
      WHERE "workspaceId" = ?
        AND "companyId" = ?
      ORDER BY "occurredAt" DESC, "itemId" DESC
      LIMIT 51
    `).all(workspaceId, companyId) as QueryPlanRow[]
    const recipientPlan = database.prepare(`
      EXPLAIN QUERY PLAN
      SELECT "itemId"
      FROM "FeedItemRecipient"
      WHERE "userId" = ?
        AND "itemId" = ?
      LIMIT 1
    `).all(principalId, 'fitem_task_0000001') as QueryPlanRow[]
    const unreadPlan = database.prepare(`
      EXPLAIN QUERY PLAN
      SELECT "itemId", "occurredAt"
      FROM "FeedSourceHead"
      WHERE "workspaceId" = ?
        AND "companyId" = ?
        AND "countsAsUnread" = true
      ORDER BY "occurredAt" DESC, "itemId" DESC
      LIMIT 1001
    `).all(workspaceId, companyId) as QueryPlanRow[]
    const integrity = database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM "FeedSourceHead") AS "headCount",
        (
          SELECT COUNT(*)
          FROM (
            SELECT "workspaceId", "companyId", "sourceType", "sourceId"
            FROM "FeedItem"
            GROUP BY "workspaceId", "companyId", "sourceType", "sourceId"
          )
        ) AS "distinctSourceCount",
        (
          SELECT COUNT(*)
          FROM "FeedSourceHead" head
          JOIN "FeedItem" item ON item."id" = head."itemId"
          WHERE item."workspaceId" <> head."workspaceId"
             OR item."companyId" <> head."companyId"
             OR item."sourceType" <> head."sourceType"
             OR item."sourceId" <> head."sourceId"
             OR item."sourceVersion" <> head."sourceVersion"
             OR item."countsAsUnread" <> head."countsAsUnread"
             OR item."occurredAt" <> head."occurredAt"
        ) AS "mismatchedHeads"
    `).get() as {
      headCount: number
      distinctSourceCount: number
      mismatchedHeads: number
    }
    assertCondition(
      integrity.headCount === seedEvidence.totalHeads,
      'head count must equal the seeded source count',
    )
    assertCondition(
      integrity.headCount === integrity.distinctSourceCount,
      'each source identity must have exactly one head',
    )
    assertCondition(integrity.mismatchedHeads === 0, 'all heads must match their immutable item')
    const expectedIndex = 'FeedSourceHead_workspaceId_companyId_occurredAt_itemId_idx'
    const expectedUnreadIndex = 'FeedSourceHead_workspaceId_companyId_countsAsUnread_occurredAt_itemId_idx'
    assertCondition(
      corePlan.some((row) => row.detail.includes(expectedIndex)),
      'core ordered scan must use the FeedSourceHead covering index',
    )
    assertCondition(
      corePlan.every((row) => !row.detail.includes('USE TEMP B-TREE')),
      'core ordered scan must not allocate a temporary sort tree',
    )
    assertCondition(
      unreadPlan.some((row) => row.detail.includes(expectedUnreadIndex)),
      'unread head scan must use the bounded live-delta covering index',
    )
    assertCondition(
      unreadPlan.every((row) => !row.detail.includes('USE TEMP B-TREE')),
      'unread head scan must not allocate a temporary sort tree',
    )
    database.close()
    rawDatabase = undefined

    prisma = new PrismaClient({
      adapter: new PrismaBetterSqlite3({
        url: `file:${databasePath.replaceAll('\\', '/')}`,
      }),
    })
    await prisma.$connect()
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON')
    await prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL')
    await prisma.$executeRawUnsafe('PRAGMA synchronous = FULL')
    await prisma.$executeRawUnsafe('PRAGMA busy_timeout = 5000')
    const prismaService = prisma as unknown as PrismaService
    const scope = new ScopeService()
    const files = null as unknown as FilesService
    const feed = new FeedService(prismaService, scope, files)
    const baseQuery: FeedListQuery = {
      company: 'all',
      filter: 'ALL',
      type: 'ALL',
      limit: 50,
    }

    const firstPage = await feed.list(principal, baseQuery)
    assertCondition(firstPage.items.length === 50, 'first page must be full')
    assertCondition(firstPage.nextCursor, 'representative first page must have a cursor')
    assertCondition(
      firstPage.unreadCount === seedEvidence.expectedUnreadHeads,
      `unread must count current accessible live-delta heads once; expected ${seedEvidence.expectedUnreadHeads}, got ${firstPage.unreadCount}`,
    )
    assertCondition(
      firstPage.attention.pendingAcknowledgements === seedEvidence.expectedPendingAcknowledgements,
      'pending acknowledgement count must match the accessible current-version oracle',
    )
    assertCondition(
      firstPage.attention.overdueTasks === seedEvidence.expectedOverdueTasks,
      'overdue task attention count must match the synthetic canonical task oracle',
    )
    assertPageOrder(firstPage)

    const firstKeys = new Set(firstPage.items.map(entrySourceKey))
    assertCondition(
      firstKeys.size === firstPage.items.length,
      'a page must never contain duplicate source identities',
    )
    const secondPageQuery: FeedListQuery = {
      ...baseQuery,
      cursor: firstPage.nextCursor ?? undefined,
    }
    const secondPage = await feed.list(principal, secondPageQuery)
    assertCondition(secondPage.items.length === 50, 'second page must be full')
    assertCondition(
      secondPage.items.every((entry) => !firstKeys.has(entrySourceKey(entry))),
      'cursor pagination must not repeat source identities across adjacent pages',
    )
    assertPageOrder(secondPage)

    const traversedKeys = new Set<string>()
    let traversalCursor: string | undefined
    let traversedPages = 0
    for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
      const page = await feed.list(principal, {
        ...baseQuery,
        cursor: traversalCursor,
      })
      for (const entry of page.items) {
        const key = entrySourceKey(entry)
        assertCondition(!traversedKeys.has(key), `cursor traversal repeated ${key}`)
        traversedKeys.add(key)
      }
      traversedPages += 1
      if (!page.nextCursor) break
      traversalCursor = page.nextCursor
    }

    const typeResults = new Map<string, FeedListResult>()
    for (const type of ['POST', 'TASK', 'EVENT', 'ANNOUNCEMENT', 'FILE'] as const) {
      const result = await feed.list(principal, { ...baseQuery, type })
      typeResults.set(type, result)
      assertCondition(result.items.length > 0, `${type} scenario must return visible rows`)
      assertCondition(
        result.items.every((entry) =>
          type === 'POST'
            ? entry.kind === 'POST'
            : entry.kind === 'SOURCE' && entry.sourceType === type),
        `${type} filter must not return another source type`,
      )
      const forbiddenId = seedEvidence.forbiddenSourceIds[type]
      assertCondition(
        !forbiddenId || result.items.every((entry) => entry.id !== forbiddenId),
        `${type} ACL canary must stay hidden`,
      )
    }

    const acknowledgementResult = await feed.list(principal, {
      ...baseQuery,
      filter: 'ACK_REQUIRED',
      type: 'POST',
    })
    assertCondition(
      acknowledgementResult.items.length > 0
      && acknowledgementResult.items.every((entry) =>
        entry.kind === 'POST' && entry.acknowledgementRequiredForMe),
      'acknowledgement filter must contain only unresolved current-version actions',
    )
    const groupResult = await feed.list(principal, {
      ...baseQuery,
      groupId: seedEvidence.visibleGroupId,
    })
    const visibleGroupFileIds = new Set(seedEvidence.visibleGroupFileShareIds)
    assertCondition(
      groupResult.items.length > 0
      && groupResult.items.every((entry) =>
        entry.kind === 'POST'
          ? entry.group?.id === seedEvidence.visibleGroupId
          : entry.sourceType === 'FILE' && visibleGroupFileIds.has(entry.id)),
      'group facet must return only the exact visible group context',
    )

    const scenarioQueries: Record<string, FeedListQuery> = {
      allFirstPage: baseQuery,
      allCursorPage: secondPageQuery,
      posts: { ...baseQuery, type: 'POST' },
      tasks: { ...baseQuery, type: 'TASK' },
      acknowledgementInbox: {
        ...baseQuery,
        filter: 'ACK_REQUIRED',
        type: 'POST',
      },
      exactGroup: { ...baseQuery, groupId: seedEvidence.visibleGroupId },
      files: { ...baseQuery, type: 'FILE' },
    }
    const timings: Record<string, ScenarioMetric> = {}
    for (const [name, query] of Object.entries(scenarioQueries)) {
      timings[name] = await timeScenario(feed, query, warmup, iterations)
      console.log(
        `${name}: p50 ${timings[name].p50Ms.toFixed(2)} ms, `
        + `p95 ${timings[name].p95Ms.toFixed(2)} ms`,
      )
    }

    await prisma.$disconnect()
    prisma = undefined
    const databaseBytes = statSync(databasePath).size
    const git = readGitEvidence()
    const evidence = {
      schemaVersion: 1,
      kind: 'bertcrm.feed.representative-load-evidence',
      generatedAt: new Date().toISOString(),
      evidenceStatus: 'PASS',
      performanceAcceptance: 'MEASURED_BASELINE_NO_APPROVED_SLA',
      caveat: 'This is a deterministic local baseline, not production capacity approval and not a substitute for DDB-004 or D-020.',
      sourceBasis: {
        document: 'docs/bitrix24-database-migration-plan.md',
        measuredSourceFingerprint: {
          canonicalBlogPosts: 5_573,
          canonicalBlogComments: 7_357,
          taskActivityRows: 150_534,
          calendarActivityRows: 639,
          importantActivityRows: 133,
          activeUsers: 515,
          activeGroups: 54,
        },
        profile: profileName,
        fixture: profile,
        syntheticExtension: {
          standaloneFileShares: profile.fileShares,
          reason: 'Target-native file share cards have no approved Bitrix source count yet; the bounded fixture exercises the new ACL/scanner query branch without claiming source representativeness.',
        },
        liveDeltaAssumption: {
          heads: seedEvidence.liveDeltaHeads,
          reason: 'Historical materialization is silent and seeds read cursors; only a bounded synthetic post-cutover delta counts as unread.',
        },
      },
      isolation: {
        generatedDataOnly: true,
        containsProductionPii: false,
        modifiedDevelopmentDatabase: false,
        temporaryDatabaseRemovedAfterRun: true,
      },
      environment: {
        platform: platform(),
        release: release(),
        arch: arch(),
        node: process.version,
        sqlite: sqliteVersion,
        cpuModel: cpus()[0]?.model ?? 'unknown',
        logicalCpuCount: cpus().length,
        totalMemoryBytes: totalmem(),
        databaseBytes,
        gitCommit: git.commit,
        workingTreeDirty: git.dirty,
      },
      execution: {
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        seedDurationMs: Number(seedDurationMs.toFixed(2)),
        warmupPerScenario: warmup,
        measuredIterationsPerScenario: iterations,
      },
      fixtureEvidence: {
        ...seedEvidence,
        forbiddenSourceIds: Object.values(seedEvidence.forbiddenSourceIds),
      },
      correctness: {
        status: 'PASS',
        firstPageItems: firstPage.items.length,
        secondPageItems: secondPage.items.length,
        traversedPages,
        uniqueTraversedSourceIdentities: traversedKeys.size,
        unreadCount: firstPage.unreadCount,
        pendingAcknowledgements: firstPage.attention.pendingAcknowledgements,
        overdueTasks: firstPage.attention.overdueTasks,
        sourceHeadIntegrity: integrity,
        checks: [
          'one current head per workspace/company/source identity',
          'head points to matching immutable FeedItem and cannot regress',
          'no adjacent-page or bounded-traversal source duplicates',
          'current-head unread count matches the deterministic live-delta ACL oracle',
          'post/task/event/announcement/file ACL canaries remain hidden',
          'acknowledgement and exact-group facets remain relevant',
        ],
      },
      queryPlans: {
        status: 'PASS',
        coreOrderedHeadScan: corePlan.map((row) => row.detail),
        unreadHeadScan: unreadPlan.map((row) => row.detail),
        recipientProbe: recipientPlan.map((row) => row.detail),
        requiredCoreIndex: expectedIndex,
        requiredUnreadIndex: expectedUnreadIndex,
        temporarySortObserved: [...corePlan, ...unreadPlan]
          .some((row) => row.detail.includes('USE TEMP B-TREE')),
      },
      timings,
    }
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    console.log(`Evidence: ${relative(repoRoot, outputPath)}`)
  } finally {
    if (prisma) await prisma.$disconnect()
    rawDatabase?.close()
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Feed rehearsal failed')
  process.exitCode = 1
})
