# AGENTS.md — apps/api

These instructions extend the repository root `AGENTS.md`.

## Backend navigation

- Module registry: `src/app.module.ts`.
- Global search: `src/modules/communication/search.controller.ts`.
- Chat API: `src/modules/communication/messages.controller.ts`.
- Chat business logic: `src/modules/communication/messages.service.ts`.
- Employees directory/profile: `src/modules/employees/employees.controller.ts`.
- Org hierarchy: `src/modules/org/org.controller.ts` and `org.service.ts`.
- Groups: `src/modules/groups/*`.
- Tasks: `src/modules/tasks/*`.
- Documents: `src/modules/documents/documents.controller.ts` and `documents.service.ts`.
- Calendar: `src/modules/calendar/calendar.controller.ts` and `calendar.service.ts`.
- Notifications: `src/modules/communication/notifications.controller.ts`.
- Authentication/session endpoints: `src/modules/auth/auth.controller.ts` and `auth.service.ts`.
- Authorization helpers: `src/modules/authorization/*`.
- Database source of truth: `prisma/schema.prisma`.
- Shared request schemas/types: `../../packages/contracts/src/*`.

## Rules

- Resolve authenticated principal and organization scope before querying entities.
- Preserve existence-safe not-found behavior and live membership/ACL checks.
- Prefer extending an existing endpoint over adding a parallel generic endpoint.
- Keep idempotency for create/send/convert operations.
- Keep business transactions atomic with audit/outbox where the existing service does so.
- Search responses must expose safe projections only.
- Do not introduce a Prisma migration unless the task explicitly requires persistent schema change.
- Do not edit `src/generated/prisma`.
- Do not run `prisma migrate dev` for a task that does not change schema.

## Focused validation

Prefer touched tests and:

```bash
npm run typecheck --workspace @bert-crm/contracts
npm run typecheck --workspace @bert-crm/api
npm run lint --workspace @bert-crm/api
npm run test --workspace @bert-crm/api
```

Run API integration/E2E only for the workflows affected by the change. Full root `quality` is a release gate, not a default local check.
