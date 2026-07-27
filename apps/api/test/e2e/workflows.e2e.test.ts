import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import request from 'supertest';
import type { ChatThreadDetail, OrganizationCapabilityView, FeedListResult, ImportReadinessView, PrincipalView, TaskDetailView } from '@bert-crm/contracts';
import { resetConfigForTests } from '../../src/config/config.js';
import { hashPassword } from '../../src/common/crypto.js';
import { configureApp } from '../../src/bootstrap.js';
import { FeedProjectionService } from '../../src/modules/feed/feed-projection.service.js';
import { JobsService } from '../../src/modules/jobs/jobs.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

const database = resolve('test/tmp/e2e.db');
let app: INestApplication;

beforeAll(async () => {
  mkdirSync(dirname(database), { recursive: true });
  copyFileSync(resolve('prisma/dev.db'), database);
  const migrationDb = new Database(database);
  if (!migrationDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'CompanyCapability'").get()) {
    migrationDb.exec(readFileSync(resolve('prisma/migrations/20260722180000_company_capabilities/migration.sql'), 'utf8'));
  }
  if (!migrationDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'OrgUnit'").get()) {
    migrationDb.exec(readFileSync(resolve('prisma/migrations/20260722193000_group_org_kernel/migration.sql'), 'utf8'));
  }
  if (!migrationDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ImportDataset'").get()) {
    migrationDb.exec(readFileSync(resolve('prisma/migrations/20260723113000_import_control_plane/migration.sql'), 'utf8'));
  }
  if (!migrationDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'FeedPost'").get()) {
    migrationDb.exec(readFileSync(resolve('prisma/migrations/20260723150000_feed_kernel/migration.sql'), 'utf8'));
  }
  if (!migrationDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'FeedItemRecipient'").get()) {
    migrationDb.exec(readFileSync(resolve('prisma/migrations/20260723173000_feed_source_projections/migration.sql'), 'utf8'));
  }
  if (!migrationDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'FeedUserItemState'").get()) {
    migrationDb.exec(readFileSync(resolve('prisma/migrations/20260723193000_feed_favorites/migration.sql'), 'utf8'));
  }
  if (!migrationDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'FeedFileShare'").get()) {
    migrationDb.exec(readFileSync(resolve('prisma/migrations/20260723211500_feed_file_shares/migration.sql'), 'utf8'));
  }
  if (!migrationDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'FeedSourceHead'").get()) {
    migrationDb.exec(readFileSync(resolve('prisma/migrations/20260723223000_feed_source_heads/migration.sql'), 'utf8'));
  }
  if (!migrationDb.prepare("SELECT name FROM pragma_table_info('FeedSourceHead') WHERE name = 'countsAsUnread'").get()) {
    migrationDb.exec(readFileSync(resolve('prisma/migrations/20260723224500_feed_source_head_unread/migration.sql'), 'utf8'));
  }
  if (!migrationDb.prepare("SELECT name FROM pragma_table_info('Task') WHERE name = 'parentTaskId'").get()) {
    migrationDb.exec(readFileSync(resolve('prisma/migrations/20260724090000_task_hierarchy/migration.sql'), 'utf8'));
  }
  if (!migrationDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'TaskParticipant'").get()) {
    migrationDb.exec(readFileSync(resolve('prisma/migrations/20260724120000_task_participants/migration.sql'), 'utf8'));
  }
  if (!migrationDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'TaskFollower'").get()) {
    migrationDb.exec(readFileSync(resolve('prisma/migrations/20260724150000_task_personal_workflow/migration.sql'), 'utf8'));
  }
  if (!migrationDb.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'Comment_task_scope_guard_insert'").get()) {
    migrationDb.exec(readFileSync(resolve('prisma/migrations/20260724180000_task_content_context/migration.sql'), 'utf8'));
  }
  if (!migrationDb.prepare("SELECT name FROM pragma_table_info('ThreadParticipant') WHERE name = 'notificationMode'").get()) {
    migrationDb.exec(readFileSync(resolve('prisma/migrations/20260724210000_chat_core/migration.sql'), 'utf8'));
  }
  if (!migrationDb.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'FileLink_message_scope_guard_insert'").get()) {
    migrationDb.exec(readFileSync(resolve('prisma/migrations/20260724233000_chat_collaboration/migration.sql'), 'utf8'));
  }
  if (!migrationDb.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'EntityLink_event_message_scope_guard_insert'").get()) {
    migrationDb.exec(readFileSync(resolve('prisma/migrations/20260725090000_chat_message_conversions/migration.sql'), 'utf8'));
  }
  migrationDb.prepare("UPDATE CompanyCapability SET enabled = true, enabledAt = CURRENT_TIMESTAMP, disabledAt = NULL WHERE companyId = ? AND code = 'CALENDAR_WRITE'").run('cmp_bert_ua');
  migrationDb.prepare("UPDATE CompanyCapability SET enabled = false, enabledById = NULL, enabledAt = NULL, disabledAt = CURRENT_TIMESTAMP WHERE companyId = ? AND code = 'FEED'").run('cmp_bert_ua');
  migrationDb.prepare("UPDATE CompanyCapability SET enabled = false, enabledById = NULL, enabledAt = NULL, disabledAt = CURRENT_TIMESTAMP WHERE companyId = ? AND code = 'GROUPS_UI'").run('cmp_bert_ua');
  migrationDb.prepare("UPDATE User SET primaryCompanyId = ? WHERE workspaceId = ?").run('cmp_bert_ua', 'ws_bert');
  migrationDb.prepare('DELETE FROM LoginAttempt').run();
  migrationDb.prepare('UPDATE PasswordCredential SET passwordHash = ?').run(await hashPassword('BertDemoPassphrase2026!'));
  migrationDb.prepare("UPDATE User SET status = 'ACTIVE', mustChangePassword = false").run();
  migrationDb.close();
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = `file:${database.replaceAll('\\', '/')}`;
  process.env.DISABLE_JOB_WORKER = 'true';
  resetConfigForTests();
  const { AppModule } = await import('../../src/app.module.js');
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = module.createNestApplication();
  configureApp(app);
  await app.init();
});

afterAll(async () => {
  await app?.close();
  rmSync(dirname(database), { recursive: true, force: true });
});

async function login(username: string) {
  const agent = request.agent(app.getHttpServer());
  const response = await agent
    .post('/api/v1/auth/login')
    .send({ username, password: 'BertDemoPassphrase2026!' })
    .expect(201);
  expect(response.body.nextStep).toBe('AUTHENTICATED');
  return { agent, csrf: response.body.csrfToken as string };
}

describe('BERT CRM API workflows', () => {
  it('enforces CSRF and organization-safe authenticated projections', async () => {
    const { agent } = await login('maria');
    const me = await agent.get('/api/v1/me').expect(200);
    const principal = me.body as PrincipalView;
    expect(principal.username).toBe('maria');
    expect(principal.permissions).toContain('tasks.read');
    const feedCapability = principal.capabilities.find((item) => item.code === 'FEED');
    expect(feedCapability).toMatchObject({ code: 'FEED', enabled: false });
    expect(typeof feedCapability?.version).toBe('number');
    await agent.post('/api/v1/auth/logout').expect(403);
    const dashboard = await agent.get('/api/v1/dashboard').expect(200);
    expect(dashboard.body).toHaveProperty('tasks');
    expect(JSON.stringify(dashboard.body)).not.toContain('privateHrComment');
  });

  it('rolls an organization capability out atomically with version, audit, and outbox evidence', async () => {
    const dmytro = await login('dmytro');
    const before = await dmytro.agent
      .get('/api/v1/admin/organization/capabilities')
      .expect(200);
    const feed = (before.body as { items: OrganizationCapabilityView[] }).items.find((item) => item.code === 'FEED');
    if (!feed) throw new Error('FEED capability is missing from the organization response');
    expect(feed).toMatchObject({ enabled: false });

    const updated = await dmytro.agent
      .patch('/api/v1/admin/organization/capabilities/FEED')
      .set('x-csrf-token', dmytro.csrf)
      .send({ enabled: true, expectedVersion: feed.version })
      .expect(200);
    expect(updated.body as OrganizationCapabilityView).toMatchObject({ code: 'FEED', enabled: true, version: feed.version + 1 });

    await dmytro.agent
      .patch('/api/v1/admin/organization/capabilities/FEED')
      .set('x-csrf-token', dmytro.csrf)
      .send({ enabled: false, expectedVersion: feed.version })
      .expect(409);

    const me = await dmytro.agent.get('/api/v1/me').expect(200);
    const principal = me.body as PrincipalView;
    expect(principal.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FEED', enabled: true, version: feed.version + 1 }),
    ]));
    const prisma = app.get(PrismaService);
    expect(await prisma.auditEvent.findFirst({ where: { action: 'company.capability_changed', companyId: 'cmp_bert_ua' } })).not.toBeNull();
    expect(await prisma.outboxEvent.findFirst({ where: { eventType: 'capability.changed' } })).not.toBeNull();
  });

  it('publishes a private-safe feed with explicit acknowledgement and a monotonic read cursor', async () => {
    const maria = await login('maria');
    const prisma = app.get(PrismaService);
    await prisma.group.upsert({
      where: { id: 'grp_product_design' },
      create: {
        id: 'grp_product_design',
        workspaceId: 'ws_bert',
        companyId: 'cmp_bert_ua',
        key: 'product-design',
        name: 'Продукт і дизайн',
        description: 'Рішення та оновлення продуктової команди',
        discoverability: 'LISTED',
        joinPolicy: 'OPEN',
        ownerId: 'usr_maria',
      },
      update: { status: 'ACTIVE', archivedAt: null },
    });
    for (const [userId, role] of [['usr_maria', 'OWNER'], ['usr_andrii', 'MEMBER']] as const) {
      await prisma.groupMember.upsert({
        where: { groupId_userId: { groupId: 'grp_product_design', userId } },
        create: { id: `gm_feed_${userId}`, groupId: 'grp_product_design', userId, role },
        update: { role, leftAt: null },
      });
    }
    await prisma.group.upsert({
      where: { id: 'grp_people_private' },
      create: {
        id: 'grp_people_private',
        workspaceId: 'ws_bert',
        companyId: 'cmp_bert_ua',
        key: 'people-private',
        name: 'Люди · приватна група',
        description: 'Конфіденційний робочий контекст HR',
        discoverability: 'HIDDEN',
        joinPolicy: 'INVITE_ONLY',
        ownerId: 'usr_olena',
      },
      update: { status: 'ACTIVE', archivedAt: null },
    });
    await prisma.groupMember.upsert({
      where: { groupId_userId: { groupId: 'grp_people_private', userId: 'usr_olena' } },
      create: {
        id: 'gm_feed_private_olena',
        groupId: 'grp_people_private',
        userId: 'usr_olena',
        role: 'OWNER',
      },
      update: { role: 'OWNER', leftAt: null },
    });
    const firstKey = `feed-e2e-first-${Date.now()}`;
    const first = await maria.agent
      .post('/api/v1/feed')
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', firstKey)
      .send({
        companyId: 'cmp_bert_ua',
        body: 'Перше контрольне оновлення для всієї компанії.',
        audience: { type: 'COMPANY' },
        requiresAcknowledgement: true,
      })
      .expect(201);
    const firstBody = first.body as { id: string; version: number };
    const repeated = await maria.agent
      .post('/api/v1/feed')
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', firstKey)
      .send({
        companyId: 'cmp_bert_ua',
        body: 'Перше контрольне оновлення для всієї компанії.',
        audience: { type: 'COMPANY' },
        requiresAcknowledgement: true,
      })
      .expect(201);
    expect((repeated.body as { id: string }).id).toBe(firstBody.id);

    const second = await maria.agent
      .post('/api/v1/feed')
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', `feed-e2e-second-${Date.now()}`)
      .send({
        companyId: 'cmp_bert_ua',
        body: 'Друге контрольне оновлення для перевірки курсора.',
        audience: { type: 'COMPANY' },
        requiresAcknowledgement: false,
      })
      .expect(201);
    const secondBody = second.body as { id: string };
    const groupPost = await maria.agent
      .post('/api/v1/feed')
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', `feed-e2e-group-${Date.now()}`)
      .send({
        companyId: 'cmp_bert_ua',
        body: 'Оновлення лише для робочої групи продукту й дизайну.',
        audience: { type: 'GROUP', groupId: 'grp_product_design' },
        requiresAcknowledgement: false,
      })
      .expect(201);
    const groupPostBody = groupPost.body as { id: string };

    const andrii = await login('andrii');
    const listed = await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua')
      .expect(200);
    const listedBody = listed.body as FeedListResult;
    const firstView = listedBody.items.find((item) => item.id === firstBody.id);
    if (!firstView) throw new Error('Published Feed item is missing from the authorized list');
    const firstItemId = firstView.itemId;
    expect(firstView).toMatchObject({
      acknowledgementRequiredForMe: true,
      hasAcknowledged: false,
      acknowledgementVersion: 1,
    });
    await andrii.agent.get(`/api/v1/feed/${firstBody.id}`).expect(200);
    const stillPending = await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua&filter=ACK_REQUIRED')
      .expect(200);
    expect((stillPending.body as FeedListResult).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstBody.id, hasAcknowledged: false }),
    ]));

    await andrii.agent
      .post(`/api/v1/feed/${firstBody.id}/acknowledge`)
      .set('x-csrf-token', andrii.csrf)
      .send({ acknowledgementVersion: 1 })
      .expect(201);
    const afterAcknowledgement = await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua&filter=ACK_REQUIRED')
      .expect(200);
    expect((afterAcknowledgement.body as FeedListResult).items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstBody.id }),
    ]));

    const comment = await andrii.agent
      .post(`/api/v1/feed/${firstBody.id}/comments`)
      .set('x-csrf-token', andrii.csrf)
      .send({ body: 'Коментар першого рівня.' })
      .expect(201);
    const commentBody = comment.body as { id: string };
    expect(await app.get(PrismaService).notification.findFirst({
      where: { dedupeKey: `feed-comment:${commentBody.id}:usr_maria` },
    })).not.toBeNull();
    await maria.agent
      .post(`/api/v1/feed/${firstBody.id}/comments`)
      .set('x-csrf-token', maria.csrf)
      .send({ body: 'Відповідь другого рівня.', replyToCommentId: commentBody.id })
      .expect(201);
    const nestedComment = await app.get(PrismaService).comment.findFirstOrThrow({
      where: { entityType: 'FEED_POST', entityId: firstBody.id, replyToCommentId: commentBody.id },
    });
    const nestedReply = await andrii.agent
      .post(`/api/v1/feed/${firstBody.id}/comments`)
      .set('x-csrf-token', andrii.csrf)
      .send({ body: 'Заборонений третій рівень.', replyToCommentId: nestedComment.id })
      .expect(400);
    expect((nestedReply.body as { code: string }).code).toBe('feed_comment_reply_depth');

    const unsubscribed = await andrii.agent
      .delete(`/api/v1/feed/${firstBody.id}/subscription`)
      .set('x-csrf-token', andrii.csrf)
      .expect(200);
    expect(unsubscribed.body as { notificationMode: string }).toEqual({ notificationMode: 'NONE' });
    await andrii.agent
      .post(`/api/v1/feed/${firstBody.id}/comments`)
      .set('x-csrf-token', andrii.csrf)
      .send({ body: 'A comment must not silently turn notifications back on.' })
      .expect(201);
    expect(await app.get(PrismaService).feedSubscription.findUniqueOrThrow({
      where: { postId_userId: { postId: firstBody.id, userId: 'usr_andrii' } },
    })).toMatchObject({ mode: 'NONE' });
    const notFollowing = await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua&filter=FOLLOWING')
      .expect(200);
    expect((notFollowing.body as FeedListResult).items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstBody.id }),
    ]));

    await andrii.agent
      .put(`/api/v1/feed/${firstBody.id}/subscription`)
      .set('x-csrf-token', andrii.csrf)
      .send({ notificationMode: 'MENTIONS' })
      .expect(200);
    const following = await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua&filter=FOLLOWING')
      .expect(200);
    expect((following.body as FeedListResult).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstBody.id, subscriptionMode: 'MENTIONS' }),
    ]));
    const ordinaryComment = await maria.agent
      .post(`/api/v1/feed/${firstBody.id}/comments`)
      .set('x-csrf-token', maria.csrf)
      .send({ body: 'An ordinary comment should not notify mention-only followers.' })
      .expect(201);
    expect(await app.get(PrismaService).notification.findFirst({
      where: { dedupeKey: `feed-comment:${(ordinaryComment.body as { id: string }).id}:usr_andrii` },
    })).toBeNull();
    const mentionComment = await maria.agent
      .post(`/api/v1/feed/${firstBody.id}/comments`)
      .set('x-csrf-token', maria.csrf)
      .send({ body: 'An explicit mention should notify.', mentionedUserIds: ['usr_andrii'] })
      .expect(201);
    expect(await app.get(PrismaService).notification.findFirst({
      where: { dedupeKey: `feed-comment:${(mentionComment.body as { id: string }).id}:usr_andrii` },
    })).toMatchObject({ category: 'MENTION', entityType: 'FEED_POST', entityId: firstBody.id });
    const authorOptions = await andrii.agent
      .get('/api/v1/feed/authors?company=cmp_bert_ua')
      .expect(200);
    expect((authorOptions.body as { items: Array<{ id: string }> }).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'usr_maria' }),
    ]));
    const audienceFacetOptions = await andrii.agent
      .get('/api/v1/feed/facets/audiences?company=cmp_bert_ua')
      .expect(200);
    expect((audienceFacetOptions.body as { items: Array<{ type: string; id: string; queryKey: string }> }).items)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'COMPANY', id: 'cmp_bert_ua', queryKey: 'audienceId' }),
        expect.objectContaining({ type: 'GROUP', id: 'grp_product_design', queryKey: 'groupId' }),
      ]));
    expect((audienceFacetOptions.body as { items: Array<{ id: string }> }).items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'grp_people_private' })]),
    );
    const companyAudience = await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua&type=POST&audienceId=cmp_bert_ua')
      .expect(200);
    expect((companyAudience.body as FeedListResult).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'POST', id: firstBody.id }),
      expect.objectContaining({ kind: 'POST', id: secondBody.id }),
    ]));
    expect((companyAudience.body as FeedListResult).items.every((item) => item.kind === 'POST')).toBe(true);
    const groupContext = await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua&groupId=grp_product_design')
      .expect(200);
    const groupItems = (groupContext.body as FeedListResult).items;
    const groupItem = groupItems.find((item) => item.id === groupPostBody.id);
    if (groupItem?.kind !== 'POST') throw new Error('Group Feed item is missing from the exact context facet');
    expect(groupItem.group?.id).toBe('grp_product_design');
    expect(groupItems.every((item) =>
      item.kind === 'POST' && item.group?.id === 'grp_product_design')).toBe(true);
    const hiddenGroupContext = await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua&groupId=grp_people_private')
      .expect(200);
    expect((hiddenGroupContext.body as FeedListResult).items).toEqual([]);
    const kyivDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const mentionedByMaria = await andrii.agent
      .get(
        `/api/v1/feed?company=cmp_bert_ua&type=POST&authorId=usr_maria&mentioned=true`
        + `&dateFrom=${kyivDate}&dateTo=${kyivDate}`,
      )
      .expect(200);
    expect((mentionedByMaria.body as FeedListResult).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'POST', id: firstBody.id }),
    ]));
    expect((mentionedByMaria.body as FeedListResult).items.every((item) => item.kind === 'POST')).toBe(true);
    await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua&dateFrom=2026-08-01&dateTo=2026-07-01')
      .expect(400);

    await andrii.agent
      .put(`/api/v1/feed/items/${firstItemId}/favorite`)
      .set('x-csrf-token', andrii.csrf)
      .expect(200, { favorited: true });
    const favoriteItems = await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua&favorite=true')
      .expect(200);
    expect((favoriteItems.body as FeedListResult).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstBody.id, itemId: firstItemId, favoritedByMe: true }),
    ]));
    const mariaFavorites = await maria.agent
      .get('/api/v1/feed?company=cmp_bert_ua&favorite=true')
      .expect(200);
    expect((mariaFavorites.body as FeedListResult).items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: firstItemId }),
    ]));
    const importantItems = await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua&type=POST&important=true')
      .expect(200);
    expect((importantItems.body as FeedListResult).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstBody.id, requiresAcknowledgement: true }),
    ]));
    expect((importantItems.body as FeedListResult).items.every((item) =>
      item.kind === 'POST' && item.requiresAcknowledgement)).toBe(true);
    await andrii.agent
      .delete(`/api/v1/feed/items/${firstItemId}/favorite`)
      .set('x-csrf-token', andrii.csrf)
      .expect(200, { favorited: false });
    await andrii.agent
      .delete(`/api/v1/feed/items/${firstItemId}/favorite`)
      .set('x-csrf-token', andrii.csrf)
      .expect(200, { favorited: false });

    const liked = await andrii.agent
      .post(`/api/v1/feed/${firstBody.id}/reactions/like`)
      .set('x-csrf-token', andrii.csrf)
      .expect(201);
    expect(liked.body as { liked: boolean; count: number }).toMatchObject({ liked: true, count: 1 });

    const feedItems = await prisma.feedItem.findMany({
      where: { postId: { in: [firstBody.id, secondBody.id] } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });
    expect(feedItems).toHaveLength(2);
    await andrii.agent
      .post('/api/v1/feed/read')
      .set('x-csrf-token', andrii.csrf)
      .send({ markers: [{ companyId: 'cmp_bert_ua', lastItemId: feedItems[0].id }] })
      .expect(201);
    await andrii.agent
      .post('/api/v1/feed/read')
      .set('x-csrf-token', andrii.csrf)
      .send({ markers: [{ companyId: 'cmp_bert_ua', lastItemId: feedItems[1].id }] })
      .expect(201);
    expect(await prisma.feedReadCursor.findUniqueOrThrow({
      where: { userId_companyId: { userId: 'usr_andrii', companyId: 'cmp_bert_ua' } },
    })).toMatchObject({ lastReadItemId: feedItems[0].id });

    const privatePost = await maria.agent
      .post('/api/v1/feed')
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', `feed-e2e-private-${Date.now()}`)
      .send({
        companyId: 'cmp_bert_ua',
        body: 'Приватне оновлення лише для Марії.',
        audience: { type: 'USERS', userIds: ['usr_maria'] },
      })
      .expect(201);
    const privatePostBody = privatePost.body as { id: string };
    const privateItem = await prisma.feedItem.findFirstOrThrow({
      where: { postId: privatePostBody.id },
      select: { id: true },
    });
    const mariaDirectAudience = await maria.agent
      .get('/api/v1/feed?company=cmp_bert_ua&type=POST&audienceId=usr_maria')
      .expect(200);
    expect((mariaDirectAudience.body as FeedListResult).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'POST', id: privatePostBody.id }),
    ]));
    const mariaAudienceFacetOptions = await maria.agent
      .get('/api/v1/feed/facets/audiences?company=cmp_bert_ua')
      .expect(200);
    expect((mariaAudienceFacetOptions.body as { items: Array<{ type: string; id: string }> }).items)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'USER', id: 'usr_maria' }),
      ]));
    await andrii.agent.get(`/api/v1/feed/${privatePostBody.id}`).expect(404);
    const outsiderDirectAudience = await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua&type=POST&audienceId=usr_maria')
      .expect(200);
    expect((outsiderDirectAudience.body as FeedListResult).items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: privatePostBody.id }),
    ]));
    await andrii.agent
      .put(`/api/v1/feed/items/${privateItem.id}/favorite`)
      .set('x-csrf-token', andrii.csrf)
      .expect(404);
    await andrii.agent
      .put(`/api/v1/feed/${privatePostBody.id}/subscription`)
      .set('x-csrf-token', andrii.csrf)
      .send({ notificationMode: 'ALL' })
      .expect(404);
    await maria.agent
      .delete(`/api/v1/feed/${privatePostBody.id}`)
      .set('x-csrf-token', maria.csrf)
      .send({ expectedVersion: 1 })
      .expect(200);
    const afterArchive = await maria.agent
      .get('/api/v1/feed?company=cmp_bert_ua')
      .expect(200);
    expect((afterArchive.body as FeedListResult).items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: privatePostBody.id }),
    ]));

    await andrii.agent
      .put(`/api/v1/feed/items/${firstItemId}/favorite`)
      .set('x-csrf-token', andrii.csrf)
      .expect(200, { favorited: true });
    const updated = await maria.agent
      .patch(`/api/v1/feed/${firstBody.id}`)
      .set('x-csrf-token', maria.csrf)
      .send({
        body: 'Оновлена версія, яка потребує нового підтвердження.',
        expectedVersion: firstBody.version,
      })
      .expect(200);
    expect(updated.body as { version: number; acknowledgementVersion: number }).toMatchObject({ version: 2, acknowledgementVersion: 2 });
    const favoriteAfterEdit = await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua&favorite=true')
      .expect(200);
    const movedFavorite = (favoriteAfterEdit.body as FeedListResult).items.find((item) => item.id === firstBody.id);
    if (!movedFavorite) throw new Error('Favourite was not moved to the edited Feed projection');
    expect(movedFavorite).toMatchObject({ favoritedByMe: true });
    expect(movedFavorite.itemId).not.toBe(firstItemId);
    await andrii.agent
      .delete(`/api/v1/feed/items/${movedFavorite.itemId}/favorite`)
      .set('x-csrf-token', andrii.csrf)
      .expect(200, { favorited: false });
    await andrii.agent
      .post(`/api/v1/feed/${firstBody.id}/acknowledge`)
      .set('x-csrf-token', andrii.csrf)
      .send({ acknowledgementVersion: 1 })
      .expect(409);
    expect(await prisma.auditEvent.findFirst({
      where: { action: 'feed.post.published', entityId: firstBody.id },
    })).not.toBeNull();
    expect(await prisma.outboxEvent.findFirst({
      where: { eventType: 'feed.post.edited', aggregateId: firstBody.id },
    })).not.toBeNull();
  });

  it('shows canonical task sources, authorized attachments and silent imported history without duplicate bodies', async () => {
    const maria = await login('maria');
    const andrii = await login('andrii');
    const task = await maria.agent
      .post('/api/v1/tasks')
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', `feed-source-task-${Date.now()}`)
      .send({
        companyId: 'cmp_bert_ua',
        title: 'Перевірити канонічну картку у стрічці',
        description: 'Опис залишається в задачі, а не в FeedItem.',
        assigneeId: 'usr_andrii',
        priority: 'HIGH',
      })
      .expect(201);
    const taskId = (task.body as { id: string }).id;
    const taskFeed = await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua&type=TASK')
      .expect(200);
    const taskFeedItems = (taskFeed.body as FeedListResult).items;
    expect(taskFeedItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'SOURCE',
        id: taskId,
        sourceType: 'TASK',
        label: 'Нове призначення',
      }),
    ]));
    const taskFeedItem = taskFeedItems.find((item) => item.kind === 'SOURCE' && item.id === taskId);
    expect(taskFeedItem?.kind).toBe('SOURCE');
    if (taskFeedItem?.kind !== 'SOURCE') throw new Error('Task feed source is missing');
    expect(taskFeedItem.href).toContain(`/tasks/${taskId}`);
    const storedTaskProjection = await app.get(PrismaService).feedItem.findFirstOrThrow({
      where: { sourceType: 'TASK', sourceId: taskId, action: 'ASSIGNED' },
    });
    expect(storedTaskProjection.safePayload).not.toContain('Перевірити канонічну картку');
    await andrii.agent
      .put(`/api/v1/feed/items/${taskFeedItem.itemId}/favorite`)
      .set('x-csrf-token', andrii.csrf)
      .expect(200, { favorited: true });

    await maria.agent
      .patch(`/api/v1/tasks/${taskId}/status`)
      .set('x-csrf-token', maria.csrf)
      .send({ status: 'BLOCKED', expectedVersion: 1 })
      .expect(200);
    const blockedFeed = await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua&type=TASK')
      .expect(200);
    const blockedTaskViews = (blockedFeed.body as FeedListResult).items
      .filter((item) => item.kind === 'SOURCE' && item.id === taskId);
    expect(blockedTaskViews).toEqual([
      expect.objectContaining({ id: taskId, action: 'BLOCKED', label: 'Завдання заблоковано' }),
    ]);
    expect(blockedTaskViews[0]?.itemId).not.toBe(taskFeedItem.itemId);
    expect(await app.get(PrismaService).feedSourceHead.findUniqueOrThrow({
      where: {
        workspaceId_companyId_sourceType_sourceId: {
          workspaceId: 'ws_bert',
          companyId: 'cmp_bert_ua',
          sourceType: 'TASK',
          sourceId: taskId,
        },
      },
    })).toMatchObject({
      itemId: blockedTaskViews[0]?.itemId,
      sourceVersion: 2,
      countsAsUnread: true,
    });
    const favoriteTaskFeed = await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua&type=TASK&favorite=true')
      .expect(200);
    const movedTaskFavorite = (favoriteTaskFeed.body as FeedListResult).items.find((item) => item.id === taskId);
    if (!movedTaskFavorite) throw new Error('Favourite was not moved to the current Task projection');
    expect(movedTaskFavorite).toMatchObject({ action: 'BLOCKED', favoritedByMe: true });
    expect(movedTaskFavorite.itemId).not.toBe(taskFeedItem.itemId);
    await andrii.agent
      .delete(`/api/v1/feed/items/${movedTaskFavorite.itemId}/favorite`)
      .set('x-csrf-token', andrii.csrf)
      .expect(200, { favorited: false });

    const uploaded = await maria.agent
      .post('/api/v1/feed/attachments?company=cmp_bert_ua')
      .set('x-csrf-token', maria.csrf)
      .attach('file', Buffer.from('Feed attachment e2e\n'), {
        filename: 'feed-note.txt',
        contentType: 'text/plain',
      })
      .expect(201);
    const fileId = (uploaded.body as { id: string }).id;
    const jobs = app.get(JobsService);
    for (let index = 0; index < 20; index += 1) {
      await jobs.runOnce();
      const status = await maria.agent.get(`/api/v1/files/${fileId}/status`).expect(200);
      if ((status.body as { scanStatus: string }).scanStatus === 'CLEAN') break;
    }
    const post = await maria.agent
      .post('/api/v1/feed')
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', `feed-attachment-post-${Date.now()}`)
      .send({
        companyId: 'cmp_bert_ua',
        body: 'Публікація з безпечним вкладенням.',
        audience: { type: 'COMPANY' },
        attachmentIds: [fileId],
      })
      .expect(201);
    const postId = (post.body as { id: string }).id;
    const postDetail = await andrii.agent.get(`/api/v1/feed/${postId}`).expect(200);
    expect(postDetail.body).toMatchObject({
      kind: 'POST',
      attachments: [expect.objectContaining({ id: fileId, fileName: 'feed-note.txt', scanStatus: 'CLEAN' })],
    });
    await andrii.agent.get(`/api/v1/files/${fileId}/download`).expect(200);

    const prisma = app.get(PrismaService);
    const historicalEventId = `evt_history_${Date.now()}`;
    await prisma.event.create({
      data: {
        id: historicalEventId,
        workspaceId: 'ws_bert',
        companyId: 'cmp_bert_ua',
        ownerId: 'usr_andrii',
        title: 'Історична зустріч',
        startAt: new Date('2020-06-10T09:00:00.000Z'),
        endAt: new Date('2020-06-10T10:00:00.000Z'),
        sourceTimezone: 'Europe/Kyiv',
      },
    });
    const beforeHistory = await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua&type=EVENT')
      .expect(200);
    const projection = app.get(FeedProjectionService);
    const firstMaterialization = await projection.materializeHistoricalSources({
      companyId: 'cmp_bert_ua',
      cutoverAt: new Date('2020-06-30T23:59:59.000Z'),
      eventIds: [historicalEventId],
    });
    expect(firstMaterialization.created.events).toBe(1);
    const repeatedMaterialization = await projection.materializeHistoricalSources({
      companyId: 'cmp_bert_ua',
      cutoverAt: new Date('2020-06-30T23:59:59.000Z'),
      eventIds: [historicalEventId],
    });
    expect(repeatedMaterialization.created.events).toBe(0);
    const afterHistory = await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua&type=EVENT')
      .expect(200);
    expect((afterHistory.body as FeedListResult).unreadCount).toBe((beforeHistory.body as FeedListResult).unreadCount);
    expect((afterHistory.body as FeedListResult).items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'SOURCE',
        id: historicalEventId,
        sourceType: 'EVENT',
        historical: true,
      }),
    ]));
    expect(await prisma.feedItem.findFirstOrThrow({
      where: { sourceType: 'EVENT', sourceId: historicalEventId },
    })).toMatchObject({ countsAsUnread: false });
    expect(await prisma.feedReadCursor.findUnique({
      where: { userId_companyId: { userId: 'usr_andrii', companyId: 'cmp_bert_ua' } },
    })).not.toBeNull();
  });

  it('shares a standalone file explicitly, rechecks scan and audience ACL, and hides it after revoke', async () => {
    const dmytro = await login('dmytro');
    const andrii = await login('andrii');
    const maria = await login('maria');
    const uploaded = await dmytro.agent
      .post('/api/v1/feed/attachments?company=cmp_bert_ua')
      .set('x-csrf-token', dmytro.csrf)
      .attach('file', Buffer.from('Standalone feed file without projected metadata\n'), {
        filename: 'standalone-plan.txt',
        contentType: 'text/plain',
      })
      .expect(201);
    const fileId = (uploaded.body as { id: string }).id;
    const idempotency = `feed-file-share-${Date.now()}`;
    const firstShare = await dmytro.agent
      .post(`/api/v1/feed/file-shares/${fileId}`)
      .set('x-csrf-token', dmytro.csrf)
      .set('idempotency-key', idempotency)
      .send({
        companyId: 'cmp_bert_ua',
        audience: { type: 'USERS', userIds: ['usr_andrii'] },
      })
      .expect(201);
    const share = firstShare.body as { id: string; fileId: string; version: number; status: string };
    expect(share).toMatchObject({ fileId, version: 1, status: 'ACTIVE' });
    const repeatedShare = await dmytro.agent
      .post(`/api/v1/feed/file-shares/${fileId}`)
      .set('x-csrf-token', dmytro.csrf)
      .set('idempotency-key', idempotency)
      .send({
        companyId: 'cmp_bert_ua',
        audience: { type: 'USERS', userIds: ['usr_andrii'] },
      })
      .expect(201);
    expect(repeatedShare.body).toMatchObject({ id: share.id });

    const pendingFeed = await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua&type=FILE')
      .expect(200);
    const pendingCard = (pendingFeed.body as FeedListResult).items.find((item) =>
      item.kind === 'SOURCE' && item.id === share.id);
    expect(pendingCard).toMatchObject({
      kind: 'SOURCE',
      sourceType: 'FILE',
      title: 'standalone-plan.txt',
      actionState: 'PROCESSING',
    });
    expect((await maria.agent
      .get('/api/v1/feed?company=cmp_bert_ua&type=FILE')
      .expect(200)).body.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: share.id }),
    ]));
    await andrii.agent.get(`/api/v1/files/${fileId}/status`).expect(200);
    await andrii.agent.get(`/api/v1/files/${fileId}/download`).expect(403);
    await maria.agent.get(`/api/v1/files/${fileId}/status`).expect(404);

    const prisma = app.get(PrismaService);
    const stored = await prisma.feedItem.findMany({
      where: { sourceType: 'FILE', sourceId: share.id },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.safePayload).not.toContain('standalone-plan.txt');
    expect(stored[0]?.safePayload).not.toContain('text/plain');

    const jobs = app.get(JobsService);
    for (let index = 0; index < 20; index += 1) {
      await jobs.runOnce();
      const status = await dmytro.agent.get(`/api/v1/files/${fileId}/status`).expect(200);
      if ((status.body as { scanStatus: string }).scanStatus === 'CLEAN') break;
    }
    const readyFeed = await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua&type=FILE')
      .expect(200);
    const readyCard = (readyFeed.body as FeedListResult).items.find((item) =>
      item.kind === 'SOURCE' && item.id === share.id);
    expect(readyCard).toMatchObject({ id: share.id, actionState: 'AVAILABLE' });
    if (!readyCard) throw new Error('Ready standalone File card is missing');
    await andrii.agent
      .put(`/api/v1/feed/items/${readyCard.itemId}/favorite`)
      .set('x-csrf-token', andrii.csrf)
      .expect(200, { favorited: true });
    await andrii.agent.get(`/api/v1/files/${fileId}/download`).expect(200);

    await dmytro.agent
      .delete(`/api/v1/feed/file-shares/${share.id}`)
      .set('x-csrf-token', dmytro.csrf)
      .send({ expectedVersion: 1 })
      .expect(200, { revoked: true, version: 2 });
    const afterRevoke = await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua&type=FILE')
      .expect(200);
    expect((afterRevoke.body as FeedListResult).items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: share.id }),
    ]));
    expect((await andrii.agent
      .get('/api/v1/feed?company=cmp_bert_ua&type=FILE&favorite=true')
      .expect(200)).body.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: share.id }),
    ]));
    await andrii.agent
      .put(`/api/v1/feed/items/${readyCard.itemId}/favorite`)
      .set('x-csrf-token', andrii.csrf)
      .expect(404);
    await andrii.agent.get(`/api/v1/files/${fileId}/status`).expect(404);
    await andrii.agent.get(`/api/v1/files/${fileId}/download`).expect(404);
    expect(await prisma.auditEvent.findFirst({
      where: { action: 'feed.file.revoked', entityId: share.id },
    })).not.toBeNull();
    expect(await prisma.outboxEvent.findFirst({
      where: { eventType: 'feed.file.revoked', aggregateId: share.id },
    })).not.toBeNull();
  });

  it('keeps groups capability-gated and never leaks hidden groups to non-members', async () => {
    const maria = await login('maria');
    const disabled = await maria.agent
      .get('/api/v1/groups?company=cmp_bert_ua')
      .expect(403);
    expect(disabled.body).toMatchObject({ code: 'capability_disabled' });

    const dmytro = await login('dmytro');
    const capabilities = await dmytro.agent
      .get('/api/v1/admin/organization/capabilities')
      .expect(200);
    const groupsCapability = (capabilities.body as { items: OrganizationCapabilityView[] }).items.find((item) => item.code === 'GROUPS_UI');
    if (!groupsCapability) throw new Error('GROUPS_UI capability is missing from the organization response');
    await dmytro.agent
      .patch('/api/v1/admin/organization/capabilities/GROUPS_UI')
      .set('x-csrf-token', dmytro.csrf)
      .send({ enabled: true, expectedVersion: groupsCapability.version })
      .expect(200);

    const prisma = app.get(PrismaService);
    await prisma.group.create({
      data: {
        id: 'grp_e2e_listed',
        workspaceId: 'ws_bert',
        companyId: 'cmp_bert_ua',
        key: 'e2e-listed',
        name: 'Відкрита робоча група',
        ownerId: 'usr_andrii',
        discoverability: 'LISTED',
        joinPolicy: 'REQUEST',
        members: { create: [
          { id: 'grpm_e2e_listed_owner', userId: 'usr_andrii', role: 'OWNER' },
          { id: 'grpm_e2e_listed_maria', userId: 'usr_maria', role: 'MEMBER' },
        ] },
      },
    });
    await prisma.group.create({
      data: {
        id: 'grp_e2e_hidden',
        workspaceId: 'ws_bert',
        companyId: 'cmp_bert_ua',
        key: 'e2e-hidden',
        name: 'Прихована робоча група',
        ownerId: 'usr_dmytro',
        discoverability: 'HIDDEN',
        joinPolicy: 'INVITE_ONLY',
        members: { create: { id: 'grpm_e2e_hidden_owner', userId: 'usr_dmytro', role: 'OWNER' } },
      },
    });

    const listed = await maria.agent
      .get('/api/v1/groups?company=cmp_bert_ua')
      .expect(200);
    expect(listed.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'grp_e2e_listed', currentUserRole: 'MEMBER', memberCount: 2 }),
    ]));
    expect(listed.body.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'grp_e2e_hidden' }),
    ]));
    await maria.agent.get('/api/v1/groups/grp_e2e_hidden').expect(404);
  });

  it('returns a company-scoped org tree with safe employee projections', async () => {
    const prisma = app.get(PrismaService);
    await prisma.userOrgAssignment.deleteMany({
      where: { userId: 'usr_maria', companyId: 'cmp_bert_ua' },
    });
    await prisma.orgUnit.deleteMany({ where: { id: 'org_e2e_product' } });
    await prisma.orgUnit.create({
      data: {
        id: 'org_e2e_product',
        workspaceId: 'ws_bert',
        companyId: 'cmp_bert_ua',
        sourceKey: 'e2e-product',
        name: 'Продуктова команда',
        normalizedName: 'продуктова команда',
        managerId: 'usr_andrii',
        assignments: { create: {
          id: 'orga_e2e_maria',
          companyId: 'cmp_bert_ua',
          userId: 'usr_maria',
          isPrimary: true,
          positionTitle: 'Продуктова дизайнерка',
        } },
      },
    });
    const maria = await login('maria');
    const units = await maria.agent
      .get('/api/v1/org/units?company=cmp_bert_ua&parentId=')
      .expect(200);
    expect(units.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'org_e2e_product', activeEmployeeCount: 1, childCount: 0 }),
    ]));
    const employees = await maria.agent
      .get('/api/v1/org/units/org_e2e_product/employees?company=cmp_bert_ua')
      .expect(200);
    expect(employees.body.items).toEqual([
      expect.objectContaining({ id: 'usr_maria', positionTitle: 'Продуктова дизайнерка', isPrimary: true }),
    ]);
    expect(JSON.stringify(employees.body)).not.toContain('contactEmail');
    expect(JSON.stringify(employees.body)).not.toContain('username');
  });

  it('exposes import readiness only to system administrators without raw source data', async () => {
    const dmytro = await login('dmytro');
    const response = await dmytro.agent
      .get('/api/v1/admin/import/readiness')
      .expect(200);
    const readiness = response.body as ImportReadinessView;
    expect(readiness).toMatchObject({
      state: 'BLOCKED',
      productionApplyAvailable: false,
      controlPlaneVersion: 1,
      counters: {
        datasets: 0,
        sealedDatasets: 0,
        runs: 0,
        unresolvedBlockingIssues: 0,
        activeMappingRows: 0,
      },
    });
    expect(readiness.gates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'CONTROL_PLANE', status: 'READY' }),
      expect.objectContaining({ id: 'D-011', status: 'BLOCKING' }),
      expect.objectContaining({ id: 'D-024', status: 'BLOCKING' }),
    ]));
    expect(JSON.stringify(readiness)).not.toContain('manifestSha256');
    expect(JSON.stringify(readiness)).not.toContain('watermarkToJson');

    const maria = await login('maria');
    await maria.agent.get('/api/v1/admin/import/readiness').expect(403);
  });

  it('submits an absence idempotently, approves it once, and executes durable effects', async () => {
    const maria = await login('maria');
    const key = `e2e-absence-${Date.now()}`;
    const payload = {
      companyId: 'cmp_bert_ua',
      startDate: '2027-02-08',
      endDate: '2027-02-12',
      substituteId: 'usr_marko',
      privateHrComment: 'Тільки для HR e2e',
    };
    const submitted = await maria.agent
      .post('/api/v1/requests/absence')
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', key)
      .send(payload)
      .expect(201);
    const repeated = await maria.agent
      .post('/api/v1/requests/absence')
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', key)
      .send(payload)
      .expect(201);
    expect(repeated.body.id).toBe(submitted.body.id);

    const andrii = await login('andrii');
    const approvalKey = `e2e-approval-${Date.now()}`;
    const approved = await andrii.agent
      .post(`/api/v1/requests/${submitted.body.id}/approve`)
      .set('x-csrf-token', andrii.csrf)
      .set('idempotency-key', approvalKey)
      .send({ expectedVersion: 1 })
      .expect(201);
    expect(approved.body.decisionStatus).toBe('APPROVED');
    const repeatedApproval = await andrii.agent
      .post(`/api/v1/requests/${submitted.body.id}/approve`)
      .set('x-csrf-token', andrii.csrf)
      .set('idempotency-key', approvalKey)
      .send({ expectedVersion: 1 })
      .expect(201);
    expect(repeatedApproval.body.decisionStatus).toBe('APPROVED');

    const jobs = app.get(JobsService);
    for (let index = 0; index < 20; index += 1) await jobs.runOnce();
    const detail = await maria.agent
      .get(`/api/v1/requests/${submitted.body.id}`)
      .expect(200);
    expect(detail.body.executionStatus).toBe('SUCCEEDED');
    expect(detail.body.effects).toHaveLength(3);
    expect(
      detail.body.effects.every(
        (effect: { state: string }) => effect.state === 'SUCCEEDED',
      ),
    ).toBe(true);
  });

  it('returns RFC 9457 problems without leaking details across scope', async () => {
    const maria = await login('maria');
    const response = await maria.agent.get('/api/v1/admin').expect(403);
    expect(response.type).toMatch(/problem\+json/);
    expect(response.body).toMatchObject({ status: 403, code: 'forbidden' });
    expect(response.body.correlationId).toBeTruthy();
  });

  it('generates an authorized audit export through the durable queue', async () => {
    const dmytro = await login('dmytro');
    const created = await dmytro.agent
      .post('/api/v1/admin/audit/exports')
      .set('x-csrf-token', dmytro.csrf)
      .set('idempotency-key', `audit-export-${Date.now()}`)
      .expect(201);
    expect(created.body.state).toBe('QUEUED');
    const jobs = app.get(JobsService);
    for (let index = 0; index < 12; index += 1) {
      await jobs.runOnce();
      const current = await dmytro.agent
        .get(`/api/v1/admin/audit/exports/${created.body.exportId}`)
        .expect(200);
      if (current.body.state === 'SUCCEEDED') {
        expect(current.body.fileId).toMatch(/^file_export_/);
        const download = await dmytro.agent
          .get(`/api/v1/files/${current.body.fileId}/download`)
          .expect(200);
        expect(download.headers['content-type']).toMatch(/text\/csv/);
        expect(download.text).toContain('correlationId');
        return;
      }
    }
    throw new Error('Audit export job did not complete');
  });

  it('returns a safe 409 for stale optimistic updates', async () => {
    const maria = await login('maria');
    const response = await maria.agent
      .patch('/api/v1/tasks/tsk_design/status')
      .set('x-csrf-token', maria.csrf)
      .send({ status: 'DONE', expectedVersion: 0 })
      .expect(409);
    expect(response.body).toMatchObject({ status: 409, code: 'version_conflict' });
    expect(JSON.stringify(response.body)).not.toContain('Prisma');
  });

  it('creates one-level subtasks idempotently and blocks parent completion until every child is terminal', async () => {
    const maria = await login('maria');
    const parent = await maria.agent
      .post('/api/v1/tasks')
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', `task-parent-${Date.now()}`)
      .send({
        companyId: 'cmp_bert_ua',
        title: 'Підготувати запуск нового робочого процесу',
        description: 'Батьківський результат для перевірки справжніх підзадач.',
        assigneeId: 'usr_maria',
        priority: 'HIGH',
      })
      .expect(201);
    const parentId = (parent.body as { id: string }).id;
    const subtaskKey = `task-subtask-${Date.now()}`;
    const subtaskInput = {
      title: 'Перевірити сценарій на мобільному екрані',
      description: 'Окремий відповідальний результат, не пункт checklist.',
      assigneeId: 'usr_maria',
      priority: 'MEDIUM',
      expectedVersion: 1,
    };
    const created = await maria.agent
      .post(`/api/v1/tasks/${parentId}/subtasks`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', subtaskKey)
      .send(subtaskInput)
      .expect(201);
    const subtaskId = (created.body as { id: string }).id;
    expect(created.body).toMatchObject({
      parentTaskId: parentId,
      parentVersion: 2,
    });

    const retried = await maria.agent
      .post(`/api/v1/tasks/${parentId}/subtasks`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', subtaskKey)
      .send(subtaskInput)
      .expect(201);
    expect(retried.body).toMatchObject({ id: subtaskId, parentTaskId: parentId, parentVersion: 2 });
    expect(await app.get(PrismaService).task.count({ where: { parentTaskId: parentId } })).toBe(1);

    await maria.agent
      .post(`/api/v1/tasks/${subtaskId}/subtasks`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', `task-grandchild-${Date.now()}`)
      .send({ ...subtaskInput, expectedVersion: 1 })
      .expect(400);

    const beforeCompletion = await maria.agent
      .get(`/api/v1/tasks/${parentId}`)
      .expect(200);
    expect(beforeCompletion.body).toMatchObject({
      version: 2,
      subtaskProgress: { done: 0, total: 1 },
      subtasks: [
        expect.objectContaining({ id: subtaskId, status: 'NEW' }),
      ],
    });

    const blocked = await maria.agent
      .patch(`/api/v1/tasks/${parentId}/status`)
      .set('x-csrf-token', maria.csrf)
      .send({ status: 'DONE', expectedVersion: 2 })
      .expect(409);
    expect(blocked.body).toMatchObject({
      status: 409,
      code: 'task_completion_blocked',
      blockingSubtaskIds: [subtaskId],
    });

    await maria.agent
      .patch(`/api/v1/tasks/${subtaskId}/status`)
      .set('x-csrf-token', maria.csrf)
      .send({ status: 'DONE', expectedVersion: 1 })
      .expect(200, { version: 2 });
    const ready = await maria.agent
      .get(`/api/v1/tasks/${parentId}`)
      .expect(200);
    expect(ready.body).toMatchObject({
      version: 3,
      subtaskProgress: { done: 1, total: 1 },
    });
    await maria.agent
      .patch(`/api/v1/tasks/${parentId}/status`)
      .set('x-csrf-token', maria.csrf)
      .send({ status: 'DONE', expectedVersion: 3 })
      .expect(200, { version: 4 });

    const completedParent = await app.get(PrismaService).task.findUniqueOrThrow({
      where: { id: parentId },
      select: { status: true, completedAt: true },
    });
    expect(completedParent.status).toBe('DONE');
    expect(completedParent.completedAt).toBeInstanceOf(Date);
    expect(await app.get(PrismaService).auditEvent.findFirst({
      where: { action: 'task.subtask_created', entityId: parentId },
    })).not.toBeNull();
    expect(await app.get(PrismaService).outboxEvent.findFirst({
      where: { eventType: 'task.subtask_created', aggregateId: parentId },
    })).not.toBeNull();
  });

  it('keeps responsible, co-executor, creator and observer task roles distinct and revokes access safely', async () => {
    const maria = await login('maria');
    const marko = await login('marko');
    const createKey = `task-roles-${Date.now()}`;
    const coExecutorTaskInput = {
      companyId: 'cmp_bert_ua',
      title: 'Узгодити рольову модель завдань',
      description: 'Співвиконавець працює із завданням, але не керує складом учасників.',
      assigneeId: 'usr_andrii',
      coExecutorIds: ['usr_marko'],
      priority: 'HIGH',
    };
    const coExecutorTask = await maria.agent
      .post('/api/v1/tasks')
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', createKey)
      .send(coExecutorTaskInput)
      .expect(201);
    const coExecutorTaskId = (coExecutorTask.body as { id: string }).id;
    await maria.agent
      .post('/api/v1/tasks')
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', createKey)
      .send({ ...coExecutorTaskInput, title: 'Інший запит під тим самим ключем' })
      .expect(409);

    const helping = await marko.agent
      .get('/api/v1/tasks?company=cmp_bert_ua&role=CO_EXECUTOR')
      .expect(200);
    expect(helping.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: coExecutorTaskId,
        viewerRoles: ['CO_EXECUTOR'],
      }),
    ]));
    const coExecutorDetail = await marko.agent
      .get(`/api/v1/tasks/${coExecutorTaskId}`)
      .expect(200);
    expect(coExecutorDetail.body).toMatchObject({
      canEdit: true,
      canManageParticipants: false,
      viewerRoles: ['CO_EXECUTOR'],
    });
    expect((coExecutorDetail.body as {
      coExecutors: Array<{ user: { id: string }; role: string }>;
    }).coExecutors.some((participant) => (
      participant.user.id === 'usr_marko' && participant.role === 'CO_EXECUTOR'
    ))).toBe(true);
    await marko.agent
      .patch(`/api/v1/tasks/${coExecutorTaskId}/status`)
      .set('x-csrf-token', marko.csrf)
      .send({ status: 'IN_PROGRESS', expectedVersion: 1 })
      .expect(200, { version: 2 });

    const observerTask = await maria.agent
      .post('/api/v1/tasks')
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', `task-observer-${Date.now()}`)
      .send({
        companyId: 'cmp_bert_ua',
        title: 'Перевірити спостереження без редагування',
        assigneeId: 'usr_andrii',
        priority: 'MEDIUM',
      })
      .expect(201);
    const observerTaskId = (observerTask.body as { id: string }).id;
    await marko.agent.get(`/api/v1/tasks/${observerTaskId}`).expect(404);

    const participantKey = `task-participant-${Date.now()}`;
    const added = await maria.agent
      .post(`/api/v1/tasks/${observerTaskId}/participants`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', participantKey)
      .send({ userId: 'usr_marko', role: 'OBSERVER', expectedVersion: 1 })
      .expect(201);
    expect(added.body).toMatchObject({
      userId: 'usr_marko',
      role: 'OBSERVER',
      version: 2,
    });
    await maria.agent
      .post(`/api/v1/tasks/${observerTaskId}/participants`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', participantKey)
      .send({ userId: 'usr_marko', role: 'OBSERVER', expectedVersion: 1 })
      .expect(201);
    await maria.agent
      .post(`/api/v1/tasks/${observerTaskId}/participants`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', participantKey)
      .send({ userId: 'usr_marko', role: 'CO_EXECUTOR', expectedVersion: 1 })
      .expect(409);

    const observing = await marko.agent
      .get('/api/v1/tasks?company=cmp_bert_ua&role=OBSERVER')
      .expect(200);
    expect(observing.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: observerTaskId,
        viewerRoles: ['OBSERVER'],
      }),
    ]));
    const observerDetail = await marko.agent
      .get(`/api/v1/tasks/${observerTaskId}`)
      .expect(200);
    expect(observerDetail.body).toMatchObject({
      canEdit: false,
      canManageParticipants: false,
      viewerRoles: ['OBSERVER'],
    });
    await marko.agent
      .patch(`/api/v1/tasks/${observerTaskId}/status`)
      .set('x-csrf-token', marko.csrf)
      .send({ status: 'IN_PROGRESS', expectedVersion: 2 })
      .expect(404);
    await marko.agent
      .get('/api/v1/tasks?company=cmp_bert_ua&role=ALL')
      .expect(403);

    const delegated = await maria.agent
      .get('/api/v1/tasks?company=cmp_bert_ua&role=CREATOR')
      .expect(200);
    expect(delegated.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: coExecutorTaskId }),
      expect.objectContaining({ id: observerTaskId }),
    ]));

    await maria.agent
      .delete(`/api/v1/tasks/${observerTaskId}/participants/usr_marko/OBSERVER`)
      .set('x-csrf-token', maria.csrf)
      .send({ expectedVersion: 2 })
      .expect(200, { version: 3 });
    await marko.agent.get(`/api/v1/tasks/${observerTaskId}`).expect(404);
    const afterRemoval = await marko.agent
      .get('/api/v1/tasks?company=cmp_bert_ua&role=OBSERVER')
      .expect(200);
    expect(afterRemoval.body.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: observerTaskId }),
    ]));

    const prisma = app.get(PrismaService);
    expect(await prisma.auditEvent.findFirst({
      where: { action: 'task.participant_added', entityId: observerTaskId },
    })).not.toBeNull();
    expect(await prisma.auditEvent.findFirst({
      where: { action: 'task.participant_removed', entityId: observerTaskId },
    })).not.toBeNull();
    expect(await prisma.outboxEvent.count({
      where: { eventType: 'task.participant_changed', aggregateId: observerTaskId },
    })).toBe(2);
  });

  it('supports complete task editing, private state, following, reminders, and readable history', async () => {
    const maria = await login('maria');
    const andrii = await login('andrii');
    const marko = await login('marko');
    const created = await maria.agent
      .post('/api/v1/tasks')
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', `task-personal-workflow-${Date.now()}`)
      .send({
        companyId: 'cmp_bert_ua',
        title: 'Підготувати повний сценарій редагування',
        description: 'Початкова версія',
        assigneeId: 'usr_maria',
        priority: 'MEDIUM',
      })
      .expect(201);
    const taskId = (created.body as { id: string }).id;
    const initial = await maria.agent.get(`/api/v1/tasks/${taskId}`).expect(200);
    expect(initial.body).toMatchObject({
      version: 1,
      canEdit: true,
      canReassign: true,
      personalState: {
        favorited: false,
        important: false,
        following: false,
        followerCount: 0,
        reminders: [],
      },
    });

    const deadline = new Date(Date.now() + 86_400_000).toISOString();
    await maria.agent
      .patch(`/api/v1/tasks/${taskId}`)
      .set('x-csrf-token', maria.csrf)
      .send({
        title: 'Погодити повний сценарій редагування',
        description: 'Оновлений критерій готовності',
        assigneeId: 'usr_andrii',
        deadline,
        priority: 'HIGH',
        blockReason: '',
        expectedVersion: 1,
      })
      .expect(200, { version: 2 });
    await maria.agent
      .patch(`/api/v1/tasks/${taskId}`)
      .set('x-csrf-token', maria.csrf)
      .send({
        title: 'Застаріле редагування',
        description: '',
        assigneeId: 'usr_maria',
        priority: 'LOW',
        expectedVersion: 1,
      })
      .expect(409);
    await marko.agent
      .patch(`/api/v1/tasks/${taskId}`)
      .set('x-csrf-token', marko.csrf)
      .send({
        title: 'Недоступна зміна',
        assigneeId: 'usr_marko',
        priority: 'LOW',
        expectedVersion: 2,
      })
      .expect(404);

    const stateKey = `task-state-${Date.now()}`;
    const stateBody = { favorited: true, important: true };
    await maria.agent
      .put(`/api/v1/tasks/${taskId}/user-state`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', stateKey)
      .send(stateBody)
      .expect(200, stateBody);
    await maria.agent
      .put(`/api/v1/tasks/${taskId}/user-state`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', stateKey)
      .send(stateBody)
      .expect(200, stateBody);
    await maria.agent
      .put(`/api/v1/tasks/${taskId}/user-state`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', stateKey)
      .send({ favorited: false, important: true })
      .expect(409);
    const favorites = await maria.agent
      .get('/api/v1/tasks?company=cmp_bert_ua&role=CREATOR&favorite=true')
      .expect(200);
    expect(favorites.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: taskId }),
    ]));
    const important = await maria.agent
      .get('/api/v1/tasks?company=cmp_bert_ua&role=CREATOR&important=true')
      .expect(200);
    expect(important.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: taskId }),
    ]));

    const followKey = `task-follow-${Date.now()}`;
    await maria.agent
      .post(`/api/v1/tasks/${taskId}/followers`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', followKey)
      .send({})
      .expect(201, { userId: 'usr_maria', following: true });
    await maria.agent
      .post(`/api/v1/tasks/${taskId}/followers`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', followKey)
      .send({})
      .expect(201, { userId: 'usr_maria', following: true });

    const remindAt = new Date(Date.now() + 1200).toISOString();
    const reminderKey = `task-reminder-${Date.now()}`;
    const reminderResponse = await maria.agent
      .post(`/api/v1/tasks/${taskId}/reminders`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', reminderKey)
      .send({ remindAt })
      .expect(201);
    const reminderId = (reminderResponse.body as { id: string }).id;
    await maria.agent
      .post(`/api/v1/tasks/${taskId}/reminders`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', reminderKey)
      .send({ remindAt })
      .expect(201);

    const detail = await maria.agent.get(`/api/v1/tasks/${taskId}`).expect(200);
    expect(detail.body).toMatchObject({
      title: 'Погодити повний сценарій редагування',
      description: 'Оновлений критерій готовності',
      assignee: { id: 'usr_andrii' },
      priority: 'HIGH',
      deadline,
      version: 2,
      personalState: {
        favorited: true,
        important: true,
        following: true,
        followerCount: 1,
        reminders: [expect.objectContaining({ id: reminderId, status: 'ACTIVE' })],
      },
    });

    await andrii.agent
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('x-csrf-token', andrii.csrf)
      .send({ body: 'Сценарій перевірено відповідальним.' })
      .expect(201);
    const prisma = app.get(PrismaService);
    expect(await prisma.notification.findFirst({
      where: {
        recipientId: 'usr_maria',
        dedupeKey: { startsWith: 'task-comment:' },
        entityId: taskId,
      },
    })).not.toBeNull();

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1300));
    await prisma.backgroundJob.updateMany({
      where: {
        type: 'task.reminder',
        entityId: reminderId,
        state: 'QUEUED',
      },
      data: { runAt: new Date('2000-01-01T00:00:00.000Z') },
    });
    await app.get(JobsService).runOnce();
    expect(await prisma.taskReminder.findUnique({
      where: { id: reminderId },
      select: { status: true },
    })).toEqual({ status: 'SENT' });
    expect(await prisma.notification.findUnique({
      where: { dedupeKey: `task-reminder:${reminderId}:usr_maria` },
    })).not.toBeNull();

    const laterReminder = await maria.agent
      .post(`/api/v1/tasks/${taskId}/reminders`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', `task-reminder-cancel-${Date.now()}`)
      .send({ remindAt: new Date(Date.now() + 86_400_000).toISOString() })
      .expect(201);
    const laterReminderId = (laterReminder.body as { id: string }).id;
    await maria.agent
      .delete(`/api/v1/tasks/${taskId}/reminders/${laterReminderId}`)
      .set('x-csrf-token', maria.csrf)
      .expect(200, { id: laterReminderId, status: 'CANCELLED' });
    expect(await prisma.taskReminder.findUnique({
      where: { id: laterReminderId },
      select: { status: true },
    })).toEqual({ status: 'CANCELLED' });

    const history = await maria.agent
      .get(`/api/v1/tasks/${taskId}/activity`)
      .expect(200);
    const historyItems = (history.body as {
      items: Array<{ action: string; label: string }>;
    }).items;
    expect(historyItems.some((item) => (
      item.action === 'task.updated'
      && item.label.includes('відповідального')
    ))).toBe(true);
    expect(historyItems.some((item) => (
      item.action === 'task.created'
      && item.label === 'Створено завдання'
    ))).toBe(true);

    await maria.agent
      .delete(`/api/v1/tasks/${taskId}/followers/usr_maria`)
      .set('x-csrf-token', maria.csrf)
      .expect(200, { userId: 'usr_maria', following: false });
    const afterUnfollow = await maria.agent
      .get(`/api/v1/tasks/${taskId}`)
      .expect(200);
    expect(afterUnfollow.body.personalState).toMatchObject({
      favorited: true,
      important: true,
      following: false,
      followerCount: 0,
    });
  });

  it('keeps direct chat creation, search, reply, read and mute state exact and access-safe', async () => {
    const maria = await login('maria');
    const andrii = await login('andrii');
    const dmytro = await login('dmytro');
    const prisma = app.get(PrismaService);
    const suffix = Date.now();
    const createKey = `chat-direct-${suffix}`;
    const created = await maria.agent
      .post('/api/v1/messages/threads')
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', createKey)
      .send({
        companyId: 'cmp_bert_ua',
        kind: 'DIRECT',
        participantIds: ['usr_andrii'],
      })
      .expect(201);
    const threadId = (created.body as { id: string }).id;
    expect((created.body as { created: boolean }).created).toBe(true);
    const retry = await maria.agent
      .post('/api/v1/messages/threads')
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', createKey)
      .send({
        companyId: 'cmp_bert_ua',
        kind: 'DIRECT',
        participantIds: ['usr_andrii'],
      })
      .expect(201);
    expect(retry.body).toMatchObject({ id: threadId, created: false });
    await maria.agent
      .post('/api/v1/messages/threads')
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', createKey)
      .send({
        companyId: 'cmp_bert_ua',
        kind: 'DIRECT',
        participantIds: ['usr_dmytro'],
      })
      .expect(409);
    const canonical = await maria.agent
      .post('/api/v1/messages/threads')
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', `chat-direct-canonical-${suffix}`)
      .send({
        companyId: 'cmp_bert_ua',
        kind: 'DIRECT',
        participantIds: ['usr_andrii'],
      })
      .expect(201);
    expect(canonical.body).toMatchObject({ id: threadId, created: false });
    await dmytro.agent.get(`/api/v1/messages/threads/${threadId}`).expect(404);

    const root = await maria.agent
      .post(`/api/v1/messages/threads/${threadId}/messages`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', `chat-root-${suffix}`)
      .send({ body: 'Погодьмо остаточний текст запуску.' })
      .expect(201);
    const rootId = (root.body as { id: string }).id;
    const rootRetry = await maria.agent
      .post(`/api/v1/messages/threads/${threadId}/messages`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', `chat-root-${suffix}`)
      .send({ body: 'Погодьмо остаточний текст запуску.' })
      .expect(201);
    expect(rootRetry.body).toEqual({ id: rootId });
    await maria.agent
      .post(`/api/v1/messages/threads/${threadId}/messages`)
      .set('x-csrf-token', maria.csrf)
      .send({ body: 'Без ключа повтору' })
      .expect(400);
    const reply = await maria.agent
      .post(`/api/v1/messages/threads/${threadId}/messages`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', `chat-reply-${suffix}`)
      .send({ body: 'Це відповідь із явним контекстом.', replyToId: rootId })
      .expect(201);
    const replyId = (reply.body as { id: string }).id;
    await maria.agent
      .post(`/api/v1/messages/threads/${threadId}/messages`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', `chat-nested-${suffix}`)
      .send({ body: 'Третій рівень не дозволено.', replyToId: replyId })
      .expect(400);

    const unread = await andrii.agent
      .get('/api/v1/messages/threads?company=cmp_bert_ua&unread=true')
      .expect(200);
    expect((unread.body as { items: Array<{ id: string; unread: boolean }> }).items)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: threadId, unread: true })]));
    const searched = await andrii.agent
      .get(`/api/v1/messages/threads?company=cmp_bert_ua&query=${encodeURIComponent('остаточний текст')}`)
      .expect(200);
    expect((searched.body as { items: Array<{ id: string }> }).items)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: threadId })]));

    const detail = await andrii.agent
      .get(`/api/v1/messages/threads/${threadId}`)
      .expect(200);
    const detailBody = detail.body as ChatThreadDetail;
    expect(detailBody.title).toBe('Марія Іваненко');
    expect(detailBody.messages.at(-1)).toMatchObject({
      id: replyId,
      replyToId: rootId,
      replyPreview: { id: rootId },
    });
    const notificationCountBeforeMute = await prisma.notification.count({
      where: { recipientId: 'usr_andrii', category: 'CHAT' },
    });
    const muted = await andrii.agent
      .put(`/api/v1/messages/threads/${threadId}/preferences`)
      .set('x-csrf-token', andrii.csrf)
      .send({
        notificationMode: 'NONE',
        expectedVersion: detailBody.participantVersion,
      })
      .expect(200);
    expect(muted.body).toMatchObject({ notificationMode: 'NONE' });
    const read = await andrii.agent
      .post(`/api/v1/messages/threads/${threadId}/read`)
      .set('x-csrf-token', andrii.csrf)
      .send({ lastReadMessageId: replyId })
      .expect(201);
    const readVersion = (read.body as { participantVersion: number }).participantVersion;
    const nonRegressing = await andrii.agent
      .post(`/api/v1/messages/threads/${threadId}/read`)
      .set('x-csrf-token', andrii.csrf)
      .send({ lastReadMessageId: rootId })
      .expect(201);
    expect(nonRegressing.body).toEqual({
      lastReadMessageId: replyId,
      participantVersion: readVersion,
    });
    const afterRead = await andrii.agent
      .get('/api/v1/messages/threads?company=cmp_bert_ua&unread=true')
      .expect(200);
    expect((afterRead.body as { items: Array<{ id: string }> }).items.some((item) => item.id === threadId))
      .toBe(false);

    await maria.agent
      .post(`/api/v1/messages/threads/${threadId}/messages`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', `chat-after-mute-${suffix}`)
      .send({ body: 'Оновлення після вимкнення сповіщень.' })
      .expect(201);
    expect(await prisma.notification.count({
      where: { recipientId: 'usr_andrii', category: 'CHAT' },
    })).toBe(notificationCountBeforeMute);
    expect(await prisma.auditEvent.count({
      where: {
        workspaceId: 'ws_bert',
        entityType: { in: ['MESSAGE_THREAD', 'MESSAGE'] },
        action: { in: ['message.thread_created', 'message.created', 'message.replied'] },
      },
    })).toBeGreaterThanOrEqual(4);
    expect(await prisma.outboxEvent.count({
      where: { aggregateType: 'MESSAGE_THREAD', aggregateId: threadId },
    })).toBeGreaterThanOrEqual(4);
  });

  it('keeps group membership, scanner-gated attachments and own message lifecycle guarded', async () => {
    const maria = await login('maria');
    const andrii = await login('andrii');
    const olena = await login('olena');
    const dmytro = await login('dmytro');
    const prisma = app.get(PrismaService);
    const suffix = Date.now();
    const created = await maria.agent
      .post('/api/v1/messages/threads')
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', `chat-group-${suffix}`)
      .send({
        companyId: 'cmp_bert_ua',
        kind: 'GROUP',
        title: `Запуск ${suffix}`,
        participantIds: ['usr_andrii', 'usr_olena'],
      })
      .expect(201);
    const threadId = (created.body as { id: string }).id;
    const initial = await maria.agent
      .get(`/api/v1/messages/threads/${threadId}`)
      .expect(200);
    const initialDetail = initial.body as ChatThreadDetail;
    expect(initialDetail).toMatchObject({
      kind: 'GROUP',
      version: 1,
      canManageParticipants: true,
      canLeave: false,
    });

    const addKey = `chat-group-add-${suffix}`;
    const added = await maria.agent
      .post(`/api/v1/messages/threads/${threadId}/participants`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', addKey)
      .send({
        userId: 'usr_dmytro',
        role: 'MEMBER',
        expectedThreadVersion: initialDetail.version,
      })
      .expect(201);
    expect(added.body).toMatchObject({
      participant: { id: 'usr_dmytro', role: 'MEMBER', version: 1 },
      threadVersion: 2,
    });
    const addRetry = await maria.agent
      .post(`/api/v1/messages/threads/${threadId}/participants`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', addKey)
      .send({
        userId: 'usr_dmytro',
        role: 'MEMBER',
        expectedThreadVersion: initialDetail.version,
      })
      .expect(201);
    expect(addRetry.body).toMatchObject({ threadVersion: 2 });
    await andrii.agent
      .post(`/api/v1/messages/threads/${threadId}/participants`)
      .set('x-csrf-token', andrii.csrf)
      .set('idempotency-key', `chat-group-denied-${suffix}`)
      .send({
        userId: 'usr_dmytro',
        role: 'MEMBER',
        expectedThreadVersion: 2,
      })
      .expect(404);

    const promoted = await maria.agent
      .put(`/api/v1/messages/threads/${threadId}/participants/usr_andrii`)
      .set('x-csrf-token', maria.csrf)
      .send({
        role: 'OWNER',
        expectedVersion: 1,
        expectedThreadVersion: 2,
      })
      .expect(200);
    expect(promoted.body).toMatchObject({
      participant: { id: 'usr_andrii', role: 'OWNER', version: 2 },
      threadVersion: 3,
    });
    await maria.agent
      .delete(`/api/v1/messages/threads/${threadId}/participants/usr_olena`)
      .set('x-csrf-token', maria.csrf)
      .send({ expectedVersion: 1, expectedThreadVersion: 3 })
      .expect(200);
    await olena.agent.get(`/api/v1/messages/threads/${threadId}`).expect(404);
    const demotedMaria = await maria.agent
      .put(`/api/v1/messages/threads/${threadId}/participants/usr_maria`)
      .set('x-csrf-token', maria.csrf)
      .send({
        role: 'MEMBER',
        expectedVersion: 1,
        expectedThreadVersion: 4,
      })
      .expect(200);
    expect(demotedMaria.body).toMatchObject({ threadVersion: 5 });
    await andrii.agent
      .put(`/api/v1/messages/threads/${threadId}/participants/usr_andrii`)
      .set('x-csrf-token', andrii.csrf)
      .send({
        role: 'MEMBER',
        expectedVersion: 2,
        expectedThreadVersion: 5,
      })
      .expect(409);

    const uploaded = await maria.agent
      .post(`/api/v1/messages/threads/${threadId}/attachments`)
      .set('x-csrf-token', maria.csrf)
      .attach('file', Buffer.from('Chat collaboration attachment e2e'), {
        filename: 'chat-context.txt',
        contentType: 'text/plain',
      })
      .expect(201);
    const fileId = (uploaded.body as { id: string }).id;
    expect(uploaded.body).toMatchObject({
      fileName: 'chat-context.txt',
      scanStatus: 'QUARANTINED',
    });
    await prisma.backgroundJob.updateMany({
      where: {
        type: 'file.scan',
        entityId: fileId,
        state: 'QUEUED',
      },
      data: { runAt: new Date('1999-01-01T00:00:00.000Z') },
    });
    for (let index = 0; index < 20; index += 1) {
      await app.get(JobsService).runOnce();
      const status = await maria.agent.get(`/api/v1/files/${fileId}/status`).expect(200);
      if (status.body.scanStatus === 'CLEAN') break;
      if (index === 19) throw new Error('Chat attachment scanner job did not complete');
    }
    const posted = await maria.agent
      .post(`/api/v1/messages/threads/${threadId}/messages`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', `chat-group-message-${suffix}`)
      .send({
        body: 'Контекст запуску у вкладенні.',
        attachmentIds: [fileId],
      })
      .expect(201);
    const messageId = (posted.body as { id: string }).id;
    const withAttachment = await andrii.agent
      .get(`/api/v1/messages/threads/${threadId}`)
      .expect(200);
    const message = (withAttachment.body as ChatThreadDetail).messages.find(
      (item) => item.id === messageId,
    );
    expect(message).toMatchObject({
      body: 'Контекст запуску у вкладенні.',
      deletedAt: null,
      attachments: [
        expect.objectContaining({
          id: fileId,
          fileName: 'chat-context.txt',
          scanStatus: 'CLEAN',
        }),
      ],
      canEdit: false,
      canDelete: false,
    });
    await andrii.agent.get(`/api/v1/files/${fileId}/download`).expect(200);
    await dmytro.agent.get(`/api/v1/files/${fileId}/download`).expect(200);

    const edited = await maria.agent
      .patch(`/api/v1/messages/${messageId}`)
      .set('x-csrf-token', maria.csrf)
      .send({
        body: 'Уточнений контекст запуску.',
        expectedVersion: 1,
      })
      .expect(200);
    expect(edited.body).toMatchObject({
      body: 'Уточнений контекст запуску.',
      version: 2,
    });
    await andrii.agent
      .patch(`/api/v1/messages/${messageId}`)
      .set('x-csrf-token', andrii.csrf)
      .send({ body: 'Чуже редагування', expectedVersion: 2 })
      .expect(404);
    await maria.agent
      .patch(`/api/v1/messages/${messageId}`)
      .set('x-csrf-token', maria.csrf)
      .send({ body: 'Застаріла версія', expectedVersion: 1 })
      .expect(409);
    await maria.agent
      .delete(`/api/v1/messages/${messageId}`)
      .set('x-csrf-token', maria.csrf)
      .send({ expectedVersion: 2 })
      .expect(200);
    const afterDelete = await andrii.agent
      .get(`/api/v1/messages/threads/${threadId}`)
      .expect(200);
    expect((afterDelete.body as ChatThreadDetail).messages.find((item) => item.id === messageId))
      .toMatchObject({
        body: '',
        version: 3,
        attachments: [],
        canEdit: false,
        canDelete: false,
      });
    await andrii.agent.get(`/api/v1/files/${fileId}/status`).expect(404);
    await maria.agent.get(`/api/v1/files/${fileId}/status`).expect(200);
    expect(await prisma.auditEvent.count({
      where: {
        workspaceId: 'ws_bert',
        entityType: { in: ['MESSAGE_THREAD', 'MESSAGE'] },
        action: {
          in: [
            'message.participant_added',
            'message.participant_role_changed',
            'message.participant_removed',
            'message.edited',
            'message.deleted',
          ],
        },
      },
    })).toBeGreaterThanOrEqual(5);
  });

  it('keeps task sources, attachments, replies, scanner state, and direct-role ACL aligned', async () => {
    const maria = await login('maria');
    const andrii = await login('andrii');
    const marko = await login('marko');
    const dmytro = await login('dmytro');
    const prisma = app.get(PrismaService);
    const suffix = Date.now();
    const threadId = `thr_task_content_${suffix}`;
    const messageId = `msg_task_content_${suffix}`;
    await prisma.messageThread.create({
      data: {
        id: threadId,
        workspaceId: 'ws_bert',
        companyId: 'cmp_bert_ua',
        kind: 'DIRECT',
        title: 'Запуск оновленої картки',
        participants: {
          create: [
            {
              id: `tp_task_maria_${suffix}`,
              userId: 'usr_maria',
              role: 'MEMBER',
            },
            {
              id: `tp_task_andrii_${suffix}`,
              userId: 'usr_andrii',
              role: 'MEMBER',
            },
          ],
        },
        messages: {
          create: {
            id: messageId,
            authorId: 'usr_maria',
            body: 'З цього повідомлення потрібно створити завдання.',
          },
        },
      },
    });
    const created = await maria.agent
      .post(`/api/v1/messages/${messageId}/task`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', `task-message-content-${suffix}`)
      .send({
        companyId: 'cmp_bert_service',
        title: 'Підготувати матеріали до завдання',
        assigneeId: 'usr_andrii',
      })
      .expect(201);
    const taskId = (created.body as { id: string }).id;
    const sourced = await maria.agent.get(`/api/v1/tasks/${taskId}`).expect(200);
    const sourcedBody = sourced.body as TaskDetailView;
    expect(sourcedBody.companyId).toBe('cmp_bert_ua');
    expect(sourcedBody.sourceLinks).toHaveLength(1);
    expect(sourcedBody.sourceLinks[0]).toMatchObject({
      kind: 'MESSAGE',
      label: 'Чат · Запуск оновленої картки',
    });
    expect(sourcedBody.sourceLinks[0]?.href).toContain(`/messages/${threadId}`);
    const eventInput = {
      title: 'Обговорити матеріали до завдання',
      startAt: '2026-07-25T09:00:00.000Z',
      endAt: '2026-07-25T10:00:00.000Z',
      sourceTimezone: 'Europe/Kyiv',
      allDay: false,
    };
    const eventKey = `event-message-content-${suffix}`;
    const event = await andrii.agent
      .post(`/api/v1/messages/${messageId}/event`)
      .set('x-csrf-token', andrii.csrf)
      .set('idempotency-key', eventKey)
      .send(eventInput)
      .expect(201);
    const eventId = (event.body as { id: string }).id;
    await andrii.agent
      .post(`/api/v1/messages/${messageId}/event`)
      .set('x-csrf-token', andrii.csrf)
      .set('idempotency-key', eventKey)
      .send(eventInput)
      .expect(201, { id: eventId, version: 1 });
    await andrii.agent
      .post(`/api/v1/messages/${messageId}/event`)
      .set('x-csrf-token', andrii.csrf)
      .set('idempotency-key', eventKey)
      .send({ ...eventInput, title: 'Інша подія' })
      .expect(409);
    const eventDetail = await andrii.agent
      .get(`/api/v1/calendar/events/${eventId}?company=cmp_bert_ua`)
      .expect(200);
    expect(eventDetail.body).toMatchObject({
      id: eventId,
      companyId: 'cmp_bert_ua',
      ownerId: 'usr_andrii',
      title: eventInput.title,
    });
    expect(await prisma.entityLink.findUnique({
      where: {
        sourceType_sourceId_targetType_targetId_relation: {
          sourceType: 'EVENT',
          sourceId: eventId,
          targetType: 'MESSAGE',
          targetId: messageId,
          relation: 'RELATED',
        },
      },
    })).not.toBeNull();
    await maria.agent
      .post(`/api/v1/tasks/${taskId}/participants`)
      .set('x-csrf-token', maria.csrf)
      .set('idempotency-key', `task-source-observer-${suffix}`)
      .send({
        userId: 'usr_dmytro',
        role: 'OBSERVER',
        expectedVersion: sourcedBody.version,
      })
      .expect(201);
    const sourceWithoutChatAccess = await dmytro.agent
      .get(`/api/v1/tasks/${taskId}`)
      .expect(200);
    expect((sourceWithoutChatAccess.body as TaskDetailView).sourceLinks).toEqual([]);

    const uploaded = await maria.agent
      .post(`/api/v1/tasks/${taskId}/attachments`)
      .set('x-csrf-token', maria.csrf)
      .attach('file', Buffer.from('Task content attachment e2e\n'), {
        filename: 'task-context.txt',
        contentType: 'text/plain',
      })
      .expect(201);
    const fileId = (uploaded.body as { id: string }).id;
    expect(uploaded.body).toMatchObject({
      fileName: 'task-context.txt',
      scanStatus: 'QUARANTINED',
      canRemove: true,
    });
    await andrii.agent.get(`/api/v1/files/${fileId}/status`).expect(200);
    await andrii.agent.get(`/api/v1/files/${fileId}/download`).expect(403);
    await marko.agent.get(`/api/v1/files/${fileId}/status`).expect(404);

    await prisma.backgroundJob.updateMany({
      where: {
        type: 'file.scan',
        entityId: fileId,
        state: 'QUEUED',
      },
      data: { runAt: new Date('1999-01-01T00:00:00.000Z') },
    });
    for (let index = 0; index < 40; index += 1) {
      await app.get(JobsService).runOnce();
      const status = await andrii.agent
        .get(`/api/v1/files/${fileId}/status`)
        .expect(200);
      if (status.body.scanStatus === 'CLEAN') break;
      if (index === 39) throw new Error('Task attachment scanner job did not complete');
    }
    const download = await andrii.agent
      .get(`/api/v1/files/${fileId}/download`)
      .expect(200);
    expect(download.text).toContain('Task content attachment e2e');

    const parent = await maria.agent
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('x-csrf-token', maria.csrf)
      .send({
        body: 'Додала контекстний файл.',
        attachmentIds: [fileId],
      })
      .expect(201);
    const parentId = (parent.body as { id: string }).id;
    const reply = await andrii.agent
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('x-csrf-token', andrii.csrf)
      .send({
        body: 'Перевірив файл, можна продовжувати.',
        replyToCommentId: parentId,
        attachmentIds: [fileId],
      })
      .expect(201);
    const replyId = (reply.body as { id: string }).id;
    await maria.agent
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('x-csrf-token', maria.csrf)
      .send({
        body: 'Зайвий третій рівень.',
        replyToCommentId: replyId,
      })
      .expect(400);
    expect(await prisma.notification.findUnique({
      where: { dedupeKey: `task-comment:${replyId}:usr_maria` },
    })).not.toBeNull();

    const detail = await andrii.agent.get(`/api/v1/tasks/${taskId}`).expect(200);
    const detailBody = detail.body as TaskDetailView;
    expect(detailBody).toMatchObject({
      attachmentCount: 1,
      attachments: [
        expect.objectContaining({
          id: fileId,
          fileName: 'task-context.txt',
          scanStatus: 'CLEAN',
        }),
      ],
    });
    const replyView = detailBody.comments.find((comment) => comment.id === replyId);
    expect(replyView?.replyToCommentId).toBe(parentId);
    expect(replyView?.replyPreview?.authorName).toBeTruthy();
    expect(replyView?.replyPreview?.body).toBe('Додала контекстний файл.');
    expect(replyView?.attachments.map((attachment) => attachment.id)).toEqual([fileId]);
    const listed = await andrii.agent
      .get('/api/v1/tasks?company=cmp_bert_ua&role=RESPONSIBLE')
      .expect(200);
    expect(listed.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: taskId, attachmentCount: 1 }),
    ]));

    await andrii.agent
      .delete(`/api/v1/tasks/${taskId}/attachments/${fileId}`)
      .set('x-csrf-token', andrii.csrf)
      .expect(200, { id: fileId, removed: true });
    const afterRemoval = await andrii.agent.get(`/api/v1/tasks/${taskId}`).expect(200);
    expect(afterRemoval.body).toMatchObject({
      attachmentCount: 0,
      attachments: [],
    });
    expect(afterRemoval.body.comments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: replyId, attachments: [] }),
    ]));
    await andrii.agent.get(`/api/v1/files/${fileId}/download`).expect(404);
    await maria.agent.get(`/api/v1/files/${fileId}/download`).expect(200);
    expect(await prisma.auditEvent.findFirst({
      where: { action: 'task.attachment_added', entityId: taskId },
    })).not.toBeNull();
    expect(await prisma.auditEvent.findFirst({
      where: { action: 'task.attachment_removed', entityId: taskId },
    })).not.toBeNull();

    const groupId = `grp_task_acl_${suffix}`;
    await prisma.group.create({
      data: {
        id: groupId,
        workspaceId: 'ws_bert',
        companyId: 'cmp_bert_ua',
        key: `task-acl-${suffix}`,
        name: 'Перевірка доступу задачі',
        ownerId: 'usr_maria',
        members: {
          create: [
            {
              id: `gm_task_maria_${suffix}`,
              userId: 'usr_maria',
              role: 'OWNER',
            },
            {
              id: `gm_task_andrii_${suffix}`,
              userId: 'usr_andrii',
              role: 'MEMBER',
            },
            {
              id: `gm_task_marko_${suffix}`,
              userId: 'usr_marko',
              role: 'MEMBER',
            },
          ],
        },
      },
    });
    const groupTaskId = `tsk_group_acl_${suffix}`;
    await prisma.task.create({
      data: {
        id: groupTaskId,
        workspaceId: 'ws_bert',
        companyId: 'cmp_bert_ua',
        groupId,
        number: `TSK-ACL-${suffix}`,
        title: 'Групова задача з прямими ролями',
        creatorId: 'usr_maria',
        assigneeId: 'usr_andrii',
      },
    });
    await marko.agent.get(`/api/v1/tasks/${groupTaskId}`).expect(404);
    await andrii.agent.get(`/api/v1/tasks/${groupTaskId}`).expect(200);
  });

  it('keeps uploads quarantined until the durable scanner job succeeds', async () => {
    const dmytro = await login('dmytro');
    const uploaded = await dmytro.agent
      .post('/api/v1/files?company=cmp_bert_ua')
      .set('x-csrf-token', dmytro.csrf)
      .attach('file', Buffer.from('BERT CRM safe e2e file\n'), {
        filename: 'e2e-note.txt',
        contentType: 'text/plain',
      })
      .expect(201);
    expect(uploaded.body.scanStatus).toBe('QUARANTINED');
    await dmytro.agent
      .get(`/api/v1/files/${uploaded.body.id}/download`)
      .expect(403);
    const jobs = app.get(JobsService);
    await app.get(PrismaService).backgroundJob.updateMany({
      where: {
        type: 'file.scan',
        entityId: uploaded.body.id as string,
        state: 'QUEUED',
      },
      data: { runAt: new Date('1999-01-01T00:00:00.000Z') },
    });
    for (let index = 0; index < 20; index += 1) {
      await jobs.runOnce();
      const status = await dmytro.agent
        .get(`/api/v1/files/${uploaded.body.id}/status`)
        .expect(200);
      if (status.body.scanStatus === 'CLEAN') {
        const download = await dmytro.agent
          .get(`/api/v1/files/${uploaded.body.id}/download`)
          .expect(200);
        expect(download.text).toContain('safe e2e file');
        return;
      }
    }
    throw new Error('Scanner job did not complete');
  });

  it('recovers an expired job lease after a simulated worker restart', async () => {
    const prisma = app.get(PrismaService);
    const jobId = `job_lease_${Date.now()}`;
    await prisma.backgroundJob.create({
      data: {
        id: jobId,
        type: 'search.index',
        entityType: 'TEST',
        entityId: jobId,
        state: 'RUNNING',
        safePayload: '{}',
        attempts: 1,
        leaseOwner: 'dead-worker',
        leaseUntil: new Date(Date.now() - 10_000),
        idempotencyKey: `lease:${jobId}`,
      },
    });
    await app.get(JobsService).runOnce();
    const recovered = await prisma.backgroundJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    expect(recovered.state).toBe('SUCCEEDED');
    expect(recovered.leaseOwner).toBeNull();
  });

  it('honors an exact legal hold during dry-run and idempotent retention purge', async () => {
    const dmytro = await login('dmytro');
    const prisma = app.get(PrismaService);
    const suffix = Date.now();
    const heldId = `ntf_held_${suffix}`;
    const purgeId = `ntf_purge_${suffix}`;
    for (const notificationId of [heldId, purgeId]) {
      await prisma.notification.create({
        data: {
          id: notificationId,
          recipientId: 'usr_dmytro',
          category: 'TEST',
          safeTitle: 'Retention test',
          safeSnippet: 'Safe metadata',
          entityType: 'TEST',
          entityId: notificationId,
          dedupeKey: `retention:${notificationId}`,
          createdAt: new Date('2020-01-01T00:00:00Z'),
        },
      });
    }
    const reauth = await dmytro.agent
      .post('/api/v1/auth/reauth')
      .set('x-csrf-token', dmytro.csrf)
      .send({ password: 'BertDemoPassphrase2026!' })
      .expect(201);
    await dmytro.agent
      .post('/api/v1/admin/retention/legal-holds')
      .set('x-csrf-token', dmytro.csrf)
      .set('x-reauth-challenge', reauth.body.challengeId)
      .send({
        entityType: 'NOTIFICATION',
        entityId: heldId,
        reason: 'e2e legal requirement',
      })
      .expect(201);
    const preview = await dmytro.agent
      .get(
        '/api/v1/admin/retention/dry-run?category=notifications&cutoff=2021-01-01T00:00:00.000Z',
      )
      .expect(200);
    expect(preview.body).toMatchObject({
      eligibleCount: 1,
      heldCount: 1,
      dryRun: true,
    });
    const requested = await dmytro.agent
      .post('/api/v1/admin/retention/purge')
      .set('x-csrf-token', dmytro.csrf)
      .set('x-reauth-challenge', reauth.body.challengeId)
      .set('idempotency-key', `retention-${suffix}`)
      .send({
        category: 'notifications',
        cutoff: '2021-01-01T00:00:00.000Z',
        expectedCount: 1,
        reason: 'e2e expired metadata',
      })
      .expect(201);
    const repeated = await dmytro.agent
      .post('/api/v1/admin/retention/purge')
      .set('x-csrf-token', dmytro.csrf)
      .set('x-reauth-challenge', reauth.body.challengeId)
      .set('idempotency-key', `retention-${suffix}`)
      .send({
        category: 'notifications',
        cutoff: '2021-01-01T00:00:00.000Z',
        expectedCount: 1,
        reason: 'e2e expired metadata',
      })
      .expect(201);
    expect(repeated.body.jobId).toBe(requested.body.jobId);
    let purgeState: string | undefined;
    for (let index = 0; index < 200; index += 1) {
      await app.get(JobsService).runOnce();
      const purge = await prisma.backgroundJob.findUnique({
        where: { id: requested.body.jobId as string },
        select: { state: true },
      });
      purgeState = purge?.state;
      if (purgeState === 'SUCCEEDED' || purgeState === 'FAILED') break;
    }
    expect(purgeState).toBe('SUCCEEDED');
    expect(
      await prisma.notification.findUnique({ where: { id: heldId } }),
    ).not.toBeNull();
    expect(
      await prisma.notification.findUnique({ where: { id: purgeId } }),
    ).toBeNull();
  });

  it('rejects a company identifier outside the authenticated principal scope', async () => {
    const maria = await login('maria');
    await maria.agent.get('/api/v1/tasks?company=cmp_not_allowed').expect(403);
    await maria.agent
      .get('/api/v1/search?q=dashboard&company=cmp_not_allowed')
      .expect(403);
  });

  it('rate-limits repeated invalid authentication attempts without disclosing account state', async () => {
    const agent = request.agent(app.getHttpServer());
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await agent.post('/api/v1/auth/login').send({
        username: `missing-${Date.now()}`,
        password: 'definitely-wrong-password',
      });
      expect(response.status).toBe(401);
    }
    const limited = await agent
      .post('/api/v1/auth/login')
      .send({
        username: `missing-${Date.now()}`,
        password: 'definitely-wrong-password',
      })
      .expect(429);
    expect(limited.body).toMatchObject({ status: 429, code: 'rate_limited' });
  });
});
