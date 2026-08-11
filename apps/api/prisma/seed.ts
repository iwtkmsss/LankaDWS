import '../src/config/load-env.js'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../src/generated/prisma/client.js'
import { allOrganizationCapabilityCodes } from '@bert-crm/contracts'
import { hashPassword } from '../src/common/crypto.js'
import { normalizeUserSearchValue } from '../src/common/user-search.js'
import { getConfig } from '../src/config/config.js'

if (process.env.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production')

const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: getConfig().DATABASE_URL }) })
const password = process.env.DEMO_SEED_PASSWORD ?? 'BertDemoPassphrase2026!'

const users = [
  { id: 'usr_maria', username: 'maria', displayName: 'Марія Іваненко', jobTitle: 'Продуктова дизайнерка', gender: 'FEMALE', birthDate: new Date('1994-05-12T00:00:00.000Z'), accountType: 'USER' as const, companyId: 'cmp_bert_ua', avatar: '/assets/avatars/avatar-maria.webp', approverId: 'usr_andrii' },
  { id: 'usr_andrii', username: 'andrii', displayName: 'Андрій Коваль', jobTitle: 'Операційний керівник', gender: 'MALE', birthDate: new Date('1989-11-03T00:00:00.000Z'), accountType: 'USER' as const, companyId: 'cmp_bert_ua', avatar: '/assets/avatars/avatar-andrii.webp', approverId: 'usr_dmytro' },
  { id: 'usr_olena', username: 'olena', displayName: 'Олена Бондар', jobTitle: 'HR-фахівчиня', gender: 'FEMALE', birthDate: new Date('1991-02-18T00:00:00.000Z'), accountType: 'USER' as const, companyId: 'cmp_bert_ua', avatar: '/assets/avatars/avatar-olena.webp', approverId: 'usr_andrii' },
  { id: 'usr_dmytro', username: 'dmytro', displayName: 'Дмитро Савчук', jobTitle: 'Системний адміністратор', gender: 'MALE', birthDate: new Date('1987-08-21T00:00:00.000Z'), accountType: 'ADMIN' as const, companyId: null, avatar: '/assets/avatars/avatar-dmytro.webp', approverId: 'usr_andrii' },
  { id: 'usr_marko', username: 'marko', displayName: 'Марко Литвин', jobTitle: 'Дизайнер', gender: 'MALE', birthDate: new Date('1996-06-30T00:00:00.000Z'), accountType: 'USER' as const, companyId: 'cmp_bert_ua', avatar: '/assets/avatars/avatar-marko.webp', approverId: 'usr_andrii' },
]

async function seed(): Promise<void> {
  await prisma.workspace.upsert({ where: { id: 'ws_bert' }, create: { id: 'ws_bert', displayName: 'BERT Workspace' }, update: { displayName: 'BERT Workspace' } })
  await prisma.company.upsert({ where: { id: 'cmp_bert_ua' }, create: { id: 'cmp_bert_ua', workspaceId: 'ws_bert', displayName: 'BERT', legalName: 'BERT', code: 'bert' }, update: { displayName: 'BERT', legalName: 'BERT', code: 'bert' } })
  for (const companyId of ['cmp_bert_ua']) {
    for (const code of allOrganizationCapabilityCodes) {
      await prisma.companyCapability.upsert({
        where: { companyId_code: { companyId, code } },
        create: { id: `cap_${companyId}_${code.toLowerCase()}`, companyId, code },
        update: {},
      })
    }
  }

  const passwordHash = await hashPassword(password)
  for (const user of users) {
    await prisma.user.upsert({ where: { id: user.id }, create: { id: user.id, workspaceId: 'ws_bert', primaryCompanyId: user.companyId, accountType: user.accountType, firstName: user.displayName.split(' ')[1] ?? user.displayName, lastName: user.displayName.split(' ')[0] ?? '', displayName: user.displayName, normalizedDisplayName: normalizeUserSearchValue(user.displayName), username: user.username, normalizedUsername: user.username, jobTitle: user.jobTitle, gender: user.gender, birthDate: user.birthDate, isActive: true, avatarAsset: user.avatar }, update: { primaryCompanyId: user.companyId, accountType: user.accountType, displayName: user.displayName, normalizedDisplayName: normalizeUserSearchValue(user.displayName), avatarAsset: user.avatar, gender: user.gender, birthDate: user.birthDate, isActive: true } })
    await prisma.usernameReservation.upsert({ where: { workspaceId_normalizedUsername: { workspaceId: 'ws_bert', normalizedUsername: user.username } }, create: { id: `unr_${user.username}`, workspaceId: 'ws_bert', normalizedUsername: user.username, currentUserId: user.id, state: 'ACTIVE' }, update: {} })
    await prisma.passwordCredential.upsert({ where: { userId: user.id }, create: { id: `pwd_${user.username}`, userId: user.id, passwordHash }, update: { passwordHash, changedAt: new Date() } })
  }
  for (const user of users) await prisma.user.update({ where: { id: user.id }, data: { approverId: user.approverId } })

  await prisma.companyCapability.updateMany({
    where: {
      companyId: 'cmp_bert_ua',
      code: { in: ['FEED', 'CALENDAR_WRITE'] },
      enabled: false,
    },
    data: {
      enabled: true,
      enabledById: 'usr_dmytro',
      enabledAt: new Date('2026-07-23T08:00:00.000Z'),
      disabledAt: null,
      version: { increment: 1 },
    },
  })

  const seedGroups = [
    {
      id: 'grp_product_design',
      companyId: 'cmp_bert_ua',
      key: 'product-design',
      name: 'Продукт і дизайн',
      description: 'Рішення та оновлення продуктової команди',
      discoverability: 'LISTED' as const,
      joinPolicy: 'OPEN' as const,
      ownerId: 'usr_maria',
      members: [
        ['usr_maria', 'OWNER'],
        ['usr_andrii', 'MEMBER'],
        ['usr_dmytro', 'MEMBER'],
      ] as const,
    },
    {
      id: 'grp_people_private',
      companyId: 'cmp_bert_ua',
      key: 'people-private',
      name: 'Люди · приватна група',
      description: 'Конфіденційний робочий контекст HR',
      discoverability: 'HIDDEN' as const,
      joinPolicy: 'INVITE_ONLY' as const,
      ownerId: 'usr_olena',
      members: [['usr_olena', 'OWNER']] as const,
    },
  ]
  for (const group of seedGroups) {
    await prisma.group.upsert({
      where: { id: group.id },
      create: {
        id: group.id,
        workspaceId: 'ws_bert',
        companyId: group.companyId,
        key: group.key,
        name: group.name,
        description: group.description,
        discoverability: group.discoverability,
        joinPolicy: group.joinPolicy,
        ownerId: group.ownerId,
      },
      update: {
        name: group.name,
        description: group.description,
        status: 'ACTIVE',
        archivedAt: null,
      },
    })
    for (const [userId, role] of group.members) {
      await prisma.groupMember.upsert({
        where: { groupId_userId: { groupId: group.id, userId } },
        create: { id: `gm_${group.id}_${userId}`, groupId: group.id, userId, role },
        update: { role, leftAt: null },
      })
    }
  }

  if (!await prisma.feedPost.findUnique({ where: { id: 'feed_release_notes' } })) {
    await prisma.feedPost.create({
      data: {
        id: 'feed_release_notes',
        workspaceId: 'ws_bert',
        companyId: 'cmp_bert_ua',
        authorId: 'usr_andrii',
        body: 'Сьогодні оновили робочий простір: головна сторінка показує важливі командні оновлення, а завдання й події залишаються окремими діями. Перегляньте зміни та підтвердьте ознайомлення.',
        requiresAcknowledgement: true,
        acknowledgementVersion: 1,
        publishedAt: new Date('2026-07-23T08:30:00.000Z'),
        recipients: {
          create: {
            id: 'frcp_release_company',
            type: 'COMPANY',
            recipientId: 'cmp_bert_ua',
          },
        },
        acknowledgementRecipients: {
          create: ['usr_maria', 'usr_olena', 'usr_dmytro', 'usr_marko'].map((userId) => ({
            id: `fackr_release_${userId}`,
            userId,
            acknowledgementVersion: 1,
          })),
        },
        subscriptions: {
          create: {
            id: 'fsub_release_andrii',
            userId: 'usr_andrii',
            mode: 'ALL',
          },
        },
      },
    })
    await prisma.feedItem.create({
      data: {
        id: 'fitem_release_notes',
        workspaceId: 'ws_bert',
        companyId: 'cmp_bert_ua',
        postId: 'feed_release_notes',
        sourceType: 'POST',
        sourceId: 'feed_release_notes',
        sourceVersion: 1,
        action: 'PUBLISHED',
        eventKey: 'feed:post:feed_release_notes:v1:published',
        actorId: 'usr_andrii',
        visibility: 'COMPANY',
        safePayload: JSON.stringify({ postId: 'feed_release_notes', action: 'PUBLISHED', snippet: 'Оновили робочий простір BertCRM' }),
        occurredAt: new Date('2026-07-23T08:30:00.000Z'),
      },
    })
  }

  if (!await prisma.feedPost.findUnique({ where: { id: 'feed_design_review' } })) {
    await prisma.feedPost.create({
      data: {
        id: 'feed_design_review',
        workspaceId: 'ws_bert',
        companyId: 'cmp_bert_ua',
        groupId: 'grp_product_design',
        authorId: 'usr_maria',
        body: 'Підготувала компактніший варіант екрану огляду: головна дія тепер одна, фільтри залишаються в URL, а мобільна версія не має горизонтального прокручування.',
        publishedAt: new Date('2026-07-22T14:10:00.000Z'),
        recipients: {
          create: {
            id: 'frcp_design_group',
            type: 'GROUP',
            recipientId: 'grp_product_design',
          },
        },
        subscriptions: {
          create: {
            id: 'fsub_design_maria',
            userId: 'usr_maria',
            mode: 'ALL',
          },
        },
      },
    })
    await prisma.feedItem.create({
      data: {
        id: 'fitem_design_review',
        workspaceId: 'ws_bert',
        companyId: 'cmp_bert_ua',
        postId: 'feed_design_review',
        sourceType: 'POST',
        sourceId: 'feed_design_review',
        sourceVersion: 1,
        action: 'PUBLISHED',
        eventKey: 'feed:post:feed_design_review:v1:published',
        actorId: 'usr_maria',
        visibility: 'GROUP',
        safePayload: JSON.stringify({ postId: 'feed_design_review', action: 'PUBLISHED', snippet: 'Компактніший варіант екрану огляду' }),
        occurredAt: new Date('2026-07-22T14:10:00.000Z'),
      },
    })
    await prisma.comment.create({
      data: {
        id: 'cmt_feed_design',
        workspaceId: 'ws_bert',
        companyId: 'cmp_bert_ua',
        entityType: 'FEED_POST',
        entityId: 'feed_design_review',
        authorId: 'usr_andrii',
        body: 'Фокус став значно яснішим. Перевірмо ще клавіатурну навігацію перед релізом.',
        visibility: 'FEED_AUDIENCE',
      },
    })
  }

  const orgUnits = [
    { id: 'org_bert_ua_operations', companyId: 'cmp_bert_ua', sourceKey: 'operations', parentId: null, name: 'Операції', normalizedName: 'операції', managerId: 'usr_andrii', sortOrder: 10 },
    { id: 'org_bert_ua_product', companyId: 'cmp_bert_ua', sourceKey: 'product', parentId: 'org_bert_ua_operations', name: 'Продукт і дизайн', normalizedName: 'продукт і дизайн', managerId: 'usr_maria', sortOrder: 20 },
    { id: 'org_bert_ua_people', companyId: 'cmp_bert_ua', sourceKey: 'people', parentId: 'org_bert_ua_operations', name: 'Люди та культура', normalizedName: 'люди та культура', managerId: 'usr_olena', sortOrder: 30 },
    { id: 'org_bert_ua_technology', companyId: 'cmp_bert_ua', sourceKey: 'technology', parentId: 'org_bert_ua_operations', name: 'Технології', normalizedName: 'технології', managerId: 'usr_dmytro', sortOrder: 40 },
    { id: 'org_bert_service', companyId: 'cmp_bert_ua', sourceKey: 'service', parentId: 'org_bert_ua_operations', name: 'Сервісний відділ', normalizedName: 'сервісний відділ', managerId: 'usr_marko', sortOrder: 50 },
  ] as const
  for (const unit of orgUnits) {
    await prisma.orgUnit.upsert({
      where: { id: unit.id },
      create: { ...unit, workspaceId: 'ws_bert' },
      update: { companyId: unit.companyId, parentId: unit.parentId, name: unit.name, normalizedName: unit.normalizedName, managerId: unit.managerId, sortOrder: unit.sortOrder, status: 'ACTIVE' },
    })
  }
  const orgStartedAt = new Date('2026-01-01T00:00:00.000Z')
  for (const assignment of [
    { id: 'orga_andrii_operations', userId: 'usr_andrii', companyId: 'cmp_bert_ua', orgUnitId: 'org_bert_ua_operations', positionTitle: 'Операційний керівник' },
    { id: 'orga_maria_product', userId: 'usr_maria', companyId: 'cmp_bert_ua', orgUnitId: 'org_bert_ua_product', positionTitle: 'Продуктова дизайнерка' },
    { id: 'orga_olena_people', userId: 'usr_olena', companyId: 'cmp_bert_ua', orgUnitId: 'org_bert_ua_people', positionTitle: 'HR-фахівчиня' },
    { id: 'orga_dmytro_technology', userId: 'usr_dmytro', companyId: 'cmp_bert_ua', orgUnitId: 'org_bert_ua_technology', positionTitle: 'Системний адміністратор' },
    { id: 'orga_marko_service', userId: 'usr_marko', companyId: 'cmp_bert_ua', orgUnitId: 'org_bert_service', positionTitle: 'Дизайнер' },
  ]) {
    await prisma.userOrgAssignment.upsert({
      where: { userId_orgUnitId_startedAt: { userId: assignment.userId, orgUnitId: assignment.orgUnitId, startedAt: orgStartedAt } },
      create: { ...assignment, isPrimary: true, startedAt: orgStartedAt },
      update: { companyId: assignment.companyId, positionTitle: assignment.positionTitle, isPrimary: true, endedAt: null },
    })
  }

  for (const [category, durationDays] of [['notifications', 180], ['closed_sessions', 180], ['job_details', 30]] as const) {
    await prisma.retentionPolicy.upsert({
      where: { category_version: { category, version: 1 } },
      create: { id: `rtp_${category}_v1`, category, durationDays, action: 'PURGE', version: 1, effectiveAt: new Date('2026-01-01T00:00:00Z'), changedBy: 'usr_dmytro' },
      update: {},
    })
  }

  await prisma.project.upsert({
    where: { id: 'prj_website' },
    create: { id: 'prj_website', workspaceId: 'ws_bert', companyId: 'cmp_bert_ua', name: 'Вебсайт для клієнта', normalizedName: 'вебсайт для клієнта' },
    update: { name: 'Вебсайт для клієнта', normalizedName: 'вебсайт для клієнта', status: 'ACTIVE' },
  })
  for (const tag of [
    { id: 'tag_design', name: 'Дизайн', normalizedName: 'дизайн', color: '#7656d6' },
    { id: 'tag_important', name: 'Важливо', normalizedName: 'важливо', color: '#c43f4e' },
  ]) {
    await prisma.tag.upsert({
      where: { id: tag.id },
      create: { ...tag, workspaceId: 'ws_bert', companyId: 'cmp_bert_ua' },
      update: { name: tag.name, normalizedName: tag.normalizedName, color: tag.color },
    })
  }

  const taskData = [
    ['tsk_design', '2401', 'Підготувати концепцію дизайну dashboard', 'usr_andrii', 'usr_maria', 'IN_PROGRESS', 'HIGH', '2026-07-15T12:00:00Z', 'prj_website'],
    ['tsk_policy', '2402', 'Оновити UI-kit компонента «Кнопка»', 'usr_maria', 'usr_andrii', 'PLANNED', 'MEDIUM', '2026-07-15T16:00:00Z', 'prj_website'],
    ['tsk_report', '2403', 'Підготувати звіт за липень', 'usr_andrii', 'usr_andrii', 'BLOCKED', 'HIGH', '2026-07-14T15:00:00Z', null],
    ['tsk_onboarding', '2404', 'Підготувати доступи нового працівника', 'usr_andrii', 'usr_olena', 'IN_PROGRESS', 'HIGH', '2026-07-17T09:00:00Z', null],
  ] as const
  for (const [taskId, number, title, createdById, responsibleId, status, priority, dueAt, projectId] of taskData) {
    await prisma.task.upsert({
      where: { id: taskId },
      create: { id: taskId, workspaceId: 'ws_bert', companyId: 'cmp_bert_ua', number, title, createdById, reporterId: createdById, status, priority, dueAt: new Date(dueAt), projectId },
      update: { createdById, reporterId: createdById, projectId },
    })
    await prisma.taskParticipant.upsert({
      where: { taskId_userId: { taskId, userId: responsibleId } },
      create: { id: `tpart_${taskId}_${responsibleId}`, taskId, userId: responsibleId, role: 'RESPONSIBLE', addedById: createdById },
      update: { role: 'RESPONSIBLE', addedById: createdById, removedAt: null },
    })
    await prisma.taskNumberAlias.upsert({
      where: { legacyNumber: `TSK-${number}` },
      create: { id: `tnum_alias_${taskId}`, taskId, legacyNumber: `TSK-${number}` },
      update: { taskId },
    })
  }
  const taskSequence = await prisma.taskNumberSequence.findUnique({ where: { scope: 'global' } })
  if (!taskSequence || taskSequence.lastNumber < 2404n) {
    await prisma.taskNumberSequence.upsert({
      where: { scope: 'global' },
      create: { scope: 'global', lastNumber: 2404n },
      update: { lastNumber: 2404n },
    })
  }
  for (const participant of [
    { id: 'tpart_report_maria_co', taskId: 'tsk_report', userId: 'usr_maria', role: 'COLLABORATOR' as const },
    { id: 'tpart_onboarding_maria_observer', taskId: 'tsk_onboarding', userId: 'usr_maria', role: 'WATCHER' as const },
  ]) {
    await prisma.taskParticipant.upsert({
      where: { taskId_userId: { taskId: participant.taskId, userId: participant.userId } },
      create: { ...participant, addedById: 'usr_andrii' },
      update: { role: participant.role, addedById: 'usr_andrii', removedAt: null },
    })
  }
  await prisma.taskTag.upsert({
    where: { taskId_tagId: { taskId: 'tsk_design', tagId: 'tag_design' } },
    create: { taskId: 'tsk_design', tagId: 'tag_design' },
    update: {},
  })

  for (const [eventId, ownerId, title, start, end] of [
    ['evt_sync', 'usr_maria', 'Синхронізація проєкту', '2026-07-15T11:00:00Z', '2026-07-15T11:45:00Z'],
    ['evt_review', 'usr_andrii', 'Огляд операцій', '2026-07-15T12:30:00Z', '2026-07-15T13:00:00Z'],
  ]) await prisma.event.upsert({ where: { id: eventId }, create: { id: eventId, workspaceId: 'ws_bert', companyId: 'cmp_bert_ua', ownerId, title, startAt: new Date(start), endAt: new Date(end), sourceTimezone: 'Europe/Kyiv' }, update: {} })

  await prisma.document.upsert({ where: { id: 'doc_policy' }, create: { id: 'doc_policy', workspaceId: 'ws_bert', companyId: 'cmp_bert_ua', number: 'DOC-0102', name: 'Політика роботи з даними', ownerId: 'usr_olena', status: 'PUBLISHED', confidentiality: 'INTERNAL' }, update: {} })
  await prisma.knowledgeArticle.upsert({ where: { id: 'art_security' }, create: { id: 'art_security', workspaceId: 'ws_bert', slug: 'bezpechna-robota-z-danymy', ownerId: 'usr_olena', currentVersionId: 'artv_security', reviewAt: new Date('2026-12-01T00:00:00Z') }, update: {} })
  await prisma.knowledgeArticleVersion.upsert({ where: { articleId_version: { articleId: 'art_security', version: 1 } }, create: { id: 'artv_security', articleId: 'art_security', version: 1, title: 'Безпечна робота з даними', body: 'Зберігайте робочі дані тільки у дозволених системах. Не передавайте облікові дані та одноразові коди іншим людям.', changeSummary: 'Перша публікація', createdBy: 'usr_olena', publishedAt: new Date() }, update: {} })
  for (const companyId of ['cmp_bert_ua', 'cmp_bert_service']) await prisma.articleAudience.upsert({ where: { articleId_principalType_principalId: { articleId: 'art_security', principalType: 'COMPANY', principalId: companyId } }, create: { id: `arta_${companyId}`, articleId: 'art_security', principalType: 'COMPANY', principalId: companyId }, update: {} })

  await prisma.announcement.upsert({ where: { id: 'ann_policy' }, create: { id: 'ann_policy', workspaceId: 'ws_bert', authorId: 'usr_olena', title: 'Оновлено політику роботи з даними', body: 'Перегляньте короткий перелік змін і підтвердьте ознайомлення у базі знань.', status: 'PUBLISHED', isPinned: true, publishAt: new Date('2026-07-12T09:00:00Z') }, update: {} })
  await prisma.announcementAudienceCompany.upsert({ where: { announcementId_companyId: { announcementId: 'ann_policy', companyId: 'cmp_bert_ua' } }, create: { id: 'anc_policy', announcementId: 'ann_policy', companyId: 'cmp_bert_ua' }, update: {} })
  for (const user of users) await prisma.announcementReceipt.upsert({ where: { announcementId_userId: { announcementId: 'ann_policy', userId: user.id } }, create: { id: `anrec_${user.username}`, announcementId: 'ann_policy', userId: user.id, effectiveContentVersion: 1 }, update: {} })
  const feedSourceItems = [
    {
      id: 'fitem_task_report',
      sourceType: 'TASK',
      sourceId: 'tsk_report',
      sourceVersion: 1,
      action: 'BLOCKED',
      eventKey: 'feed:task:tsk_report:v1:blocked',
      actorId: 'usr_andrii',
      visibility: 'PARTICIPANTS',
      occurredAt: new Date('2026-07-21T13:20:00.000Z'),
      recipientIds: ['usr_andrii', 'usr_maria'],
    },
    {
      id: 'fitem_event_review',
      sourceType: 'EVENT',
      sourceId: 'evt_review',
      sourceVersion: 1,
      action: 'SCHEDULED',
      eventKey: 'feed:event:evt_review:v1:scheduled',
      actorId: 'usr_andrii',
      visibility: 'COMPANY',
      occurredAt: new Date('2026-07-20T10:00:00.000Z'),
      recipientIds: ['usr_andrii'],
    },
    {
      id: 'fitem_announcement_policy',
      sourceType: 'ANNOUNCEMENT',
      sourceId: 'ann_policy',
      sourceVersion: 1,
      action: 'PUBLISHED',
      eventKey: 'feed:announcement:ann_policy:cmp_bert_ua:v1:published',
      actorId: 'usr_olena',
      visibility: 'PARTICIPANTS',
      occurredAt: new Date('2026-07-19T09:00:00.000Z'),
      recipientIds: ['usr_maria', 'usr_andrii', 'usr_olena', 'usr_dmytro', 'usr_marko'],
    },
  ] as const
  for (const source of feedSourceItems) {
    if (!await prisma.feedItem.findUnique({ where: { eventKey: source.eventKey } })) {
      await prisma.feedItem.create({
        data: {
          id: source.id,
          workspaceId: 'ws_bert',
          companyId: 'cmp_bert_ua',
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          sourceVersion: source.sourceVersion,
          action: source.action,
          eventKey: source.eventKey,
          actorId: source.actorId,
          visibility: source.visibility,
          safePayload: JSON.stringify({
            schemaVersion: 1,
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            action: source.action,
            historical: false,
          }),
          countsAsUnread: false,
          occurredAt: source.occurredAt,
        },
      })
    }
    const allowedRecipients = await prisma.user.findMany({
      where: { primaryCompanyId: 'cmp_bert_ua', isActive: true, id: { in: [...source.recipientIds] } },
      select: { id: true },
    })
    const existingRecipientIds = new Set((await prisma.feedItemRecipient.findMany({
      where: { itemId: source.id },
      select: { userId: true },
    })).map(({ userId }) => userId))
    await prisma.feedItemRecipient.createMany({
      data: allowedRecipients
        .filter(({ id: userId }) => !existingRecipientIds.has(userId))
        .map(({ id: userId }) => ({
          id: `firec_${source.id}_${userId}`,
          itemId: source.id,
          userId,
        })),
    })
  }
  const currentFeedItems = await prisma.feedItem.findMany({
    orderBy: [
      { sourceVersion: 'desc' },
      { occurredAt: 'desc' },
      { id: 'desc' },
    ],
  })
  const seededHeads = new Set<string>()
  for (const item of currentFeedItems) {
    const sourceKey = `${item.workspaceId}:${item.companyId}:${item.sourceType}:${item.sourceId}`
    if (seededHeads.has(sourceKey)) continue
    seededHeads.add(sourceKey)
    await prisma.feedSourceHead.upsert({
      where: {
        workspaceId_companyId_sourceType_sourceId: {
          workspaceId: item.workspaceId,
          companyId: item.companyId,
          sourceType: item.sourceType,
          sourceId: item.sourceId,
        },
      },
      create: {
        id: `fhead_${item.id}`,
        workspaceId: item.workspaceId,
        companyId: item.companyId,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        itemId: item.id,
        sourceVersion: item.sourceVersion,
        countsAsUnread: item.countsAsUnread,
        occurredAt: item.occurredAt,
      },
      update: {
        itemId: item.id,
        sourceVersion: item.sourceVersion,
        countsAsUnread: item.countsAsUnread,
        occurredAt: item.occurredAt,
      },
    })
  }

  await prisma.lifecycleProcess.upsert({ where: { id: 'life_onboarding' }, create: { id: 'life_onboarding', workspaceId: 'ws_bert', companyId: 'cmp_bert_ua', employeeId: 'usr_marko', processType: 'ONBOARDING', templateVersion: 1, ownerId: 'usr_olena', startAt: new Date('2026-07-20T00:00:00Z'), status: 'IN_PROGRESS', progress: 42 }, update: {} })
  await prisma.lifecycleStep.upsert({ where: { processId_sourceKey: { processId: 'life_onboarding', sourceKey: 'IT_ACCESS' } }, create: { id: 'step_onboarding_it', processId: 'life_onboarding', sourceKey: 'IT_ACCESS', linkedTaskId: 'tsk_onboarding', ownerId: 'usr_olena', status: 'IN_PROGRESS', dueAt: new Date('2026-07-17T09:00:00Z') }, update: {} })

  await prisma.messageThread.upsert({ where: { id: 'thread_design' }, create: { id: 'thread_design', workspaceId: 'ws_bert', companyId: 'cmp_bert_ua', kind: 'CONTEXTUAL', title: 'Дизайн dashboard', entityType: 'TASK', entityId: 'tsk_design', createdById: 'usr_maria', lastMessageAt: new Date() }, update: {} })
  for (const [index, userId] of ['usr_maria', 'usr_andrii'].entries()) await prisma.threadParticipant.upsert({ where: { threadId_userId: { threadId: 'thread_design', userId } }, create: { id: `tp_${userId}`, threadId: 'thread_design', userId, role: index === 0 ? 'OWNER' : 'MEMBER' }, update: {} })
  await prisma.message.upsert({ where: { id: 'msg_design' }, create: { id: 'msg_design', threadId: 'thread_design', authorId: 'usr_andrii', body: 'Перевірмо фокус-блок і mobile-поведінку перед публікацією.' }, update: {} })

  await prisma.auditEvent.create({ data: { id: `aud_seed_${Date.now()}`, workspaceId: 'ws_bert', actorType: 'SYSTEM', action: 'demo.seeded', entityType: 'WORKSPACE', entityId: 'ws_bert', result: 'SUCCESS', risk: 'NORMAL', correlationId: `seed_${Date.now()}` } })
}

seed().then(async () => { await prisma.$disconnect(); console.log('Development seed ready for maria, andrii, olena and dmytro.') }).catch(async (error) => { console.error(error instanceof Error ? error.message : error); await prisma.$disconnect(); process.exitCode = 1 })
