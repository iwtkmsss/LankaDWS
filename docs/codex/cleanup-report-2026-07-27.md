# Cleanup report — 2026-07-27

Performed a safe local cleanup of ignored generated artifacts only.

- Removed Playwright state, reports, screenshots, and one-off audit helpers.
- Removed generated `dist/` outputs, the disposable web E2E SQLite database, and old dev-server logs.
- Estimated recovered space: 45,231,361 bytes (about 43.14 MiB).
- No Git-index removals or `.gitignore` changes were needed.
- Product source, tests, runtime data, backups, `.env`, the development database, and generated Prisma Client were preserved.

The reusable `output/playwright/route-audit/standalone-audit.mjs` was intentionally retained because current documentation references it.
