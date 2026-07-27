# BERT CRM architecture

## Форма системи

BERT CRM — npm-workspaces modular monolith. `apps/web` є React/Vite client, `apps/api` — єдиний writable NestJS API та bounded worker, `packages/contracts` — framework-neutral transport boundary. Production використовує одну SQLite writer instance на локальному persistent volume та окремий локальний file store.

Залежності спрямовані всередину: React routes використовують shared API/UI helpers і contracts; Nest controllers делегують application services; services володіють transaction boundaries; Prisma, filesystem, cryptography та scanner є infrastructure boundary. Contracts не імпортують код applications.

## Модулі

- Identity: auth, password/TOTP lifecycle, opaque sessions, users, одна організація, рекурсивна структура підрозділів, roles та authorization.
- Work: tasks/checklist/recurrence, requests/approvals, calendar/presence та onboarding/offboarding.
- Content: documents/files, knowledge, announcements, contextual chat/comments і notifications.
- Platform: search, analytics, append-only audit/export, durable jobs/outbox, retention/legal hold, backup/restore та health/observability.

Cross-module effect починається з outbox/job reference, записаного поряд з aggregate та audit. Worker перетворює effect на idempotent durable job після commit. Scanner, filesystem-heavy export/preview та async notification не виконуються в business transaction.

## Transaction boundaries

- Login створює/ротує session лише після password та optional second-factor verification.
- Absence submit атомарно пише snapshot, encrypted private HR detail, approval attempt, audit та outbox.
- Approval атомарно пише version-checked decision, audit і effect records; пізніший effect failure не відкочує рішення людини.
- Announcement publish фіксує audience/version та materialization event; receipts створює worker.
- Deactivation і credential reset відкликають sessions та змінюють authorization version у тому самому logical operation.
- Retention purge виконується лише після dry-run/re-auth, повторно обчислює eligible rows і виключає active exact-scope legal holds.

## Реальні adapter boundaries

- `apps/api/src/modules/files/storage.ts`: quarantine/clean local storage boundary; може бути замінений object-storage implementation без зміни controller contract.
- `MALWARE_SCANNER`: development-clean лише для development; production використовує реальний scanner adapter або fail-closed `unavailable`.
- Prisma services: persistence boundary для майбутнього переходу з SQLite на server database.
- `EMAIL_ADAPTER` і `OTEL_EXPORTER_OTLP_ENDPOINT`: optional delivery/telemetry integrations; in-app persistence не залежить від них.
- backup scripts: encrypted destination boundary, який production scheduler може передавати в окремий volume/off-host storage.

## Security boundary

List/detail/mutation/search/notification/file операції спочатку визначають authenticated principal, потім єдиний organization scope, record ACL/participation і лише після цього safe projection. Організаційна структура є рекурсивним деревом `підрозділ → підрозділ`; вона не створює окремих tenant або company scopes. System administration не надає автоматичного доступу до private HR/chat/document fields. API problems відповідають RFC 9457 і не повертають stack, SQL, secret, physical path або private payload.

`companyId` тимчасово лишається внутрішнім persistence key для сумісності з наявними таблицями та історичними міграціями. Це не продуктове поняття: API завжди резолвить його в один primary organization record, відхиляє інші legacy ID, не підтримує `company=all`, а web-клієнт не показує перемикач і не зберігає company scope в URL.

Structured request logs містять correlation ID, safe route pattern, status і latency без body/query values. Detailed health/metrics захищений `system.manage`; public liveness/readiness не розкриває DB/file paths або queue payload.
