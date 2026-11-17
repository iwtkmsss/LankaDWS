# Bitrix24 → LankaDWS: одноразовий скрипт імпорту (тестовий перенос)

- **Дата:** 2026-11-17
- **Статус:** робочий дизайн тестового переносу великих даних. Замінює важкий план `bitrix24-database-migration-plan.md` для цього запуску (рішення 2026-11-10: одноразовий серверний скрипт, без control plane).
- **Рішення власника (2026-11-16):** переносимо всю історію; файли — пізніше окремим етапом; LankaDWS містить лише тестові дані, які можна стерти; компанії адмін розкладе потім (усе йде в одну компанію); групи Bitrix → групові чати; Bitrix лишається робочим, freeze і дельти не потрібні.

## Потік

```text
Bitrix (live, Percona 5.7)
  → plink + sudo mysqldump (allowlist таблиць, нічого на диск Bitrix) → bitrix-dump.sql.gz на ПК
  → локальний MySQL 8.4 (127.0.0.1:3307, БД sitemanager, хеші паролів стерті)
  → extract: SQL → NDJSON.gz (по сутностях)
  → load: NDJSON → свіжа SQLite LankaDWS (better-sqlite3, пакетні транзакції)
  → звіт: джерело / перенесено / пропущено (з причиною), час, розмір БД
```

Реальні дані живуть лише поза репозиторієм: `C:\mics\project\LankaDWS-migration-data\` (дамп, MySQL, NDJSON, цільова БД). У Git — лише код і цей документ.

NDJSON потрібен, щоб на сервері LankaDWS не ставити MySQL: на сервер копіюються NDJSON-файли і там запускається `load` (тоді `MessageThread.directKey` рахується з серверним `SESSION_PEPPER`).

## Ідентифікатори

Детерміновані, з префіксом сутності, напр. `usr_b24_123`, `tsk_b24_181536`, `thr_b24_77`, `msg_b24_9001`, `cmt_b24_5555`, `feed_b24_42`, `evt_b24_10`, `org_b24_15`, `prj_b24_7`. Повторний запуск на свіжій БД дає ті самі ID; мапінг-таблиця не потрібна.

`Task.number` = ID задачі в Bitrix (цифри, унікальний), тож номери задач для людей не змінюються. Після імпорту `TaskNumberSequence('global')` = max(номер).

## Час

Bitrix зберігає наївний час сервера (`MSK`, UTC+3 без переходів з 2014). Імпорт: `UTC = значення − 3 год`. Дані — з 2018 року.

## Мапінг

| Bitrix | LankaDWS | Правила |
|---|---|---|
| — | `Workspace` | існуючий (створений `admin:create`), рівно один |
| — | `Company` `cmp_b24` | одна компанія «Імпорт з Bitrix24»; адмін перейменує / розкладе пізніше |
| `b_user` (без `EXTERNAL_AUTH_ID`) | `User` | без паролів; `isActive = ACTIVE='Y'`; displayName = прізвище ім'я по батькові; `primaryCompanyId=cmp_b24`; accountType USER; username з `LOGIN` (lowercase, `^[a-z0-9._-]{3,32}$`, інакше транслітерація/`b24-<id>`, без дублікатів) + `UsernameReservation` |
| `b_user` з `EXTERNAL_AUTH_ID` (email/bot/replica/…) | `User` неактивний | лише якщо є автором перенесеного контенту |
| `b_iblock_section` (IBLOCK_ID=1) | `OrgUnit` | дерево за `IBLOCK_SECTION_ID`; `sourceKey='b24:dept:<id>'`; керівник з `b_uts_iblock_1_section.UF_HEAD` |
| `b_utm_user` (FIELD_ID=63) | `UserOrgAssignment` | користувач ↔ відділ; без вигаданого primary |
| `b_sonet_group` | `Project` (каталог задач) + групова розмова | `Task.projectId` для задач групи; учасники групи → учасники групового чату |
| `b_tasks` (ZOMBIE≠'Y') | `Task` | статус 1,2,6→NEW; 3→IN_PROGRESS; 4→IN_REVIEW; 5,7→DONE (`completedAt=CLOSED_DATE`); пріоритет 0/1/2→LOW/MEDIUM/HIGH; `TASK_CONTROL='Y'`→requiresAcceptance; `createdById=reporterId=CREATED_BY`; `DEADLINE`→dueAt; `START_DATE_PLAN`→startsAt; `PARENT_ID`→parentTaskId (якщо батько перенесений) |
| `b_tasks_member` | `TaskParticipant` | R→RESPONSIBLE, A→COLLABORATOR, U→WATCHER; один запис на людину (пріоритет R>A>U) |
| `b_tasks_checklist_items` | `TaskChecklistItem` | позиція за `SORT_INDEX` |
| `b_forum_message` за `b_tasks.FORUM_TOPIC_ID` | `Comment` (`TASK`, `PARTICIPANTS`) | лише `NEW_TOPIC='N'` і `PARAM1 IS NULL` (без службових повідомлень) |
| `b_blog_post` (PUBLISH_STATUS='P') | `FeedPost` + проєкція стрічки | адресати: `G2`/`UA`→COMPANY; `U<id>`→USER; `SG<id>`/`DR<id>` розгортаються в USER; важливі пости → підтвердження |
| `b_blog_comment` | `Comment` (`FEED_POST`, `FEED_AUDIENCE`) | |
| `b_im_chat` TYPE=P (без ENTITY_TYPE) | `MessageThread` DIRECT | 2 учасники з `b_im_relation`; `directKey` як у `messages.service` |
| `b_im_chat` TYPE=C (звичайні, SONET_GROUP, CALL) | `MessageThread` GROUP | автор чату OWNER, решта MEMBER; для SONET_GROUP учасники = relation ∪ учасники групи (A/E/K) |
| група без чату | `MessageThread` GROUP | порожній чат з назвою й учасниками групи |
| `b_im_message` (NOTIFY_TYPE=0, AUTHOR_ID>0) у перенесених чатах | `Message` | службові/системні не переносяться; повідомлення лише з файлом → текст-заглушка |
| `b_im_message_param` LIKE | `MessageReaction` LIKE | |
| `b_im_relation` | `ThreadParticipant` | `lastReadMessageId` з `LAST_ID`; без непрочитаних і сповіщень |
| `b_calendar_event` (user, власні, не видалені; company; group) | `Event` | особисті → PRIVATE; company → INTERNAL + `EventAudience` |

Не переносимо: TYPE S (системні сповіщення), O (відкриті лінії), CRM, P/PERSONAL (чат із собою), сповіщення про задачі в IM, копії подій у календарях учасників, переговорні (location), видалене, файли й аватари (окремий етап).

## Текст

Bitrix BBCode → мала Markdown-розмітка LankaDWS (`apps/web/src/shared/text/FormattedText.tsx`):
`[B]`→`**`, `[I]`→`*`, `[U]`→`[u]`, `[S]`→`~~`, `[URL=x]t[/URL]`→`[t](x)`, `[USER=id]Ім'я[/USER]`→згадка `[Ім'я](/?employeeId=usr_b24_id)`, `[QUOTE]`→`> `, `[LIST][*]`→`- `, `[CODE]`→код, `[DISK FILE ID=…]`/`[IMG]` → позначка файлу; HTML-сутності декодуються; невідомі теги прибираються, текст лишається. Тексти не обрізаються.

## Побічні ефекти

Скрипт пише прямо в БД: жодних сповіщень, outbox, realtime, лічильників непрочитаного. Стрічка — історична (`countsAsUnread=false`).

## Звіт

Для кожної сутності: у джерелі, перенесено, пропущено за причинами; час кожного етапу; розмір SQLite до/після.
