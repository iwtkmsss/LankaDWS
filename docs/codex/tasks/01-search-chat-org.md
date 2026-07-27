# Task 01 — search, chat, and organization display

## Goal

Implement one focused enhancement across existing search, direct chat, or organization display behavior without creating a new persistent model.

## Read first

`AGENTS.md`, `CODEX_CONTEXT_MAP.md`, `apps/web/AGENTS.md`, `apps/api/AGENTS.md`, `apps/web/src/layout/AppShell.tsx`, `apps/web/src/pages/CommunicationPages.tsx`, `apps/web/src/pages/OrganizationPage.tsx`, `apps/api/src/modules/communication/search.controller.ts`, `apps/api/src/modules/communication/messages.controller.ts`, `apps/api/src/modules/communication/messages.service.ts`, `apps/api/src/modules/org/org.controller.ts`, `apps/api/src/modules/org/org.service.ts`, `packages/contracts/src/chat.ts`, and `apps/web/e2e/app.spec.ts`.

## Existing behavior to reuse

- Global search: `GET /api/v1/search?q=`; results are server-authorized safe projections.
- Quick create: canonical routes such as `/tasks/new`, `/messages?new=1`, and `/groups?new=1`.
- Chat search: `GET /api/v1/messages/threads?query=`.
- Direct chat: idempotent `POST /api/v1/messages/threads`, then `/messages/:threadId`.
- Organization tree: `GET /api/v1/org/units`; `OrgUnit.parentId` is the only hierarchy model.

## Acceptance criteria

Preserve server-side scope checks, canonical direct-thread reuse, URL state, keyboard interactions, responsive chat behavior, and accessible names. Do not create a duplicate form inside search.

## Validation

Run typecheck/lint/test only for touched workspaces and, if the UI flow changes, one `desktop-chromium` E2E scenario selected with `--grep`. Add mobile only for responsive changes.

## Non-goals

No Prisma migration, new `Project` entity, permission redesign, full E2E, or route audit.
