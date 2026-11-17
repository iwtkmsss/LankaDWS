// Extract step of the one-off Bitrix24 import: runs read-only SQL against a restored Bitrix MySQL copy
// through the `mysql` CLI and streams one gzip NDJSON file per entity. No credential column is ever selected.
//
//   npm run bitrix:extract --workspace @lankadws/api -- --out <ndjson dir> --mysql <path to mysql.exe>
//
// Options (or env): --out (BITRIX_NDJSON_DIR), --mysql (BITRIX_MYSQL_BIN, default `mysql`),
// --host (127.0.0.1), --port (3307), --user (root), --database (sitemanager), --only users,tasks
// The MySQL password, if any, is read by the client from MYSQL_PWD.
import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { ENTITY_FILES, type EntityFile, formatDuration, ndjsonPath, parseArgs, stringOption } from './common.js'

interface MysqlOptions {
  bin: string
  host: string
  port: string
  user: string
  database: string
}

// Chats that become LankaDWS threads: personal dialogs (P without entity) and group chats
// (plain, SONET_GROUP, CALL). System (S), open lines (O), CRM and self-chats (P/PERSONAL) are not moved.
const CHAT_FILTER = `((c.TYPE = 'P' AND COALESCE(c.ENTITY_TYPE, '') = '')
  OR (c.TYPE = 'C' AND COALESCE(c.ENTITY_TYPE, '') IN ('', 'SONET_GROUP', 'CALL')))`

// External accounts (email, bot, replica, ...) are imported only when they authored or take part in moved content.
const EXTERNAL_USER_REFERENCED = `(
  EXISTS (SELECT 1 FROM b_tasks t WHERE t.CREATED_BY = u.ID OR t.RESPONSIBLE_ID = u.ID)
  OR EXISTS (SELECT 1 FROM b_tasks_member tm WHERE tm.USER_ID = u.ID AND tm.TYPE IN ('R', 'A', 'U'))
  OR EXISTS (SELECT 1 FROM b_forum_message f WHERE f.AUTHOR_ID = u.ID AND f.FORUM_ID = 11 AND f.NEW_TOPIC = 'N' AND f.PARAM1 IS NULL)
  OR EXISTS (SELECT 1 FROM b_blog_post bp WHERE bp.AUTHOR_ID = u.ID AND bp.PUBLISH_STATUS = 'P')
  OR EXISTS (SELECT 1 FROM b_blog_comment bc WHERE bc.AUTHOR_ID = u.ID AND bc.PUBLISH_STATUS = 'P')
  OR EXISTS (SELECT 1 FROM b_im_relation r JOIN b_im_chat c ON c.ID = r.CHAT_ID WHERE r.USER_ID = u.ID AND ${CHAT_FILTER})
  OR EXISTS (SELECT 1 FROM b_im_message m JOIN b_im_chat c ON c.ID = m.CHAT_ID WHERE m.AUTHOR_ID = u.ID AND m.NOTIFY_TYPE = 0 AND ${CHAT_FILTER})
  OR EXISTS (SELECT 1 FROM b_calendar_event e WHERE (e.OWNER_ID = u.ID OR e.CREATED_BY = u.ID) AND e.DELETED = 'N' AND e.CAL_TYPE IN ('user', 'company_calendar', 'group'))
  OR EXISTS (SELECT 1 FROM b_sonet_user2group g WHERE g.USER_ID = u.ID AND g.ROLE IN ('A', 'E', 'K'))
)`

const QUERIES: Record<EntityFile, string> = {
  users: `SELECT JSON_OBJECT('id', u.ID, 'login', u.LOGIN, 'active', u.ACTIVE, 'name', u.NAME, 'lastName', u.LAST_NAME,
      'secondName', u.SECOND_NAME, 'gender', u.PERSONAL_GENDER, 'birthday', u.PERSONAL_BIRTHDAY,
      'mobile', u.PERSONAL_MOBILE, 'phone', u.PERSONAL_PHONE, 'workPhone', u.WORK_PHONE, 'position', u.WORK_POSITION,
      'external', u.EXTERNAL_AUTH_ID, 'registeredAt', u.DATE_REGISTER, 'updatedAt', u.TIMESTAMP_X,
      'referenced', CASE WHEN u.EXTERNAL_AUTH_ID IS NULL THEN 1 WHEN ${EXTERNAL_USER_REFERENCED} THEN 1 ELSE 0 END)
    FROM b_user u ORDER BY u.ID`,
  departments: `SELECT JSON_OBJECT('id', s.ID, 'parentId', s.IBLOCK_SECTION_ID, 'name', s.NAME, 'sort', s.SORT,
      'depth', s.DEPTH_LEVEL, 'active', s.ACTIVE, 'headId', h.UF_HEAD, 'createdAt', s.DATE_CREATE, 'updatedAt', s.TIMESTAMP_X)
    FROM b_iblock_section s LEFT JOIN b_uts_iblock_1_section h ON h.VALUE_ID = s.ID
    WHERE s.IBLOCK_ID = 1 ORDER BY s.DEPTH_LEVEL, s.LEFT_MARGIN, s.ID`,
  user_departments: `SELECT JSON_OBJECT('userId', VALUE_ID, 'deptId', VALUE_INT)
    FROM b_utm_user WHERE FIELD_ID = (SELECT ID FROM b_user_field WHERE ENTITY_ID = 'USER' AND FIELD_NAME = 'UF_DEPARTMENT')
      AND VALUE_INT IS NOT NULL ORDER BY ID`,
  groups: `SELECT JSON_OBJECT('id', ID, 'name', NAME, 'ownerId', OWNER_ID, 'createdAt', DATE_CREATE, 'updatedAt', DATE_UPDATE,
      'active', ACTIVE, 'closed', CLOSED, 'project', PROJECT)
    FROM b_sonet_group ORDER BY ID`,
  group_members: `SELECT JSON_OBJECT('groupId', GROUP_ID, 'userId', USER_ID, 'role', ROLE, 'createdAt', DATE_CREATE)
    FROM b_sonet_user2group WHERE ROLE IN ('A', 'E', 'K') ORDER BY GROUP_ID, ID`,
  chats: `SELECT JSON_OBJECT('id', c.ID, 'type', c.TYPE, 'entityType', c.ENTITY_TYPE, 'entityId', c.ENTITY_ID, 'title', c.TITLE,
      'authorId', c.AUTHOR_ID,
      'createdAt', COALESCE(c.DATE_CREATE, (SELECT MIN(m.DATE_CREATE) FROM b_im_message m WHERE m.CHAT_ID = c.ID)))
    FROM b_im_chat c WHERE ${CHAT_FILTER} ORDER BY c.ID`,
  chat_members: `SELECT JSON_OBJECT('chatId', r.CHAT_ID, 'userId', r.USER_ID, 'notifyBlock', r.NOTIFY_BLOCK, 'lastId', r.LAST_ID)
    FROM b_im_relation r JOIN b_im_chat c ON c.ID = r.CHAT_ID WHERE ${CHAT_FILTER} ORDER BY r.CHAT_ID, r.ID`,
  // Streamed per chat in (CHAT_ID, ID) index order: a global ORDER BY would force a multi-GB filesort.
  messages: `SELECT JSON_OBJECT('id', m.ID, 'chatId', m.CHAT_ID, 'authorId', m.AUTHOR_ID, 'message', m.MESSAGE,
      'createdAt', m.DATE_CREATE,
      'params', (SELECT GROUP_CONCAT(DISTINCT p.PARAM_NAME) FROM b_im_message_param p
        WHERE p.MESSAGE_ID = m.ID AND p.PARAM_NAME IN ('FILE_ID', 'IS_DELETED', 'CODE', 'IS_EDITED')))
    FROM b_im_chat c FORCE INDEX (PRIMARY) STRAIGHT_JOIN b_im_message m FORCE INDEX (IX_IM_MESS_7) ON m.CHAT_ID = c.ID
    WHERE ${CHAT_FILTER} AND m.NOTIFY_TYPE = 0`,
  message_likes: `SELECT JSON_OBJECT('id', p.ID, 'messageId', p.MESSAGE_ID, 'userId', p.PARAM_VALUE)
    FROM b_im_message_param p WHERE p.PARAM_NAME = 'LIKE' ORDER BY p.ID`,
  tasks: `SELECT JSON_OBJECT('id', ID, 'title', TITLE, 'description', DESCRIPTION, 'bbcode', DESCRIPTION_IN_BBCODE,
      'priority', PRIORITY, 'status', STATUS, 'responsibleId', RESPONSIBLE_ID, 'createdBy', CREATED_BY,
      'createdAt', CREATED_DATE, 'changedAt', CHANGED_DATE, 'closedAt', CLOSED_DATE, 'deadline', DEADLINE,
      'startPlan', START_DATE_PLAN, 'timeEstimate', TIME_ESTIMATE, 'taskControl', TASK_CONTROL, 'groupId', GROUP_ID,
      'parentId', PARENT_ID, 'forumTopicId', FORUM_TOPIC_ID, 'zombie', ZOMBIE)
    FROM b_tasks ORDER BY ID`,
  task_members: `SELECT JSON_OBJECT('taskId', TASK_ID, 'userId', USER_ID, 'type', TYPE)
    FROM b_tasks_member WHERE TYPE IN ('R', 'A', 'U') ORDER BY TASK_ID`,
  task_checklist: `SELECT JSON_OBJECT('id', c.ID, 'taskId', c.TASK_ID, 'title', c.TITLE, 'complete', c.IS_COMPLETE,
      'sort', c.SORT_INDEX, 'toggledBy', c.TOGGLED_BY, 'toggledAt', c.TOGGLED_DATE, 'parentId', t.PARENT_ID,
      'parentSort', p.SORT_INDEX,
      'isHeader', EXISTS (SELECT 1 FROM b_tasks_checklist_items_tree x WHERE x.PARENT_ID = c.ID AND x.LEVEL = 1))
    FROM b_tasks_checklist_items c
    LEFT JOIN b_tasks_checklist_items_tree t ON t.CHILD_ID = c.ID AND t.LEVEL = 1
    LEFT JOIN b_tasks_checklist_items p ON p.ID = t.PARENT_ID
    ORDER BY c.TASK_ID, c.ID`,
  // NEW_TOPIC='Y' / PARAM1 (TK, EV, TM, WF) are service rows, not people's comments.
  task_comments: `SELECT JSON_OBJECT('id', ID, 'topicId', TOPIC_ID, 'authorId', AUTHOR_ID, 'message', POST_MESSAGE,
      'createdAt', POST_DATE, 'editedAt', EDIT_DATE, 'approved', APPROVED)
    FROM b_forum_message WHERE FORUM_ID = 11 AND NEW_TOPIC = 'N' AND PARAM1 IS NULL ORDER BY ID`,
  blog_posts: `SELECT JSON_OBJECT('id', p.ID, 'authorId', p.AUTHOR_ID, 'title', p.TITLE, 'micro', p.MICRO, 'text', p.DETAIL_TEXT,
      'textType', p.DETAIL_TEXT_TYPE, 'createdAt', p.DATE_CREATE, 'publishedAt', p.DATE_PUBLISH,
      'important', EXISTS (SELECT 1 FROM b_blog_post_param x WHERE x.POST_ID = p.ID AND x.NAME = 'BLOG_POST_IMPRTNT'),
      'rights', (SELECT JSON_ARRAYAGG(r.ENTITY) FROM b_blog_socnet_rights r WHERE r.POST_ID = p.ID))
    FROM b_blog_post p WHERE p.PUBLISH_STATUS = 'P' ORDER BY p.ID`,
  blog_post_reads: `SELECT JSON_OBJECT('postId', POST_ID, 'userId', USER_ID)
    FROM b_blog_post_param WHERE NAME = 'BLOG_POST_IMPRTNT' AND VALUE = 'Y' AND USER_ID > 0 ORDER BY POST_ID, USER_ID`,
  blog_comments: `SELECT JSON_OBJECT('id', ID, 'postId', POST_ID, 'parentId', PARENT_ID, 'authorId', AUTHOR_ID,
      'text', POST_TEXT, 'createdAt', DATE_CREATE)
    FROM b_blog_comment WHERE PUBLISH_STATUS = 'P' ORDER BY ID`,
  // Own rows only: user-calendar copies of a meeting (PARENT_ID <> ID) and meeting rooms (location) are not moved.
  calendar_events: `SELECT JSON_OBJECT('id', ID, 'calType', CAL_TYPE, 'ownerId', OWNER_ID, 'createdBy', CREATED_BY, 'name', NAME,
      'description', DESCRIPTION, 'dateFrom', DATE_FROM, 'dateTo', DATE_TO, 'tzFrom', TZ_FROM, 'tzTo', TZ_TO,
      'skipTime', DT_SKIP_TIME, 'length', DT_LENGTH, 'rrule', RRULE, 'createdAt', DATE_CREATE, 'updatedAt', TIMESTAMP_X,
      'active', ACTIVE)
    FROM b_calendar_event
    WHERE DELETED = 'N' AND ((CAL_TYPE = 'user' AND PARENT_ID = ID) OR CAL_TYPE IN ('company_calendar', 'group'))
    ORDER BY ID`,
}

// Source-side totals for the report, so it shows what was filtered in SQL and why.
const SUMMARY_SQL = `SELECT JSON_OBJECT(
  'users', (SELECT JSON_OBJECTAGG(k, n) FROM (SELECT COALESCE(EXTERNAL_AUTH_ID, 'normal') k, COUNT(*) n FROM b_user GROUP BY k) x),
  'chats', (SELECT JSON_OBJECTAGG(k, n) FROM (SELECT CONCAT(TYPE, '/', COALESCE(NULLIF(ENTITY_TYPE, ''), '-')) k, COUNT(*) n FROM b_im_chat GROUP BY k) x),
  'tasks', (SELECT JSON_OBJECT('total', COUNT(*), 'zombie', SUM(ZOMBIE = 'Y')) FROM b_tasks),
  'taskForumRows', (SELECT JSON_OBJECT('total', COUNT(*), 'serviceRows', SUM(NEW_TOPIC = 'Y' OR PARAM1 IS NOT NULL)) FROM b_forum_message WHERE FORUM_ID = 11),
  'blogPosts', (SELECT JSON_OBJECTAGG(k, n) FROM (SELECT PUBLISH_STATUS k, COUNT(*) n FROM b_blog_post GROUP BY k) x),
  'blogComments', (SELECT JSON_OBJECTAGG(k, n) FROM (SELECT PUBLISH_STATUS k, COUNT(*) n FROM b_blog_comment GROUP BY k) x),
  'calendar', (SELECT JSON_OBJECTAGG(k, n) FROM (SELECT CONCAT(CAL_TYPE, IF(DELETED = 'Y', '/deleted', ''), IF(PARENT_ID = ID OR PARENT_ID IS NULL, '', '/attendee-copy')) k, COUNT(*) n FROM b_calendar_event GROUP BY k) x),
  'sonetMembers', (SELECT JSON_OBJECTAGG(k, n) FROM (SELECT ROLE k, COUNT(*) n FROM b_sonet_user2group GROUP BY k) x)
)`

function mysqlArgs(options: MysqlOptions): string[] {
  return [
    `--host=${options.host}`,
    `--port=${options.port}`,
    `--user=${options.user}`,
    '--default-character-set=utf8mb4',
    '--batch',
    '--raw',
    '--skip-column-names',
    // Without --quick the client buffers the whole result set in memory.
    '--quick',
    options.database,
  ]
}

/** Runs one SQL statement and pipes its single-column output (one JSON document per line) into `sink`. */
async function runQuery(options: MysqlOptions, sql: string, sinks: NodeJS.WritableStream[], onLine?: () => void): Promise<void> {
  const child = spawn(options.bin, mysqlArgs(options), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => { stderr += chunk })
  const exited = new Promise<number>((resolveExit, reject) => {
    child.on('error', reject)
    child.on('close', (code) => resolveExit(code ?? -1))
  })
  child.stdin.end(`SET SESSION group_concat_max_len = 1048576;\n${sql};\n`)
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (onLine) for (const byte of chunk) if (byte === 10) onLine()
      callback(null, chunk)
    },
  })
  await pipeline([child.stdout, counter, ...sinks])
  const code = await exited
  if (code !== 0) throw new Error(`mysql exited with ${code}: ${stderr.trim().slice(0, 2000)}`)
}

async function extractEntity(options: MysqlOptions, dir: string, entity: EntityFile): Promise<{ rows: number; ms: number }> {
  const started = performance.now()
  const path = ndjsonPath(dir, entity)
  let rows = 0
  let lastLog = started
  await runQuery(options, QUERIES[entity], [createGzip({ level: 6 }), createWriteStream(path)], () => {
    rows += 1
    if (rows % 200_000 === 0 && performance.now() - lastLog > 5000) {
      lastLog = performance.now()
      process.stdout.write(`  ${entity}: ${rows} rows...\n`)
    }
  })
  return { rows, ms: performance.now() - started }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const out = stringOption(args, 'out', 'BITRIX_NDJSON_DIR')
  if (!out) throw new Error('Pass --out <ndjson dir> (or BITRIX_NDJSON_DIR); real data must stay outside the repository')
  const dir = resolve(out)
  mkdirSync(dir, { recursive: true })
  const options: MysqlOptions = {
    bin: stringOption(args, 'mysql', 'BITRIX_MYSQL_BIN') ?? 'mysql',
    host: stringOption(args, 'host', 'BITRIX_MYSQL_HOST') ?? '127.0.0.1',
    port: stringOption(args, 'port', 'BITRIX_MYSQL_PORT') ?? '3307',
    user: stringOption(args, 'user', 'BITRIX_MYSQL_USER') ?? 'root',
    database: stringOption(args, 'database', 'BITRIX_MYSQL_DATABASE') ?? 'sitemanager',
  }
  const only = stringOption(args, 'only')?.split(',').map((value) => value.trim())
  const entities = ENTITY_FILES.filter((entity) => !only || only.includes(entity))
  const unknown = only?.filter((value) => !(ENTITY_FILES as readonly string[]).includes(value)) ?? []
  if (unknown.length) throw new Error(`Unknown entities: ${unknown.join(', ')}`)

  const started = performance.now()
  const manifest: { startedAt: string; finishedAt?: string; entities: Record<string, { rows: number; ms: number }>; sourceSummary?: unknown } = {
    startedAt: new Date().toISOString(),
    entities: {},
  }
  const summaryChunks: Buffer[] = []
  const summarySink = new Transform({ transform(chunk: Buffer, _encoding, callback) { summaryChunks.push(chunk); callback() } })
  summarySink.resume()
  await runQuery(options, SUMMARY_SQL, [summarySink])
  manifest.sourceSummary = JSON.parse(Buffer.concat(summaryChunks).toString('utf8').trim()) as unknown

  for (const entity of entities) {
    process.stdout.write(`extract ${entity}...\n`)
    const result = await extractEntity(options, dir, entity)
    manifest.entities[entity] = { rows: result.rows, ms: Math.round(result.ms) }
    process.stdout.write(`extract ${entity}: ${result.rows} rows in ${formatDuration(result.ms)}\n`)
  }
  manifest.finishedAt = new Date().toISOString()
  const manifestPath = join(dir, only ? `extract-manifest-partial.json` : 'extract-manifest.json')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  process.stdout.write(`extract done in ${formatDuration(performance.now() - started)}; manifest: ${manifestPath}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
