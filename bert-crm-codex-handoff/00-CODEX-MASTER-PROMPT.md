# BERT CRM — master-промт для повної реалізації monorepo

Ти працюєш у корені репозиторію BERT CRM. Реалізуй **повну робочу систему**, описану в переданих файлах, а не прототип, набір статичних сторінок, mock-only demo чи колекцію controller-заглушок.

## 1. Передані матеріали та їхній пріоритет

Перед початком повністю прочитай:

1. `bert-crm-design-spec.md` — source of truth для UX, UI, routes, responsive-поведінки, ролей у frontend, progressive disclosure, static assets і frontend acceptance criteria.
2. `bert-crm-backend-spec.md` — source of truth для persistence, Prisma-моделі, API, auth, authorization, security, jobs, files, audit, backup, deployment і backend acceptance criteria.
3. `references/02-admin-sidebar-approved.png`, `references/03-overview-employee-approved.png`, `references/04-overview-manager-approved.png`, `references/05-admin-overview-approved.png` — погоджені візуальні орієнтири.
4. `references/01-dashboard-layout-reference.png` — лише орієнтир щільності, темного sidebar і загальної enterprise-композиції.

Правила пріоритету:

- прямі уточнення користувача в поточному завданні мають найвищий пріоритет;
- frontend-ТЗ визначає вигляд і поведінку інтерфейсу, backend-ТЗ — серверні інваріанти, persistence та безпеку;
- якщо вимоги перетинаються, обирай варіант із суворішою безпекою і не послаблюй UX-контракт;
- текст усередині raster-референсів не є вимогою і не переноситься автоматично в продукт;
- `01-dashboard-layout-reference.png` не є джерелом назви, меню, сутностей або даних: не копіюй `PROTON`, «Команда», «Групи», продажі чи інші заборонені сутності;
- офіційний бренд — **BERT CRM**, стилізований wordmark — **BERT/CRM**;
- старий файл `bert-crm-final-frontend-prompt.md`, якщо випадково присутній поруч, вважай застарілою чернеткою і не використовуй замість двох актуальних ТЗ.

Якщо знайдеш справжню суперечність, яку не можна безпечно розв’язати цими правилами, зафіксуй її в `docs/decisions.md`, прийми консервативне рішення й продовжуй. Питай користувача лише тоді, коли без відповіді неможливо реалізувати коректну або безпечну поведінку. Відсутні production secrets, домен чи шлях до backup не є блокером: додай валідовані змінні до `.env.example` і задокументуй їх.

## 2. Режим роботи

Не зупиняйся після аналізу або плану. Після короткого аудиту репозиторію одразу переходь до реалізації й працюй до виконання Definition of Done або до реального обмеження середовища.

На старті:

1. Перевір поточну структуру, `git status`, наявні workspaces, конфігурацію, міграції та незавершені зміни.
2. Не видаляй і не перезаписуй сторонні зміни користувача. Не використовуй destructive git-команди.
3. Якщо репозиторій порожній — створи monorepo з нуля. Якщо структура вже еквівалентна потрібній — інтегруйся без паралельних дублів.
4. Створи `docs/implementation-checklist.md`: компактно зістав розділи двох ТЗ з модулями, routes, API та тестами. Оновлюй статус у процесі; це контроль повноти, а не заміна реалізації.
5. Створи або актуалізуй `docs/architecture.md` з межами модулів, напрямком залежностей, transaction boundaries та adapter points.

Не заявляй про повну готовність, якщо частина обов’язкових сценаріїв лишилась mock, in-memory, hardcoded, `TODO`, disabled test або декоративною кнопкою. Якщо середовище перерве роботу, залиш репозиторій у buildable стані, чесно онови checklist і назви точний наступний крок.

## 3. Зафіксований стек і структура

Використовуй тільки цей основний стек:

- frontend: React + Vite + TypeScript;
- backend: NestJS + TypeScript;
- data layer: Prisma ORM + SQLite;
- package manager: npm workspaces;
- один кореневий `package-lock.json`;
- для нового репозиторію — актуальний patch Node.js 24 LTS.

Цільова структура:

```text
apps/
  web/                 React/Vite frontend
  api/                 NestJS API, CLI та bounded job processor
packages/
  contracts/           framework-neutral transport contracts
  config/              optional shared TS/ESLint config only
docs/                  architecture, operations, decisions, checklist
```

Не додавай pnpm/yarn/bun lockfile, другу ORM, Redis, BullMQ, Kafka, RabbitMQ, PostgreSQL, мікросервіси, важкий admin template або паралельний backend. Не створюй другий `contracts` усередині apps.

Кореневі npm scripts мають реально оркеструвати workspaces і бути описані в README: `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`, Prisma generate/migrate/seed, BERT CLI, backup/restore verification. Скрипти не можуть бути порожніми `echo`-заглушками.

## 4. Архітектурні принципи: модульність, DRY та ООП

### 4.1 Модульний моноліт

Backend залишається одним NestJS modular monolith. Кожен business-модуль володіє своєю поведінкою й публічним application API. Орієнтовна внутрішня структура feature-модуля:

```text
modules/<feature>/
  domain/              сутності, value objects, policies, domain events
  application/         use cases, commands/queries, ports
  infrastructure/      Prisma repository та зовнішні adapters
  presentation/        HTTP controllers і request mapping
  <feature>.module.ts
```

Застосовуй ці шари пропорційно складності. Не створюй порожні класи або по одному файлу на кожен тривіальний type лише заради «архітектури». Водночас controller, Prisma query, permission logic, audit і business rule не повинні змішуватися в одному файлі.

Непорушні межі:

- controller відповідає за HTTP mapping, validation handoff і response; business logic у controller заборонена;
- application service/use case координує сценарій і володіє transaction boundary;
- domain layer не імпортує NestJS, Prisma, HTTP або filesystem;
- infrastructure реалізує ports і не диктує домену свої типи;
- один модуль не імпортує Prisma repository іншого модуля напряму;
- міжмодульна взаємодія — через явний application service, domain event або transactional outbox;
- `forwardRef()` не використовуй як стандартне лікування циклів; усунь цикл зміною межі. Кожен неминучий виняток задокументуй;
- `common`, `shared` і `utils` не перетворюй на звалище business logic.

### 4.2 Практичне ООП

Використовуй сильні сторони ООП там, де вони створюють інваріанти й замінювані межі:

- encapsulation: критичний стан змінюється через named methods/use cases, а не довільним patch об’єкта;
- value objects/factories: для нікнейму, company scope, permission code, credential lifecycle, approval version та інших значень із правилами;
- abstraction і dependency inversion: storage, malware scanner, clock, ID generator, password hasher, session store та repository boundaries підключаються через ports/Nest DI tokens;
- polymorphism: real API/mock data provider на frontend і production/test adapters на backend реалізують один контракт;
- composition over inheritance: збирай поведінку з малих сервісів і policies, не будуй глибокі class-ієрархії;
- single responsibility: клас або модуль має одну зрозумілу причину для зміни;
- domain policies: authorization, confidentiality, company scope та допустимі переходи статусів виражені окремими перевірюваними правилами;
- domain/application errors: типізовані помилки централізовано мапляться в RFC 9457 problem responses.

Не створюй `IService`/`IRepository` для кожного класу механічно. Абстракція потрібна, коли є реальна boundary, кілька implementations, тестова заміна або необхідність ізолювати framework. Не роби generic `BaseCrudService`, `BaseController` чи `BaseRepository`, які приховують permission checks та обходять domain invariants. Для критичних дій використовуй явні методи на кшталт `submitRequest`, `approveVersion`, `publishAnnouncement`, `resetCredentials`, `deactivateUser`.

React реалізуй функціональними компонентами, hooks і composition. Не перенось backend-style class inheritance у frontend і не використовуй class components лише заради ООП.

### 4.3 Правило відсутності дублювання

Перед створенням нового component, hook, DTO, enum, mapper, policy або helper перевір, чи немає вже канонічної реалізації. Один concern — одне джерело правди.

Обов’язково централізуй:

- transport DTO/enums/problem codes/pagination у `packages/contracts`;
- design tokens, typography, spacing, colors, radii та component variants;
- route registry, route builders і navigation metadata;
- sidebar config з permission predicates: не створюй окремий sidebar для кожної ролі;
- permission codes та server-side policy evaluation;
- company-scope query building і isolation rules;
- API client, error normalization, auth bootstrap, query keys і pagination serialization;
- date/time/timezone formatting;
- status labels/colors/icons;
- audit event creation для однотипних технічних полів;
- file validation, quarantine state та download authorization;
- form primitives, modal/drawer primitives, loading/empty/error states.

DRY не означає стирати доменну семантику. Якщо два use cases лише схожі візуально, але мають різні permission/invariant правила, залиш явні сценарії й винеси тільки справді спільну механіку. Не створюй абстракцію заради двох випадкових однакових рядків.

М’які сигнали для декомпозиції: source-файл наближається до 250–300 рядків, component має кілька незалежних зон, service має більше однієї причини для зміни або method одночасно валідовує, авторизує, читає БД, змінює стан і формує HTTP response. Generated files, Prisma schema/migrations та декларативні fixtures є винятками. Не дроби код до файлів, у яких неможливо побачити завершену думку.

### 4.4 Напрямок залежностей

- `apps/web` не імпортує `apps/api`, Prisma Client або server-only types;
- `apps/api` може імпортувати `packages/contracts`, але contracts не імпортують Nest/Prisma;
- shared frontend layer не залежить від feature/page layer;
- domain не залежить від application/infrastructure/presentation;
- application залежить від ports, infrastructure реалізує ports;
- dependency cycles мають ламати lint/typecheck, а не маскуватися barrel-файлами.

Додай lint import-boundaries або еквівалентну автоматичну перевірку. Використовуй barrel exports лише на публічній межі модуля; не створюй ланцюги re-export, які спричиняють цикли.

## 5. Shared contracts та API

`packages/contracts` є framework-neutral і не містить Prisma models, password/TOTP data, filesystem paths, внутрішні audit payloads або приватні HR-поля. Воно повинно збиратися окремо та містити лише безпечні transport contracts: DTO, enums, permission/error codes, pagination, safe projections, entity references і company scope.

Уникай паралельного ручного опису одного payload у frontend та backend. Обери одну framework-neutral runtime-validation стратегію або явний mapper до Nest validation і задокументуй її. TypeScript type сам по собі не замінює runtime validation.

API:

- prefix `/api/v1`;
- OpenAPI генерується з актуальної реалізації та зберігається як artifact;
- помилки — RFC 9457-compatible problem details зі стабільними safe error codes;
- list endpoints мають детерміновану pagination, server-side filter/sort і safe projections;
- mutation endpoints підтримують idempotency там, де цього вимагають ТЗ;
- stale writes захищені version/ETag або еквівалентною optimistic concurrency;
- Prisma entity не повертається напряму з controller;
- жодна response-модель не витікає ширше за permission/confidentiality scope.

## 6. Frontend-архітектура

Побудуй один app shell і один набір спільних компонентів. Role-aware UI отримується з permission-driven configuration, а не копіюванням сторінок.

Рекомендовані межі:

- `app/` — bootstrap, providers, router, global error boundaries;
- `modules/` або `features/` — вертикальні business-сценарії;
- `shared/ui/` — невеликі доступні primitives і design-system components;
- `shared/api/` — typed API client/provider interfaces;
- `shared/lib/` — вузькі технічні helpers без business rules;
- `assets/` або `public/` — локальні оптимізовані static assets.

Обов’язкові правила:

- React Router/browser history; кожна значуща ділянка має власний URL, deep link, refresh і Back/Forward;
- route registry одночасно живить router, breadcrumbs і navigation metadata;
- sidebar має єдину геометрію для всіх ролей; items фільтруються permissions, роль показується біля імені; для адміністратора є погоджена вкладена секція;
- overview персональний, без сутності або блоку «Команда»;
- server state використовує один узгоджений cache/query layer; company id входить у query keys, запити попередньої компанії cancel/ignore при switch;
- real API provider і mock provider реалізують спільні typed ports; production ніколи мовчки не переходить на mock;
- mock/demo mode увімкнений лише явним development/test flag і фізично не показує demo credentials у production build;
- forms мають єдину validation/error strategy; server error не губиться й не замінюється загальним toast без контексту;
- складні detail views використовують drawer/modal/progressive disclosure згідно з ТЗ;
- semantic HTML, keyboard navigation, focus management, ARIA лише там, де native semantics недостатньо;
- loading, skeleton, empty, offline, permission, conflict, maintenance та unexpected-error states — реальні компоненти, не текстові заглушки;
- не використовуй гігантський універсальний page component із десятками role checks;
- не дублюй кольори й відступи inline: використовуй CSS variables/design tokens і scoped component styles;
- route-level code splitting, стабільні dimensions для media, мінімум layout shift.

## 7. Backend, persistence та транзакції

Реалізуй усі модулі з backend-ТЗ з реальною Prisma/SQLite persistence. Заборонені in-memory repositories у production path.

Ключові правила:

- одна впорядкована Prisma schema і migration history; production — `migrate deploy`, не `db push`;
- timestamps у UTC; timezone conversion на application boundary;
- UUID/ULID генеруються application-side;
- foreign keys, indexes і uniqueness constraints дублюють критичні application invariants на рівні БД, де це можливо;
- transaction boundary проходить навколо завершеної business-операції, але не охоплює HTTP, malware scan, image processing або довге копіювання файлів;
- side effects після commit проходять через transactional outbox/durable jobs;
- повторний submit/approve/publish не створює дубль;
- list/detail/search/count/export/file/notification однаково застосовують company scope і confidentiality;
- no N+1 на списках і dashboard counts;
- SQLite працює як single-writer deployment із WAL, `foreign_keys=ON`, контрольованим `busy_timeout`, bounded retry та метриками busy/checkpoint;
- tests використовують окремий file-based SQLite, а не лише in-memory substitute;
- Prisma Client/database types не перетинають межу frontend.

Для FTS5, jobs, outbox, backup, retention/legal hold і file quarantine виконай точні вимоги backend-ТЗ. Не замінюй їх коментарями або cron-псевдокодом.

## 8. Authentication, authorization і security

Security controls реалізуються server-side незалежно від прихованих елементів UI.

Не відхиляйся від вимог:

- login тільки за canonical nickname + password; email не є login/recovery identifier;
- opaque server-side session у secure HttpOnly cookie; не зберігай auth token у `localStorage`;
- CSRF protection, session rotation/revocation, rate limits, re-auth для критичних дій;
- Argon2id password hashing, TOTP secret encryption, hashed recovery codes;
- перший admin створюється `npm run bert -- admin:create` через masked interactive prompt;
- admin password reset без email виконується за окремим permission, із reason, re-auth, audit, one-time temporary password, session revocation і forced first login;
- full-admin reset виконується за two-person control, а break-glass — лише через задокументований CLI;
- unlock не змішується з reset; impersonation відсутній;
- RBAC + company scope + resource ACL + field confidentiality; default deny;
- системний адміністратор не отримує автоматичного доступу до приватного HR/chat/document content;
- secrets, temporary password, TOTP seed, recovery codes і private payload не потрапляють у logs, screenshots, fixtures або OpenAPI examples;
- production config validation має блокувати старт при небезпечних або відсутніх secrets;
- файли мають opaque storage paths, quarantine, MIME/hash validation, scanner adapter і permission-checked download. Якщо scanner недоступний, файл не стає доступним.

## 9. Візуальна реалізація та static assets

Референси задають напрямок, але UI збирається з responsive HTML/CSS/React components, а не одним великим screenshot background.

Особливо важливо:

- усі required images із розділу 4 frontend-ТЗ створи як локальні static assets;
- для role hero використовуй окремий portrait cutout із прозорим фоном, а сині сигнальні стрічки, surface, тіні та адаптивне обтікання формуй CSS; це дає чисту PNG/CSS-композицію без raster-тексту;
- не вбудовуй назви, числа, кнопки або labels у зображення;
- не використовуй випадкові remote URLs, CDN hotlinks або runtime image generation;
- self-host Onest WOFF2 і license; runtime Google Fonts request заборонений;
- оптимізуй PNG/WebP/AVIF відповідно до alpha й visual quality, задай width/height, `srcset`/`picture`, loading priority та asset budget із ТЗ;
- не завантажуй hero всіх ролей на кожній сторінці;
- перевір alpha edges, overlap тексту, focus outlines, 1366×768, tablet і mobile;
- створюй оригінальні error/empty/offline/maintenance assets і дотримуйся mapping із ТЗ;
- готові browser screenshots збережи в `artifacts/screenshots/` або іншій чітко описаній директорії; не включай у них one-time credentials.

Якщо у середовищі доступний інструмент генерації зображень — використай його для photo/illustration assets. Не підміняй потрібну фотографію програмно намальованим placeholder. Після генерації оптимізуй файли без втрати прозорості й перевір їх у реальному layout.

## 10. Реалізація вертикальними зрізами

Не пиши весь backend окремо від frontend до самого кінця. Після foundation реалізуй feature за feature наскрізно: contract → migration/repository → use case/policy → API → frontend adapter → page/drawer → tests.

Рекомендований порядок:

1. Workspace foundation: root scripts, configs, contracts, quality gates, env validation.
2. Design system/app shell: Onest, tokens, router, sidebar/topbar, error boundaries, static asset pipeline.
3. Identity foundation: users, companies, nickname login, sessions, first login, TOTP, permissions, company selector, first-admin CLI.
4. Personal overview і tasks.
5. Requests/approvals та calendar/presence.
6. Documents/files/knowledge.
7. Employees і lifecycle.
8. Announcements/notifications.
9. Context chat/comments/search/saved views.
10. Admin: users, companies, roles/rights, security, audit, system/jobs.
11. Retention, legal hold, backup/restore, observability, health.
12. Responsive/accessibility/performance polish, full E2E і visual verification.

Після кожного зрізу запускай найближчі lint/typecheck/unit/integration tests. Не накопичуй усі помилки до фіналу.

## 11. Заборонені shortcut-рішення

Не можна:

- копіювати один і той самий DTO/enum/status map у кілька workspaces;
- створювати окремі sidebar/page copies для кожної ролі;
- зберігати production data лише в React state, LocalStorage, JSON або in-memory map;
- приховувати кнопку замість server-side permission check;
- повертати Prisma rows напряму без safe projection;
- виконувати довільний `include: { ...allRelations }` для списків;
- змішувати production і demo credentials;
- fallback-итися на mock при помилці API;
- залишати non-functional buttons, пусті routes, fake success toasts або hardcoded analytics;
- використовувати `any`, non-null assertions і disabled lint rules як системний спосіб «виправити» TypeScript;
- catch-ити помилку без логування safe context або без коректного UI/API outcome;
- створювати generic abstraction, яка обходить domain rules;
- додавати клієнтів, ліди, угоди, продажі, воронки, товари, склад, customer portal, команди, підрозділи, bulk user import або impersonation;
- використовувати production SQLite на ephemeral/network filesystem чи запускати кілька writable replicas;
- копіювати live SQLite file для backup без WAL-aware safe snapshot;
- вважати систему завершеною без restore test.

## 12. Тестування та quality gates

Тести мають перевіряти поведінку, а не лише snapshots структури.

Обов’язковий мінімум:

- unit tests для value objects, policies, transitions і application services;
- Prisma integration tests на isolated file-based SQLite;
- API E2E для auth, permissions, company isolation, idempotency, files, announcements, jobs і admin reset;
- CLI tests для `admin:create` та break-glass guard;
- frontend component/route tests для URL, permission states, forms, drawers і error pages;
- Playwright E2E для ключових user journeys і browser history;
- accessibility smoke/axe для головних routes;
- tests на 403 privacy outcome, 404/410, 409, 429, 500, 503, offline/bootstrap;
- absence workflow, announcement schedule/audience, company switching і cache isolation із ТЗ;
- migration test з empty DB та upgrade fixture;
- job recovery після restart і SQLite busy/concurrency behavior;
- backup → restore у fresh directory → integrity/smoke test;
- production build без unresolved assets, TypeScript errors або mock fallback.

Перед фінальною відповіддю виконай кореневі quality gates: install/lockfile consistency, lint, typecheck, unit, integration, E2E, build та візуальні перевірки з обох ТЗ. Не приховуй skipped/failed checks. Якщо конкретний check неможливий лише через обмеження host environment, наведи точну команду, фактичну причину й що вже перевірено натомість.

## 13. Документація та production handoff

Залиш у репозиторії:

- актуальний root `README.md` з Node/npm requirements, workspace tree і точними командами;
- `.env.example` без secrets із поясненням кожної production variable;
- `docs/architecture.md`;
- `docs/implementation-checklist.md`;
- `docs/decisions.md` лише для реальних неоднозначностей/відхилень;
- operational runbook для deploy, migrations, backup, restore, single-writer SQLite, file store і break-glass;
- OpenAPI artifact;
- інструкцію demo mode та reset demo data;
- відомі межі SQLite і adapter points для майбутньої міграції storage/database;
- перелік і розташування generated static assets та browser screenshots.

README не повинен радити ручне редагування generated files або небезпечне копіювання production DB.

## 14. Definition of Done

Система готова лише коли одночасно виконано Definition of Done з обох ТЗ і ці додаткові критерії:

- monorepo запускається з чистого checkout за задокументованими npm-командами;
- production frontend використовує реальний NestJS API;
- усі обов’язкові дані переживають restart;
- усі значущі дії змінюють URL/стан/дані коректно, а не лише вигляд;
- permissions, company scope і confidentiality доведені негативними тестами;
- код не містить паралельних реалізацій contracts/navigation/auth/company scope;
- модулі не мають недокументованих циклів або cross-module Prisma access;
- UI відповідає BERT CRM design system і використовує локальні static images/font;
- desktop/tablet/mobile, keyboard, 403/404/500/offline та чотири ролі перевірені;
- admin CLI, admin reset, two-person/break-glass, jobs/outbox, file quarantine, retention і backup/restore реально працюють;
- lint/typecheck/tests/build завершуються успішно;
- у production немає demo credentials, mock fallback, remote font/image dependency або placeholder secrets.

## 15. Формат фінальної відповіді

Не відповідай лише «готово». Коротко, але конкретно наведи:

1. Що реалізовано: основні routes, modules і end-to-end workflows.
2. Архітектуру: workspace tree, shared contracts, ключові ports/adapters і відсутність дублювання.
3. Безпеку: auth/session/RBAC/company scope/admin reset/files/audit.
4. Дані та operations: migrations, jobs/outbox, backup/restore, deployment assumptions.
5. Visuals: де лежать generated assets і screenshots.
6. Точні команди запуску, створення першого admin, tests і production build.
7. Фактичні результати всіх quality gates.
8. Лише реальні залишкові обмеження або blockers; не називай заплановану обов’язкову функцію «майбутнім покращенням».

Починай із повного читання двох ТЗ та аудиту репозиторію, після чого **відразу реалізуй систему**. Не проси повторного погодження вже затвердженого дизайну чи стеку.
