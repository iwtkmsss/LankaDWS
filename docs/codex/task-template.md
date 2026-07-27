# Focused Codex task template

## Goal

State one observable behavior change.

## Existing behavior to reuse

Name the route, endpoint, component, service, or contract that already owns the behavior.

## Read first

List 5–12 exact paths. Start with `AGENTS.md` and the applicable section of `CODEX_CONTEXT_MAP.md`.

## Scope and non-goals

List permitted files/areas and explicitly exclude unrelated refactors, new dependencies, schema changes, and generated output.

## Acceptance criteria

Describe user-visible behavior, authorization/scope guarantees, URL and keyboard/accessibility requirements where applicable.

## Validation budget

List only focused workspace checks and one focused E2E scenario if necessary. Do not default to `npm run quality`, full E2E, route audit, migrations, or production build.

## Stop conditions

Ask before a new persistent entity, Prisma migration, permission model change, destructive migration, external write, dependency change, CI change, or material scope expansion.

## Completion output

Report behavior, changed files, validation results, and remaining risk/non-goals.
