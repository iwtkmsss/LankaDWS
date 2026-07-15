import 'dotenv/config'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../src/generated/prisma/client.js'
import { allPermissionCodes, Permission } from '@bert-crm/contracts'
import { hashPassword } from '../src/common/crypto.js'
import { getConfig } from '../src/config/config.js'

if (process.env.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production')

const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: getConfig().DATABASE_URL }) })
const password = process.env.DEMO_SEED_PASSWORD ?? 'BertDemoPassphrase2026!'

const roles = {
  employee: { id: 'role_employee', name: 'Працівник', permissions: [Permission.TasksRead, Permission.TasksCreate, Permission.RequestsRead, Permission.RequestsCreate, Permission.CalendarRead, Permission.DocumentsRead, Permission.DocumentsManage, Permission.KnowledgeRead, Permission.EmployeesRead, Permission.AnnouncementsRead, Permission.MessagesRead, Permission.NotificationsRead] },
  manager: { id: 'role_manager', name: 'Керівник', permissions: [Permission.TasksRead, Permission.TasksCreate, Permission.TasksManage, Permission.RequestsRead, Permission.RequestsCreate, Permission.RequestsApprove, Permission.CalendarRead, Permission.CalendarManage, Permission.DocumentsRead, Permission.DocumentsManage, Permission.KnowledgeRead, Permission.KnowledgeManage, Permission.EmployeesRead, Permission.AnnouncementsRead, Permission.MessagesRead, Permission.NotificationsRead, Permission.AnalyticsRead] },
  hr: { id: 'role_hr', name: 'HR', permissions: [Permission.TasksRead, Permission.TasksCreate, Permission.TasksManage, Permission.RequestsRead, Permission.RequestsCreate, Permission.RequestsApprove, Permission.CalendarRead, Permission.CalendarManage, Permission.DocumentsRead, Permission.DocumentsManage, Permission.KnowledgeRead, Permission.KnowledgeManage, Permission.EmployeesRead, Permission.LifecycleManage, Permission.AnnouncementsRead, Permission.AnnouncementsCreate, Permission.AnnouncementsPublish, Permission.MessagesRead, Permission.NotificationsRead, Permission.AnalyticsRead, Permission.ConfidentialHrRead] },
  admin: { id: 'role_admin', name: 'Адміністратор', permissions: allPermissionCodes },
  viewer: { id: 'role_viewer', name: 'Перегляд', permissions: [Permission.TasksRead, Permission.CalendarRead, Permission.DocumentsRead, Permission.KnowledgeRead, Permission.EmployeesRead, Permission.AnnouncementsRead, Permission.NotificationsRead] },
}

const users = [
  { id: 'usr_maria', username: 'maria', displayName: 'Марія Іваненко', jobTitle: 'Продуктова дизайнерка', role: roles.employee, companyId: 'cmp_bert_ua', avatar: '/assets/avatars/avatar-maria.webp', approverId: 'usr_andrii' },
  { id: 'usr_andrii', username: 'andrii', displayName: 'Андрій Коваль', jobTitle: 'Операційний керівник', role: roles.manager, companyId: 'cmp_bert_ua', avatar: '/assets/avatars/avatar-andrii.webp', approverId: 'usr_dmytro' },
  { id: 'usr_olena', username: 'olena', displayName: 'Олена Бондар', jobTitle: 'HR-фахівчиня', role: roles.hr, companyId: 'cmp_bert_ua', avatar: '/assets/avatars/avatar-olena.webp', approverId: 'usr_andrii' },
  { id: 'usr_dmytro', username: 'dmytro', displayName: 'Дмитро Савчук', jobTitle: 'Системний адміністратор', role: roles.admin, companyId: 'cmp_bert_ua', avatar: '/assets/avatars/avatar-dmytro.webp', approverId: 'usr_andrii' },
  { id: 'usr_marko', username: 'marko', displayName: 'Марко Литвин', jobTitle: 'Дизайнер', role: roles.employee, companyId: 'cmp_bert_service', avatar: '/assets/avatars/avatar-marko.webp', approverId: 'usr_andrii' },
]

async function seed(): Promise<void> {
  await prisma.workspace.upsert({ where: { id: 'ws_bert' }, create: { id: 'ws_bert', displayName: 'BERT Workspace' }, update: { displayName: 'BERT Workspace' } })
  await prisma.company.upsert({ where: { id: 'cmp_bert_ua' }, create: { id: 'cmp_bert_ua', workspaceId: 'ws_bert', displayName: 'BERT Україна', legalName: 'ТОВ «БЕРТ Україна»', code: 'bert-ua' }, update: {} })
  await prisma.company.upsert({ where: { id: 'cmp_bert_service' }, create: { id: 'cmp_bert_service', workspaceId: 'ws_bert', displayName: 'BERT Сервіс', legalName: 'ТОВ «БЕРТ Сервіс»', code: 'bert-service' }, update: {} })

  for (const code of allPermissionCodes) await prisma.permission.upsert({ where: { code }, create: { code, domain: code.split('.')[0] ?? 'system', risk: code.includes('reset') || code.includes('security') || code.includes('roles') ? 'HIGH' : 'NORMAL', description: code }, update: {} })
  for (const role of Object.values(roles)) {
    await prisma.role.upsert({ where: { id: role.id }, create: { id: role.id, workspaceId: 'ws_bert', name: role.name, normalizedName: role.name.toLowerCase(), isSystem: true, isFullAdmin: role.id === 'role_admin' }, update: { name: role.name } })
    for (const code of role.permissions) await prisma.rolePermission.upsert({ where: { roleId_permissionCode: { roleId: role.id, permissionCode: code } }, create: { id: `rp_${role.id}_${code.replaceAll('.', '_')}`, roleId: role.id, permissionCode: code, scope: role.id === 'role_employee' ? 'OWN' : 'ALL_COMPANIES' }, update: {} })
  }

  const passwordHash = await hashPassword(password)
  for (const user of users) {
    await prisma.user.upsert({ where: { id: user.id }, create: { id: user.id, workspaceId: 'ws_bert', primaryCompanyId: user.companyId, displayName: user.displayName, username: user.username, normalizedUsername: user.username, jobTitle: user.jobTitle, displayRole: user.role.name, status: 'ACTIVE', mustChangePassword: false, avatarAsset: user.avatar }, update: { displayName: user.displayName, avatarAsset: user.avatar, status: 'ACTIVE' } })
    await prisma.usernameReservation.upsert({ where: { workspaceId_normalizedUsername: { workspaceId: 'ws_bert', normalizedUsername: user.username } }, create: { id: `unr_${user.username}`, workspaceId: 'ws_bert', normalizedUsername: user.username, currentUserId: user.id, state: 'ACTIVE' }, update: {} })
    for (const companyId of ['cmp_bert_ua', 'cmp_bert_service']) await prisma.userCompanyAccess.upsert({ where: { userId_companyId: { userId: user.id, companyId } }, create: { id: `uca_${user.username}_${companyId}`, userId: user.id, companyId, grantedBy: 'usr_dmytro' }, update: {} })
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: user.role.id } }, create: { id: `ur_${user.username}`, userId: user.id, roleId: user.role.id, grantedBy: 'usr_dmytro' }, update: {} })
    await prisma.passwordCredential.upsert({ where: { userId: user.id }, create: { id: `pwd_${user.username}`, userId: user.id, passwordHash }, update: { passwordHash, changedAt: new Date() } })
  }
  for (const user of users) await prisma.user.update({ where: { id: user.id }, data: { approverId: user.approverId } })

  for (const [category, durationDays] of [['notifications', 180], ['closed_sessions', 180], ['job_details', 30]] as const) {
    await prisma.retentionPolicy.upsert({
      where: { category_version: { category, version: 1 } },
      create: { id: `rtp_${category}_v1`, category, durationDays, action: 'PURGE', version: 1, effectiveAt: new Date('2026-01-01T00:00:00Z'), changedBy: 'usr_dmytro' },
      update: {},
    })
  }

  await prisma.requestType.upsert({ where: { id: 'rtype_absence' }, create: { id: 'rtype_absence', workspaceId: 'ws_bert', name: 'Відсутність · Відпустка', category: 'ABSENCE', schemaJson: JSON.stringify({ fields: ['startDate', 'endDate', 'substituteId', 'privateHrComment'] }), effectsJson: JSON.stringify(['calendar', 'presence', 'notifications']) }, update: {} })

  const taskData = [
    ['tsk_design', 'TSK-2401', 'Підготувати концепцію дизайну dashboard', 'usr_maria', 'IN_PROGRESS', 'HIGH', '2026-07-15T12:00:00Z'],
    ['tsk_policy', 'TSK-2402', 'Оновити UI-kit компонента «Кнопка»', 'usr_maria', 'PLANNED', 'MEDIUM', '2026-07-15T16:00:00Z'],
    ['tsk_report', 'TSK-2403', 'Підготувати звіт за липень', 'usr_andrii', 'BLOCKED', 'HIGH', '2026-07-14T15:00:00Z'],
    ['tsk_onboarding', 'TSK-2404', 'Підготувати доступи нового працівника', 'usr_olena', 'IN_PROGRESS', 'HIGH', '2026-07-17T09:00:00Z'],
  ] as const
  for (const [taskId, number, title, assigneeId, status, priority, deadline] of taskData) await prisma.task.upsert({ where: { id: taskId }, create: { id: taskId, workspaceId: 'ws_bert', companyId: 'cmp_bert_ua', number, title, creatorId: 'usr_andrii', assigneeId, status, priority, deadline: new Date(deadline) }, update: {} })

  await prisma.request.upsert({ where: { id: 'req_absence_demo' }, create: { id: 'req_absence_demo', workspaceId: 'ws_bert', companyId: 'cmp_bert_ua', number: 'REQ-0252', authorId: 'usr_maria', typeId: 'rtype_absence', typeVersion: 1, routeVersion: 1, decisionStatus: 'PENDING', currentApproverId: 'usr_andrii', confidentiality: 'HR_SECURITY', slaDueAt: new Date('2026-07-15T12:00:00Z') }, update: {} })
  await prisma.requestSnapshot.upsert({ where: { requestId_version: { requestId: 'req_absence_demo', version: 1 } }, create: { id: 'snap_absence_demo', requestId: 'req_absence_demo', version: 1, valuesJson: JSON.stringify({ type: 'absence', startAt: '2026-07-20T00:00:00.000Z', endAt: '2026-07-24T23:59:59.999Z', substituteId: 'usr_marko', workdays: 5 }), safeSummary: 'Відпустка · 20–24 липня', authorId: 'usr_maria' }, update: {} })
  await prisma.approvalAttempt.upsert({ where: { id: 'apr_absence_demo' }, create: { id: 'apr_absence_demo', requestId: 'req_absence_demo', requestVersion: 1, approverId: 'usr_andrii', state: 'PENDING', idempotencyKey: 'pending:req_absence_demo:1' }, update: {} })

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

  await prisma.lifecycleProcess.upsert({ where: { id: 'life_onboarding' }, create: { id: 'life_onboarding', workspaceId: 'ws_bert', companyId: 'cmp_bert_ua', employeeId: 'usr_marko', processType: 'ONBOARDING', templateVersion: 1, ownerId: 'usr_olena', startAt: new Date('2026-07-20T00:00:00Z'), status: 'IN_PROGRESS', progress: 42 }, update: {} })
  await prisma.lifecycleStep.upsert({ where: { processId_sourceKey: { processId: 'life_onboarding', sourceKey: 'IT_ACCESS' } }, create: { id: 'step_onboarding_it', processId: 'life_onboarding', sourceKey: 'IT_ACCESS', linkedTaskId: 'tsk_onboarding', ownerId: 'usr_olena', status: 'IN_PROGRESS', dueAt: new Date('2026-07-17T09:00:00Z') }, update: {} })

  await prisma.messageThread.upsert({ where: { id: 'thread_design' }, create: { id: 'thread_design', workspaceId: 'ws_bert', companyId: 'cmp_bert_ua', kind: 'CONTEXT', title: 'Дизайн dashboard', entityType: 'TASK', entityId: 'tsk_design', lastMessageAt: new Date() }, update: {} })
  for (const userId of ['usr_maria', 'usr_andrii']) await prisma.threadParticipant.upsert({ where: { threadId_userId: { threadId: 'thread_design', userId } }, create: { id: `tp_${userId}`, threadId: 'thread_design', userId, role: 'PARTICIPANT' }, update: {} })
  await prisma.message.upsert({ where: { id: 'msg_design' }, create: { id: 'msg_design', threadId: 'thread_design', authorId: 'usr_andrii', body: 'Перевірмо фокус-блок і mobile-поведінку перед публікацією.' }, update: {} })

  await prisma.notification.upsert({ where: { dedupeKey: 'seed:request:req_absence_demo:andrii' }, create: { id: 'ntf_approval', recipientId: 'usr_andrii', category: 'APPROVALS', safeTitle: 'Потрібне ваше рішення', safeSnippet: 'Відпустка · 20–24 липня', entityType: 'REQUEST', entityId: 'req_absence_demo', requiresAction: true, dedupeKey: 'seed:request:req_absence_demo:andrii', deliveredAt: new Date() }, update: {} })
  await prisma.auditEvent.create({ data: { id: `aud_seed_${Date.now()}`, workspaceId: 'ws_bert', actorType: 'SYSTEM', action: 'demo.seeded', entityType: 'WORKSPACE', entityId: 'ws_bert', result: 'SUCCESS', risk: 'NORMAL', correlationId: `seed_${Date.now()}` } })
}

seed().then(async () => { await prisma.$disconnect(); console.log('Development seed ready for maria, andrii, olena and dmytro.') }).catch(async (error) => { console.error(error instanceof Error ? error.message : error); await prisma.$disconnect(); process.exitCode = 1 })
