# Codex Task 01 — глобальний пошук, direct chat autocomplete і батьківський підрозділ

## Mode

Implementation. Work end-to-end, but keep the change narrow. Do not perform general product research.

## Goal

Improve the existing LankaDWS search surfaces without duplicating forms or introducing a new domain model:

1. global `Ctrl/Cmd+K` must find existing entities and show relevant canonical create actions while the user types;
2. chat search must show matching existing conversations and matching employees; clicking an employee must immediately open the canonical direct conversation, creating an empty thread only when none exists;
3. employee cards/profile must show the current org unit and its immediate parent org unit when present.

## Existing behavior to reuse

Do not rebuild these mechanisms:

- Global command palette and quick-create actions already exist in:
  `apps/web/src/layout/AppShell.tsx`.
- Global search endpoint already exists:
  `GET /api/v1/search`.
- Chat thread search already matches title, message text and participant names/usernames:
  `MessagesService.threads()`.
- Direct threads are canonical and idempotent:
  `POST /api/v1/messages/threads`.
- Employee search already exists:
  `GET /api/v1/employees?search=...`.
- Org hierarchy already exists through `OrgUnit.parentId`.
- Canonical create pages/drawers already exist for Task, Chat, Calendar, Request, Group, Drive and Announcement.

## Read first — do not scan the whole repository

```text
AGENTS.md
CODEX_CONTEXT_MAP.md
apps/web/AGENTS.md
apps/api/AGENTS.md
apps/web/src/layout/AppShell.tsx
apps/web/src/pages/CommunicationPages.tsx
apps/web/src/pages/ContentPages.tsx
apps/web/src/pages/OrganizationPage.tsx
apps/api/src/modules/communication/search.controller.ts
apps/api/src/modules/communication/messages.controller.ts
apps/api/src/modules/communication/messages.service.ts
apps/api/src/modules/employees/employees.controller.ts
apps/api/src/modules/org/org.service.ts
packages/contracts/src/chat.ts
packages/contracts/src/org.ts
apps/web/e2e/app.spec.ts
```

Expand only through direct imports/call sites or a failing focused test.

Do not read:

```text
.playwright-cli/**
output/**
docs/bitrix24-*
docs/assets/bitrix24-migration/**
apps/api/src/modules/import-control/**
artifacts/openapi.json
artifacts/feed-rehearsal-*.json
```

## A. Global command palette

Modify the existing `CommandPalette`; do not add a second global search component.

### Required behavior

- Keep `Ctrl/Cmd+K`, focus trap, Escape, ArrowUp/ArrowDown and Enter.
- For a trimmed query shorter than 2 characters, keep the current default quick-create and navigation suggestions.
- For a query of 2+ characters:
  - fetch existing search results through the current `/search` endpoint;
  - also include locally filtered quick-create actions whose title/description matches the query;
  - render create actions in a separate `Створити` group before entity results;
  - use canonical routes already present in `quickCreateActions`;
  - do not embed or duplicate Task/Group/Event/etc. forms inside the palette.
- Preserve the existing 220 ms debounce or use 200–300 ms.
- Prevent stale responses from replacing newer results.
- Keep a clear loading state, empty state and safe failure state.
- Search remains permission/capability-aware.
- No Prisma migration and no new dependency.

### Examples

```text
"зав" -> "Нове завдання" + matching TASK results
"гру" -> "Нова група" + matching GROUP results
"оле" -> matching EMPLOYEE and CHAT results
"фай" -> "Завантажити файл" + matching DOCUMENT results
```

## B. Chat employee suggestions

Enhance the existing search area in `MessagesPage`; do not create a separate page.

### Required behavior

- Existing thread results continue to work exactly as now.
- After 2+ trimmed characters, query safe employees using:
  `GET /employees?search=<query>`.
- Debounce employee lookup by 200–300 ms.
- Do not show the authenticated user.
- Render a compact section below/near thread results:
  `Написати людині`.
- Each suggestion shows existing `Avatar`, display name and job/position title.
- On click:
  1. call `POST /messages/threads`;
  2. body:
     ```json
     {
       "companyId": "<current organization id>",
       "kind": "DIRECT",
       "participantIds": ["<employee id>"]
     }
     ```
  3. use a retry-safe idempotency key;
  4. navigate to `/messages/<returned id>`;
  5. clear the search state.
- If a direct thread already exists, open it; do not create a duplicate.
- If no thread exists, the opened thread is empty and ready for the first message.
- Show a small pending state and a non-destructive error message. Keep the search text after an error.
- Respect `messages.write`; hide/disable person-create suggestions without permission.
- Do not change chat schema, SSE, read cursors or notification rules.

## C. Immediate parent org unit on employees

No schema migration.

### Backend

In `apps/api/src/modules/employees/employees.controller.ts`:

- extend the safe orgUnit select to include only the immediate parent:
  ```text
  parent: { id, name }
  ```
- return:
  ```ts
  orgUnit: {
    id: string
    name: string
    parent: { id: string; name: string } | null
  } | null
  ```
- apply to list and detail responses;
- keep `EmployeesOrgRead` permission behavior: users without this permission must not receive org hierarchy fields.

Update a shared contract only if this projection already has a canonical shared type. Do not create an unnecessary contract layer just for local page interfaces.

### Frontend

In Employee directory cards/table and employee profile:

- show current unit;
- when parent exists, show hierarchy in a compact form:
  `Батьківський підрозділ → Поточний підрозділ`;
- do not expose private contacts or hidden org data;
- keep mobile reflow and existing visual system.

`/employees/org` tree already uses `parentId`; preserve it.

## Explicitly out of scope

Do not implement any of the following in this run:

```text
Project model
Group.kind migration
new permissions
new top-level routes
Bitrix import changes
full page-file refactor
design-system rewrite
full route audit
all-workspace quality pipeline
```

If a requirement appears to need a new Project model, stop that branch of work and mention it in the final summary; continue A–C.

## Acceptance criteria

1. `Ctrl/Cmd+K` with `зав` displays `Нове завдання` and matching task results.
2. Selecting a create suggestion opens the canonical existing create route.
3. Global entity result selection still opens its canonical detail route.
4. Chat search by employee name still finds threads where that employee participates.
5. Chat search also shows an employee suggestion even when no thread exists.
6. Clicking an employee opens the existing direct thread or creates exactly one empty direct thread.
7. Repeating the same click/retry does not duplicate the direct thread.
8. The current user is never offered as a direct-chat target.
9. Employee UI displays one-level hierarchy when available and degrades cleanly when there is no parent.
10. No horizontal overflow at 390 px and no keyboard regression in the command palette.
11. No Prisma migration, dependency change or generated audit artifacts.

## Tests

Add focused tests near existing search/chat tests.

Minimum focused coverage:

- global create action remains visible for a matching query;
- chat employee suggestion creates/reuses a direct thread;
- employee hierarchy projection does not appear without org permission;
- employee hierarchy renders parent + current unit.

## Validation budget

During implementation run only touched workspace checks.

```bash
npm run typecheck --workspace @lankadws/contracts
npm run typecheck --workspace @lankadws/api
npm run typecheck --workspace @lankadws/web
npm run lint --workspace @lankadws/api
npm run lint --workspace @lankadws/web
```

Run focused tests only. For Playwright start with:

```bash
npm run test:e2e --workspace @lankadws/web -- \
  --project=desktop-chromium \
  --grep "chat search|global search|employee"
```

Add `mobile-chromium` only because this task changes responsive chat/search rendering.

Do not run:

```text
npm ci
npm run quality
full npm run test:e2e
route-audit scripts
```

unless a focused failure proves they are necessary.

## Work style

- Before editing, output a plan of at most 12 lines with exact files.
- Then implement without pausing for routine local decisions.
- Keep changes focused; do not refactor unrelated code.
- After implementation, inspect only the final scoped diff.

## Completion output

Return exactly:

1. implemented behavior;
2. changed files grouped by web/api/contracts/tests;
3. commands run and results;
4. explicit non-goals left unchanged;
5. any real remaining risk.
