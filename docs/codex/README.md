# Codex working guide

Use this directory as the compact entry point for repository work.

1. Read the root [AGENTS.md](../../AGENTS.md), then the nested instruction file for a touched workspace.
2. Read only the relevant flow in [CODEX_CONTEXT_MAP.md](../../CODEX_CONTEXT_MAP.md).
3. Use [api-map.md](api-map.md) for an endpoint inventory; it is generated from `artifacts/openapi.json`.
4. Start a product change from [task-template.md](task-template.md) or the closest focused task in [tasks](tasks/).

The `bootstrap/` directory preserves the bootstrap inputs and is not the day-to-day source of truth. Do not inspect generated browser output or run the route audit unless a task explicitly requests it.

Regenerate the API map with:

```bash
node scripts/generate-codex-api-map.mjs
```
