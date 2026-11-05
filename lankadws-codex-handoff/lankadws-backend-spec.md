# LankaDWS — самодостатнє ТЗ на backend-реалізацію

## 0. Завдання для Codex і пріоритети

Цей документ разом із `lankadws-design-spec.md` є source of truth для реалізації LankaDWS. Frontend-ТЗ визначає UX, routes, permission outcomes і контракти даних; цей документ визначає реальний backend, persistence, auth, API, jobs, files, audit, backup і deployment.

Codex має створити **працездатний production-oriented backend**, а не mock server, набір controller-заглушок або in-memory repository. Усі критичні операції мають реально зберігатися в SQLite, перевіряти права server-side, залишати audit і переживати restart процесу.

Зафіксований стек:

- monorepo: **npm workspaces**;
- frontend: **React + Vite + TypeScript** у `apps/web`;
- backend: **NestJS + TypeScript** у `apps/api`;
- ORM: **Prisma ORM**;
- database: **SQLite** у persistent volume;
- shared transport contracts: `packages/contracts`;
- package manager: **npm**, без pnpm/yarn/bun lockfile.

Для нового репозиторію використовувати актуальний patch-реліз Node.js 24 LTS. Якщо репозиторій уже має сумісний підтримуваний Node LTS, не змінювати major без потреби. Орієнтири: [Node.js release schedule](https://nodejs.org/en/about/previous-releases), [NestJS documentation](https://docs.nestjs.com/), [Prisma SQLite connector](https://www.prisma.io/docs/orm/core-concepts/supported-databases/sqlite).

### Непорушні продуктові правила

- це внутрішня CRM без клієнтів, лідів, угод, продажів, воронки, revenue, товарів або customer portal;
- немає сутностей `Команда`, `Підрозділ`, `teamId`, `departmentId`, team lead або оргдерева;
- одна інсталяція є одним workspace/tenant і може містити кілька плоских компаній;
- користувач має одну primary company і доступ до додаткових компаній;
- вхід відбувається **лише за нікнеймом і паролем**; email не є login/recovery identifier;
- bulk import користувачів із CSV/XLSX у MVP відсутній;
- impersonation / `Увійти як користувач` заборонено;
- адміністрування системи не дає автоматичного права читати приватні HR-дані, документи або чати;
- backend ніколи не довіряє прихованій кнопці, frontend role або company query без власної перевірки;
- SQLite не маскується під distributed database: production першої версії працює як один writable deployment instance.

### Межі реалізації

Потрібно реалізувати:

- реальні Prisma models і migrations;
- REST API `/api/v1` з OpenAPI;
- nickname/password auth, TOTP-2FA, recovery codes, sessions і re-auth;
- CLI створення першого адміністратора;
- server-side RBAC, company scope, ACL і confidentiality;
- усі модулі, необхідні frontend-ТЗ;
- local persistent file storage через adapter, quarantine і scan states;
- persistent background jobs та transactional outbox без Redis;
- audit, retention, backup/restore scripts і health checks;
- unit, integration, E2E, migration, CLI та permission-isolation tests;
- README, `.env.example`, OpenAPI artifact і operational runbook.

Не потрібно впроваджувати:

- мікросервіси, Kubernetes або service mesh;
- Redis/BullMQ/Kafka/RabbitMQ;
- PostgreSQL чи паралельну другу ORM;
- SSO, SCIM, LDAP або social login;
- bulk user import;
- зовнішній портал;
- довільний workflow/code builder;
- billing, marketplace, телефонію чи відеодзвінки.

## 1. Структура monorepo й архітектура

### 1.1 Workspaces

Цільова логічна структура:

| Workspace | Призначення |
|---|---|
| `apps/web` | React/Vite frontend із frontend-ТЗ |
| `apps/api` | NestJS HTTP API, CLI entrypoint і bounded background processor |
| `packages/contracts` | Transport DTO, enums, route-safe error codes, pagination types; без Prisma/Nest/browser implementation |
| `packages/config` | Необов’язкові спільні TypeScript/ESLint config; без runtime secrets |

Якщо репозиторій уже має еквівалентні paths, зберегти їх і описати mapping у README. Не створювати дубль `contracts` усередині кожного app. Prisma Client і database types не експортуються у frontend.

Кореневі scripts мають запускати workspace-команди через npm: install, dev, build, lint, typecheck, test, test:e2e, prisma generate/migrate та LankaDWS CLI. Один `package-lock.json` знаходиться в root.

### 1.2 Модульний моноліт

Backend — один NestJS modular monolith із чіткими модулями:

- `AuthModule`;
- `UsersModule`;
- `CompaniesModule`;
- `RolesModule` / `AuthorizationModule`;
- `TasksModule`;
- `RequestsModule` / `ApprovalsModule`;
- `CalendarModule`;
- `DocumentsModule` / `FilesModule`;
- `KnowledgeModule`;
- `AnnouncementsModule`;
- `LifecycleModule` для offboarding;
- `ChatModule` / `CommentsModule`;
- `NotificationsModule`;
- `SearchModule`;
- `AuditModule`;
- `JobsModule` / `OutboxModule`;
- `AdminModule` / `SystemModule`;
- `HealthModule`.

Модулі взаємодіють через application services і domain events/outbox, а не імпортують чужі Prisma repositories напряму. HTTP controller не містить business logic. Prisma queries з permission scope не дублюються довільно по controller-ах.

Не створювати generic `BaseCrudService`, який обходить invariants. Критичні сутності мають явні command methods: submit request, approve version, reset credentials, publish announcement, deactivate user, archive document.

### 1.3 Shared contracts

`packages/contracts` містить:

- request/response DTO для frontend adapter;
- safe list/detail projections;
- enum/status values;
- permission codes;
- RFC 9457-compatible problem types/error codes;
- cursor/page metadata;
- entity references і company-scope types.

Contracts не містять password hash, TOTP seed, storage path, internal audit payload, private HR field або Prisma-generated model. Runtime validation у API залишається обов’язковою навіть для shared TypeScript type.

## 2. SQLite і Prisma

### 2.1 Режим експлуатації

SQLite є основною production database першої версії за умови:

- один writable API deployment для одного database file;
- database file лежить на локальному persistent volume, не в ephemeral container layer;
- database не розміщується на NFS/SMB/network filesystem;
- horizontal multi-writer replicas заборонені;
- read/write transactions короткі й не містять HTTP, image processing, malware scan або file copy;
- великі звіти, retention і preview виконуються batch-ами через job queue.

У production увімкнути `foreign_keys=ON`, WAL і контрольований `busy_timeout`. Durability policy має бути явно зафіксована; для критичних робочих даних default — synchronous mode із пріоритетом цілісності, а не максимального benchmark. WAL дозволяє одночасні readers/writer, але SQLite залишається single-writer database: [SQLite WAL](https://sqlite.org/wal.html), [SQLite isolation](https://sqlite.org/isolation.html).

Codex має додати метрики database busy/retry, WAL size/checkpoint і slow query. При `SQLITE_BUSY` використовується bounded retry з jitter лише для idempotent/transaction-safe операцій; після ліміту API повертає контрольований 503/409, а не зависає.

### 2.2 Prisma правила

- одна schema і впорядкована історія Prisma migrations;
- `prisma migrate deploy` виконується перед запуском нового production build;
- production database не змінюється через `db push`;
- seed запускається лише явно й ніколи поверх production без guard;
- кожна migration має rollback/restore note, навіть якщо Prisma не генерує down migration автоматично;
- raw SQL migration дозволена лише для SQLite FTS5, append-only triggers, indexes або PRAGMA, яких Prisma schema не виражає; причина документується;
- критичні multi-record зміни виконуються в Prisma transaction;
- SQLite/Prisma використовує Serializable isolation; interactive transaction не тримається довше за необхідне: [Prisma transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions).

Усі timestamps зберігаються в UTC. Human date, timezone і holiday calculations виконуються application service за timezone користувача/компанії. IDs генеруються application-side як UUID/ULID і не розкривають послідовність записів.

### 2.3 Індекси й масштаби

Обов’язкові composite indexes створюються під реальні filters: workspace/company, status, assignee/approver, deadline, updatedAt, recipient/readAt, thread/createdAt, job/state/runAt, audit/createdAt.

List endpoints не завантажують comments, history, attachment bytes або повні relations. Pagination — cursor або page з детермінованим secondary sort по `id`. Немає N+1 для avatar metadata, assignee, role names, counts або company labels.

SQLite FTS5 використовується через ізольований search repository/raw migration для дозволених searchable fields. У FTS ніколи не потрапляють password/security data, private HR comment, TOTP/recovery data або content без search permission. Якщо середовище не має FTS5, startup/readiness не мовчить: або використовується задокументований малий fallback, або deployment блокується з людською помилкою.

## 3. Bootstrap: команда першого адміністратора

### 3.1 Основна команда

Кореневий workspace надає інтерактивну команду:

`npm run lankadws -- admin:create`

Назва root script може відрізнятися лише якщо вже є погоджений CLI convention; README завжди показує точну команду. CLI використовує Nest application context і ті самі services/validation, що API, але не запускає HTTP listener.

Команда призначена **лише для першого повного адміністратора**. Вона:

1. перевіряє database connection і migrations;
2. відмовляється працювати, якщо вже існує активний full admin;
3. у порожній database запитує назву workspace, display/legal name першої компанії, code, timezone і робочі дні;
4. запитує ім’я адміністратора та унікальний нікнейм;
5. читає пароль двічі через masked TTY prompt;
6. перевіряє nickname/password policy й compromised/common blocklist;
7. в одній transaction створює workspace, company, protected system roles/permissions, user, username reservation, password credential, full-admin assignment, primary company access, security policy й bootstrap audit event;
8. позначає адміністратора `mustEnroll2FA=true`;
9. виводить лише safe summary: username, company, created IDs і наступний крок; пароль, hash, recovery code або TOTP secret у stdout/log не виводяться.

Пароль заборонено передавати як CLI argument, query string або звичайну environment variable, що може потрапити в shell history/process list. Для CI/bootstrap automation допускається окремий documented secret-file/stdin mode з restrictive file permissions, але interactive mode є default.

У команди немає `--force`, який обходить наявність адміністратора. Повторний запуск є no-op/error з чітким exit code. Partial bootstrap не допускається: transaction або створює всі core records, або нічого.

### 3.2 Break-glass recovery

Окрема команда `npm run lankadws -- admin:recover` використовується лише коли:

- немає другого активного full admin для two-person reset;
- звичайний UI recovery неможливий;
- оператор має authorized server-console access.

Вона вимагає username, masked re-confirmation/installation secret, reason і typed impact confirmation; не приймає permanent password аргументом. Команда відкликає сесії, створює короткоживучий one-time temporary credential, показує його один раз у TTY і записує append-only `system:break-glass` audit event без secret. Користувач проходить `/first-login`, встановлює власний пароль і повторно налаштовує/підтверджує 2FA за policy.

Break-glass не змінює ролі, не створює нового прихованого адміністратора й не видаляє audit. Operational runbook пояснює фізичний/організаційний контроль цієї команди.

## 4. Authentication і credential lifecycle

### 4.1 Нікнейм

- єдиний login identifier — `username`;
- canonical lowercase, 3–32 символи, `[a-z0-9._-]`, без пробілів;
- uniqueness case-insensitive у межах workspace;
- display name і contact email не впливають на login;
- email-адреса не приймається як fallback;
- деактивований або перейменований username залишається у `UsernameReservation` і не перевидається;
- попередній username не працює як login alias;
- зміна username потребує окремого permission, re-auth, reason, session revocation і audit.

Login error нейтральний: неправильний username, password, відсутній account або недозволений state не дозволяють account enumeration. Після правильної credential-перевірки деактивований/blocked state може показувати дозволений UX без приватних деталей.

### 4.2 Паролі

Policy узгоджується з [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html) і [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html):

- мінімум 15 символів, якщо password може бути єдиним фактором;
- якщо 2FA обов’язковий для кожного входу, backend може дозволити мінімум 8, але UI заохочує passphrase;
- максимум щонайменше 64 символи;
- без штучних composition rules;
- перевірка common/compromised/context blocklist;
- без calendar-based forced rotation за відсутності compromise;
- password manager, paste й autocomplete не блокуються;
- password зберігається лише як salted Argon2id hash із параметрами, що benchmark-яться на цільовому host;
- current password, hash і previous plaintext ніколи не повертаються API.

Password hashing не виконується всередині довгої database transaction. Hash готується перед короткою transaction, після чого credential version змінюється атомарно.

### 4.3 Login і session

Auth використовує opaque server-side session, а не довгоживучий JWT у localStorage.

- browser отримує random session ID у `HttpOnly`, `Secure` production cookie з коректним `SameSite` і path;
- session record містить user, created/lastSeen/expires/revoked, device label, safe IP/user-agent metadata і auth assurance;
- session ID зберігається тільки як hash/opaque verifier, якщо реалізація дозволяє;
- session rotate-иться після login, 2FA, re-auth і critical credential change;
- idle timeout і absolute timeout задаються security policy;
- CSRF protection обов’язковий для state-changing browser requests;
- logout, deactivation, password admin-reset, username change і `Завершити всі сесії` негайно revoke відповідні sessions;
- account/authorization version у session не дозволяє користуватися старими правами після role/company change.

Rate limiting враховує username fingerprint та IP/device signal, використовує progressive delay і не дозволяє простий denial-of-service permanent lock. Lock/unlock події аудіюються. `429` повертає safe retry hint без внутрішніх thresholds.

### 4.4 First login і admin reset

Temporary password:

- генерується CSPRNG, не менше 20 random символів;
- зберігається лише як hash;
- default expiry 24 години;
- single-use;
- анулюється новим reset;
- після перевірки дає лише restricted credential-change session, не доступ до business API.

`/first-login` дозволяє тільки встановлення нового password, завершення credential session і необхідний 2FA enrollment. Після password change користувач входить повторно звичайним шляхом; full session автоматично не видається.

Admin reset:

- permission `users.credentials.reset`;
- re-auth і 2FA адміністратора;
- target identity verification method і reason обов’язкові;
- усі target sessions revoke;
- one-time secret повертається один раз і не потрапляє в audit/log/notification/analytics;
- reset password не reset-ить 2FA;
- target отримує safe in-app security notice після наступного входу.

Reset password/2FA повному адміністратору при наявності другого full admin використовує `CredentialResetApproval`: initiator і approver різні, approval короткоживучий, обидва re-authenticate-яться, secret генерується лише після approve. Self-approval заборонений. За відсутності другого admin — тільки break-glass CLI.

### 4.5 TOTP і recovery codes

- TOTP secret шифрується application encryption key, який не лежить у SQLite/repository;
- setup підтверджується першим валідним code до activation;
- recovery codes генеруються CSPRNG, показуються один раз і зберігаються як hashes;
- використаний recovery code атомарно позначається consumed;
- recovery code замінює лише другий factor після правильного username/password;
- reset 2FA має permission `users.mfa.reset`, re-auth, reason, audit і session review;
- security policy може вимагати 2FA для конкретних ролей або всіх users;
- clock skew window обмежений і тестується.

### 4.6 Заборони

- немає public email/username password-recovery endpoint;
- немає security questions;
- немає password у URL, log, event payload, notification або support export;
- немає hidden master password;
- немає impersonation session;
- API `Перевірка доступу` повертає policy result, але не токен іншого користувача.

## 5. Authorization, company scope і confidentiality

### 5.1 Модель прав

RBAC складається з:

- system/custom `Role`;
- atomic `Permission` codes;
- `RolePermission` зі scope;
- `UserRole`;
- `UserCompanyAccess`;
- entity ACL/participation;
- direct approver relation;
- confidentiality rules;
- temporary delegation.

Scope values: `OWN`, `SELECTED_COMPANIES`, `ALL_COMPANIES`. Default deny. Permission на модуль не дорівнює доступу до кожного record або private field.

Обов’язкові high-risk permissions включають:

- roles/permissions manage;
- users create/deactivate;
- username change;
- credentials reset;
- MFA reset;
- account unlock;
- session revoke;
- security policy manage;
- audit read/export;
- sensitive export;
- announcements create/publish;
- confidential HR/security content read.

`Керувати системою` не дає `Читати весь контент`. System admin бачить account metadata й configuration, але chat, HR document, private request fields та file contents — лише за content permission/ACL.

### 5.2 Enforcement

Кожний list/detail/mutation/export/search/file endpoint:

1. отримує authenticated principal і current authorization version;
2. визначає workspace/company scope;
3. застосовує record-level ACL/participation;
4. застосовує field-level confidentiality projection;
5. перевіряє entity state/version;
6. повертає allow, 403 або privacy-preserving 404.

Фільтрація після завантаження заборонена, якщо query уже міг повернути чужі records. Company/ACL constraints входять у repository query. Search, notification, counts, analytics і exports використовують ті самі policy services.

Company query із frontend не розширює scope. `company=all` означає лише всі **дозволені** компанії. Create command зі scope all вимагає явний конкретний companyId.

### 5.3 Permission preview

Admin endpoint `Перевірка доступу` приймає target user, company, entity type/id і proposed action, повертає safe explanation: allowed/denied, matched role/scope/ACL і missing permission. Він:

- доступний лише authorized admin;
- аудіюється для sensitive target;
- не повертає private entity payload;
- не створює session/token target user;
- використовує той самий policy engine, що реальна операція.

### 5.4 Інваріанти адміністратора

- не можна деактивувати останнього active full admin;
- не можна прибрати останню full-admin assignment;
- self-role downgrade потребує другого admin, якщо він є;
- full-admin credential reset використовує two-person control;
- system roles versioned/protected; custom roles можна archive, не destructive delete;
- permission change збільшує authorization version affected users і invalidates старий access негайно.

## 6. Prisma domain model

Нижче — мінімальна нормалізована модель. Назви можуть бути адаптовані до existing conventions, але зміст, constraints і security boundaries зберігаються. Password/TOTP/file bytes не змішуються з `User`.

### 6.1 Workspace, companies і users

| Model | Ключові поля / constraints |
|---|---|
| `Workspace` | `id`, `displayName`, `status`, `defaultTimezone`, timestamps; у поточній інсталяції один active record |
| `Company` | `id`, `workspaceId`, `displayName`, `legalName`, unique normalized `code`, `status`, `timezone`, `locale`, working-day/calendar settings, version |
| `User` | `id`, `workspaceId`, `primaryCompanyId`, `displayName`, `username`, `normalizedUsername`, `jobTitle`, optional contact metadata, `displayRole`, `approverId?`, `timezone`, `locale`, `status`, `mustChangePassword`, `mustEnroll2FA`, `authorizationVersion`, timestamps |
| `UsernameReservation` | unique `workspaceId + normalizedUsername`, `currentUserId?`, `previousUserId?`, `state`, `reservedAt`; records не перевикористовуються мовчки |
| `UserCompanyAccess` | unique `userId + companyId`, access status, grantedBy, grantedAt |
| `Role` | `id`, `workspaceId`, `name`, `normalizedName`, `isSystem`, `isFullAdmin`, `status`, `version`, timestamps |
| `Permission` | unique code, domain, risk level, description; system-seeded |
| `RolePermission` | unique role/permission/scope, optional selected company relation, version |
| `UserRole` | user, role, grantedBy, validFrom/validTo?, status |
| `Delegation` | delegator, substitute, company scope, allowed actions, start/end, reason, status; no cycles |

Contact email є optional profile/notification value. На ньому немає auth unique constraint, reset token або login lookup.

### 6.2 Credentials і sessions

| Model | Ключові поля / constraints |
|---|---|
| `PasswordCredential` | one active per user, passwordHash, algorithm/parameter version, changedAt, compromisedAt?, credentialVersion; жодного plaintext |
| `TemporaryCredential` | user, secretHash, purpose, expiresAt, consumedAt?, createdBy, invalidatedAt? |
| `TotpCredential` | user, encryptedSecret, keyVersion, confirmedAt, disabledAt? |
| `RecoveryCode` | user, codeHash, createdAt, consumedAt? |
| `UserSession` | id/hash, user, assurance level, device/user-agent metadata, created/lastSeen/expires/revoked, revokeReason |
| `LoginAttempt` | normalized username fingerprint, optional resolved user, coarse IP/device hash, result/reason code, createdAt, retention-limited |
| `CredentialEvent` | target user, actor user/system, event type, result, reasonCode, correlationId, createdAt; без secret |
| `CredentialResetApproval` | target admin, initiator, approver?, reset type, state, expiresAt, reason, approvedAt?; initiator ≠ approver |
| `ReauthChallenge` | session, purpose, expiresAt, satisfiedAt, assurance; no password content |

### 6.3 Tasks і links

| Model | Ключові поля / constraints |
|---|---|
| `Task` | workspace/company, human number, title, description, creator, assignee, status, priority, deadline, version, recurrence source?, archivedAt? |
| `TaskChecklistItem` | task, order, text, isDone, completedBy/At, version |
| `TaskDependency` | predecessor/successor, type; self/cycle guard |
| `TaskWatcher` | task/user unique |
| `TaskRecurrenceRule` | task template, timezone, bounded recurrence rule, nextRunAt, active |
| `EntityLink` | source type/id, target type/id, relation type, createdBy; unique pair |

Recurring job створює next task idempotently за occurrence key. Видалення source entity не залишає silent broken links: link має state або archival handling.

### 6.4 Requests і approvals

| Model | Ключові поля / constraints |
|---|---|
| `RequestType` | workspace, name, category, status, currentPublishedVersionId? |
| `RequestTypeVersion` | type, version number, immutable schema/visibility/effect definition as validated canonical JSON text, createdBy, publishedAt? |
| `ApprovalRoute` | workspace/type/company conditions, status, current version |
| `ApprovalRouteVersion` | immutable version, createdBy, publishedAt |
| `ApprovalStepDefinition` | routeVersion, order/parallel group, resolver type, SLA, escalation policy |
| `Request` | workspace/company, human number, author, typeVersion, routeVersion, version, decisionStatus, executionStatus, currentStep, confidentiality, SLA dates, timestamps |
| `RequestSnapshot` | request/version, validated values as canonical JSON text, safe summary, submittedAt, author; immutable after submit |
| `RequestPrivateDetail` | request/version, encrypted or separately access-controlled private HR fields; never list/search/notification payload |
| `ApprovalAttempt` | request, requestVersion, step, approver, state, comment, decidedAt, idempotency key; unique active decision constraint |
| `ApprovalEffect` | request/attempt, effect type, idempotency key, state, resultRef?, lastErrorCode? |

Form schemas підтримують лише дозволені field types із frontend-ТЗ. Backend validate-ить schema під час publish і values під час draft/submit. Довільний executable code, SQL, template script або unsafe expression заборонені.

### 6.5 Calendar, presence і lifecycle

| Model | Ключові поля / constraints |
|---|---|
| `Event` | workspace/company, owner, title, start/end UTC, source timezone, allDay, visibility, recurrence?, version |
| `EventParticipant` | event/user, role, response state |
| `PresenceRecord` | workspace/company, user, state, start/end, visibility, sourceRequestId?, version |
| `LifecycleProcess` | offboarding type, workspace/company, employee, templateVersion, owner, start/end, status, progress, version |
| `LifecycleTemplate` | workspace/company scope, name, type, status, current version |
| `LifecycleTemplateVersion` | immutable task/dependency definition, publishedAt |
| `LifecycleStep` | process, source template step, linkedTaskId, owner, status, dueAt, blocker reason |
| `AssetAssignment` | employee, equipment metadata, issued/returned dates, status; без ERP-функцій |

Presence record показує privacy-safe state; absence reason залишається в request confidentiality boundary.

### 6.6 Documents, knowledge і files

| Model | Ключові поля / constraints |
|---|---|
| `FileObject` | workspace/company, opaque storage key, original safe filename, MIME detected/declared, bytes, sha256, scanStatus, storageStatus, owner, createdAt |
| `FileLink` | file, entity type/id, purpose, ACL inheritance mode |
| `Document` | workspace/company, human number, name, owner, status, confidentiality, currentVersionId, version, archivedAt? |
| `DocumentVersion` | document, version number, fileId, createdBy, change summary, status, createdAt; immutable file reference |
| `DocumentAcl` | document or version, principal type/id, allowed actions |
| `KnowledgeArticle` | workspace, slug, owner, status, currentVersionId, reviewAt, version |
| `KnowledgeArticleVersion` | article, version, title/body canonical content, change summary, createdBy, publishedAt? |
| `ArticleAudience` | article/version, company/role/user target |
| `Acknowledgement` | entity type/version, user, dueAt, openedAt?, confirmedAt?, source notification |

Original filename ніколи не використовується як disk path. File bytes не зберігаються в SQLite BLOB у MVP; SQLite містить metadata, а storage adapter — bytes.

### 6.7 Announcements і notifications

| Model | Ключові поля / constraints |
|---|---|
| `Announcement` | workspace, author, title, body, status, isPinned, publishAt, expiresAt?, version, archivedAt? |
| `AnnouncementAudienceCompany` | announcement/company unique |
| `AnnouncementAudienceRole` | announcement/role unique |
| `AnnouncementAudienceUser` | announcement/user unique |
| `AnnouncementReceipt` | announcement/user unique, deliveredAt, readAt?, dismissedAt?, effectiveContentVersion |
| `Notification` | recipient, category, safeTitle, safeSnippet, entityRef, requiresAction, readAt?, deliveredAt, createdAt, dedupeKey |
| `NotificationPreference` | user/category/channel, enabled, digest/quiet settings, version |

Audience materialization/receipt generation виконується idempotent job після publish. Publish transaction фіксує version й outbox event; користувач без audience/company permission не отримує content через direct ID.

### 6.8 Chat, comments і saved views

| Model | Ключові поля / constraints |
|---|---|
| `MessageThread` | workspace, optional company, kind personal/context, title?, entityRef?, lastMessageAt, version |
| `ThreadParticipant` | thread/user, role, joinedAt, leftAt?, lastReadMessageId? |
| `Message` | thread, author, body, replyTo?, createdAt, editedAt?, deletedAt?, version |
| `Comment` | workspace/company, entityRef, author, body, visibility, created/edited/deleted timestamps, version |
| `AttachmentLink` | file, message/comment/entity relation |
| `SavedView` | user, module, name, validated query state, isDefault, version |

Message delete є controlled tombstone за retention policy; hard delete не ламає thread ordering/audit. Comment visibility не може розширювати entity permission.

### 6.9 Audit, outbox, jobs і retention

| Model | Ключові поля / constraints |
|---|---|
| `AuditEvent` | workspace/company?, actor type/id, action, entity type/id, result, risk, before/after safe diff, reasonCode, correlationId, createdAt |
| `OutboxEvent` | aggregate type/id/version, event type, safe payload, state, attempts, nextRunAt, createdAt |
| `BackgroundJob` | type, entityRef, state, payload safe/encrypted as needed, progress, attempts, maxAttempts, runAt, leaseOwner/Until, lastErrorCode, idempotencyKey, timestamps |
| `RetentionPolicy` | category, duration, action, version, effectiveAt, changedBy |
| `LegalHold` | entity/category scope, reason, placedBy/At, releasedBy/At?, status |
| `IdempotencyRecord` | user/client scope, key, operation, request fingerprint, result reference/status, expiresAt |

Audit update/delete забороняється application layer і defense-in-depth SQLite trigger, крім окремого retention archival process. Audit diff не містить password, TOTP, recovery code, private comment або raw file content.

## 7. REST API contract

### 7.1 Загальні правила

- base path `/api/v1`;
- JSON UTF-8; upload/download використовують окремі multipart/stream endpoints;
- OpenAPI генерується з runtime DTO і зберігається як build artifact;
- errors відповідають [RFC 9457 Problem Details](https://www.rfc-editor.org/info/rfc9457/) з safe `type`, `title`, `status`, `code`, `correlationId`, optional field errors;
- internal stack/database message не повертається;
- кожна response має request/correlation ID;
- list endpoints мають `items` і cursor/page metadata;
- filtering/sorting allowlisted, unknown query rejected або canonicalized;
- mutation із ризиком duplicate приймає `Idempotency-Key`;
- versioned entity mutation приймає expected version/ETag; stale write → 409 із safe current version info;
- date/time — ISO 8601 UTC, timezone передається окремим field;
- API не повертає поле лише тому, що воно є в Prisma model.

Production бажано подавати web/API з одного site origin через reverse proxy. Dev CORS allowlist містить лише configured Vite origin, credentials і необхідні methods/headers; wildcard з cookies заборонений.

### 7.2 Auth і current user

| Method/path | Призначення |
|---|---|
| `POST /auth/login` | username/password; повертає next step, не account enumeration |
| `POST /auth/first-login/password` | restricted session встановлює permanent password |
| `POST /auth/2fa/setup` / `confirm` | enrollment до activation |
| `POST /auth/2fa/challenge` | завершує login assurance |
| `POST /auth/recovery-code` | backup second factor після password |
| `POST /auth/reauth` | short-lived proof для critical action |
| `POST /auth/logout` | revoke current session |
| `GET /me` | safe current principal, roles, companies, display role, capabilities |
| `GET /me/sessions` | active sessions |
| `DELETE /me/sessions/:id` | revoke own other session |
| `POST /me/sessions/revoke-others` | revoke all other sessions |
| `PATCH /me/profile` | дозволені self fields only |
| `POST /me/password/change` | current password + new password, optional revoke others |

Немає `/forgot-password` або email reset endpoint. `/access-help` є frontend content/config endpoint без username lookup.

### 7.3 Робочі ресурси

Кожний resource має list, permission-checked detail і явні commands. Основні groups:

- `/tasks`, `/tasks/:id`, `/tasks/:id/status`, checklist/dependencies/watchers/comments;
- `/requests`, `/requests/:id`, `/requests/:id/submit`, `/approve`, `/return`, `/reject`, `/delegate`, `/cancel`;
- `/calendar/events`, `/calendar/events/:id`, recurrence/participants за scope;
- `/documents`, `/documents/:id`, versions, ACL, submit/publish/archive/acknowledge;
- `/knowledge/articles`, slug/detail, versions, publish/archive/acknowledge;
- `/announcements`, `/announcements/:id`, draft/publish/schedule/archive/read-state;
- `/employees`, `/employees/:id` як safe projections поверх users/lifecycle;
- `/lifecycle/processes`, offboarding commands/steps;
- `/messages/threads`, `/messages/threads/:id/messages`;
- `/comments` scoped by entity reference;
- `/notifications`, read/unread/preferences;
- `/search` із type/company filters і permission-safe snippets;
- `/files` upload/status/download/replace endpoints;
- `/analytics` лише allowlisted aggregate reports;
- `/saved-views` only owner-managed.

Create task/request/event/document/announcement зі scope `all` відхиляється без конкретного company/audience. Detail endpoint не залежить від active frontend list filter, лише від реального permission.

### 7.4 Admin API

| Group | Ключові команди |
|---|---|
| `/admin/users` | create, update safe profile, company access, role assignment, deactivate/reactivate |
| `/admin/users/:id/security` | summary без secret, sessions, failed-login state |
| `/admin/users/:id/password-reset` | create one-time reset після re-auth/identity verification |
| `/admin/users/:id/mfa-reset` | separate high-risk flow |
| `/admin/users/:id/unlock` | unlock only, без password/role changes |
| `/admin/credential-reset-approvals` | initiate/approve/cancel full-admin two-person reset |
| `/admin/companies` | create/update/deactivate з impact preview |
| `/admin/roles` | create/version/diff/publish/archive |
| `/admin/access-preview` | same policy engine, no impersonation |
| `/admin/security-policy` | versioned settings й effective date |
| `/admin/audit` | permission-scoped list/detail/export job |
| `/admin/system` | request types/routes/templates/directories/notification defaults/jobs/retention |

Bulk user import endpoint відсутній. Generic endpoint для прямого редагування permissions JSON або arbitrary Prisma model відсутній.

### 7.5 File API

Upload складається з metadata initiation/multipart receive та asynchronous scan. Download завжди через authorized endpoint або короткоживучий signed token з exact file/user/action scope. Storage key/path не повертається frontend.

API підтримує range/stream для дозволеного preview/download, але не читає весь великий файл у memory. `Content-Disposition`, MIME sniffing, CSP/sandbox для preview і safe filename обов’язкові.

## 8. Domain workflows і transaction boundaries

### 8.1 Задачі

- status transitions відповідають frontend-ТЗ;
- assignee/company permission перевіряється під час create/reassign;
- checklist, dependency і status versioned;
- dependency cycle заборонений;
- recurring task occurrence має unique idempotency key;
- archive не видаляє comments/files/history;
- пов’язані request/document/event/process мають symmetric entity links;
- low-risk watcher/read changes можуть бути optimistic на frontend, але backend залишається source of truth.

### 8.2 Заявка `Відсутність`

Submit transaction:

1. перевіряє author/company/type version і required fields;
2. нормалізує dates/timezone та holiday calendar;
3. перевіряє approver route й absence conflicts;
4. створює immutable `RequestSnapshot vN`;
5. зберігає private HR detail окремо;
6. фіксує route version/current approval step;
7. переводить status draft → submitted/pending;
8. створює audit і outbox events;
9. commit-иться до notification/effect processing.

Approver decision:

- приймає expected request version та idempotency key;
- approver бачить/погоджує саме snapshot version;
- stale version → 409, без рішення;
- author не approve-ить own request без явної policy;
- return/reject потребує comment;
- delegation не створює cycle і не розширює scope;
- unique constraint/idempotency не дозволяє подвійне рішення.

Final approval atomically фіксує decision і створює `ApprovalEffect`/outbox. Calendar event, privacy-safe presence, linked tasks і notifications виконуються idempotent jobs. Partial effect failure не скасовує людське рішення й не просить approve повторно; UI бачить кожний effect state та retry/escalation.

### 8.3 Documents і knowledge

- file спочатку quarantine;
- document version immutable після submit;
- publish pointer змінюється transactionally;
- approval прив’язаний до exact version;
- ACL/audience перевіряються на list/detail/download/search;
- acknowledgement прив’язаний до version; нова суттєва version може створити нову requirement;
- archive не видаляє version/file до retention/dependency check;
- private file не стає public через derivative/preview.

### 8.4 Оголошення

Статуси: draft → scheduled/published → ended → archived.

- draft editable by owner/permission;
- publish потребує `announcements.publish`, specific audience і optional schedule;
- audience preview рахується тим самим resolver, що реальна доставка;
- publish transaction фіксує content version, audience definition, audit і outbox;
- receipt generation/delivery idempotent;
- direct read повторно перевіряє effective audience та current company access;
- expiry прибирає announcement з active dashboard, але не hard-delete;
- суттєве edit published content створює new version/audit diff; re-mark unread тільки після explicit command;
- announcement не виконує mandatory legal acknowledgement.

### 8.5 Offboarding

- process створюється з immutable template version;
- кожний operational step створює real Task;
- dependencies/owners/due dates не є decorative checklist;
- access revocation, equipment returns and final documents have explicit state;
- offboarding revoke sessions/accesses transactionally або через критичний idempotent effect;
- завершення блокується, якщо active ownership/approver references не передані;
- deactivation не hard-delete-ить User або UsernameReservation;
- ownership transfer має impact report і audit.

### 8.6 Chat і comments

- user може читати thread лише як active participant або authorized entity participant;
- context thread не успадковує ширші права, ніж entity;
- add participant перевіряє company/entity access;
- message/comment body validate-иться, sanitized at rendering boundary і не виконується як HTML/script;
- edit залишає edited metadata; delete — tombstone;
- attachment проходить загальний file pipeline;
- message-to-task/document link створюється explicit command із permission;
- unread/read pointer idempotent і не створює notification storm.

### 8.7 Notifications

In-app notification — обов’язковий MVP channel. Email adapter optional і ніколи не використовується для login/reset.

- outbox гарантує, що committed business event не губиться між transaction і notification;
- `dedupeKey` не дозволяє дубль при retry;
- safeTitle/safeSnippet формуються за recipient permission, а не з raw entity body;
- action-required notification не очищується лише через mark read;
- quiet mode/digest не затримує mandatory security event у in-app center;
- якщо access revoke-нуто, notification deep link повертає 403/privacy 404 і не показує cached snippet понад дозволене.

## 9. Files і local storage

### 9.1 Storage adapter

MVP використовує local persistent filesystem через `FileStoragePort`, щоб пізніше можна було підключити S3-compatible storage без зміни domain services.

- bytes лежать поза repo й SQLite у configured persistent directory;
- path будується з opaque workspace/company/file IDs, не original filename;
- temp upload і quarantine відокремлені від clean storage;
- atomic move/rename використовується в межах одного volume;
- directory traversal і symlink escape блокуються;
- file permissions мінімальні для service account;
- frontend ніколи не отримує physical path.

### 9.2 Upload pipeline

1. перевірити auth, permission, company, declared size/type;
2. stream upload у temp/quarantine з hard size limit;
3. обчислити SHA-256 і detected MIME/magic bytes;
4. створити `FileObject` зі state `QUARANTINED`;
5. enqueue scan/metadata/preview job;
6. після clean result атомарно змінити storage/status;
7. infected/unsupported file ізолювати, не видавати download URL і показати safe error;
8. link до entity створити лише в дозволеному state або як pending attachment за policy.

Filename, extension і client MIME не є trusted. Archive bomb, executable content, SVG/script, macros і unsupported formats обробляються allowlist/policy. ClamAV або сумісний scanner підключається adapter-ом; якщо production scanner unavailable, файл лишається quarantined, а не автоматично clean.

### 9.3 Preview/download

- authorization перевіряється кожного разу;
- confidential download може створювати audit;
- preview active content sandboxed/converted;
- unsafe office/PDF preview не виконується в API process;
- image derivative зберігає ACL source file;
- signed token короткоживучий, one action/file/user, revocable через authorization version;
- expired token → 410/403 без physical path.

### 9.4 Backup scope

Backup manifest пов’язує SQLite snapshot і file-storage snapshot. Відновлення лише database без відповідних files або files без metadata не вважається успішним restore.

## 10. Persistent jobs і outbox без Redis

### 10.1 Job runner

`BackgroundJob` у SQLite є durable source of truth. Processor може працювати всередині `apps/api` як bounded worker loop; окремий process допускається лише на тому самому host/volume і після concurrency tests.

- job states: queued, running, succeeded, failed, cancelled;
- atomic claim через short transaction і lease;
- expired lease повертає job до retryable state;
- concurrency мала й configurable, default орієнтований на один SQLite writer;
- exponential backoff + jitter;
- max attempts і dead-letter/failed state;
- progress update rate-limited, щоб не створювати зайві writes;
- payload мінімальний; large/private body зберігається за entity reference;
- handler idempotent за job/idempotency key;
- graceful shutdown перестає claim-ити jobs і звільняє/дочікується current lease без data loss.

Jobs: notifications, announcement schedule/audience receipts, approval effects, document preview, malware scan, export, analytics precompute, recurring tasks, reminders, retention batches, search indexing. Bulk user import job відсутній.

### 10.2 Transactional outbox

Business transaction пише aggregate change, audit і `OutboxEvent` разом. Dispatcher перетворює outbox на jobs/notifications після commit. Event processed marker/idempotency не дозволяє дубль.

Заборонено викликати scanner, filesystem-heavy preview, optional email або long analytics всередині request transaction.

### 10.3 Scheduling

Scheduler використовує UTC `runAt`, timezone rules зберігає source entity. Після restart overdue jobs claim-яться контрольовано, без масового duplicate burst. Scheduled announcement, reminder, recurrence й retention мають unique occurrence key.

## 11. Search і analytics

### 11.1 Search

Global search повертає лише safe projections:

- type/id;
- title/safe snippet;
- company label;
- status;
- permitted route.

Search index partitioned by workspace/company/type і не індексує private HR comment, security metadata, hidden chat, password/credential data або quarantined file content. Direct result click повторно перевіряє permission; index hit не є authorization.

FTS update відбувається idempotent job/outbox. Reindex доступний admin job із progress, не блокує API. Search query rate-limited, max length/token count bounded.

### 11.2 Analytics

- тільки process/aggregate metrics із frontend-ТЗ;
- permission і company scope застосовуються до source rows до aggregation;
- small reports можуть рахуватися query-time з indexes;
- великі періоди precompute-яться background job;
- не створювати hidden employee surveillance metrics;
- export — background job із expiry й audit;
- private comments/chat content не входять в analytics.

## 12. Audit, retention і privacy

### 12.1 Audit events

Обов’язково фіксуються:

- login success/failure/lock/unlock, 2FA/session events;
- create/deactivate/reactivate user;
- username change/reservation;
- password/MFA reset, two-person approval і break-glass;
- role, permission, company access, ACL і security policy changes;
- submit/approve/return/reject/delegate/cancel/force-complete;
- publish/archive document/article/announcement;
- sensitive view/download/export;
- background critical effect/result;
- retention policy/legal hold/purge;
- backup/restore verification result.

Audit містить actor, target, action, result, reason, safe diff, timestamp, correlation ID. Він не містить secret, raw password, TOTP, recovery code, complete private body, file bytes або access token.

### 12.2 Retention defaults

| Категорія | Default |
|---|---:|
| Active tasks/requests/lifecycle | Поки active |
| Archived tasks/requests/processes | 5 років |
| Published documents/versions | 7 років після archive/supersede |
| Abandoned unpublished drafts | 180 днів inactive |
| Knowledge/announcements | 3 роки після archive |
| Chat/comments | 2 роки після last activity |
| In-app notifications | 180 днів |
| Credential/access/role/export audit | 5 років |
| Other audit | 3 роки |
| Closed session/login metadata | 180 днів |
| Export file | 24 години; metadata 180 днів |
| Job payload/error detail | 30 днів; safe metadata 180 днів |

Defaults конфігуровані versioned policy, але зміна потребує permission, re-auth, impact preview, effective date й audit. Legal hold зупиняє purge exact scope. Purge batch idempotent, має dry-run report, dependency check і result audit.

Temporary credential plaintext ніколи не є retention category: зберігається лише hash до consume/expiry. Local frontend drafts регламентуються frontend-ТЗ й очищуються при logout/deactivation для sensitive content.

### 12.3 Privacy

- data minimization у DTO/log/search/notification;
- IP/location зберігаються лише приблизно й retention-limited;
- employee photo/contact visibility permission-scoped;
- HR private detail окремо від general request;
- admin config access не дорівнює HR content access;
- support bundle redacts usernames where unnecessary, secrets, paths і private body;
- production fixtures не використовують реальних людей.

## 13. SQLite backup, restore і disaster recovery

### 13.1 Цілі

- RPO ≤ 1 година для database і file metadata/content;
- RTO ≤ 4 години;
- backups encrypted і зберігаються окремо від active volume;
- database snapshot і files мають один backup manifest/correlation ID.

### 13.2 Безпечний snapshot

Не копіювати live `.db` навмання без урахування WAL/SHM. Використовувати SQLite online backup API або контрольований `VACUUM INTO`/checkpoint procedure, протестований із фактичним Prisma/driver setup. Backup job:

1. перевіряє free disk space;
2. створює consistent database snapshot;
3. snapshot-ить file store/manifest;
4. обчислює checksums;
5. шифрує/передає в separate backup location;
6. запускає integrity check на копії;
7. записує safe backup audit/metric;
8. застосовує rotation.

Baseline rotation: щонайменше 30 daily і 12 monthly copies або еквівалентна policy, що виконує RPO/RTO. Backup failure створює technical alert. Production restore test на staging проводиться регулярно, рекомендовано щоквартально, і доводить: migrations, login, permissions, files, audit і ключовий request flow.

### 13.3 Restore runbook

Restore не виконується через звичайний admin UI. Runbook включає stop writes, preserve failed volume, verify backup checksum, restore DB/files, apply compatible migrations, integrity check, smoke tests, rotate session/secret as required, reopen traffic й зафіксувати incident audit.

## 14. Application security

### 14.1 Transport і browser boundary

- TLS terminate-иться на trusted reverse proxy; production HTTP redirect-иться на HTTPS;
- proxy trust налаштований exact, а не для будь-якого forwarded header;
- Secure/HttpOnly/SameSite cookies;
- CSRF token/origin verification для mutations;
- strict CORS allowlist;
- CSP, HSTS, frame, content-type, referrer і permissions headers;
- request body/query/header limits;
- multipart limits до запису large body;
- API й frontend не розкривають framework/version banners без потреби.

### 14.2 Input і output

- runtime DTO validation з allowlist/transform rules;
- unknown dangerous fields відхиляються, mass assignment заборонений;
- Prisma parameterization; raw SQL лише centralized і parameterized;
- output encoding виконує frontend, але backend не зберігає/повертає unsafe active HTML без sanitizer/content policy;
- URL/open redirect тільки allowlisted internal paths;
- IDs, pagination cursors і signed tokens validate-яться;
- error response не містить stack/SQL/path/secret/private payload.

### 14.3 Secrets і encryption

- `.env.example` містить names, не values;
- production secrets приходять із environment/secret files/manager і не комітяться;
- окремі keys для session signing, TOTP encryption, file link signing та optional data encryption;
- key version зберігається поруч із encrypted value для rotation;
- startup fails closed, якщо critical secret слабкий/відсутній;
- SQLite file, backup і file storage мають OS/disk encryption та restrictive permissions;
- secrets ніколи не потрапляють у structured logs, traces, metrics або crash report.

### 14.4 Abuse protection

- rate limits для login, 2FA, reauth, search, upload, export і admin reset;
- progressive delay й bounded account lock;
- account unlock окрема audited action;
- idempotency для duplicate mutation;
- file quota/size/type limits;
- export/download expiry;
- background queue backpressure;
- dependency/security scanning у CI;
- production admin/security operations можуть вимагати recent re-auth навіть за active session.

Security baseline звіряється з OWASP Authentication, Authorization, Session Management, File Upload і Logging Cheat Sheets. Усі authorization decisions приймаються server-side.

## 15. Observability і health

### 15.1 Logs/traces/metrics

Structured logs містять:

- timestamp, level, service/build version;
- route pattern, method, status, latency;
- correlation ID;
- principal/workspace/company IDs лише де це потрібно й дозволено;
- error code/class без private payload.

Не логувати raw request body за замовчуванням. Auth, HR, chat, file content і security endpoints мають explicit redaction/no-body policy.

Метрики:

- request count/error/latency p50/p75/p95;
- auth failures/lockouts без username labels високої cardinality;
- Prisma query latency/count і `SQLITE_BUSY` retry/failure;
- WAL size/checkpoint duration;
- job queue depth, oldest age, success/failure/retry;
- outbox lag;
- notification delivery;
- file scan/preview status;
- backup age/result;
- storage/free space;
- event-loop lag/memory.

### 15.2 Health endpoints

- liveness: process/event loop живий, без важких dependency checks;
- readiness: migrations/schema compatible, SQLite read/write probe без destructive data, storage dirs writable, critical secret/config valid, job processor state;
- detailed health доступний лише internal/authorized scope;
- public health не повертає paths, versions, queue payload або database info.

Graceful shutdown перестає приймати traffic/jobs, завершує bounded active requests, закриває Prisma/storage handles і залишає recoverable job lease.

## 16. Performance і reliability budgets

Backend budgets мають підтримувати frontend p75 targets:

| Операція | Ціль p75 за нормального dataset |
|---|---:|
| Auth/session check | ≤ 100 ms server time |
| Indexed list first page | ≤ 300 ms |
| Entity summary/detail | ≤ 400 ms без file bytes |
| Search first results | ≤ 700 ms |
| Low-risk mutation | ≤ 500 ms |
| Submit/approve transaction | ≤ 800 ms без async effects |
| Job claim/update | без постійного lock contention |

Це budgets, не обіцянка ігнорувати integrity. Scanner, preview, export, analytics, notification fan-out та approval effects не виконуються синхронно в HTTP request.

Reliability:

- idempotency й unique constraints захищають від duplicate;
- transaction не містить external side effect;
- outbox не губить committed effect;
- stale entity version → 409;
- SQLite busy → bounded retry/control error;
- disk-full/read-only startup/runtime має safe error й alert;
- partial module failure не пошкоджує core records;
- no silent catch/log-and-continue для critical mutation.

### SQLite capacity boundary

README/runbook чесно фіксує: одна writable instance, local persistent disk, bounded job concurrency. Метрики мають сигналізувати, коли SQLite стає вузьким місцем: тривалий busy rate, growing write latency/WAL, queue lag, потреба в multi-instance або складній аналітиці. Міграція на іншу database є окремим майбутнім проєктом; у MVP не підтримувати дві database одночасно.

## 17. Testing strategy

### 17.1 Unit tests

Покривають:

- username normalization/reservation;
- password/temporary credential policy;
- permission/company/ACL decisions;
- role protection й last-admin invariants;
- approval state machine/version/idempotency;
- announcement audience resolver;
- recurrence, timezone, SLA/holiday calculations;
- retention/legal hold decisions;
- notification safe projection;
- job retry/lease logic.

### 17.2 Integration tests

Використовують isolated temporary **file-based SQLite**, Prisma migrations і real repository; in-memory mock не замінює SQLite behavior.

- migration from empty DB;
- foreign/unique constraints;
- WAL/concurrent reader-writer and bounded busy behavior;
- transaction rollback;
- authorization query isolation;
- FTS permission-safe indexing;
- append-only audit guard;
- job claim/recovery after simulated crash;
- local file quarantine/clean/infected states;
- backup snapshot + restore + integrity check.

Кожний test має власний DB/file directory, очищений після run; production paths не використовуються.

### 17.3 API E2E

Обов’язкові flows:

1. bootstrap/seed test environment;
2. nickname-only login; contact email rejected;
3. first-login temporary credential не відкриває business endpoint;
4. password change + 2FA + session rotation;
5. admin reset revokes sessions і не resets 2FA;
6. full-admin reset потребує second approver або break-glass path;
7. reserved username не перевидається;
8. company scope не витікає через list/detail/search/count/export/notification;
9. Maria creates absence, Andrii returns v1, Maria submits v2, Andrii approves, effects execute once;
10. private HR comment не потрапляє manager/calendar/search/log;
11. announcement audience, schedule, read і archive;
12. document quarantine → clean → permissioned download;
13. offboarding revokes access і блокується без ownership transfer;
14. 403/privacy 404/409/410/429/500 problem responses;
15. duplicate request/idempotency produces one business result.

### 17.4 CLI tests

`admin:create` тестується для empty DB, validation failure, transaction rollback, repeated run, existing admin, masked/no-secret output і required 2FA flag. `admin:recover` тестується без запису secret у log, із session revoke/audit і refusal при невиконаних preconditions.

### 17.5 Contract і security tests

- generated OpenAPI не має undocumented critical routes;
- frontend contracts compile against backend DTO;
- forbidden Prisma fields не входять у JSON snapshots;
- CSRF/CORS/cookie/security headers перевіряються;
- path traversal, oversized upload, fake MIME, XSS payload і unauthorized IDOR cases;
- rate-limit behavior без account enumeration;
- dependency audit/scanning;
- no real secrets/PII у fixtures/snapshots.

Root/workspace scripts `lint`, `typecheck`, `test`, `test:e2e`, `build` завершуються non-zero при failure. Release не проходить лише за ручним smoke test.

## 18. Deployment і operations

### 18.1 Production topology

Baseline:

- один NestJS API/worker process або один deployment replica;
- reverse proxy/TLS;
- persistent volume для SQLite;
- persistent volume для file storage;
- separate encrypted backup destination;
- React static build або same-origin web server;
- process supervisor/container restart policy;
- monitoring/alerting.

Заборонено deploy SQLite database на ephemeral serverless filesystem або запускати кілька writable replicas над одним network-mounted file.

### 18.2 Configuration

`.env.example` і config validation описують щонайменше:

- runtime environment/port/trusted proxy/origins;
- SQLite URL/path;
- file/temp/quarantine directories;
- session cookie/timeouts;
- password/TOTP/session signing/encryption secret references;
- rate limits;
- upload limits/allowed types;
- scanner adapter;
- job concurrency/poll/lease;
- retention/backup paths/schedule;
- logging/observability endpoints;
- frontend base URL.

Config startup validation показує назву відсутнього parameter, але не його value. Production не використовує development defaults для secrets, cookie security або database path.

### 18.3 Deployment sequence

1. `npm ci` у root;
2. generate Prisma Client;
3. lint/typecheck/tests/build;
4. перевірити backup/restore point;
5. `prisma migrate deploy` на одному release job/process;
6. запустити API з readiness false;
7. verify database/storage/config;
8. readiness true й переключення traffic;
9. post-deploy auth/permission/file/job smoke;
10. monitor error/SQLite busy/WAL/job lag.

Migration failure не запускає старий/новий mixed process поверх невідомої schema. Для destructive migration потрібні expand/migrate/contract або maintenance window, backup і verification.

### 18.4 Operational docs

README/runbooks:

- local dev і npm workspaces commands;
- migrations/seed;
- `admin:create` і break-glass;
- backup/restore;
- rotate secrets;
- disk full/WAL growth/SQLite busy;
- scanner unavailable/quarantine backlog;
- job retry/dead letter;
- user credential/security incident;
- upgrade dependencies/Node/Prisma;
- move to another host/volume;
- known SQLite single-writer boundary.

## 19. Definition of Done

Backend не готовий, доки не виконані всі умови:

### Реалізація

- npm workspaces monorepo працює одним root lockfile;
- `apps/api` NestJS build без TypeScript errors;
- Prisma schema/migrations створюють SQLite з усіма constraints/indexes;
- CLI першого admin працює з empty DB і безпечними prompts;
- auth/session/TOTP/reset/two-person/break-glass реалізовані;
- RBAC/company/ACL/field confidentiality enforced server-side;
- tasks, requests/approvals, calendar/presence, files/documents, knowledge, announcements, lifecycle, chat, notifications, search, audit і jobs мають real persistence;
- transactional outbox та durable job recovery працюють після restart;
- file quarantine/scan/download permission працюють;
- retention/legal hold/purge і backup/restore наявні;
- OpenAPI й shared contracts актуальні;
- no bulk user import, impersonation, teams/departments або customer CRM.

### Перевірки

- lint/typecheck/unit/integration/E2E/security/CLI tests успішні;
- migrations перевірені з empty DB і upgrade fixture;
- SQLite concurrency/busy поведінка протестована;
- double submit/approve не створює duplicate;
- company isolation перевірена для list/detail/search/count/export/file/notification;
- private HR/security data не витікає;
- backup відновлено у fresh directory і пройдено smoke;
- production config validation відхиляє insecure/missing secrets;
- build/run не потребують ручного редагування generated files.

### Фінальна передача Codex

У відповіді й README вказати:

- workspace structure та точні npm commands;
- Node/Nest/Prisma/SQLite versions;
- migration і seed status;
- точну команду створення першого адміністратора;
- demo accounts лише для development;
- auth/session/file/job/backup design;
- OpenAPI location;
- усі виконані tests;
- production deployment assumptions, особливо один writable SQLite instance;
- відомі обмеження й adapter points для майбутнього storage/database migration.

Не завершувати роботу словами «backend готовий», якщо auth усе ще mock, data in-memory, Prisma migration відсутня, job губиться після restart, files публічні або backup не перевірено restore-тестом.
