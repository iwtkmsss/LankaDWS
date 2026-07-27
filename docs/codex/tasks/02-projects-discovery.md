# Task 02 — project discovery

## Goal

Produce a bounded design decision for a requested “project” capability before implementation.

## Read first

`AGENTS.md`, `CODEX_CONTEXT_MAP.md`, `docs/architecture.md`, `docs/decisions.md`, `apps/api/prisma/schema.prisma`, `packages/contracts/src/groups.ts`, `apps/api/src/modules/groups/groups.controller.ts`, `apps/api/src/modules/groups/groups.service.ts`, `apps/api/src/modules/tasks/tasks.controller.ts`, `apps/api/src/modules/tasks/tasks.service.ts`, `apps/web/src/pages/ContentPages.tsx`, and `apps/web/src/pages/TasksPage.tsx`.

## Existing behavior

Groups are an existing aggregate and tasks have optional `groupId`. The schema has no `Project` model.

## Deliverable

Compare these options against permissions, lifecycle, membership, task linkage, search, migration cost, and UI/API impact:

1. A separate `Project` aggregate.
2. A `Group` kind such as `TEAM | PROJECT`.
3. A saved task/group view with no new persistence.

State the recommended option, affected files, migration/contract impact, and a follow-up implementation slice. Do not implement the capability in this task.

## Stop conditions

Ask before schema/migration, new permission, external write, dependency, CI, or material scope expansion.
