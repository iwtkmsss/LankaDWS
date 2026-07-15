# BERT CRM — комплект передачі Codex

Цей каталог містить усе, що потрібно передати Codex для переходу від проєктування до реалізації повного npm-workspaces monorepo.

## Що передати

- `00-CODEX-MASTER-PROMPT.md` — головна технічна інструкція: порядок роботи, архітектурні межі, DRY, модульність, практичне ООП, security та quality gates.
- `bert-crm-design-spec.md` — повне ТЗ на дизайн і frontend.
- `bert-crm-backend-spec.md` — повне ТЗ на backend, database, auth, security та operations.
- `references/01-dashboard-layout-reference.png` — лише референс щільності та загальної композиції.
- `references/02-admin-sidebar-approved.png` — затверджена вкладена адмін-навігація та роль біля імені.
- `references/03-overview-employee-approved.png` — затверджений візуальний напрямок персонального overview працівника.
- `references/04-overview-manager-approved.png` — затверджений візуальний напрямок overview керівника/погоджувача.
- `references/05-admin-overview-approved.png` — затверджений візуальний напрямок адміністративного overview.

## Як запустити роботу

1. Розпакувати комплект у корінь нового або наявного репозиторію.
2. Відкрити цей репозиторій у Codex.
3. Передати всі файли з комплекту в одному контексті.
4. Дати Codex вміст `00-CODEX-MASTER-PROMPT.md` як основне завдання.
5. Дозволити йому реалізовувати весь monorepo, запускати npm-команди, тести, browser checks та генерувати локальні static image assets.

Повторно погоджувати стек або дизайн не потрібно. Для старту також не потрібні production-домен, реальні secrets чи остаточний backup path: Codex має винести їх у валідовані environment variables та `.env.example`.

## Як читати візуальні референси

Два MD-файли завжди важливіші за текст усередині PNG. У референсах не можна копіювати `PROTON`, «Команда», «Групи», продажі або інші дані, що суперечать ТЗ. Raster-файли показують композицію, навігацію, щільність, рольові акценти й фото/CSS-підхід.

Фінальний сайт не збирається зі screenshot backgrounds. Portrait cutouts, error illustrations та інші required images генеруються як локальні static assets; текст, кнопки, статуси й сині сигнальні форми залишаються responsive HTML/CSS.

## Що не передавати

Не додавайте старий `bert-crm-final-frontend-prompt.md`: це рання чернетка, яку вже замінив `bert-crm-design-spec.md`. Вона може створити суперечності та змусити Codex реалізувати застарілі рішення.
