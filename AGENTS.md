# AGENTS.md — LankaDWS

## Purpose

Help coding agents (Codex, Claude) make small, safe, reviewable changes in this npm-workspaces monorepo without repeatedly scanning unrelated code or running the full release pipeline.

## Naming

Repo and packages are `lankadws` / `@lankadws/*`; the official product name is **LankaDWS**. Keep display copy and technical namespaces consistent, and do not rename identifiers or packages as part of an unrelated task.

## Repository map

- `apps/web`: React 19 + Vite 8 + react-router 7 + TanStack Query client. Lint = **oxlint**.
- `apps/api`: NestJS 11 API/worker + Prisma 7.8 + SQLite (`better-sqlite3`) + Zod 4 + Temporal polyfill. Lint = **eslint**.
- `packages/contracts`: shared Zod schemas, permissions and transport types (framework-neutral).
- Toolchain: Node ≥24, npm ≥11, TypeScript ~6, ESM everywhere. Playwright projects: `desktop-chromium`, `mobile-chromium`.
- `docs/architecture.md`: short architecture overview.
- `docs/decisions.md`: authoritative chronological record of product invariants — consult it before relying on an invariant stated only here.
- `artifacts/openapi.json`: generated API reference; read only for API-map/OpenAPI work.
- `docs/bitrix24-*`: migration-only context; do not read for normal product/UI tasks.

Read `CODEX_CONTEXT_MAP.md` for targeted request flows.

Canonical authenticated home is `/overview` (data from `GET /dashboard`); the Live Feed is `/feed`. Import-control has no production `APPLY` path.

There is currently large in-progress uncommitted work in `apps/*` messages, `feed`, and a new `apps/api/src/modules/realtime` module. Keep changes narrowly scoped and expect this area to move.

## Context budget

Start with the exact files named by the task. Expand only through imports, call sites or failing tests.

Do not recursively inspect or search these generated/noisy paths unless the task explicitly targets them:

```text
.playwright-cli/
**/.playwright-cli/
output/
apps/web/artifacts/
apps/web/test-results/
coverage/
dist/
node_modules/
apps/api/src/generated/prisma/
artifacts/feed-rehearsal-*.json
```

Do not run repo-wide `git show`, `git diff HEAD~1`, empty-pattern `rg`, or `find .` to understand a local task. Use path-scoped commands.

## Existing product invariants

- One workspace holds multiple active companies, surfaced as organizational groups (`/companies`, `/organization`). `companyId` is a persistence key and UI filter, **not** an authorization boundary; there is no global company switcher in the shell. Every authenticated principal receives all active companies (decision 2026-08-31).
- Confidentiality is enforced at the aggregate boundary: a task is readable only by its creator/reporter/active participants/admin; a chat only by active participants/admin; a notification only by its recipient.
- Authorization is server-side. Search, chat, files, groups, tasks and employee projections must preserve current permission/scope checks.
- Direct chat threads are canonical and idempotent. Reuse `POST /messages/threads`; never create duplicate direct conversations.
- Org hierarchy already uses recursive `OrgUnit.parentId`; do not add another hierarchy model.
- Groups already exist and Tasks already have optional `groupId`.
- `Project` and `Tag` exist in `schema.prisma` as task-catalog records (`Task.projectId`, `Task.tags`). Do not build a standalone project-management aggregate, page or route, and do not treat `Project` as a company/authorization scope.
- Reuse canonical create routes/forms. Do not duplicate entity forms inside global search.
- Do not edit generated Prisma Client.

## Change boundaries

For a requested implementation:

- make only in-scope local changes;
- prefer existing components, contracts, endpoints and design tokens;
- do not add dependencies unless the task requires one;
- do not change Prisma schema or add migrations for a UI/search task;
- do not refactor unrelated large files in the same change;
- preserve URL-addressable state, keyboard behavior, responsive behavior and accessible names.

Ask before a material scope expansion, new persistent entity, destructive data migration, external write or dependency replacement.

## Stop conditions

Stop and ask before deleting a non-generated source file, changing application behavior, Prisma schema/migrations, permissions, contracts, dependencies, lockfile or CI, rewriting Git history, or removing an ambiguous large directory.

## Validation tiers

Use the smallest validation that proves the touched behavior.

### During implementation

Run only touched workspaces and focused tests.

Examples:

```bash
npm run typecheck --workspace @lankadws/contracts
npm run typecheck --workspace @lankadws/api
npm run typecheck --workspace @lankadws/web
npm run test:e2e --workspace @lankadws/web -- --project=desktop-chromium --grep "<focused scenario>"
```

### Before completing a feature slice

Run lint/typecheck/tests only for touched workspaces.

### Full release validation

Do **not** run these unless requested, preparing a merge/release, or targeted checks reveal cross-cutting risk:

```bash
npm run quality
npm run test:e2e
```

Do not run `npm ci` when dependencies and lockfile are unchanged and the existing install is usable.

## Output

End with:

1. concise behavior summary;
2. changed files;
3. validation commands and results;
4. any remaining risk or explicit non-goal.

Do not create generated screenshots, route-audit output or large evidence files unless explicitly requested.
