# BERT CRM architecture

## Форма системи

BERT CRM — npm-workspaces modular monolith. `apps/web` є React/Vite client, `apps/api` — єдиний writable NestJS API та bounded worker, `packages/contracts` — framework-neutral transport boundary. Production використовує одну SQLite writer instance на локальному persistent volume та окремий локальний file store.

Залежності спрямовані всередину: React routes використовують shared API/UI helpers і contracts; Nest controllers делегують application services; services володіють transaction boundaries; Prisma, filesystem, cryptography та scanner є infrastructure boundary. Contracts не імпортують код applications.

## Модулі

- Identity: auth, password/TOTP lifecycle, opaque sessions, users, одна організація, рекурсивна структура підрозділів, roles та authorization.
- Work: collaborative tasks/participants/checklist/relations/reminders/recurrence/time, calendar/presence та onboarding/offboarding.
- Content: documents/files, knowledge, announcements, contextual chat/comments і notifications.
- Platform: локальні пошуки модулів, analytics, append-only audit/export, durable jobs/outbox, retention/legal hold, backup/restore та health/observability.

Cross-module effect починається з outbox/job reference, записаного поряд з aggregate та audit. Worker перетворює effect на idempotent durable job після commit. Scanner, filesystem-heavy export/preview та async notification не виконуються в business transaction.

## Transaction boundaries

- Login створює/ротує session лише після password та optional second-factor verification.
- Absence submit атомарно пише snapshot, encrypted private HR detail, approval attempt, audit та outbox.
- Approval атомарно пише version-checked decision, audit і effect records; пізніший effect failure не відкочує рішення людини.
- Announcement publish фіксує audience/version та materialization event; receipts створює worker.
- Task create атомарно пише canonical task, participant roles, checklist, tags, relations, reminders, recurrence, staged file links, idempotency record, audit та outbox. Файл до commit лишається в наявному quarantine lifecycle.
- Deactivation і credential reset відкликають sessions та змінюють authorization version у тому самому logical operation.
- Retention purge виконується лише після dry-run/re-auth, повторно обчислює eligible rows і виключає active exact-scope legal holds.

## Реальні adapter boundaries

- `apps/api/src/modules/files/storage.ts`: quarantine/clean local storage boundary; може бути замінений object-storage implementation без зміни controller contract.
- `MALWARE_SCANNER`: development-clean лише для development; production використовує реальний scanner adapter або fail-closed `unavailable`.
- Prisma services: persistence boundary для майбутнього переходу з SQLite на server database.
- `EMAIL_ADAPTER` і `OTEL_EXPORTER_OTLP_ENDPOINT`: optional delivery/telemetry integrations; in-app persistence не залежить від них.
- backup scripts: encrypted destination boundary, який production scheduler може передавати в окремий volume/off-host storage.

## Security boundary

List/detail/mutation/search/notification/file операції спочатку визначають authenticated principal, потім workspace, module capability та record ACL/participation і лише після цього safe projection. Усі активні компанії одного workspace є доступними як організаційні групи, а не security scopes. Задачу читають лише її creator/reporter/active participants і адміністратор; чат — active participants і адміністратор; сповіщення — лише одержувач. Організаційна структура є рекурсивним деревом `компанія → підрозділ → підрозділ`. API problems відповідають RFC 9457 і не повертають stack, SQL, secret, physical path або private payload.

`companyId` лишається persistence key і зручним фільтром/контекстом створення, але не надає й не забирає доступ усередині workspace. Auth principal отримує всі активні company IDs; неактивні компанії залишаються видимими лише адміністраторам. Публічний каталог `/companies` та об’єднана сторінка `/organization` показують цей поділ без глобального перемикача в shell.

Structured request logs містять correlation ID, safe route pattern, status і latency без body/query values. Detailed health/metrics захищений `system.manage`; public liveness/readiness не розкриває DB/file paths або queue payload.

Task controller делегує нові write/read flows у `TaskCommandService`, `TaskQueryService` та вузькі hierarchy/participants/checklist/relations/reminders/recurrence/time/catalog/attachments services. `TaskCompatibilityService` із thin `TasksService` re-export підтримує наявні list/detail consumers під час поступової міграції, але не вводить другий task aggregate.
