# Task 00 — repository hygiene

## Goal

Keep agent instructions, generated context boundaries, and the API map accurate without changing product behavior.

## Read first

`AGENTS.md`, `CODEX_CONTEXT_MAP.md`, `apps/web/AGENTS.md`, `apps/api/AGENTS.md`, `.gitignore`, `scripts/audit-codex-context.mjs`, `scripts/generate-codex-api-map.mjs`, and `artifacts/openapi.json`.

## Scope

Documentation, agent instructions, helper scripts, `.gitignore`, and generated artifacts only. Preserve reusable source scripts only when they are genuinely portable; do not move hard-coded audit output into source paths.

## Acceptance criteria

- Instructions list real workspace commands and current invariants.
- `docs/codex/api-map.md` is generated from OpenAPI with method, route, tag, and operation ID.
- Generated browser state is ignored and tracked generated artifacts are removed from the Git index without deleting local files.
- Markdown links resolve locally.

## Validation

```bash
node --check scripts/audit-codex-context.mjs
node --check scripts/generate-codex-api-map.mjs
node scripts/generate-codex-api-map.mjs
node scripts/audit-codex-context.mjs || true
git diff --check
```

## Non-goals

No application code, Prisma schema/migrations, contracts, dependencies, lockfile, or CI changes.
