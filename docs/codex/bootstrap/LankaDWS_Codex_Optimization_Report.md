# LankaDWS × Codex: глибокий аудит швидкості, лімітів і промтів

Дата аудиту: 2026-07-27  
Репозиторій: `iwtkmsss/LankaDWS`  
Перевірений HEAD: `bdd7c05ad9b68e3d52be998dd0bd76a87525401e`

## Головний висновок

Проблема не в одному «невдалому промті». Вона складається з п’яти факторів:

1. **Надто широкий запит**, який одночасно зачіпає глобальний пошук, quick-create, чат, організаційну структуру, групи та ще не змодельовані проєкти.
2. **GPT-5.6 Sol використовується для кожної роботи**, хоча більша частина задач є звичайною реалізацією UI/API та не потребує найдорожчого режиму.
3. **У Git відстежуються великі згенеровані Playwright-артефакти**: десятки `.playwright-cli/*.yml`, `output/playwright/**`, скриншоти та звіти. Вони збільшують дерево репозиторію, шум пошуку, розмір diff і ризик того, що агент читає непотрібне.
4. **Перевірки за замовчуванням дуже важкі**: кореневий `npm run quality` починається з `npm ci`, а далі запускає Prisma, lint, typecheck, unit, integration і build для всього монорепо; повний web E2E запускає два viewport-проєкти послідовно.
5. **Немає `AGENTS.md`**, тому Codex щоразу заново визначає структуру, команди, межі задачі, важливі інваріанти й рівень потрібної перевірки.

Найбільший практичний ефект дадуть не додаткові довгі інструкції, а:

- прибрати з Git згенерований шум;
- додати короткий `AGENTS.md` і окрему карту репозиторію;
- ділити одну бізнес-ідею на невеликі vertical slices;
- запускати лише релевантні перевірки;
- використовувати Sol тільки там, де він реально дає виграш.

---

## 1. Що саме зараз змушує Codex витрачати багато часу

### 1.1. Останній commit майже перезібрав увесь продукт

Останній commit містить:

- багато нових Prisma-міграцій;
- приблизно 1 500 рядків змін у `schema.prisma`;
- приблизно 1 600 рядків нового коду в `messages.service.ts`;
- понад 1 400 рядків у `feed-rehearsal.ts`;
- зміни майже в усіх великих frontend-сторінках;
- десятки Playwright YAML snapshots;
- масивні каталоги browser-audit зі скриншотами.

Через це небезпечні команди на кшталт:

```bash
git show HEAD
git diff HEAD~1
find . -type f
rg "" .
```

можуть створити величезний контекст. Codex треба прямо заборонити робити repo-wide читання без потреби.

### 1.2. Згенеровані browser-артефакти відстежуються Git

Поточний `.gitignore` ігнорує `apps/web/artifacts/...`, але не ігнорує:

```text
.playwright-cli/
output/
**/.playwright-cli/
**/playwright-cli.json
```

У HEAD уже є десятки root `.playwright-cli/*.yml` і великий `output/playwright/route-audit/` зі скриншотами. Простого додавання в `.gitignore` недостатньо: уже відстежувані файли треба прибрати з Git index.

Рекомендований окремий housekeeping-task наведено у `CODEX_TASK_00_REPO_HYGIENE.md`.

### 1.3. Поточний запит об’єднує чотири різні задачі

Оригінальна ідея фактично містить:

1. глобальний пошук + quick create;
2. autocomplete користувачів у чаті + створення direct thread;
3. відображення підрозділу і батьківського підрозділу;
4. групи та окреме поняття «проєкт».

Це різні модулі, різні інваріанти та різні тести. Окремий `Project` у поточній Prisma-схемі відсутній, тому фраза «зроби групи та проєкти» може змусити агента почати нову міграцію, permissions, contracts, API, routes, UI, search та E2E. Саме це різко роздуває роботу.

### 1.4. Частина потрібного вже реалізована

Codex не повинен повторно винаходити наявні механізми:

- `Ctrl/Cmd+K` command palette вже є в `apps/web/src/layout/AppShell.tsx`;
- quick-create уже веде на канонічні форми;
- `GET /search` уже шукає Tasks, Requests, Groups, Chat, Documents, Employees, Events та Knowledge;
- пошук чатів уже вміє знаходити thread за назвою, текстом повідомлень і користувачем-учасником;
- `POST /messages/threads` уже канонічно створює або повертає існуючий direct thread;
- `OrgUnit.parentId` і рекурсивне дерево підрозділів уже існують;
- групи вже мають schema/contracts/API/UI;
- `Task.groupId` уже прив’язує завдання до групи;
- окремої сутності `Project` немає.

Найкращий промт повинен описувати **дельту**, а не заново формулювати весь продукт.

### 1.5. Повні перевірки занадто дорогі для кожного маленького кроку

Кореневий `quality`:

```text
npm ci
Prisma generate
lint усіх workspaces
typecheck усіх workspaces
unit tests
integration tests
build
```

Web E2E додатково:

- перед стартом збирає contracts і API;
- готує окрему БД;
- запускає Chromium;
- має desktop + mobile;
- `workers: 1`;
- містить довгі stateful сценарії, uploads, SSE, axe та screenshots.

Це правильно перед релізом, але не після кожної локальної зміни.

---

## 2. Рекомендована модельна стратегія

### GPT-5.6 Sol

Використовувати для:

- нової доменної моделі;
- Prisma schema + migration;
- security/authorization;
- складних race conditions;
- великих cross-module refactor;
- аналізу, де неправильне рішення дуже дороге.

Не використовувати за замовчуванням для CSS, невеликої React-взаємодії, локального endpoint або одного тесту.

### GPT-5.6 Terra

Основний режим для LankaDWS:

- звичайний feature slice React + NestJS;
- пошук;
- форми;
- API DTO;
- локальний refactor;
- focused tests.

У credit rate card Terra має приблизно вдвічі нижчу ставку за input/output tokens, ніж Sol. У включених лімітах точне списання може відрізнятися, але OpenAI прямо вказує, що витрати залежать від моделі, складності, тривалості та обсягу контексту.

### Luna / Spark, якщо доступні у picker

Для:

- локальних UI-правок;
- CSS;
- компонентів;
- тестів;
- механічного розбиття файлів;
- дрібних accessibility fixes.

### Reasoning effort

Практична схема:

- `low`: механічні локальні зміни;
- `medium`: стандартна feature-робота;
- `high`: складний баг або authorization;
- `xhigh/max`: лише коли є вимірюваний виграш і чіткі критерії.

Не ставити найвищий effort «про всяк випадок».

---

## 3. Три рівні перевірки

### Tier 1 — під час реалізації

Тільки touched workspace та targeted test:

```bash
npm run typecheck --workspace @lankadws/contracts
npm run typecheck --workspace @lankadws/api
npm run typecheck --workspace @lankadws/web
```

Запускати лише потрібні з цих трьох.

Focused Playwright:

```bash
npm run test:e2e --workspace @lankadws/web -- \
  --project=desktop-chromium \
  --grep "chat search|global search"
```

### Tier 2 — перед завершенням feature slice

```bash
npm run lint --workspace @lankadws/api
npm run lint --workspace @lankadws/web
npm run test --workspace @lankadws/api
npm run test --workspace @lankadws/web
```

Тільки workspaces, яких торкнулась зміна.

### Tier 3 — перед merge/release або на окрему вимогу

```bash
npm run quality
npm run test:e2e
```

Не запускати Tier 3 автоматично для кожної UI-ітерації.

---

## 4. Як ставити задачі Codex

### Погано

> Пошукай усе, що можна десь додати, зроби гарно, подивись по всьому проєкту, додай групи та проєкти, перевір усе.

Це не має чіткої межі й stop condition.

### Добре

Кожна задача повинна мати:

1. **Goal** — один вимірюваний результат.
2. **Existing behavior** — що вже є і має бути reused.
3. **Read first** — 5–12 конкретних файлів.
4. **Scope** — що дозволено змінювати.
5. **Out of scope** — що не змінювати.
6. **Acceptance criteria** — поведінкові критерії.
7. **Validation budget** — конкретні команди.
8. **Stop conditions** — коли треба зупинитися й запитати.
9. **Output format** — короткий summary, changed files, tests.

Офіційна рекомендація OpenAI: описувати задачу як GitHub Issue, починати великі зміни з Ask/plan mode і давати Codex задачі приблизно на годину людської роботи або кілька сотень рядків.

---

## 5. Рекомендований порядок роботи саме для запиту зі скриншота

### Task 00 — hygiene

Один раз очистити Git від generated browser artifacts і додати AGENTS/context map.

Модель: Terra або Luna.  
Файл: `CODEX_TASK_00_REPO_HYGIENE.md`.

### Task 01 — search + chat + org display

Локальна реалізація без Prisma migration:

- command palette показує релевантні create actions разом із пошуком;
- chat search показує існуючі діалоги та людей;
- клік по людині створює або відкриває канонічний direct thread;
- employee UI показує поточний і батьківський підрозділ;
- не створюється Project;
- не переписується search architecture.

Модель: Terra medium.  
Файл: `CODEX_TASK_01_SEARCH_CHAT_ORG.md`.

### Task 02 — Projects discovery

Окремий Ask-mode run:

- чи є Project окремою сутністю;
- чи достатньо `Group.kind = TEAM | PROJECT`;
- lifecycle, permissions, membership, task binding;
- migration impact;
- search/routes/API.

Тільки план, без коду та міграції.

Модель: Sol medium/high.  
Файл: `CODEX_TASK_02_PROJECTS_DISCOVERY.md`.

Після погодження рішення — окремий implementation task.

---

## 6. Найважливіші технічні покращення репозиторію

### Обов’язково

- додати root `AGENTS.md`;
- додати nested `apps/web/AGENTS.md` і `apps/api/AGENTS.md`;
- додати `.playwright-cli/`, `**/.playwright-cli/`, `output/` у `.gitignore`;
- прибрати generated artifacts з Git index;
- не читати Bitrix migration docs у звичайних product/UI задачах;
- не запускати `npm ci`, якщо dependencies/lockfile не змінені й `node_modules` уже є;
- не запускати full route audit без прямої вимоги;
- починати новий Codex thread для нового feature slice.

### Наступний рівень

Великі файли варто поступово розділити:

- `apps/web/src/pages/CommunicationPages.tsx`;
- `apps/web/src/pages/ContentPages.tsx`;
- `apps/api/src/modules/communication/messages.service.ts`;
- `apps/web/src/pages/TasksPage.tsx`.

Не робити це одночасно з feature change. Окремий mechanical refactor значно полегшить майбутню навігацію Codex.

Рекомендована майбутня структура:

```text
apps/web/src/features/search/
apps/web/src/features/chat/
apps/web/src/features/employees/
apps/web/src/features/groups/
apps/api/src/modules/communication/search/
apps/api/src/modules/communication/chat/
```

### Автоматична карта API

Не треба вручну підтримувати гігантський список усіх endpoint-ів. У репозиторії вже є `artifacts/openapi.json`. У пакеті є script:

```bash
node scripts/generate-codex-api-map.mjs
```

Він генерує компактний `docs/codex-api-map.md` з method, path, tag та operationId.

---

## 7. Офіційні джерела OpenAI

- Codex usage та залежність витрат від розміру, складності, моделі й тривалості:  
  https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- Codex rate card:  
  https://help.openai.com/en/articles/20001106-codex-rate-card
- Як OpenAI використовує Codex: Ask Mode, GitHub-Issue prompts, AGENTS.md:  
  https://openai.com/business/guides-and-resources/how-openai-uses-codex/
- GPT-5.6 model guidance: lean prompts, reasoning effort, autonomy boundaries:  
  https://developers.openai.com/api/docs/guides/latest-model
- Harness engineering: «give Codex a map, not a 1,000-page instruction manual»:  
  https://openai.com/index/harness-engineering/
- Codex overview та AGENTS.md:  
  https://openai.com/index/introducing-codex/

---

## 8. Що лежить у цьому пакеті

```text
AGENTS.md
apps/web/AGENTS.md
apps/api/AGENTS.md
CODEX_CONTEXT_MAP.md
CODEX_TASK_00_REPO_HYGIENE.md
CODEX_TASK_01_SEARCH_CHAT_ORG.md
CODEX_TASK_02_PROJECTS_DISCOVERY.md
CODEX_TASK_TEMPLATE.md
scripts/generate-codex-api-map.mjs
scripts/audit-codex-context.mjs
```

Порядок застосування:

1. скопіювати `AGENTS.md` і nested AGENTS у repo;
2. виконати Task 00;
3. запустити Task 01 в окремому Codex thread;
4. перевірити UI;
5. окремо запустити Task 02 в Ask mode;
6. лише після погодження моделі Project дати implementation prompt.
