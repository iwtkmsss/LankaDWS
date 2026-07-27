# Frontend browser audit

Дата: 2026-07-27

## Покриття

- 56 оголошених маршрутів у Chromium.
- 2 viewport: desktop `1440×960` і mobile `390×844`.
- 112 маршрутних екранів та 8 додаткових станів із декоративними ілюстраціями.
- Перевірки: Axe, console/page errors, HTTP 5xx і відсутні API/assets, horizontal overflow, blank screens, broken images та фактична видимість ілюстрацій.
- Ролі: anonymous для public routes, Dmytro для загального й адміністративного контуру, Maria для приватної заявки та чату.

Підсумок: **120/120 екранів пройдено, 0 невдалих перевірок**.

Машинний звіт: `output/playwright/route-audit/report.json`.
Повні скриншоти: `output/playwright/route-audit/screenshots/desktop/` і `output/playwright/route-audit/screenshots/mobile/`.

## Виправлено під час аудиту

- доступне ім’я кнопки швидкого створення на mobile;
- семантику заголовків login та empty states;
- дубльовані `aside` landmarks у формах і lifecycle;
- некоректний ARIA у skeleton loading state;
- недостатній контраст danger, request, directory та lifecycle елементів;
- horizontal overflow довгого user-agent на сторінці активних сесій;
- правильні заголовки статичних `new` routes;
- повноцінний detail drawer для події журналу аудиту;
- збереження `company=all` під час переходу з командної палітри.

## Функціональні сценарії

Основний Playwright E2E-прогін: 18/20; два однакові desktop/mobile падіння виявили одну помилку збереження company scope. Після виправлення цільовий повтор пройшов **2/2**. Отже, усі 20 актуальних сценаріїв мають passing result без повторного запуску вже успішних 18.

Додатково пройдено `npm run typecheck --workspace @bert-crm/web` і `git diff --check`.

## Відтворення

```powershell
node .\output\playwright\route-audit\standalone-audit.mjs
npm run test:e2e --workspace @bert-crm/web
```
