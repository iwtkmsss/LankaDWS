# Codex Bootstrap Task — актуалізувати й організувати agent-harness BertCRM

## Режим

Implementation, але **тільки repository documentation/tooling hygiene**.  
Не змінюй функціональність продукту.

## Мета

На основі фактичного поточного стану BertCRM:

1. перевірити й актуалізувати інструкції для Codex;
2. створити точну, компактну карту репозиторію та основних request-flow;
3. організувати допоміжні Codex-документи в логічну структуру;
4. зменшити generated noise у Git;
5. не допустити, щоб майбутні агенти щоразу сканували весь монорепозиторій або запускали повний pipeline без потреби.

## Вхідні bootstrap-файли

Очікується, що в репозиторії вже розміщені:

```text
/AGENTS.md
/CODEX_CONTEXT_MAP.md
/apps/web/AGENTS.md
/apps/api/AGENTS.md
/scripts/audit-codex-context.mjs
/scripts/generate-codex-api-map.mjs
/docs/codex/bootstrap/*
```

Файли в `docs/codex/bootstrap/` можуть містити report, task prompts, template та gitignore fragment.

## Незмінні місця

Ці файли мають залишитися саме тут, тому що їхнє розташування має значення:

```text
/AGENTS.md
/apps/web/AGENTS.md
/apps/api/AGENTS.md
```

Ці скрипти мають залишитися під `/scripts`:

```text
/scripts/audit-codex-context.mjs
/scripts/generate-codex-api-map.mjs
```

Інші Codex-документи можна організувати всередині:

```text
/docs/codex/
```

Не розкидай Codex-документи по продуктових модулях.

## Спочатку прочитай

Почни з bootstrap-файлів та коротких джерел істини:

```text
package.json
README.md
.gitignore
docs/architecture.md
docs/decisions.md
apps/web/package.json
apps/api/package.json
packages/contracts/package.json
apps/web/src/app/routes.ts
apps/web/src/app/router.tsx
apps/api/src/app.module.ts
apps/api/prisma/schema.prisma
artifacts/openapi.json
```

Потім використовуй **точковий пошук** для перевірки конкретних flow. Не роби безцільного рекурсивного читання всього репозиторію.

## Заборонені або шумні шляхи

Не читай вміст цих каталогів пофайлово, крім інвентаризації назв/розмірів:

```text
.playwright-cli/**
**/.playwright-cli/**
output/**
apps/web/artifacts/**
apps/web/test-results/**
coverage/**
dist/**
node_modules/**
apps/api/src/generated/prisma/**
```

Не використовуй для локального аудиту:

```bash
git show HEAD
git diff HEAD~1
rg "" .
find . -type f
```

Використовуй `git ls-files`, path-scoped `rg`, точкове читання та `git diff -- <paths>`.

## Обов’язкова робота

### 1. Перевірити структуру та scripts

Звір:

- npm workspaces;
- package scripts;
- frontend routes;
- NestJS modules/controllers;
- shared contracts;
- Prisma models;
- наявні OpenAPI artifacts;
- test/lint/typecheck/e2e commands.

Не вигадуй відсутні команди або модулі.

### 2. Оновити `AGENTS.md`

Root `AGENTS.md` повинен бути короткою операційною інструкцією, а не енциклопедією.

Він має точно містити:

- карту workspaces;
- context-budget rules;
- noisy/generated paths;
- ключові domain/security invariants;
- change boundaries;
- три рівні validation;
- stop conditions;
- формат фінального звіту агента.

Не дублюй у root-файлі деталі, які належать nested `AGENTS.md` або context map.

### 3. Оновити nested AGENTS

`apps/web/AGENTS.md`:

- точні frontend entry points;
- правила routes/search/chat/UI;
- focused frontend validation;
- responsive/accessibility requirements.

`apps/api/AGENTS.md`:

- точні controller/service/module paths;
- authorization/scope/idempotency/transaction rules;
- Prisma migration boundaries;
- focused backend validation.

### 4. Оновити карту контексту

Перемісти або перейменуй `CODEX_CONTEXT_MAP.md` лише якщо одночасно оновиш усі посилання. Перевага — зберегти його в корені для швидкого доступу.

Карта повинна містити компактні flow для:

```text
global search / command palette
quick create
chat search
direct thread creation
employees
organization hierarchy
groups
tasks
documents/drive
calendar
notifications
auth/permissions
```

Для кожного flow вкажи:

```text
frontend entry
API request
controller
service
contract
Prisma model, якщо релевантно
focused test
```

Не вставляй повний source code або повний OpenAPI JSON.

### 5. Згенерувати API map

Перевір та за потреби виправ:

```text
scripts/generate-codex-api-map.mjs
```

Запусти його для створення:

```text
docs/codex/api-map.md
```

API map має генеруватися з `artifacts/openapi.json` і містити method, route, tag та operationId.

Якщо OpenAPI artifact явно застарілий відносно controllers, не запускай важку повну генерацію автоматично. Познач це в документації та поясни точну команду оновлення.

### 6. Організувати Codex-документи

Рекомендована структура:

```text
docs/codex/
  README.md
  api-map.md
  optimization-report.md
  task-template.md
  tasks/
    00-repo-hygiene.md
    01-search-chat-org.md
    02-projects-discovery.md
```

Можеш адаптувати назви, але:

- не дублюй однаковий текст;
- збережи призначення кожного task;
- додай `docs/codex/README.md` з коротким порядком використання;
- усі внутрішні посилання мають бути валідними.

### 7. Очистити generated context noise

Інвентаризуй tracked generated files через `git ls-files`.

Онови `.gitignore` для:

```gitignore
.playwright-cli/
**/.playwright-cli/
**/playwright-cli.json
output/
```

Збережи вже наявні правила.

Якщо під `output/` є справді reusable source scripts:

1. перенеси тільки ці scripts у стабільний source path;
2. онови документацію/commands;
3. потім прибери generated output із Git index.

Не переписуй Git history. Не видаляй продуктові assets або source fixtures.

### 8. Перевірити task prompts

Актуалізуй task prompts відповідно до реального коду:

- exact read-first paths;
- existing endpoints;
- acceptance criteria;
- validation budget;
- explicit non-goals.

Не реалізовуй самі product tasks у цьому run.

## Що не можна змінювати

```text
application behavior
React product components
NestJS business logic
Prisma schema
migrations
seed data
permissions
API contracts
dependencies
lockfile
CI behavior
```

Виняток: можна змінити лише documentation/tooling paths і `.gitignore`, а також перенести reusable audit scripts із generated-каталогів.

## Validation budget

Не запускай:

```text
npm ci
npm run quality
full npm run test:e2e
route audit
Prisma migrations
production build
```

Запусти тільки:

```bash
node --check scripts/audit-codex-context.mjs
node --check scripts/generate-codex-api-map.mjs
node scripts/generate-codex-api-map.mjs
node scripts/audit-codex-context.mjs || true
git diff --check
git status --short
```

Також перевір усі Markdown links/paths простим локальним script або точковою перевіркою, без нової dependency.

## Stop conditions

Зупинись і запитай перед:

```text
видаленням source-файлу, який не є generated artifact
зміною application code
зміною Prisma schema
додаванням dependency
зміною CI
переписуванням Git history
неоднозначним видаленням великого каталогу
```

## Робочий стиль

1. Спочатку дай план максимум на 12 рядків із точними файлами.
2. Потім виконай аудит та зміни без пауз на рутинні рішення.
3. Не створюй нових великих звітів, якщо інформація вже є.
4. Тримай root `AGENTS.md` компактним.
5. Наприкінці переглянь лише scoped diff документації/tooling.

## Фінальна відповідь

Поверни:

1. нову структуру `docs/codex`;
2. які AGENTS/context дані були виправлені;
3. скільки generated tracked files прибрано за категоріями;
4. які scripts/links переміщено або оновлено;
5. команди validation і результати;
6. що свідомо не змінювалося.
