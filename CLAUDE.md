@AGENTS.md

<!-- Claude-specific notes; everything substantive lives in AGENTS.md so Codex and Claude share one source. -->

- `apps/api/AGENTS.md` and `apps/web/AGENTS.md` add workspace-specific navigation and rules; read the one for the workspace you are touching.
- `docs/decisions.md` is the authoritative, chronological record of product invariants. Consult it before assuming an invariant from a doc.
- `CODEX_CONTEXT_MAP.md` is a per-flow navigation map (routes, controllers, contracts, focused tests).
- Windows host: default shell is PowerShell (a Bash tool is also available). Expect CRLF/LF git warnings on checkout; do not "fix" line endings as part of a feature change.
- Default validation is focused per workspace: `npm run typecheck|lint|test --workspace @lankadws/<contracts|api|web>`. `npm run quality` and `npm run test:e2e` are release gates, not local defaults.
