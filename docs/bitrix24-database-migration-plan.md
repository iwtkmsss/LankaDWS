# Backend-план переносу БД і файлів Bitrix24 у BERT CRM

- **Версія:** 1.1 — implementation-aligned data plan
- **Дата:** 2026-07-23
- **Статус:** робочий план для source snapshot, export, staging, import, delta, reconciliation і cutover; рішення уточнюються за evidence, security review та rehearsal results
- **Пов'язаний product/UI план:** [bitrix24-functionality-migration-plan.md](bitrix24-functionality-migration-plan.md)
- **Source:** `b24.bertcompany.org`, Bitrix on-prem `20.0.1198`

> Цей файл регулює backend/data migration, а пов'язаний plan — product scope, UI, routes і UX. Обидва є керованими правилами, не незмінною «правдою»: доречна зміна приймається, якщо вона безпечніша або спрощує роботу, має evidence/tests і зафіксована в decision log. Data safety/recovery не послаблюються лише заради UI-зручності.

## 0. Рішення

Просте копіювання MySQL-файлів у папку BERT CRM **не використовується** як migration method:

- live `*.ibd`/redo/undo copy може бути transaction-inconsistent;
- DB має ≈77,82 GiB, із яких ≈43,04 GiB — derived search/projection data, які треба rebuild-ити;
- DB не містить самі бінарні файли: `/upload` має ≈1,36 TiB;
- raw DB містить password hashes, auth/session/token та інші secrets;
- physical restore залежить від exact Percona/MySQL version/config;
- production data не можна класти в Git або звичайну developer-папку.

Цільовий потік:

```text
consistent Percona 5.7 backup + matching /upload snapshot
→ verified restore в ізольований Percona 5.7 staging
→ schema fingerprint + exact source inventory
→ allowlisted canonical export у deterministic chunks
→ normalization/quarantine/reconciliation
→ ordered idempotent BERT import
→ rebuild search/feed/counters
→ final delta під write freeze
→ signed reconciliation
```

Потрібні два різні артефакти:

1. **Safety/source snapshot** — повний encrypted physical DB backup + matching `/upload` snapshot для recovery і повторного extraction.
2. **Migration dataset** — очищений logical export лише канонічних даних, який читає BERT importer.

## 1. Межі й безпека аудиту

Read-only аудит виконано 2026-07-22–23 через UI/admin SQL console:

- дозволено: navigation, `information_schema`, `SHOW`, агреговані `SELECT`;
- не виконувалося: `INSERT`, `UPDATE`, `DELETE`, DDL, create/update settings, permission changes, messages, saved filters, upload або content mutation;
- у repo не копіювалися message bodies, filenames, user names/emails, auth/license secrets або бінарні файли;
- counts є point-in-time evidence, бо source лишався live.

Admin visibility не є доказом end-user ACL. До production export F0 обов'язково порівнює source і target visibility для ordinary employee, manager, group member/non-member та deactivated author.

## 2. Перевірений source fingerprint

| Параметр | Значення |
|---|---|
| Bitrix build | `20.0.1198` |
| Database | `sitemanager` |
| Server | Percona Server `5.7.26-29-log` |
| Tables | 795; усі InnoDB |
| Charset/collation | `utf8` / `utf8_unicode_ci` |
| DB time zone | `SYSTEM`; system zone `MSK` |
| Declared foreign keys | 0 |
| Estimated DB size | 61,23 GiB data + 16,60 GiB indexes = 77,82 GiB |
| Estimated rows | ≈324,3M |

`information_schema.TABLE_ROWS` для InnoDB є оцінкою. Воно використовується для capacity planning, але ніколи як final `sourceTotal`.

### 2.1. Storage distribution

| Клас | Estimated rows | Storage | Рішення |
|---|---:|---:|---|
| Search/derived projections | 253,5M | 43,04 GiB | exclude/rebuild |
| Chat/IM | 48,3M | 19,86 GiB | chunked classification/import |
| Files/Disk metadata | 6,63M | 11,31 GiB | metadata + separate binary snapshot |
| Feed | 3,68M | 1,16 GiB | canonical source + dedupe projections |
| Forum/Blog | 1,98M | 1,12 GiB | canonical comments/posts |
| Tasks | 4,09M | 0,52 GiB | canonical task graph/history |
| Identity/preferences | — | ≈0,03 GiB | filtered import |
| Calendar/custom/org | — | <0,02 GiB | filtered import/archive |

Найбільші physical tables:

| Table | Data | Index | Рішення |
|---|---:|---:|---|
| `b_search_content_stem` | ≈13 045 MiB | ≈8 074 MiB | exclude |
| `b_im_message` | ≈12 917 MiB | ≈2 928 MiB | classify/chunk |
| `b_disk_object` | ≈10 286 MiB | ≈373 MiB | canonical metadata |
| `b_search_content` | ≈9 699 MiB | ≈157 MiB | exclude |
| `b_search_content_text` | ≈9 435 MiB | — | exclude |
| `b_im_message_param` | ≈1 789 MiB | ≈2 668 MiB | param inventory/chunk |
| `b_forum_message` | ≈563 MiB | ≈373 MiB | canonical task comments |
| `b_sonet_log_comment` | ≈534 MiB | ≈144 MiB | projection/dedupe |
| `b_tasks_search_index` | ≈470 MiB | ≈62 MiB | exclude/rebuild |
| `b_sonet_log_index` | ≈407 MiB | ≈116 MiB | exclude/rebuild |

### 2.2. Entity baseline

Counts нижче можуть відрізнятися на sealed snapshot через live writes.

| Entity | Point-in-time evidence |
|---|---:|
| Raw users | 1 048 |
| Active normal / inactive normal users | 514 / 512 |
| Departments | 171 active, 1 root, max depth 6 |
| User→department assignments | 1 028; 0 orphan; 515 для active users |
| Departments with head | 99; 0 orphan head references |
| Base tasks | ≈152,8k |
| Task member rows | ≈902,7k |
| Task log rows | ≈1,59M |
| Canonical task comments | 1 100 222 forum messages / 122 881 topics |
| Blog posts/comments | 5 742 / 7 357 |
| Chats/relations | 28 343 / 57 827 |
| IM messages/params/recent | 11 510 977 / 36 781 210 / 35 004 |
| Groups/projects | 54 active |
| `b_file` rows | ≈1 121 815 |
| `b_file.FILE_SIZE` total | ≈1,363 TiB |
| Disk objects | 1 128 552 |
| Active disk files/folders | 1 108 330 / 18 355 |
| Active disk-file bytes | ≈1,353 TiB |
| Disk versions/version bytes | 1 110 436 / ≈1,360 TiB |
| Attached disk objects | 490 264 |
| Calendar rows | ≈6,4k |
| Absence records | 204; last activity July 2023 |

### 2.3. Перевірені distributions

#### Tasks

Source status codes не перейменовуються «по пам'яті»: extractor pin-ить constants цього build. Point-in-time distribution:

| `STATUS` | Tasks | Subtasks (`PARENT_ID>0`) | `ZOMBIE=Y` |
|---:|---:|---:|---:|
| 2 | 9 466 | 2 034 | 2 905 |
| 3 | 260 | 63 | 62 |
| 4 | 1 038 | 244 | 459 |
| 5 | 142 014 | 40 650 | 752 |
| 6 | 24 | 7 | 8 |

Task source activity spans December 2018 through the audit date. `b_tasks_log` є history; `b_tasks_search_index`, sorting/effective/counters — projections.

#### Chat types

| `TYPE` / `ENTITY_TYPE` | Chats |
|---|---:|
| `P` / empty | 26 310 |
| `S` / empty | 959 |
| `C` / empty | 686 |
| `P` / `PERSONAL` | 327 |
| `C` / `SONET_GROUP` | 51 |
| `C` / `CALL` | 7 |
| `O` / empty | 2 |
| `C` / `CRM` | 1 |

Type codes зберігаються raw у staging; target kind визначається tested mapping. CRM/CALL rows не розширюють product scope автоматично.

#### Feed/activity

`b_sonet_log` є projection з різними canonical джерелами:

| Event | Rows | Migration treatment |
|---|---:|---|
| `tasks` | 150 534 | do not import as feed source |
| `report` | 6 871 | legacy/dormant; exclude unless product decision |
| `timeman_entry` | 6 089 | excluded scope |
| `blog_post` | 5 573 | validate/link canonical Blog post |
| `calendar` | 639 | do not duplicate calendar |
| `blog_post_important` | 133 | validate important-post mapping |

`b_sonet_log_comment` має 976 716 `tasks_comment`, 7 357 `blog_comment`, 352 `calendar_comment` та малі historical categories. Це validation/projection source, не independent comments.

Rights evidence:

- overall ≈902 946 explicit user-right rows across 164 588 logs;
- additional other codes ≈7 104, social-group ≈2 185, all-employee `G2` ≈1 517, recursive department ≈113;
- important logs: 1 361 rights rows, з них 1 186 explicit user pairs, 13 `G2`, 4 social-group і 13 recursive department codes.

Expansion виконується зі snapshot membership/org state і зберігає raw code, expanded recipient IDs та mapping version.

#### Groups

| Visibility/open/project class | Groups |
|---|---:|
| hidden/private non-project | 27 |
| hidden/private project | 19 |
| visible/open project | 3 |
| visible/open non-project | 3 |
| visible/not-open | 2 |

Observed membership code combinations: `K/G/N` 299, `K/G/Y` 283, `A/U/N` 54, `E/G/N` 36, `K/U/N` 32, `Z/G/N` 9. Semantics і auto-member/pending rules фіксуються fixtures до mapping; один observed owner row на group не є дозволом вигадувати owner для orphan.

#### Calendar

| Source class | Rows |
|---|---:|
| active user meetings | 2 933 |
| active user non-meetings | 2 028 |
| deleted user events | 358 |
| deleted user meetings | 246 |
| active locations | 420 |
| deleted locations | 440 |
| active company events | 6 |
| active company meeting | 1 |
| group meetings | 3 |

Calendar writes останніх перевірених personal rows доходять до January 2026; це підтримує read-first, але не автоматично full write/RSVP scope.

#### Files/Disk

- active disk file: `TYPE=3`, `DELETED_TYPE=0`;
- active folder: `TYPE=2`, `DELETED_TYPE=0`;
- observed deleted files: 1 616 із `DELETED_TYPE=3`, 233 із `DELETED_TYPE=4`;
- всі `b_file.HANDLER_ID` empty/local; external storage rows не знайдені;
- file metadata змінювалися до audit date, тому final file delta обов'язковий.

#### Absence iblock

Iblock ID 3 має properties `USER`, `FINISH_STATE`, `STATE`, `ABSENCE_TYPE`. Records охоплюють 2019-04 — 2023-07; last source change — 2023-07-10. Це evidence для archive-only default, не для створення нового approval workflow.

### 2.4. Relation and index evidence

- Source не має DB foreign keys; relation integrity рахується окремими exact reports.
- `b_tasks.FORUM_TOPIC_ID → b_forum_message.TOPIC_ID` — canonical task-comment edge.
- `b_tasks_member.TASK_ID/USER_ID`, parent task, checklist tree і dependency edges перевіряються before apply.
- `b_im_message` має indexes для chat/date, chat/id і notify-type/date; message export усе одно йде ascending primary-key chunks.
- `b_im_message_param` indexed by message/name та name/value/message; param inventory виконується offline.
- `b_im_relation` indexes підтримують user/type/status, chat/user і status/counter; target read/mute reconcile робиться per user/thread.
- Disk object/version/attachment links перевіряються окремо від physical file existence.
- Exact index DDL і column definitions зберігаються в `source-schema/` та входять у `sourceSchemaFingerprint`.

## 3. Канонічні джерела

Одна business entity має рівно одне authoritative джерело. Projection/cache rows не створюють дублікати.

| Business entity | Canonical source | Relation/auxiliary source | Не імпортувати як другу entity |
|---|---|---|---|
| User | `b_user` без credential fields | user-field tables | sessions/auth/token tables |
| Department | departments iblock ID 1 | `b_utm_user` field 63; section UTS field 125 | workgroup як department |
| Saved view | allowlisted `b_user_option` | UI schema fixtures | raw serialized blob у target |
| Group/project | `b_sonet_group` | `b_sonet_user2group`, `b_sonet_features*` | log/search projection |
| Task | `b_tasks` | member/checklist/tree/dependency/log/options | `b_sonet_log(EVENT_ID='tasks')`, search/counter/sort |
| Task comment | `b_forum_message` by `b_tasks.FORUM_TOPIC_ID` | topic/reply/file metadata | `b_sonet_log_comment(tasks_comment)` |
| Feed post/comment | `b_blog_post` / `b_blog_comment` | selected rights/reactions/favorites | matching `b_sonet_log*` content copy |
| Feed audience | `b_sonet_log_right` for matching canonical event | expansion of explicit user/group/org codes | admin visibility |
| Important acknowledgement | `b_blog_post_param(NAME='BLOG_POST_IMPRTNT')` | required-recipient snapshot | read cursor/like/comment |
| Chat | classified `b_im_message` + `b_im_chat` | `b_im_message_param` | task/system notification rows |
| Chat membership/read/mute | `b_im_relation` | `b_im_recent` for recent/pin UX | inferred membership from authors |
| File | `b_file` + physical `/upload` object | Disk object/version/attachment/storage/access | preview/cache/path projection |
| Disk tree/version/link | `b_disk_object`, `b_disk_version`, `b_disk_attached_object` | storage/access tables | `b_disk_object_path` |
| Calendar | `b_calendar_event` | type/settings fields | Social Network activity row |
| Absence archive | iblock ID 3 + properties | user/org mapping | new operational workflow |

### 3.1. Hard exclusions/rebuild

- `b_search_%`;
- `b_tasks_search_index`, `b_tasks_effective`, `b_tasks_sorting`, task counters;
- `b_sonet_log_index`;
- `b_disk_object_path`;
- cache, session, temporary, search and generated projection tables;
- password/session/OTP/token/webhook/mail/SMS/license secrets;
- `b_im_message` system/task notifications as user chats;
- dormant CRM/leads/deals/catalog/process data unless a later approved data decision adds it.

Кожне exclusion має versioned rule ID і counts у reconciliation; воно не є silent loss.

## 4. Domain-specific mapping rules

### 4.1. Users and organization

- `b_user` credential columns `PASSWORD`, `CHECKWORD`, `STORED_HASH`, `CONFIRM_CODE` та session/auth records не експортуються.
- Inactive author імпортується як deactivated identity stub без login credentials і active roles, щоб history мала автора.
- Department iblock: ID 1, code `departments`.
- User department field: `b_user_field.ID=63`, `UF_DEPARTMENT`, multiple; values у `b_utm_user`.
- Department head field: `b_user_field.ID=125`, `IBLOCK_1_SECTION/UF_HEAD`; values у `b_uts_iblock_1_section`.
- User може мати кілька assignments; primary assignment не вигадується без source/approved rule.
- `sourceTenantId` не дорівнює одному BERT `companyId`. Versioned `SourceCompanyMapping` має бути signed до entity import.

Company resolution precedence:

1. authoritative source company marker;
2. owning mapped group/project;
3. approved unambiguous org-unit mapping;
4. інакше `COMPANY_AMBIGUOUS` quarantine/blocker.

Author department, first participant, current admin company або file path не є fallback.

### 4.2. Tasks and comments

`b_tasks_member.TYPE`:

| Source | Meaning | Target |
|---|---|---|
| `R` | responsible | Task responsible |
| `O` | originator/creator | Task creator |
| `A` | accomplice | co-executor |
| `U` | auditor | observer |

Observed role counts: `R` 148 615, `O` 148 615, `A` 125 796, `U` 479 684. Follower є окремою notification subscription і не виводиться з `U`.

Task import:

- base task first;
- second pass: `PARENT_ID`, checklist tree, dependencies, recurrence/options;
- unknown status/member type, parent cycle, missing required actor або cross-company relation — quarantine/blocker;
- source `ZOMBIE`/delete/status constants pin-яться fixtures, не вгадуються;
- BERT task number генерується новий; `ExternalIdMap` зберігає legacy ID/link;
- comments беруться лише з `b_forum_message.TOPIC_ID = b_tasks.FORUM_TOPIC_ID`;
- 976 716 `b_sonet_log_comment(tasks_comment)` rows є projection і не імпортуються повторно.

Target implementation checkpoint 2026-07-24:

- `Task.assigneeId` and `Task.creatorId` remain the single canonical responsible and creator; source member types `A` and `U` map only to active `TaskParticipant(CO_EXECUTOR|OBSERVER)` rows;
- the fourteenth ordered migration enforces same-workspace/company scope, active company access, optional group membership, partial active uniqueness and immutable participant identity even when an application path is bypassed;
- removal is a one-way soft lifecycle, preserving import/audit evidence while immediately revoking direct task, search and current Feed-projection access;
- the fifteenth ordered migration adds separate `TaskFollower`, `TaskUserState` and `TaskReminder` rows with active-user/workspace/company/group guards, immutable identities, partial active-reminder uniqueness and one-way `ACTIVE → SENT|CANCELLED` transitions;
- follower is notification intent only and is never inferred from observer membership; favourite/important state is private to its user, while reminder jobs re-authorize the canonical task again before delivery;
- reassignment or participant removal mutes/cancels personal workflows when that change actually revokes the user's last direct access path;
- the sixteenth ordered migration guards `TASK`/`TASK_COMMENT` file links, one-level replies and allowlisted task source links against cross-workspace/company/group drift, alternate writers and relation mutation; task materials are capped at 20 and comment attachments at 5;
- task access requires a canonical direct role even inside a work group, while a source link additionally requires current authorization for its Message, Lifecycle or Document target; a removed task link revokes task-derived file access without deleting the owner’s canonical `FileObject`;
- this is target schema/ACL readiness only: the approved extractor/import runner still has to materialize and reconcile the measured legacy `A`/`U` rows and any explicitly proven legacy personal intent, so source-role migration is not yet declared complete.

### 4.3. Feed and acknowledgements

- Canonical post/comment: Blog tables.
- `b_sonet_log` є mixed activity projection: tasks, reports, timeman, blog, calendar, historical CRM events.
- Selected task/calendar/file activity у target будується з canonical aggregates, не копіюється вдруге.
- Important receipt evidence: 4 623 `userId+postId` pairs across 140 posts у `b_blog_post_param`.
- Important activity log має 133 matching rows; discrepancy 140↔133 мусить мати report і approved rule.
- `b_sonet_log_right` містить explicit user, all-employee `G2`, social-group і recursive department codes. Extractor зберігає raw right code + cutover expansion result.
- Canonical Feed filter mapping не вгадує legacy rights: `groupId` записується лише для доведеного social-group context, а `audienceId` — для exact mapped company/user recipient. Нерозв’язаний або виключений right code потрапляє в compatibility report і не створює приблизну facet option.
- Legacy per-user favorites materialize into `FeedUserItemState` only after the canonical `FeedItem` mapping and current ACL closure are proven. A missing, excluded or inaccessible source item becomes a compatibility-report entry; a favorite never grants or restores content visibility.
- Historical required-recipient denominator не вигадується. Якщо точний audience неможливо відновити, outcome: legacy status unknown, explicit re-ack campaign або archive-only.

### 4.4. Chats

Core relation:

- `b_im_chat` — thread/type/entity/count/last-message;
- `b_im_relation` — participant, join/start boundary, last-read/send/file, status, `NOTIFY_BLOCK`, unread counter;
- `b_im_message` — body, author, chat, date, notify module/event/import ID;
- `b_im_message_param` — attachments/reply/reactions/other params;
- `b_im_recent` — user recent/pin/unread UX.

Observed `b_im_message` classes:

| Class | Rows | Rule |
|---|---:|---|
| `NOTIFY_TYPE=2`, `tasks/comment` | 6 199 489 | exclude as chat |
| `NOTIFY_TYPE=2`, `tasks/manage` | 2 815 654 | exclude as chat |
| `NOTIFY_TYPE=0`, `im/private` | 1 881 160 | chat candidate |
| `NOTIFY_TYPE=0`, `im/group` | 114 432 | chat candidate |
| likes/rating/mentions/other notifications | сотні тисяч | exclude/rebuild selectively |

Отже 11,51M message rows не дорівнюють 11,51M людських повідомлень. До export із offline clone виконується повна distribution за `NOTIFY_TYPE, NOTIFY_MODULE, NOTIFY_EVENT, CHAT_ID, AUTHOR_ID`, а також inventory `PARAM_NAME`.

Chat record імпортується лише коли:

1. class allowlisted як human/group/system-chat message;
2. thread valid і mapped;
3. participant/visibility rule valid;
4. author є mapped user або approved system identity;
5. param dependencies доступні або мають explicit unavailable marker.

`NOTIFY_TYPE IN (2,4)` не створює historical thread/message/unread/notification. Task/feed/calendar history походить з canonical source. `b_im_relation` є authority для participants/read/mute; membership не виводиться з message authors.

Target implementation checkpoint 2026-07-24: the seventeenth ordered migration adds `MessageThread.directKey`, creator provenance, participant notification mode/version and the indexes needed by company-scoped thread access. Existing `CONTEXT`/`PARTICIPANT` values are normalized to `CONTEXTUAL`/`MEMBER`. SQLite triggers enforce active same-scope participants, direct cardinality, group minimum membership, active-participant authorship, one reply level, immutable thread/message identity and monotonic read cursors even when an application path is bypassed.

The eighteenth ordered migration completes the guarded collaboration boundary for target-native Chat. Direct and company membership is server-managed and immutable; group/contextual ownership cannot lose its final active owner; a group cannot fall below two active participants. Participant role/removal and message edit/delete use optimistic versions. A deleted message cannot be resurrected, and a `MESSAGE` attachment link must remain same-scope, immutable and within the five-file limit. `CONTEXTUAL` threads may intentionally retain one owner, so an entity-bound working room is not forced into an artificial group cardinality.

The application derives canonical direct keys with HMAC over company plus sorted participant IDs, uses body-bound idempotency for thread/message/participant creation and treats mute/read state as personal state rather than access. Message attachments reuse the canonical quarantine/scanner pipeline; participant download access is re-authorized against the live thread and disappears after participant removal or message deletion, while canonical file ownership remains intact. This checkpoint proves target schema/API/UI readiness only: it does not claim that the measured legacy chat history, relations, params, file mappings or read/mute boundaries have been extracted or reconciled. The approved importer must still classify notification rows, materialize the signed dependency-closed set and pass the Chat reconciliation gates below.

The nineteenth ordered migration adds the target-native message conversion boundary. An `EVENT` link is accepted only for one non-deleted `MESSAGE` in the same workspace/company, when `createdBy` is both the event owner and an active thread participant with active company access. Only `RELATED` EVENT↔MESSAGE links are allowed and their identity is immutable. The application separately enforces `calendar.manage`, company `CALENDAR_WRITE`, IANA timezone validation and body-bound idempotency, then creates Event, link, audit and outbox in one transaction. Task conversion likewise derives company scope from the thread instead of trusting a client-supplied company. This proves target write safety only and does not alter the historical Calendar/Chat extraction or reconciliation requirements.

### 4.5. Files and Disk

Усі перевірені `b_file` objects використовують local upload storage; external handler count = 0. Тому DB snapshot без `/upload` неповний.

Physical relative path формується тільки за перевіреним Bitrix storage rule з normalized `SUBDIR + FILE_NAME`. Заборонені absolute paths, `..`, drive prefixes, NUL і path escape.

Symlink/reparse-point або hardlink, що виходить за immutable snapshot root, не читається: він отримує `FILE_PATH_ESCAPE` blocking issue. Snapshot inventory фіксує link type й resolved path лише у protected report.

Для кожного file manifest зберігає:

- `sourceFileId`;
- normalized relative path;
- snapshot root ID;
- DB size і actual size;
- mtime;
- SHA-256 фактичного binary;
- content/MIME probe result;
- Disk object/version/attachment references;
- deleted/missing/changed-after-copy state;
- source ACL/storage context;
- manifest chunk/hash.

Pipeline:

```text
immutable encrypted source snapshot
→ path validation
→ size + SHA-256
→ quarantine object
→ MIME magic-byte detection
→ malware/zip-bomb/encrypted-archive policy
→ owner/group/ACL reconciliation
→ FileObject/DocumentVersion
→ promote only when CLEAN
```

Version, object і attachment counts/bytes reconcile-яться окремо. Missing binary не замінюється empty file: dependent record блокується або отримує approved unavailable marker.

### 4.6. Calendar and Absences

- `b_calendar_event` у цьому build зберігає recurrence/attendees/relations serialized inline; table `b_calendar_event_connection` відсутня.
- Serialized data читається non-executable parser з limits; PHP object instantiation/hooks заборонені.
- Source system zone `MSK`; target зберігає normalized UTC + original raw value/zone.
- Absences: 204 active records, остання зміна/interval у липні 2023. Default — archive export, не operational module.

### 4.7. Saved views

Observed usage:

| Option | Users |
|---|---:|
| Task advanced filter | 828 |
| Task grid | 744 |
| Live Feed filter | 454 |
| IM settings | 625 |
| Employee-list filter | 301 |
| Group-list filter | 63 |

Raw `b_user_option` не пишеться у target. Parser:

- не викликає PHP `unserialize()` з class instantiation;
- має limits на bytes/depth/items;
- приймає лише allowlisted scalar/array structure;
- map-ить лише exact field/operator/value;
- unknown/stale fields потрапляють у compatibility report;
- зберігає owner/default flag тільки коли semantics доведені.

## 5. Source snapshot

### 5.1. DB backup

Source — Percona 5.7, тому для physical backup використовується сумісний **Percona XtraBackup 2.4**, не XtraBackup 8.0. Див. [Percona version compatibility](https://docs.percona.com/percona-xtrabackup/8.0/about-xtrabackup.html).

Template; exact paths/parallelism/encryption wrapper фіксуються після rehearsal. Credentials містяться у protected option file, не command line/history:

```bash
xtrabackup \
  --defaults-extra-file="<protected>/source-backup.cnf" \
  --backup \
  --parallel=4 \
  --target-dir="<secure-snapshot-root>/<snapshotId>/db"

xtrabackup \
  --prepare \
  --target-dir="<secure-snapshot-root>/<snapshotId>/db"
```

Success evidence:

- exit code 0;
- backup metadata and binlog coordinates captured;
- `prepare` завершився без corruption;
- encrypted archive/object hashes verified;
- restore у disposable isolated Percona 5.7 успішний;
- table/schema fingerprint і exact counts readable;
- recovery time/throughput recorded.

Raw datadir copy дозволений лише як частина documented storage-level physical snapshot with DB-consistency proof; звичайне копіювання live files заборонене. Див. [MySQL 5.7 backup methods](https://dev.mysql.com/doc/refman/5.7/en/backup-methods.html).

### 5.2. `/upload` snapshot

Preferred: storage/filesystem snapshot із immutable snapshot ID. Якщо його немає:

1. bulk copy під час source writes;
2. generated preliminary manifest;
3. formal Bitrix write freeze;
4. final sync без необґрунтованого `--delete`;
5. final manifest/hash comparison;
6. DB final delta/watermark у тому самому freeze window.

Illustrative Linux template:

```bash
rsync -aH --numeric-ids --itemize-changes \
  "<bitrix-document-root>/upload/" \
  "<secure-snapshot-root>/<snapshotId>/upload/"
```

Exact source/destination absolute paths перевіряються read-only перед execution. Source root, start/end UTC, snapshot ID, count/bytes, failures і manifest SHA-256 входять у `snapshot-manifest.json`.

### 5.3. Restore staging

- isolated network segment; no public web;
- exact Percona 5.7-compatible image;
- no outgoing mail/SMS/webhooks;
- application credentials/tokens unavailable;
- read-only extraction account after restore;
- production host never used for heavy distribution joins/hash scans;
- staging is destroyed after DDB-006 retention/evidence requirements.

## 6. Migration dataset

### 6.1. Storage location

Production raw snapshot: encrypted Operations storage, never Git/dev machine.

Developer-safe normalized test dataset, якщо потрібен:

`C:\mics\project\BertCRM-migration-data\<snapshotId>`

Це sibling до repo, не `BertCRM`. Future importer отримує read-only root через `BITRIX_SNAPSHOT_ROOT`. Real user content не копіюється локально без DDB-006 authorization; fixtures мають synthetic/redacted bodies.

### 6.2. Layout

```text
<snapshotId>/
  snapshot-manifest.json
  source-schema/
    ddl.sql
    columns.ndjson
    indexes.ndjson
  canonical/
    identities/*.ndjson.zst
    org/*.ndjson.zst
    groups/*.ndjson.zst
    tasks/*.ndjson.zst
    task-comments/*.ndjson.zst
    feed/*.ndjson.zst
    chats/*.ndjson.zst
    calendar/*.ndjson.zst
    absence-archive/*.ndjson.zst
    file-metadata/*.ndjson.zst
  files/
    manifest.ndjson.zst
    tombstones.ndjson.zst
  reports/
    source-counts.json
    exclusions.json
    relations.json
    acl-probes.json
    compatibility.json
    company-mapping.json
  checksums.sha256
```

`snapshot-manifest.json`:

- `datasetId`, `snapshotId`, `sourceSystem`, `sourceTenantId`;
- Bitrix/Percona versions and source fingerprint;
- `sourceSchemaFingerprint`;
- charset/collation/system timezone;
- capture start/end UTC;
- binlog file/position or explicit unavailable reason;
- DB and upload snapshot IDs;
- table/entity allowlist + exclusion-rule version;
- company-mapping/mapping/schema/exporter versions;
- every child manifest SHA-256;
- signer and key ID, never secret key.

#### 6.2.1. BertCRM signed manifest contract v1

Станом на 2026-07-23 preflight contract реалізований у `packages/contracts/src/import.ts`, а filesystem validator — у `apps/api/src/modules/import-control/manifest-validator.ts`.

- Envelope strict: `{ payload, signing }`; unknown fields, duplicate child paths і unsafe aggregate byte count блокують dataset.
- Поточний v1 pin-ить підтверджене source-середовище: Bitrix `20.0.1198`, Percona `5.7.26-29-log`, `utf8`, `utf8_unicode_ci`, `MSK`. Інший source потребує нового compatibility decision/contract version, а не silent acceptance.
- Child paths — лише lowercase forward-slash relative ASCII paths під `source-schema/`, `canonical/`, `files/`, `reports/` або exact `checksums.sha256`; absolute, drive, backslash, empty, `.`/`..`, trailing-dot і Windows device-name segments блокуються до filesystem access.
- Обов'язкові schema/reconciliation reports, `reports/company-mapping.json`, `files/manifest.ndjson.zst`, `files/tombstones.ndjson.zst` і `checksums.sha256`. Canonical chunks лишаються entity-dependent, але кожен фактичний chunk обов'язково декларується.
- `checksums.sha256` має GNU-compatible форму `<64 hex><two spaces><relative path>`, охоплює кожен child, крім самого `checksums.sha256`, і не може містити duplicate/extra paths.
- Підпис — Ed25519. Signed bytes = deterministic BertCRM canonical JSON v1 з lexicographically sorted object keys для `{ payload, signing: { signerId, keyId, algorithm } }`; `signedPayloadSha256` хешує саме ці bytes, після чого `signature` підписує ті самі bytes. Поля hash/signature навмисно не входять у signed bytes, щоб не створювати cycle.
- Trusted public keys задаються Operations як JSON object `keyId → PEM/public-key text` у `IMPORT_SIGNING_PUBLIC_KEYS_JSON`; для sealing конфігурація містить лише absolute private-key path, але не key bytes.
- Validator inventory-ить bounded filesystem tree, відхиляє undeclared/unsafe entries, realpath-ить root/children і блокує escape, non-regular/hard-linked file, mutation during read, size/hash mismatch, invalid signature/key та malformed/invalid UTF-8 manifest/checksum index. Raw child content він не парсить і не виводить.

Exporter-side sealing використовує [strict request v1 example](examples/bitrix-snapshot-seal-request.example.json), скопійований у захищене Operations-сховище. Request містить payload metadata без `files`/hashes/signature та non-secret `signerId/keyId`; Ed25519 private key є окремим bounded regular file. Dataset, request і key — три distinct absolute paths поза repository, а request/key також поза dataset root.

```bash
npm run bert -- import:seal-manifest
npm run bert -- import:seal-manifest --json
```

`BITRIX_SNAPSHOT_ROOT`, `BITRIX_MANIFEST_METADATA_PATH` та `IMPORT_SIGNING_PRIVATE_KEY_PATH` задають exact paths. Команда bounded-inventory-ить allowlisted export, відхиляє symlink/hardlink/unsafe/extra entry, хешує stable bytes, генерує lexicographically sorted GNU-compatible `checksums.sha256`, canonical Ed25519 envelope і одразу запускає existing verifier з public key, derived in-memory. Вона створює тільки відсутні `checksums.sha256`/`snapshot-manifest.json`: identical rerun не пише й повертає той самий hash; mismatch ніколи не overwrite-иться; outputs поточної спроби видаляються, якщо verifier round-trip не пройшов. Private-key bytes, absolute paths і raw content у report не потрапляють.

Verifier commands:

```bash
npm run bert -- import:validate-manifest
npm run bert -- import:validate-manifest --json
```

Після sealing `BITRIX_SNAPSHOT_ROOT` монтується read-only. Validator не bootstraps NestJS/Prisma, не пише у target DB і повертає лише safe dataset IDs, relative paths, counters, hashes та stable issue codes. Exit `0` = valid/sealed, `2` = validation або seal-input failure, `1` = config/runtime failure. Generator закриває ручне складання envelope, але не є canonical source extractor і не замінює real company inventory/approval, DDB-004–DDB-009 evidence або rehearsal.

#### 6.2.2. Company mapping artifact v1

`reports/company-mapping.json` є обов'язковим child signed manifest. Окремий другий cryptographic signature не дублюється: Ed25519 manifest підписує exact SHA-256 цього файла, тому artifact transitively signed тим самим trusted key.

Artifact містить лише migration metadata:

- `decisionId=D-024`, source system/tenant/build, explicit `targetWorkspaceId`, `companyMappingVersion`, policy version і UTC generation time;
- SHA-256 source inventory evidence;
- fixed precedence `authoritative marker → owning mapped group → approved org unit → block ambiguous`;
- `fallbackPolicy=AUTHORITATIVE_ONLY`; author department, participant, admin company, filename/path не можуть стати fallback;
- opaque `sourceOrgUnitKey`, source-root fingerprint, branch kind, descendant flag і explicit `MAP|QUARANTINE`;
- для `MAP` — stable BERT `targetCompanyId` + code; один ID не може мати різні codes і навпаки;
- current cross-company policy `BLOCK_AND_QUARANTINE` та detected count;
- рівно три non-secret approval evidence refs: Product, Security, Data.

Preflight блокує missing/malformed/duplicate-key artifact, source/version mismatch, incomplete approvals, quarantined roots і будь-який unresolved cross-company entity. Human/JSON report повертає тільки counts: roots, mapped/quarantined, target-company count, approvals і cross-company count — без source keys, branch names або approver identity.

Це визначає формат evidence, але **не закриває DDB-007/D-024**. Вони закриваються лише real source inventory, затвердженим mapping artifact і policy для фактичних cross-company entities.

#### 6.2.3. Read-only company mapping DB preflight

Після filesystem-only manifest check оператор виконує:

```bash
npm run bert -- import:validate-company-map
npm run bert -- import:validate-company-map --json
```

Команда спершу повторює повну перевірку signed dataset. Лише після її успіху вона відкриває окреме Prisma/SQLite з'єднання з `readonly + fileMustExist` і читає `SourceCompanyMapping` за exact signed scope: `targetWorkspaceId + sourceSystem + sourceTenantId + companyMappingVersion + ACTIVE`. NestJS, workers та application services для цього не запускаються. Preflight блокує:

- missing, retargeted, unexpected або duplicate active rows відносно exact signed root set;
- inactive target company;
- target company з іншим workspace, ID або code;
- DB lookup failure чи перевищення bounded 10 000-row contract.

Звіт повертає тільки workspace/version, manifest hash, signed/active/matched/target-company counters і stable issue codes. Source-root keys, branch names, company names/codes та raw DB errors не виводяться. Команда нічого не записує, не seal-ить dataset, не створює run і не відкриває `APPLY`; exit codes такі самі: `0` valid, `2` validation failed, `1` configuration/runtime error.

### 6.3. Logical export

Canonical export робиться з restored clone. MyDumper можна використати для parallel table extraction/checksums; `mysqldump --single-transaction --quick` — fallback для InnoDB. Див. [MyDumper usage](https://mydumper.github.io/mydumper/docs/html/usage.html), [MyDumper locks](https://mydumper.github.io/mydumper/docs/html/locks.html), [MySQL 5.7 mysqldump](https://dev.mysql.com/doc/refman/5.7/en/mysqldump.html).

Admin SQL page не є production exporter.

Large tables:

- stable primary-key ranges only; no `OFFSET`;
- initial maximum 250 000 rows and 256 MiB uncompressed per chunk; first reached limit closes chunk;
- boundary persisted before final write;
- output canonical UTF-8 NDJSON compressed with Zstandard;
- invalid source bytes quarantine-яться, не замінюються silently.

Кожен chunk:

```text
entity/table
minPk/maxPk
rowCount
min/max source timestamp
uncompressed/compressed bytes
sha256
sourceSchemaFingerprint
mappingVersion
exporterVersion
```

Повторний export sealed range з однаковими rules має дати той самий normalized SHA-256.

### 6.4. Encoding/time

- Source connection encoding pin-иться до verified `utf8`; `utf8` не трактується як `utf8mb4`.
- Test corpus: Ukrainian, HTML/BBCode, combining characters, quotes/slashes, null bytes, legacy emoji encoding.
- Raw field hash зберігається до normalization.
- Source system zone — `MSK`; business/user zone може відрізнятися.
- Target time: UTC + original source value/zone.
- Naive timestamp не конвертується в Europe/Kyiv без per-table mapping fixture.

### 6.5. Hot/archive policy and dependency closure

Product decisions D-010/D-020 приймаються окремо для Tasks, Feed, Chat, Calendar і Files. Допустимі outcomes:

1. full operational import після DDB-004 capacity proof;
2. bounded hot operational history + BERT-hosted immutable authorized archive;
3. bounded hot history + time-limited read-only Bitrix, після чого sealed archive import/export.

Archive не є public dump: він використовує ту саму identity/company/group/thread/file ACL, encrypted storage/index, audit, retention/legal hold і stable legacy ID resolver. Якщо archive search не може перевірити ACL до snippet, body не індексується.

History window завжди має dependency closure:

- active/open task переноситься разом із parent/subtasks, participants, canonical comments, required files і links незалежно від віку;
- imported reply має imported target або explicit deleted/archive stub;
- chat thread зберігає participants, lifecycle, read boundary, last-message metadata і references навіть якщо старі bodies archive-only;
- file, потрібний included task/post/comment/message/event, не виключається лише через дату;
- excluded hot body має authorized archive lookup або explicit unavailable marker;
- source/hot/archive/excluded/quarantine totals reconcile-яться окремо.

## 7. Import pipeline

### 7.1. Ordered apply

1. `ImportDataset`, `ImportRun`, manifest/signature/schema preflight.
2. `SourceCompanyMapping`.
3. Users без credentials; deactivated/system identity stubs.
4. Org units, parent tree, assignments, department heads.
5. Groups/projects, privacy/features, owners/members.
6. File metadata and resumable quarantine transfers.
7. Base tasks.
8. Task roles; second-pass parent/checklist/dependencies/options.
9. Task comments/replies/files.
10. Feed posts/comments/audience/important recipients/receipts.
11. Chat threads/participants/read/mute.
12. Classified messages/params/replies/reactions/files/recent state.
13. Calendar and selected Absence archive.
14. Saved/default views and legacy-link rewrite.
15. Rebuild search/feed/counters/unread.
16. Representative ACL probes and signed reconciliation.

### 7.2. Chunk transaction

```text
raw chunk
→ verify manifest/hash/schema
→ normalize staging
→ validate types/enums/relations/company/ACL
→ compute deterministic normalized hash
→ bounded target transaction
→ ExternalIdMap + ImportChangeJournal + checkpoint
```

Target mutation, `ExternalIdMap`, journal and chunk checkpoint commit-яться разом. Crash before commit не просуває checkpoint; crash after commit дає idempotent NOOP.

Binary transfer окремий:

```text
immutable source
→ resumable quarantine upload
→ size/hash verify
→ metadata transaction
→ malware scan
→ idempotent promote
```

DB і object storage не мають спільної transaction, тому `ImportBinaryTransfer` зберігає durable state. Orphan sweeper працює лише після DDB-006 TTL/legal-hold rule.

### 7.3. Error policy

Auto-correction заборонена для:

- unknown enum/member/status;
- invalid/broken required relation;
- cross-company ambiguity;
- invalid bytes/timestamp;
- duplicate source mapping;
- same revision with different normalized hash;
- missing/changed binary;
- ACL mismatch;
- manifest/schema/hash mismatch.

Issue має stable code, entity/source ID, severity, rule/mapping version, owner і resolution. PII/body/token не пишеться в issue/log.

### 7.4. Import control plane target models

`ImportDataset`: immutable sealed source package — `id`, `workspaceId`, `sourceSystem`, `sourceTenantId`, `sourceBuild`, `sourceSchemaFingerprint`, `companyMappingVersion`, `kind SNAPSHOT|DELTA`, `parentDatasetId?`, `sequence`, `exportedAt`, `watermarkFromJson?`, `watermarkToJson`, `mappingVersion`, `schemaVersion`, `manifestSha256`, `encryptionKeyId`, `status INGESTING|SEALED|INVALID`, `createdAt`, `sealedAt?`. Watermarks are keyed by source entity because Tasks, IM, Disk і Calendar не мають спільного cursor. Unique `(workspaceId,sourceSystem,sourceTenantId,sequence)`. Після `SEALED` manifest/files/watermarks immutable.

`ImportFile`: `id`, dataset, source type, safe filename, bytes, SHA-256, record count?, status; unique dataset/filename.

`ImportBinaryTransfer`: `id`, `runId`, `datasetId`, `sourceFileId`, `expectedBytes`, `transferredBytes`, `sha256`, `quarantineObjectKey`, `uploadStateJson?`, status `PENDING|UPLOADING|UPLOADED|SCANNING|CLEAN|PROMOTED|FAILED`, `attempt`, `lastErrorCode?`, `fileObjectId?`, `documentVersionId?`, timestamps; unique dataset/source file.

`ImportRun`: `id`, `datasetId`, mode `VALIDATE|DRY_RUN|APPLY`, `checkpointJson`, status `QUEUED|RUNNING|PAUSED|SUCCEEDED|FAILED|CANCELLED`, `reconciliationStatus NOT_RUN|PASSED|FAILED`, `reconciledAt?`, `leaseOwner?`, `leaseUntil?`, `heartbeatAt?`, `attempt`, `lastErrorCode?`, `countersJson`, `safeErrorSummary?`, timestamps. `DELTA` є dataset kind, не run mode. Resume продовжує той самий run/checkpoint і збільшує attempt.

`ImportApplyLease`: `id`, `workspaceId`, `sourceSystem`, `sourceTenantId`, `runId`, `leaseOwner`, `leaseUntil`, `version`; unique `(workspaceId,sourceSystem,sourceTenantId)` і `runId`. Transaction атомарно набуває lease, тому для portal існує не більше одного active `APPLY`. Graceful pause: persist checkpoint → `PAUSED` → release lease. Crash resume — лише після expiry або audited takeover.

`APPLY` preflight до target write: dataset `SEALED`; manifest/file hashes verified; для `DELTA` parent має successful reconciled APPLY, next sequence і matching watermark chain; mapping/schema versions compatible. Final delta watermark точно збігається із signed cutover manifest. Failure створює `BLOCKING` issue до lease/target mutation.

`ImportIssue`: `id`, run, source type/id?, severity `WARNING|BLOCKING`, code, `safeDetailJson`, owner?, resolvedAt?, resolution?.

`ExternalIdMap`: `id`, workspace, source system/tenant/type/id, target type/id, source revision/time/hash, last applied target version/hash/run, last-seen dataset, tombstone, timestamps. Unique source key; index target type/id. Update/tombstone optimistic-compare-ить current target version/hash із last applied; divergence блокує overwrite.

`ImportChangeJournal`: `id`, run, external map?, operation `CREATE|UPDATE|NOOP|TOMBSTONE|QUARANTINE`, before/after version, `safeDiffJson`, createdAt. Це reconciliation evidence, не backup.

`MigrationActivation`: `id`, workspace/company/source, status `PREPARING|READY|ACTIVE_PRE_WRITE|FORWARD_FIX_ONLY|ROLLED_BACK`, final dataset/watermarks/manifest/signoff, feed cutover, pre-apply and activation-baseline backup refs, prepared/activated/first-native-write timestamps, version. Перша accepted native BERT mutation атомарно заповнює `firstNativeWriteAt` і переводить state у `FORWARD_FIX_ONLY`.

### 7.5. Historical side effects, unread and legacy links

- Import runs use explicit historical context and suppress user notifications, emails, ordinary realtime events and business automation. Import progress/audit channel є окремим.
- HTTP idempotency, import idempotency (`ExternalIdMap + revision/hash + checkpoint`) і outbox delivery IDs не використовують один key.
- Feed posts імпортуються як canonical source; feed projection materializes у silent mode.
- `feedCutoverAt` — signed UTC момент source write freeze, не час execution importer.
- Historical feed item не збільшує unread. При activation `FeedReadCursor` seed-иться останнім видимим historical item для user/stream; late historical materialization не змінює counter.
- Important acknowledgement імпортується лише з authoritative post/user receipt. Read/like/comment не створює receipt.
- Chat unread/read/mute seed-иться з `b_im_relation` і mapped source boundary. Historical task/system IM notifications не створюють target unread.
- Після activation лише BERT-native/post-cutover actions запускають normal notifications/outbox.

Legacy-link rewrite виконується після `ExternalIdMap` і до content publish. Parser allowlist-ить exact internal Bitrix URL patterns і перевіряє target ACL; string replacement у arbitrary HTML заборонений. Report: `rewritten`, `leftAsLegacy`, `brokenKnownPattern`, `deniedOnOpen`. Included `brokenKnownPattern > 0` є blocker без explicit product gap; unknown pattern не redirect-ить на external/arbitrary URL.

## 8. Delta and cutover

### 8.1. Delta strategy

Initial snapshot фіксує binlog coordinates.

- Якщо binlogs retained і test decoder підтвердив coverage, delta читається за exact binlog range.
- Інакше кожна entity має explicit high-water key + overlapping time/PK window.
- Table без reliable update/delete marker вимагає final-freeze resnapshot/diff.
- Overlap rows dedupe-яться `ExternalIdMap + source revision/hash`; timestamp alone недостатній.
- Tombstone не воскресає зі старого snapshot.

File delta:

`sourceFileId + normalizedPath + size + mtime + SHA-256`.

Changed-after-copy або missing file не publish-иться.

Tombstone apply:

| Source entity | Target action | History rule |
|---|---|---|
| User | `DEACTIVATED`, credentials/active roles absent | author display/reference preserved |
| Group/Task/Document/Event | archived/cancelled/read-only | deep links and allowed history preserved |
| Message/Comment/FeedPost | soft-deleted/redacted marker | ID/author/time/context/map preserved; body denied |
| File/binary | quarantine/retention lock; download denied | physical purge only by separate legal-hold-aware retention job |

Tombstone застосовується лише якщо source position входить у sealed watermark і target version/hash не diverged від last successful source apply. Conflict → `BLOCKING`, не destructive overwrite. Hard delete не виконується importer/rollback flow.

### 8.2. Cutover sequence

1. Close retention, topology, company mapping, ACL and history decisions.
2. Create/verify source DB+upload snapshot.
3. Restore isolated clone; seal canonical dataset.
4. Run repeated dry imports and failure-resume tests.
5. Run pre-freeze delta rehearsal.
6. Take verified BERT pre-apply DB+file backup; enable BERT mutation lock.
7. Apply base snapshot and pre-freeze deltas; BERT remains locked.
8. Announce and enforce Bitrix write freeze.
9. Capture final DB delta + final upload sync/manifest in same freeze window.
10. Apply final delta; rebuild projections; run signed reconcile under both locks.
11. Take verified BERT activation-baseline backup.
12. Set Bitrix read-only with transition banner; open BERT.
13. Monitor ACL denials, missing links/files, search, unread/ack counts, import lag.
14. After validation sign-off, close pre-write restore window; future incidents use forward-fix.

Якщо technical Bitrix read-only неможливий, procedural freeze має named commander і write-monitor evidence. Source write після final watermark — no-go до нового delta/reconcile.

### 8.3. Rollback boundary

До першого native BERT write import можна скасувати тільки verified restore BERT pre-apply DB+files backup. Batch delete imported rows не є rollback.

Після першого native BERT write source failback/restore pre-cutover state заборонений, бо replay-complete journal для нових BERT bodies/files відсутній. Incident flow: lock → incident snapshot → reconcile → versioned forward-fix → reconcile.

## 9. Reconciliation

Кожен immutable report містить: `datasetId`, `runId`, source system/tenant/build, `sourceSchemaFingerprint`, company/mapping/schema/exporter versions, manifest SHA-256, generated UTC і signer/key ID.

Для кожної entity/company:

```text
successfullyProcessed = importedCreated + importedUpdated + unchanged
                      + appliedTombstones + unchangedTombstones

sourceTotal = excludedByApprovedRule + quarantined + successfullyProcessed

targetAfter = targetBefore + importedCreated - appliedTombstones

duplicateTargetCount = importedCreated + importedUpdated + unchanged
                     - distinctMappedTargetIds
```

`sourceTotal` береться з sealed exact export, не `information_schema`.

Required reports:

| Domain | Обов'язкова звірка |
|---|---|
| Identity/org | active/inactive/system; departments/parents; assignments; heads; orphan count |
| Tasks | status/zombie/date/company; `R/O/A/U`; parents/cycles; checklists/deps; canonical comments |
| Feed | blog posts/comments; audience codes/expansion; required recipients; receipts; 140↔133 discrepancy |
| Chat | total IM rows; allowed chat rows; excluded notifications by type/module/event; threads/relations/messages/params/read/mute; hot/archive |
| Files | `b_file`, objects, folders, versions, attachments; DB/actual bytes; SHA-256; missing/changed/orphan/deleted; ACL/link closure |
| Calendar | active/deleted/type/privacy/recurrence/timezone |
| Saved views | parsed/imported/excluded/default/owner; invalid field/operator report |
| Company mapping | source/target totals; every cross-company decision |
| ACL | source/target allow/deny for representative non-admin principals |

Zero tolerance:

- cross-company/group/thread/file disclosure;
- duplicate target mapping;
- broken required relation;
- broken known included legacy link;
- published file before `CLEAN`;
- credential/secret export;
- unexplained manifest/hash mismatch.

Data, Security and Product sign signed reconciliation before activation.

## 10. Target topology gate

Current SQLite is not assumed valid for:

- ≈2M chat candidates plus params/read state;
- 1,10M task comments;
- ≈1,36 TiB logical file corpus;
- ACL-safe full-text search/archive;
- parallel import/rebuild;
- required backup/restore window.

Before implementation DDB-004 compares:

1. bounded hot dataset in current SQLite;
2. server relational DB + object storage + ACL-safe search;
3. hot operational DB + immutable authorized legacy archive.

Evidence: representative data, indexes/query plans, concurrent read/write, import/reconcile throughput, full-text behavior, backup/restore size/time, P95/P99 and failure recovery. Recommended default for planning — **server DB + object storage + separate ACL-safe search/archive**, але final selection лишається gated measured decision.

Implementation evidence 2026-07-23: the target-native Feed slice now has an isolated deterministic rehearsal based on the measured source fingerprint (5 573 posts, 7 357 comments, 150 534 task activities, 639 calendar activities, 133 important/announcement rows, 515 active users and 54 groups), plus explicitly labeled bounded synthetic File-share coverage. It creates a fresh temporary migrated SQLite database, exercises the actual `FeedService` authorization/cursor path, verifies one non-regressing `FeedSourceHead` per source, ACL canaries, exact facets, silent-history unread semantics and covering-index plans, records 20-sample p50/p95, then removes the database. Machine evidence: `artifacts/feed-rehearsal-representative.json`. This closes only the product F2b Feed relevance/load-evidence item; it does **not** close DDB-004 because concurrent import/write, full corpus, search, binary storage and backup/restore evidence remain missing.

## 11. Delivery phases

### DB-F0 — Source freeze design

Output:

- signed source fingerprint/DDL/index inventory;
- exact table/field allowlist and exclusion rules;
- company map;
- chat class + message-param inventory;
- task/feed dedupe fixtures;
- saved-view parser fixtures;
- DB/upload absolute roots and snapshot owner;
- binlog/retention capability;
- history/PII retention decisions;
- target topology decision.

Exit: DDB-001–DDB-008 closed; command templates and responsible owners recorded; no secret in commands. Exact validated absolute targets are finalized by DDB-009 in DB-F1.

### DB-F1 — Snapshot and extractor rehearsal

Output:

- verified XtraBackup prepare/restore;
- verified `/upload` snapshot and manifest;
- isolated staging;
- deterministic canonical chunks;
- exact source counts/relation reports;
- synthetic/redacted developer fixture.
- signed manifest v1 generated exporter-side and accepted by the existing BertCRM Ops validator.

Exit: DDB-009 closed; repeated hash stable; source production load accepted; missing/orphan report complete.

### DB-F2 — Importer rehearsal

Output:

- ordered idempotent importer;
- quarantine/issues;
- binary resume/scan/promote;
- saved-view and legacy-link reports;
- failure injection at 1%/50%/after binary upload;
- representative ACL reconcile.

Exit: resume without duplicate; critical issue count 0; measured capacity meets DDB-004.

### DB-F3 — Cutover rehearsal

Output:

- base + overlapping delta chain;
- final-freeze timing;
- BERT pre-apply and activation backup restore proofs;
- workspace lock and forward-fix rehearsal;
- signed reconciliation package.

Exit: DDB-010 closed; RPO/RTO accepted; exact go/no-go thresholds and commander recorded.

### DB-F4 — Production cutover

Freeze → final delta/file sync → apply → rebuild → signed reconcile → backup → activation → monitoring. Legacy shutdown only after validation sign-off.

## 12. Decision log

| ID | Рішення | Статус | Owner |
|---|---|---|---|
| DDB-001 | Raw live datadir не є migration dataset; safety backup = verified Percona 5.7 backup | **Прийнято планом** | Data/Ops |
| DDB-002 | DB backup завжди має matching `/upload` snapshot + manifest | **Прийнято планом** | Data/Ops |
| DDB-003 | Search/cache/projection tables exclude/rebuild; canonical source matrix §3 | **Прийнято планом** | Data/Architecture |
| DDB-004 | Target DB/search/archive topology на measured dataset | **BLOCKING DB-F0** | Architecture/Ops/Data |
| DDB-005 | Реалізувати product decisions D-010/D-020: retention, full hot vs hot+archive і dependency closure | **BLOCKING DB-F0** | Product/Legal/Data |
| DDB-006 | Raw/staging encryption, TTL, access і deletion evidence | **BLOCKING DB-F0** | Security/Data |
| DDB-007 | Реалізувати product decision D-024: source org branches → BERT companies і cross-company policy | **BLOCKING DB-F0** | Product/Security/Data |
| DDB-008 | Binlog availability або explicit per-table delta/final-resnapshot rules | **BLOCKING DB-F0** | Data/Ops |
| DDB-009 | Actual absolute DB/upload roots, backup target, owners, throughput and exact commands | **BLOCKING DB-F1** | Ops |
| DDB-010 | RPO/RTO, freeze window, both BERT backup refs, commander | **BLOCKING DB-F3** | Ops/Product |
| DDB-011 | `ExternalIdMap` є canonical source→target mapping; email/filename/current department не є ID fallback | **Прийнято планом** | Data/Architecture |
| DDB-012 | До first native BERT write rollback = verified restore; після нього лише forward-fix, не batch delete/replay | **Прийнято планом** | Ops/Data |
| DDB-013 | Dataset envelope = strict signed manifest v1; Ed25519 trusted-key verification і full child size/hash/checksum preflight перед DB import | **Прийнято реалізацією** | Data/Security/Architecture |
| DDB-014 | Signed company map = manifest-bound privacy-safe artifact v1, target-workspace binding, exact read-only DB comparison і Product/Security/Data evidence; unresolved roots/cross-company entities блокують preflight | **Прийнято реалізацією** | Product/Security/Data |
| DDB-015 | Exporter sealing = external strict metadata request + separate Ed25519 key file; deterministic no-overwrite checksums/signature and mandatory existing-verifier round-trip | **Прийнято реалізацією** | Data/Security/Ops |

## 13. Risks and no-go gates

| Ризик | Control | No-go |
|---|---|---|
| Inconsistent DB copy | XtraBackup prepare+restore | restore/checksum failure |
| DB/file mismatch | matching snapshot IDs + manifest + final freeze | missing/changed dependent binary |
| Notification flood/duplicate chat | IM classification | unknown high-volume class |
| Duplicate task/feed history | canonical matrix | canonical/projection count unexplained |
| ACL leak | representative-principal probes | any unauthorized result/snippet/download |
| Secret leakage | field/table allowlist + log redaction | credential/token in dataset/log |
| Encoding/time corruption | raw hash + fixtures | silent replacement/time drift |
| SQLite overload | DDB-004 measured topology | target/recovery limits unmet |
| Broken delta | binlog/high-water/overlap/final resnapshot | uncovered update/delete path |
| Unrecoverable cutover | dual BERT backup/restore rehearsal | missing restore evidence |

### 13.1. Verification matrix

Unit:

- source enum/role/class mapping;
- canonical normalization/hash;
- saved-view non-executable parser;
- legacy URL parser;
- path traversal/symlink escape;
- encoding/timezone fixtures;
- chunk-boundary and tombstone policy.

Integration:

- manifest/schema/hash preflight;
- signed company mapping ↔ exact active target rows/workspace/company-state preflight;
- `ExternalIdMap` idempotency and target-divergence block;
- lease acquire/heartbeat/expiry/audited takeover;
- chunk transaction/checkpoint resume;
- binary resume/scan/promote/orphan handling;
- historical side-effect suppression;
- source/target ACL probes;
- projection rebuild without duplicates.

Fault injection:

- truncated export or manifest child;
- same source ID across tenants;
- equal source time with different normalized hash;
- overlapping/out-of-order delta;
- invalid parent/watermark chain;
- expired or concurrently acquired apply lease;
- target changed after last source apply;
- unknown task member/status/chat class;
- broken task/org parent or reply/file dependency;
- invalid serialized saved filter;
- known legacy link without map;
- archive ACL mismatch;
- Unicode/HTML/long/invalid-byte fields;
- zero/oversized/wrong-MIME/zip-bomb/encrypted archive;
- missing/changed physical binary;
- failure at 1%, 50% and after binary upload;
- suppressed historical outbox accidentally emitted;
- DST/naive-time drift;
- DB snapshot restore without matching file manifest;
- recovery/forward-fix rehearsal;
- measured-volume load and restore test.

## 14. Definition of Done

Backend migration завершена лише коли:

- source DB і `/upload` snapshots мають verified IDs/hashes і restore evidence;
- canonical dataset відтворюється deterministic chunks;
- excluded/projection/auth data має explicit rules/counts;
- exact entity/domain equations сходяться;
- task/feed/chat canonical rules не створюють duplicate history або notifications;
- files мають size/hash/scan/ACL/link closure;
- representative non-admin source/target ACL збігаються;
- delta покриває create/update/delete/file change до final watermark;
- target topology і recovery проходять measured gates;
- signed reconciliation має zero critical issues;
- рішення, команди, owners, absolute targets і evidence refs оновлені саме в цьому файлі.
