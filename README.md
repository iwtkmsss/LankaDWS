# LankaDWS

LankaDWS — внутрішній operations workspace із capability-gated Живою стрічкою, задачами, заявками й погодженнями, календарем, документами, knowledge base, оголошеннями, lifecycle-процесами та адмініструванням доступів. Це npm-workspaces monorepo з одним NestJS API/worker, React-клієнтом і спільними runtime-контрактами.

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

### Local network development

To open the development instance from other devices on the same local network, run:

```bash
npm run dev:public
```

The command loads `.env.public` before it starts either process. Copy `.env.public.example` to the ignored `.env.public`, set `PUBLIC_HOST`, and use `PUBLIC_CLIENT_PORT` and `PUBLIC_SERVER_PORT` to change the default ports (`5173` and `3000`). This is intended only for a trusted local network; it is not a production deployment.

`prisma:seed` дозволений тільки поза production. Development accounts: `maria`, `andrii`, `olena`, `dmytro`, `marko`; пароль задає `DEMO_SEED_PASSWORD` (у `.env.example` наведене лише development-значення). Demo містить одну організацію LankaDWS з рекурсивною структурою підрозділів; «Сервісний відділ» є дочірнім підрозділом «Операцій». Production build не має demo fallback і не показує credentials.

Жива стрічка не дублює робочі сутності: авторські публікації є `FeedPost`, а картки задач, подій, оголошень і явно поширених файлів щоразу читають і повторно авторизують канонічне джерело. Вкладення використовують спільний файловий карантин/сканер і стають доступними для завантаження лише після стану `CLEAN`. Окрема File-картка з’являється тільки після permissioned «Поширити файл», не зберігає назву/MIME в `FeedItem`, успадковує точну live audience і зникає разом із recipient download access після revoke. Історичні проєкції імпортера мають `countsAsUnread=false`, тому cutover не створює штучну хвилю непрочитаного.

Для кожної публікації користувач обирає «усі коментарі», «лише згадки» або «без сповіщень». Явне вимкнення не скасовується наступним коментарем, а фільтр `FOLLOWING` показує тільки публікації з активною підпискою. Сповіщення створюються без копіювання тексту публікації та лише для чинного адресата її аудиторії.

Розширені фільтри стрічки відкриваються однією компактною панеллю й композиційно поєднують автора, діапазон дат, прямі згадки, робочу групу та точну аудиторію. `groupId` означає контекст групової публікації, а `audienceId` — всю організацію або конкретного одержувача прямого допису. Стан залишається в URL і збережених представленнях; межі дат API обчислює за часовим поясом організації, а списки авторів та аудиторій формуються лише з повторно авторизованих видимих елементів.

Зірка на будь-якій доступній картці зберігає її у приватне «Обране» користувача. Коли допис редагується або канонічна картка задачі/події/оголошення отримує нову проєкцію, активна позначка переноситься на її поточну версію без розширення доступу. Фасета «Важливі публікації» показує всі повідомлення з обов’язковим підтвердженням, тоді як «До підтвердження» залишається окремим inbox лише для ще невиконаних дій. Обидва фільтри композиційні, URL-addressable і підтримуються збереженими представленнями.

## Перший адміністратор

На чистій мігрованій БД виконайте інтерактивну команду в захищеному TTY:

```bash
npm run lankadws -- admin:create
```

Команда одноразова, не приймає пароль через argv і створює workspace, єдину організацію, full-admin role, user, Argon2id credential та audit event однією транзакцією. Аварійне відновлення останнього адміністратора описане в [operations runbook](docs/operations-runbook.md) і запускається лише як `npm run lankadws -- admin:recover` з налаштованим `BREAK_GLASS_SECRET_HASH`.

API, Prisma, CLI та Vite читають виключно `.env` з кореня репозиторію; локальні `apps/*/.env*` не використовуються. Змінні середовища процесу мають вищий пріоритет для production і тестової ізоляції. Команда нижче криптографічно незалежно генерує `SESSION_PEPPER`, `CSRF_SECRET`, `TOTP_ENCRYPTION_KEY`, `FILE_LINK_SECRET`, `BACKUP_ENCRYPTION_KEY`, Argon2id `BREAK_GLASS_SECRET_HASH` і development seed password, після підтвердження записує їх у кореневий `.env`:

```bash
npm run lankadws -- recovery:hash
```

Генератор використовує OS CSPRNG (`crypto.randomBytes`) з 256–384 бітами ентропії на значення. Відкритий installation recovery secret не записується у `.env`: він показується один раз, а в конфігурацію потрапляє лише Argon2id-хеш. Збережіть одноразово показаний secret у password manager, перезапустіть API, а потім запускайте `npm run lankadws -- admin:recover`. Повторний запуск із уже робочими секретами вимагає явного `ROTATE` і попереджає про вплив на sessions, TOTP/private ciphertext та старі backup.

Для локальної development-бази break-glass не потрібен. Наступна команда знаходить єдиного full-admin, встановлює йому постійний `DEMO_SEED_PASSWORD` із `.env`, прибирає локальний 2FA, відкликає старі сесії та друкує готові credentials, не змінюючи CRM-дані:

```bash
npm run lankadws -- admin:dev-reset
```

`admin:dev-reset` жорстко заборонений при `NODE_ENV=production`.

## Формування та перевірка Bitrix migration dataset

Після logical export оператор копіює [приклад seal request](docs/examples/bitrix-snapshot-seal-request.example.json) у захищене Operations-сховище й заповнює лише evidence-backed metadata. Сам request, Ed25519 private key і dataset мають бути трьома окремими absolute paths поза репозиторієм; private key ніколи не передається як текст environment variable.

Для sealing задайте `BITRIX_SNAPSHOT_ROOT`, `BITRIX_MANIFEST_METADATA_PATH` та `IMPORT_SIGNING_PRIVATE_KEY_PATH`, потім виконайте:

```bash
npm run lankadws -- import:seal-manifest
npm run lankadws -- import:seal-manifest --json
```

Команда сама робить bounded inventory, стабільно хешує allowlisted regular files, генерує sorted GNU-compatible `checksums.sha256`, будує та підписує strict manifest v1 і одразу перевіряє результат чинним verifier. Вона створює лише відсутні `checksums.sha256` і `snapshot-manifest.json`, ніколи їх не перезаписує, а повторний запуск на незмінному export повертає той самий manifest SHA-256 без запису. Unsafe/extra entry, link, зміна файла під час hash, неповний contract або невирішений company mapping блокують sealing; newly-created outputs відкочуються, якщо verifier round-trip не пройшов.

Після sealing dataset монтується read-only. Перед будь-яким `VALIDATE`, `DRY_RUN` або майбутнім `APPLY` задайте `BITRIX_SNAPSHOT_ROOT` і trusted Ed25519 public keys у `IMPORT_SIGNING_PUBLIC_KEYS_JSON`, потім виконайте:

```bash
npm run lankadws -- import:validate-manifest
npm run lankadws -- import:validate-manifest --json
npm run lankadws -- import:validate-company-map
npm run lankadws -- import:validate-company-map --json
```

`import:validate-manifest` не запускає NestJS або БД. Вона перевіряє строгий v1 manifest, trusted signature, allowlisted relative paths, розмір і SHA-256 кожного файла, `checksums.sha256`, strict UTF-8 для службових artifacts і signed company mapping.

`import:validate-company-map` спершу повторює ту саму повну перевірку, а тоді read-only звіряє підписаний target workspace/root set з exact active `SourceCompanyMapping` і станом target companies у LankaDWS. Seal і validation reports містять лише safe IDs, відносні шляхи, counters, hashes і стабільні issue codes — без source branch keys/names, company names/codes, approver identity, raw content, PII, private-key material, DB errors чи абсолютного storage path. Успіх повертає exit code `0`, невалідний dataset/DB mapping або seal input — `2`, configuration/runtime error — `1`.

Це лише preflight dataset: команда не закриває DDB-рішення, не імпортує дані й не робить production `APPLY`. Повний контракт описаний у [backend-плані міграції БД](docs/bitrix24-database-migration-plan.md).

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
npm run feed:rehearse -- --profile smoke
npm run feed:rehearse -- --profile representative --iterations 20 --warmup 3
npm run lankadws -- import:seal-manifest [--json]
npm run lankadws -- import:validate-manifest [--json]
npm run lankadws -- import:validate-company-map [--json]
```

Кореневий `npm run quality` починається з `npm ci` і перевіряє lockfile consistency, Prisma generation, lint, typecheck, tests та build. API E2E і browser E2E запускаються окремою командою `npm run test:e2e`.

## Дані, security та operations

- Opaque HttpOnly/SameSite sessions, CSRF, rotation/revocation, Argon2id, first login, TOTP/recovery codes і recent re-auth.
- Server-side RBAC, єдиний organization scope, рекурсивні підрозділи, document ACL, participant checks і окрема encrypted private HR projection.
- Durable SQLite jobs/outbox з lease recovery, backoff та idempotency; рішення погодження не відкочується через помилку async effect.
- Upload спочатку потрапляє в quarantine; download можливий лише після scanner result `CLEAN` та повторної authorization-перевірки.
- Audit append-only на рівні SQLite triggers; export генерується background job-ом у захищений file store.
- Retention має versioned policies, impact dry-run, exact-scope legal hold, recent re-auth та idempotent batch purge.
- Backup використовує SQLite online backup API, AES-256-GCM, єдиний DB/files manifest, SHA-256 та rotation; restore verification працює у fresh directory.

Повна production topology, deploy/rollback, backup/restore, disk/WAL/job/scanner incidents, secret rotation і migration assumptions наведені в [docs/operations-runbook.md](docs/operations-runbook.md).

## Межі SQLite та adapter points

Production topology — один writable process над локальним диском. Заборонені кілька writable replicas, ephemeral/serverless filesystem і network-mounted shared SQLite. Коли стале навантаження наближається до меж single-writer або потрібні multi-region/high-write сценарії, Prisma persistence boundary мігрує на server database. Файлова межа ізольована в `apps/api/src/modules/files/storage.ts`; scanner, email/telemetry і backup destination задаються configuration adapters.

Generated Prisma Client не редагують вручну. Міграції створюються через Prisma, а production застосовує лише `prisma migrate deploy` після перевіреного backup/restore point.
