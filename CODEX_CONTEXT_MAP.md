# BertCRM context map

Read only the flow relevant to the request. This is a navigation map, not an architecture manual. Route sources are `apps/web/src/app/routes.ts` and `apps/web/src/app/router.tsx`; the machine-readable endpoint source is `artifacts/openapi.json`.

## Global search / command palette

| Field | Current path |
|---|---|
| Frontend entry | `apps/web/src/layout/AppShell.tsx` (`Ctrl/Cmd+K`) |
| API request | `GET /api/v1/search?q=<query>` |
| Controller / service | `modules/communication/search.controller.ts` / `messages.service.ts` |
| Contract / model | `packages/contracts/src/domain.ts`; permission-safe projections from existing domain models |
| Focused test | `apps/web/e2e/app.spec.ts` (global search scenario) |

The palette debounces queries of at least two characters and routes safe results. Do not duplicate creation forms there.

## Quick create

| Field | Current path |
|---|---|
| Frontend entry | `apps/web/src/layout/AppShell.tsx` |
| Canonical routes | `/tasks/new`, `/messages?new=1`, `/calendar?new=1`, `/groups?new=1`, `/drive?new=1`, `/announcements/new` |
| API owners | Existing tasks, messages, calendar, groups, documents, and announcements controllers |
| Focused test | `apps/web/e2e/app.spec.ts` where the changed canonical flow is covered |

Keep permission/capability gates and reuse the destination form.

## Messages and user search

| Field | Current path |
|---|---|
| Frontend entry | `apps/web/src/features/messages/MessagesPage.tsx` (`/messages`, `/messages/:threadId`, `/messages?q=`) |
| API request | `GET /api/v1/messages/users/search?q=<query>`; `GET /api/v1/messages/threads?cursor=&limit=`; `GET /api/v1/messages/threads/:id/messages?before\|after\|around=` |
| Controller / service | `communication/messages.controller.ts` / `messages.service.ts` |
| Contract / model | `packages/contracts/src/chat.ts`; `User`, `MessageThread`, `Message` |
| Realtime | User-scoped `GET /api/v1/messages/events`; point reads update message and thread-preview caches |
| Focused test | `apps/web/e2e/messages.spec.ts`; feature RTL tests under `apps/web/src/features/messages` |

The sidebar search is user-only and uses normalized Unicode display names/usernames. Thread titles
and message bodies do not participate. Conversation history is cursor-paginated separately from
metadata; in-thread search can open an anchored `around` window.

## Direct thread creation

| Field | Current path |
|---|---|
| Frontend entry | `apps/web/src/features/messages/MessagesPage.tsx` |
| API request | `POST /api/v1/messages/threads` with `idempotency-key` |
| Controller / service | `communication/messages.controller.ts` / `messages.service.ts` |
| Contract / model | `packages/contracts/src/chat.ts`; `MessageThread`, `Message` |
| Focused test | `apps/web/e2e/messages.spec.ts` direct/group creation scenarios |

Direct threads are canonical: reuse the returned thread and navigate to `/messages/:threadId`; never create a duplicate conversation.

## Employees

| Field | Current path |
|---|---|
| Frontend entry | `apps/web/src/pages/ContentPages.tsx` (`/employees`, `/employees/:employeeId`) |
| API request | `GET /api/v1/employees`, `GET /api/v1/employees/:id` |
| Controller / service | `modules/employees/employees.controller.ts` / controller-owned Prisma projection |
| Contract / model | `packages/contracts/src/org.ts`; `User`, `UserOrgAssignment` |
| Focused test | `apps/web/e2e/app.spec.ts` or a focused web scenario |

## Organization hierarchy

| Field | Current path |
|---|---|
| Frontend entry | `apps/web/src/pages/OrganizationPage.tsx` (`/employees/org`) |
| API request | `GET /api/v1/org/units`, `GET /api/v1/org/units/:id/employees` |
| Controller / service | `modules/org/org.controller.ts` / `org.service.ts` |
| Contract / model | `packages/contracts/src/org.ts`; `OrgUnit.parentId`, `UserOrgAssignment` |
| Focused test | Focused web E2E when the tree interaction changes |

Build the displayed tree from the safe flat list. Do not add another hierarchy model.

## Groups

| Field | Current path |
|---|---|
| Frontend entry | `apps/web/src/pages/ContentPages.tsx` (`/groups`, `/groups/:groupId`) |
| API request | `GET/POST /api/v1/groups`, detail, membership, archive, and group-thread routes |
| Controller / service | `modules/groups/groups.controller.ts` / `groups.service.ts` |
| Contract / model | `packages/contracts/src/groups.ts`; `Group`, `GroupMember`, `GroupJoinRequest` |
| Focused test | Focused web/API test for the changed membership or group flow |

## Tasks

| Field | Current path |
|---|---|
| Frontend entry | `apps/web/src/pages/TasksPage.tsx` (`/tasks`, `/tasks/new`, `/tasks/:taskId`) |
| API request | `GET/POST /api/v1/tasks` and task subresource routes |
| Controller / service | `modules/tasks/tasks.controller.ts` / `tasks.service.ts` |
| Contract / model | `packages/contracts/src/domain.ts`; `Task` (optional `groupId`) |
| Focused test | Focused API/web test for the changed task workflow |

## Documents / Drive

| Field | Current path |
|---|---|
| Frontend entry | `apps/web/src/pages/ContentPages.tsx` (`/documents`, `/drive`) |
| API request | `GET/POST /api/v1/documents`, detail, version, publish, archive, and restore routes |
| Controller / service | `modules/documents/documents.controller.ts` / `documents.service.ts` |
| Contract / model | `packages/contracts/src/domain.ts`; `Document`, `DocumentVersion`, `DocumentAcl` |
| Focused test | Focused test for the changed document/ACL flow |

## Calendar

| Field | Current path |
|---|---|
| Frontend entry | `apps/web/src/pages/CalendarPage.tsx` (`/calendar`, `/calendar/events/:eventId`) |
| API request | `GET/POST /api/v1/calendar/events`, `GET/PATCH /api/v1/calendar/events/:id` |
| Controller / service | `modules/calendar/calendar.controller.ts` / `calendar.service.ts` |
| Contract / model | `packages/contracts/src/domain.ts`; calendar event models |
| Focused test | Focused web/API test for the changed event flow |

## Notifications

| Field | Current path |
|---|---|
| Frontend entry | `apps/web/src/layout/AppShell.tsx`, `apps/web/src/pages/CommunicationPages.tsx` (`/notifications`) |
| API request | `GET /api/v1/notifications`, `GET /summary`, `PATCH /read-all`, `PATCH /:id` |
| Controller / service | `communication/notifications.controller.ts` / controller-owned Prisma projection |
| Contract / model | `packages/contracts/src/domain.ts`; `Notification`, `NotificationPreference` |
| Focused test | Focused web scenario for changed unread/read behavior |

## Auth / permissions

| Field | Current path |
|---|---|
| Frontend entry | `apps/web/src/shared/auth/AuthProvider.tsx`, `apps/web/src/pages/SettingsPages.tsx` |
| API request | `/api/v1/auth/*` and `/api/v1/me/*` |
| Controller / service | `modules/auth/auth.controller.ts` / `auth.service.ts`, guards in `auth.guard.ts` |
| Contract / model | `packages/contracts/src/auth.ts`, `permissions.ts`; `User`, `UserSession`, `Role` |
| Focused test | `apps/api/src/modules/auth/password-policy.test.ts` plus affected focused test |

Authorization is server-side. Preserve organization scope and existence-safe behavior for all projections.

## Generated context boundaries

Do not inspect `.playwright-cli/`, `output/`, `apps/web/artifacts/`, `apps/web/test-results/`, `coverage/`, `dist/`, `node_modules/`, or `apps/api/src/generated/prisma/` unless the task explicitly targets them. Migration-only context is under `docs/bitrix24-*` and `apps/api/src/modules/import-control/`.

Generate the Markdown endpoint index when needed:

```bash
node scripts/generate-codex-api-map.mjs
```
