# Implementation checklist

Status legend: `[x]` implemented and verified; `[~]` implemented with a host-dependent check still pending; `[ ]` not complete.

## Foundation

- [x] npm workspaces: `apps/web`, `apps/api`, `packages/contracts`, one root lockfile.
- [x] Shared contracts, Zod runtime schemas, RFC 9457 errors and `/api/v1`.
- [x] Prisma SQLite schema, three ordered migrations, WAL/foreign-key/busy configuration and append-only triggers.
- [x] Design tokens, local Onest, role-aware app shell, canonical route registry and permission navigation.

## Identity and administration

- [x] Nickname-only Argon2id login, opaque cookie session, CSRF, rotation/revocation and rate limiting.
- [x] First login, TOTP, recovery codes, recent re-auth, password/profile/notification settings and personal sessions.
- [x] First-admin and break-glass CLI guards; admin reset, unlock and two-person full-admin reset.
- [x] Users, companies, versioned roles/scopes, access preview, security policy, append-only audit and export UI/APIs.

## Work modules

- [x] Personal/manager/HR/admin overview backed by safe API projections.
- [x] Tasks list/detail/create/status, server filters, saved views, checklist/comments and durable idempotent recurrence.
- [x] Requests/approvals including absence v1 → returned → v2 → approved and observable effect results.
- [x] Calendar/presence with privacy-safe absence state.
- [x] Onboarding/offboarding with linked tasks and ownership-transfer blockers.

## Content and communication

- [x] Documents, immutable versions, knowledge articles and acknowledgements.
- [x] File streaming, MIME/hash validation, quarantine, scanner adapter and authorized download.
- [x] Announcements draft/schedule/publish/audience receipts/read/archive.
- [x] Context chat/comments, notifications/preferences, safe global search and saved views.

## Platform and operations

- [x] SQLite durable jobs/outbox, atomic lease recovery, retries/backoff and idempotency.
- [x] Versioned retention policy, impact dry-run, exact legal hold, re-auth/idempotent purge, append-only audit and CSV export jobs.
- [x] Online SQLite backup, AES-GCM DB/files manifest, SHA-256, 30-daily/12-monthly rotation and fresh restore verification.
- [x] Public live/ready, protected detailed health, structured redacted request logs, latency/queue/WAL/storage/backup metrics and production config fail-closed.
- [x] OpenAPI artifact, operations runbook, deployment/incident/secret-rotation documentation and SQLite capacity boundary.

## Frontend and visuals

- [x] All canonical routes and protected 403/privacy-404 outcomes.
- [x] Desktop/tablet/mobile shell, focus-trapped drawers/sheets, server filters, URL company scope and cache isolation.
- [x] Local hero/auth/error/lifecycle/avatar assets, local font/license and asset manifest.
- [x] Loading/empty/403/404/500/offline/conflict/maintenance states, keyboard/focus behavior and axe smoke.

## Verification

- [x] Lockfile install, lint, typecheck, unit/component/contract, CLI guard and security tests.
- [x] Empty/upgrade migrations, append-only audit, FTS5, SQLite busy recovery, expired job lease, idempotency and company-isolation tests.
- [x] API E2E for auth/CSRF, permissions, request effects, 409/429, quarantine scan/download, audit export and retention/legal hold.
- [x] Backup → restore into fresh directory → checksum/integrity/smoke verification.
- [x] Production build, desktop/mobile Playwright journeys, browser history, axe and visual screenshots.
