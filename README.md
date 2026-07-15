# BERT CRM

BERT CRM — внутрішній operations workspace для задач, заявок і погоджень, календаря, документів, knowledge base, оголошень, lifecycle-процесів та адміністрування доступів. Це npm-workspaces monorepo з одним NestJS API/worker, React-клієнтом і спільними runtime-контрактами.

## Вимоги та стек

- Node.js 24+ і npm 11+;
- React 19, Vite 8, TypeScript 6;
- NestJS 11;
- Prisma 7.8, SQLite через `better-sqlite3`;
- один writable API/worker process і локальні persistent volumes для SQLite та файлів.

## Структура

```text
apps/
  api/                 NestJS API, bounded worker, Prisma, CLI та operations scripts
  web/                 React/Vite SPA, Playwright і локальні static assets
packages/
  contracts/           DTO, Zod schemas, permissions, statuses і RFC 9457 contracts
docs/
  architecture.md
  decisions.md
  implementation-checklist.md
  operations-runbook.md
  assets-manifest.md
artifacts/openapi.json  generated OpenAPI artifact
```

## Локальний запуск

```bash
npm ci
npm run prisma:generate
npm run prisma:deploy
npm run prisma:seed
npm run dev
```

Web: `http://localhost:5173`. API: `http://localhost:3000/api/v1`. Swagger UI: `http://localhost:3000/api/v1/openapi`.

`prisma:seed` дозволений тільки поза production. Development accounts: `maria`, `andrii`, `olena`, `dmytro`, `marko`; пароль задає `DEMO_SEED_PASSWORD` (у `.env.example` наведене лише development-значення). Production build не має demo fallback і не показує credentials.

## Перший адміністратор

На чистій мігрованій БД виконайте інтерактивну команду в захищеному TTY:

```bash
npm run bert -- admin:create
```

Команда одноразова, не приймає пароль через argv і створює workspace, першу company, full-admin role, user, Argon2id credential та audit event однією транзакцією. Аварійне відновлення останнього адміністратора описане в [operations runbook](docs/operations-runbook.md) і запускається лише як `npm run bert -- admin:recover` з налаштованим `BREAK_GLASS_SECRET_HASH`.

## Команди

```bash
npm run dev                 # web + API
npm run build               # contracts + API + production web
npm run lint
npm run typecheck
npm run test                # unit + component/contract + CLI guards
npm run test:integration    # migrations, SQLite guards
npm run test:e2e            # API workflows + Playwright desktop/mobile/axe
npm run prisma:deploy
npm run prisma:seed         # development only
npm run openapi             # artifacts/openapi.json
npm run backup
npm run restore:verify -- <optional-backup-directory>
```

Кореневий `npm run quality` починається з `npm ci` і перевіряє lockfile consistency, Prisma generation, lint, typecheck, tests та build. API E2E і browser E2E запускаються окремою командою `npm run test:e2e`.

## Дані, security та operations

- Opaque HttpOnly/SameSite sessions, CSRF, rotation/revocation, Argon2id, first login, TOTP/recovery codes і recent re-auth.
- Server-side RBAC, company scope, document ACL, participant checks і окрема encrypted private HR projection.
- Durable SQLite jobs/outbox з lease recovery, backoff та idempotency; рішення погодження не відкочується через помилку async effect.
- Upload спочатку потрапляє в quarantine; download можливий лише після scanner result `CLEAN` та повторної authorization-перевірки.
- Audit append-only на рівні SQLite triggers; export генерується background job-ом у захищений file store.
- Retention має versioned policies, impact dry-run, exact-scope legal hold, recent re-auth та idempotent batch purge.
- Backup використовує SQLite online backup API, AES-256-GCM, єдиний DB/files manifest, SHA-256 та rotation; restore verification працює у fresh directory.

Повна production topology, deploy/rollback, backup/restore, disk/WAL/job/scanner incidents, secret rotation і migration assumptions наведені в [docs/operations-runbook.md](docs/operations-runbook.md).

## Межі SQLite та adapter points

Production topology — один writable process над локальним диском. Заборонені кілька writable replicas, ephemeral/serverless filesystem і network-mounted shared SQLite. Коли стале навантаження наближається до меж single-writer або потрібні multi-region/high-write сценарії, Prisma persistence boundary мігрує на server database. Файлова межа ізольована в `apps/api/src/modules/files/storage.ts`; scanner, email/telemetry і backup destination задаються configuration adapters.

Generated Prisma Client не редагують вручну. Міграції створюються через Prisma, а production застосовує лише `prisma migrate deploy` після перевіреного backup/restore point.
