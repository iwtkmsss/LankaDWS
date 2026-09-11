# Codex Task 02 — Project domain discovery for LankaDWS

## Mode

Ask/plan mode only. Do not edit files, create migrations or implement UI.

## Goal

Determine the smallest correct way to support «проєкти» in LankaDWS without duplicating the existing Group and Task domains.

## Current facts

- `Group` already supports membership, owner, discoverability, join policy, Feed context, Task context and a canonical contextual chat.
- `Task` already has optional `groupId`.
- Group UI text currently describes groups as «Команди та проєкти», but there is no explicit group kind.
- There is no Prisma `Project` model, Project contract, Project route, Project controller or Project permission.
- The product has one organization and recursive OrgUnits.
- Authorization, search, audit/outbox and migration compatibility are strict.

## Read only

```text
AGENTS.md
CODEX_CONTEXT_MAP.md
docs/architecture.md
docs/decisions.md
packages/contracts/src/groups.ts
packages/contracts/src/permissions.ts
apps/api/prisma/schema.prisma
apps/api/src/modules/groups/groups.controller.ts
apps/api/src/modules/groups/groups.service.ts
apps/api/src/modules/tasks/tasks.controller.ts
apps/api/src/modules/tasks/tasks.service.ts
apps/api/src/modules/communication/search.controller.ts
apps/web/src/app/routes.ts
apps/web/src/pages/ContentPages.tsx
apps/web/src/pages/TasksPage.tsx
apps/web/e2e/app.spec.ts
```

Do not read Bitrix migration docs, generated artifacts or full Git history unless a specific approved decision directly references them.

## Compare exactly three options

### Option A — separate Project aggregate

Evaluate:

- Prisma model and migration;
- lifecycle/status;
- owner/members;
- task relation;
- project chat/feed/files;
- permissions;
- routes/API/search;
- audit/outbox;
- migration/import impact.

### Option B — `Group.kind = TEAM | PROJECT`

Evaluate:

- minimal migration;
- whether existing Group invariants remain valid;
- UI labels/filtering;
- project-specific fields that cannot fit;
- Task relation and search;
- backwards compatibility.

### Option C — no persistent Project entity

Project is a saved view/tag/convention over Tasks and Groups.

Evaluate when this is sufficient and what user requirements it cannot satisfy.

## Required questions to answer

1. What user action distinguishes a project from a group?
2. Does a project need its own lifecycle, dates, status, owner, budget or milestones?
3. Can membership be inherited from Group?
4. Should every project have one canonical group/chat?
5. Should tasks belong to Group, Project, both, or exactly one context?
6. What happens to current `Task.groupId`?
7. How should global search and quick create expose projects?
8. What permission model is required?
9. What is the migration/backfill path for existing groups that are already used as projects?
10. Which option minimizes complexity without blocking likely future needs?

## Deliverable

Return a concise architecture decision document containing:

```text
Recommendation
Why
Rejected alternatives
Domain model
State transitions
Permissions
API
Frontend routes
Search integration
Migration/backfill
Testing strategy
Estimated touched files
Risks/open questions
Implementation slices
```

Limit the proposed first implementation slice to work that a developer could reasonably review as one PR. Do not write code.
