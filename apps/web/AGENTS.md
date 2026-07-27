# AGENTS.md — apps/web

These instructions extend the repository root `AGENTS.md`.

## Frontend navigation

- Canonical route registry: `src/app/routes.ts`.
- Router/guards: `src/app/router.tsx`.
- App shell, quick create and global command palette: `src/layout/AppShell.tsx`.
- Chat and notifications: `src/pages/CommunicationPages.tsx`.
- Groups, Drive, Employees and Knowledge: `src/pages/ContentPages.tsx`.
- Organization tree: `src/pages/OrganizationPage.tsx`.
- Calendar: `src/pages/CalendarPage.tsx`.
- Profile, notification, security and session settings: `src/pages/SettingsPages.tsx`.
- Shared UI: `src/shared/ui/index.tsx`.
- Design styles: `src/styles/*.css`.

## Rules

- Reuse canonical routes and existing drawers/forms.
- Do not create a second entity-creation form inside global search.
- Search results must remain permission-safe because the API is the authority.
- Keep keyboard navigation, focus trap, Escape, ArrowUp/ArrowDown and Enter behavior.
- Keep mobile master/detail behavior for chat.
- Use existing Onest/navy/cobalt tokens and Lucide icons.
- Avoid decorative images on dense work surfaces.
- Keep URL/search-param behavior stable unless the task explicitly changes it.
- Preserve accessible labels, focus order, keyboard navigation and responsive layouts.
- Do not split a large page file during a feature task; use a separate mechanical refactor task.

## Focused validation

For local UI work, prefer:

```bash
npm run typecheck --workspace @bert-crm/web
npm run lint --workspace @bert-crm/web
npm run test --workspace @bert-crm/web
npm run test:e2e --workspace @bert-crm/web -- \
  --project=desktop-chromium \
  --grep "<focused scenario>"
```

Add mobile Chromium only when responsive behavior changed. Do not run the 120-screen route audit for a local component change.
