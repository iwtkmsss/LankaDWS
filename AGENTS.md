# AGENTS.md — BertCRM

## Purpose

Help Codex make small, safe, reviewable changes in this npm-workspaces monorepo without repeatedly scanning unrelated code or running the full release pipeline.

## Repository map

- `apps/web`: React 19 + Vite + TypeScript client.
- `apps/api`: NestJS API/worker + Prisma + SQLite.
- `packages/contracts`: shared Zod schemas, permissions and transport types.
- `docs/architecture.md`: short architecture overview.
- `docs/decisions.md`: durable architecture decisions.
- `artifacts/openapi.json`: generated API reference; read only for API-map/OpenAPI work.
- `docs/bitrix24-*`: migration-only context; do not read for normal product/UI tasks.

Read `CODEX_CONTEXT_MAP.md` for targeted request flows.

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

- One authenticated organization; `companyId` is an internal persistence key, not a user-facing multi-company selector.
- Authorization is server-side. Search, chat, files, groups, tasks and employee projections must preserve current permission/scope checks.
- Direct chat threads are canonical and idempotent. Reuse `POST /messages/threads`; never create duplicate direct conversations.
- Org hierarchy already uses recursive `OrgUnit.parentId`; do not add another hierarchy model.
- Groups already exist and Tasks already have optional `groupId`.
- There is no approved standalone `Project` model. Do not add Project/schema migrations unless the task explicitly approves a design.
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
npm run typecheck --workspace @bert-crm/contracts
npm run typecheck --workspace @bert-crm/api
npm run typecheck --workspace @bert-crm/web
npm run test:e2e --workspace @bert-crm/web -- --project=desktop-chromium --grep "<focused scenario>"
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
