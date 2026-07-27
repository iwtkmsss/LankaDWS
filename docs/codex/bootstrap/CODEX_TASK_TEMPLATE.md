# Codex task template — BertCRM

## Mode

Choose one:

```text
Ask/plan only
Implementation
Review/diagnosis only
```

## Goal

One measurable result in 1–3 sentences.

## Existing behavior to reuse

- Existing component:
- Existing endpoint:
- Existing contract:
- Existing test pattern:

## Read first

```text
exact/path/one.ts
exact/path/two.tsx
```

Expand only through direct imports/call sites or failing focused tests.

## Scope

- Change:
- Change:
- Preserve:

## Out of scope

```text
schema migration
new dependency
unrelated refactor
full route audit
generated artifacts
```

## Acceptance criteria

1. Observable behavior.
2. Observable behavior.
3. Permission/error/empty state.
4. Mobile/keyboard requirement when relevant.
5. No regression condition.

## Validation budget

```bash
# touched workspace typecheck
# targeted unit/integration test
# one focused Playwright project/grep when necessary
```

Do not run `npm ci`, root `npm run quality` or full `npm run test:e2e` unless explicitly requested or a focused failure proves cross-cutting risk.

## Stop conditions

Ask before:

```text
new persistent entity
new permission
destructive migration
external write
material scope expansion
```

## Completion output

1. behavior implemented or diagnosis;
2. changed/relevant files;
3. validation results;
4. remaining risk/non-goals.
