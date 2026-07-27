# Codex optimization report

Audited: 2026-07-27. This report records the operating decisions, not a second architecture manual.

- Keep work as small vertical slices. Search, chat, organization display, groups, and any future project concept have different invariants and tests.
- Reuse existing command palette, canonical create routes, direct-thread API, recursive `OrgUnit`, groups, and `Task.groupId`. There is no approved `Project` aggregate.
- Start with task-named files and `CODEX_CONTEXT_MAP.md`; expand through imports, call sites, or a focused failing test only.
- Use focused workspace checks during implementation and reserve `npm run quality` and full E2E for merge/release or explicit requests.
- Ignore generated Playwright state and `output/`; do not use route-audit artifacts as normal task context.

The generated API inventory is [api-map.md](api-map.md). Durable product decisions belong in [docs/decisions.md](../decisions.md).
