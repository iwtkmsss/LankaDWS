# Implementation checklist

Status legend: `[x]` implemented and verified; `[~]` implemented with a host-dependent check still pending; `[ ]` not complete.

## Foundation

- [x] npm workspaces: `apps/web`, `apps/api`, `packages/contracts`, one root lockfile.
- [x] Shared contracts, Zod runtime schemas, RFC 9457 errors and `/api/v1`.
- [x] Prisma SQLite schema, seventeen ordered migrations, WAL/foreign-key/busy configuration and append-only/lifecycle triggers.
- [x] Design tokens, local Onest, role-aware app shell, canonical route registry and permission navigation.

## Identity and administration

- [x] Nickname-only Argon2id login, opaque cookie session, CSRF, rotation/revocation and rate limiting.
- [x] First login, TOTP, recovery codes, recent re-auth, password/profile/notification settings and personal sessions.
- [x] First-admin and break-glass CLI guards; admin reset, unlock and two-person full-admin reset.
- [x] Users, companies, versioned roles/scopes, access preview, security policy, append-only audit and export UI/APIs.

## Work modules

- [x] Personal/manager/HR/admin overview backed by safe API projections.
- [x] Tasks list/detail/create/full edit/status, four canonical role views, participant ACL/management, personal favourite/important/follow/reminder state, safe activity history, server filters, saved views, checklist, one-level comment replies with attachments, task materials/source links, one-level full-task subtasks and durable idempotent recurrence.
- [x] Requests/approvals including absence v1 → returned → v2 → approved and observable effect results.
- [x] Calendar/presence with privacy-safe absence state.
- [x] Onboarding/offboarding with linked tasks and ownership-transfer blockers.

## Content and communication

- [x] Documents, immutable versions, knowledge articles and acknowledgements.
- [x] File streaming, MIME/hash validation, quarantine, scanner adapter and authorized download.
- [x] Announcements draft/schedule/publish/audience receipts/read/archive.
- [x] Context chat/comments, notifications/preferences, safe global search and saved views.
- [x] Capability-gated native Live Feed foundation: explicit company/group/user audiences, immutable source-version items, flat replies, attachments, like, subscriptions/mentions, acknowledgement recipient snapshots/receipts, monotonic read cursors, URL filters and saved views.

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
- [x] SaaS/CRM UX delivery rules recorded: one dominant task, progressive disclosure, WCAG 2.2 AA, reduced motion, useful-only imagery and CWV targets.
- [x] Overview and Administration use a compact first-viewport work focus, one concrete primary action, non-zero-only admin blockers, explicit link labels and company-scoped first clicks at desktop, 412 px and 320 px.
- [x] When `FEED` is enabled, canonical `/overview` switches atomically to a task-oriented Live Feed in the same Onest/navy/cobalt system; the legacy work overview remains the complete fallback for disabled companies.

## Verification

- [x] Lockfile install, lint, typecheck, unit/component/contract, CLI guard and security tests.
- [x] Empty/upgrade migrations, append-only audit, FTS5, SQLite busy recovery, expired job lease, idempotency and company-isolation tests.
- [x] API E2E for auth/CSRF, permissions, request effects, 409/429, quarantine scan/download, audit export and retention/legal hold.
- [x] Backup → restore into fresh directory → checksum/integrity/smoke verification.
- [x] Production build, desktop/mobile Playwright journeys, browser history, axe and visual screenshots.

## Bitrix24 functionality migration

- [x] Company capability foundation for `FEED`, `GROUPS_UI`, `DRIVE`, `CALENDAR_WRITE`, `CALLS` and `ABSENCES`: shared schemas, Prisma migration, conservative permission backfill, versioned admin API, audit/outbox and `/me` projection.
- [x] Daily navigation order is explicit: Огляд → Завдання → Чат → Календар; secondary modules use the existing dark-sidebar «Ще» disclosure on desktop and the mobile navigation drawer.
- [x] 390 px dashboard rows keep statuses inside the card without horizontal clipping.
- [x] Group/Member and OrgUnit/UserOrgAssignment kernels, safe read APIs, privacy/capability E2E coverage and controlled unavailable routes are implemented.
- [x] Company structure UI provides task-oriented search, safe employee projections, a controlled multi-company state and desktop/mobile browser QA.
- [x] Import control plane covers immutable sealed datasets/files, compatible snapshot/delta chains, validate/dry-run/apply runs, exclusive apply leases, blocking issues, external ID maps, append-only change journal, resumable binary transfer state and migration activation evidence.
- [x] Read-only admin readiness API/UI exposes only workspace-safe counters and explicit preflight gates; `system.manage` is required and production `APPLY` remains unavailable.
- [x] Strict signed snapshot-manifest v1 contract and read-only Ops validator verify pinned source compatibility, Ed25519 trust, safe paths, child size/SHA-256 and `checksums.sha256` without starting NestJS/DB or exposing raw/PII.
- [x] Privacy-safe company-mapping artifact v1 is transitively signed by the manifest, pins no-inference precedence, requires Product/Security/Data evidence and blocks unresolved roots/cross-company entities while reporting aggregate coverage only.
- [x] Read-only company-mapping DB preflight binds the signed artifact to a target workspace, exact active mapping rows and active target-company IDs/codes while keeping source roots and DB details out of reports.
- [x] Exporter-side manifest sealing performs bounded safe inventory, deterministic hashes/checksums, Ed25519 signing, no-overwrite/idempotent output and immediate verifier round-trip without loading secrets into environment text.
- [x] First native Feed vertical slice includes company/group/private denial, publish/edit/archive source lifecycle, explicit re-acknowledgement, flat comments, like, attention rail, monotonic cursor and audit/outbox E2E coverage.
- [x] Feed attachments reuse `FileObject`/`FileLink`, quarantine/scanner and source ACL; Task block/assignment, Event and delivered Announcement render as compact canonical cards whose immutable projection stores no editable source body.
- [x] Historical projection hook accepts only an explicit dependency-closed source ID set, writes `countsAsUnread=false`, seeds monotonic per-user cursors at the signed cutover boundary and is idempotent; it deliberately remains importer-internal while D-020 is unresolved.
- [x] Per-post Feed subscriptions expose `ALL|MENTIONS|NONE`, preserve an explicit mute across later comments, deliver only currently audience-eligible in-app notifications and add a compact URL/saved-view-compatible `FOLLOWING` filter.
- [x] Advanced Feed filtering composes a privacy-safe author facet, company-local date boundaries and direct mentions behind one responsive progressive-disclosure panel; rapid URL updates merge instead of overwriting one another.
- [x] Private per-user Feed favourites work for authored and canonical source cards, fail closed after access loss and compose with the exact `important` facet; `important` means every mandatory post while `ACK_REQUIRED` remains the pending-action inbox.
- [x] Exact `groupId` context and `audienceId` recipient facets compose in URL/saved views; option discovery is derived only from enabled companies and currently accessible posts, while hidden groups and inaccessible direct posts remain existence-safe.
- [x] Standalone File cards require an explicit high-risk share action, keep filename/MIME out of immutable `FeedItem.safePayload`, reuse live company/group/direct ACL plus scanner-gated download, and disappear after an audited versioned revoke; attachment upload alone never creates the card.
- [x] `FeedSourceHead` selects exactly one non-regressing current immutable projection per source, so cursor pages and unread/favourite state cannot repeat superseded versions; the isolated representative rehearsal covers 156,943 source heads, real source-fingerprint entity counts, ACL canaries, exact facets, query plans and 20-sample p50/p95 evidence without changing the development database.
- [x] First F3 Tasks vertical slice models each subtask as a real one-level `Task`: company/group scope is inherited and database-guarded, child-of-child/cross-scope links fail closed, idempotent creation is atomic with audit/outbox, parent completion returns safe `409 + blockingSubtaskIds`, progress refreshes after child completion, and the progressive-disclosure drawer passed desktop/390 px Playwright plus axe QA.
- [x] Second F3 Tasks slice adds canonical responsible/co-executor/creator/observer views, a guarded `TaskParticipant` lifecycle, creator/manager roster controls, co-executor edit rights, observer read/comment rights, existence-safe revocation across task/search/Feed paths, body-bound idempotency and compact desktop/mobile participant UI.
- [x] Third F3 Tasks slice adds optimistic full edit, guarded `TaskFollower`/`TaskUserState`/`TaskReminder` lifecycles, delivery-time reminder reauthorization, private URL/saved-view-compatible personal filters, safe paginated activity and an existing-style progressive drawer verified at 1440 px and 360 px with 44 px mobile actions, zero overflow and zero Axe violations.
- [x] Fourth F3 Tasks slice adds scanner-gated task materials, removable task-scoped file links, live-authorized Message/Lifecycle/Document source links, one-level comment replies with up to five task attachments, delivery-time reply notification reauthorization and a centralized task ACL where group membership is an additional boundary rather than an access grant. The compact progressive drawer passed 21 API E2E workflows, fresh-migration trigger probes, 18 desktop/mobile web journeys, axe and overflow checks.
- [x] First F3 Chat slice adds canonical direct/group threads, active-participant ACL, body-bound idempotency, company-scoped text search, exact unread counts, monotonic read cursors, personal mute, one-level replies and mute-aware notification fan-out. The seventeenth migration independently guards scope, participants, direct cardinality, reply depth, immutable message cores and read regression; 22 API E2E workflows and 20 desktop/mobile web journeys pass with axe, contrast, overflow and visual checks.
- [x] Second F3 Chat slice adds guarded group/contextual participant management, immutable direct/company membership, last-owner and group-minimum rules, up to five scanner-gated message attachments, live thread-derived file access and optimistic own-message edit/delete with a retained marker. The compact Onest/navy/cobalt UI uses a progressive participant drawer and message action menu; target API, fresh-migration and desktop/mobile axe/overflow/visual coverage pass without adding decorative imagery to the operational surface.
- [x] Third F3 Chat slice converts an accessible non-deleted message into a same-company task or internal calendar event from one progressive drawer. The server derives company scope from the thread, binds retries to the normalized body, preserves the message as an `EntityLink`, gates event creation with `calendar.manage + CALENDAR_WRITE`, and writes aggregate, audit and outbox atomically. The nineteenth migration independently guards EVENT→MESSAGE scope and immutability; focused contract/type, migration, API and mobile UI scenarios pass.
- [~] Full F3 user-facing scope is implemented: advanced task facets and authorized Chat SSE with automatic polling fallback are active. Persisted multi-process replay/expired `Last-Event-ID` reset remains a topology-dependent hardening item, not a missing chat workflow.
- [x] Employees P1 directory uses the existing org kernel for company, department, manager and availability filters, preserves filters in the URL, keeps org fields permission-aware and exposes the same compact employee profile on desktop/mobile without a schema migration.
- [~] Drive now provides useful server-backed My/Shared/Drafts/Archive sections, company/type/sort filters, file sizes, version counts, selected-company upload and audited archive/restore on the existing document/file access boundary. Persisted nested/group folders are intentionally not claimed or migrated until their real need is confirmed.
- [~] Calendar now has Day/Week/Month/Schedule views, period-aware navigation, URL-persisted My/Team scope, organizer labels and responsive daily/weekly layouts on the existing Event model. Participants, RSVP and reminders remain intentionally absent until a durable model is explicitly approved; no fake JSON persistence or migration was introduced.
- [x] Active Group detail is a compact work hub for exact-context Feed, task list/create and one canonical contextual chat. New tasks persist the existing `Task.groupId`; assignees are group members, and chat/thread/SSE/file reads recheck live membership so leaving a group removes access without a migration.
- [x] Global `Ctrl/Cmd+K` combines permission-aware quick navigation with debounced grouped search across Tasks, Requests, Groups, Chat, Drive, Employees, Calendar and Knowledge; company/ACL/live-membership rules are rechecked server-side, while keyboard, focus-trap and mobile behavior stay within the existing shell design.
- [x] Notification center is a compact daily-action queue with correct Action/Unread/Mentions/All filtering, bulk read, canonical entity links, localized categories, responsive controls and a real unread topbar badge. It reuses the existing `Notification` model and does not add a migration.
- [x] One permission/capability-aware Quick Create is available from desktop/mobile topbar and as the first `Ctrl/Cmd+K` group for Task, Chat, Calendar Event, Request, Group, Drive upload and Announcement. It reuses canonical forms, persists company scope and resolves `company=all` to a real enabled company without a migration.
- [x] Chat unread summary exposes no message bodies or user profiles, rechecks company/participant/live-group access and drives the same count in sidebar, topbar and mobile nav. Active thread SSE disables redundant list polling; foreground polling remains only as fallback.
- [x] Requests are a compact responsive Mine/Approval/HR-company queue with stable counts, URL search/page/company state, author/approver context, SLA warning and pagination. The existing drawer now exposes cancel and approval decisions, while a returned absence restores its latest safe snapshot in the company-aware wizard for resubmission; no migration was added.
- [x] Employee cards/profile connect a person to canonical work: direct chat preselects that employee, Task preselects the assignee and Calendar prefills only a safe time-block title. All actions reuse company/permission/capability checks; `company=all` direct-chat creation now resolves to a concrete allowed company.
- [ ] Full F2b exit now requires only importer-runner integration after D-020 approval; the local Feed evidence does not close DDB-004 production topology/capacity.
- [ ] Real approved company inventory/mapping, capacity evidence, deterministic source extractor and rehearsal runner remain F1 work; DDB-007/D-024 and other blockers stay open and no unfinished mutation or misleading `APPLY` control is exposed.

## Current implementation-stage closure · 2026-07-24

- [x] The internal CRM product/design stage requested before the real Bitrix transfer is complete: the primary daily flows are implemented in the existing Onest/navy/cobalt shell, Chat uses authorized SSE with polling fallback, and the latest combined API/Web typecheck passed.
- [x] No additional schema migration is required for the remaining product UI work in this stage.
- [ ] The next data stage starts only with a real approved source inventory, company mapping and snapshot/extractor input. It is the one controlled legacy-to-BertCRM transfer flow; it must not be replaced by speculative schema work or synthetic claims that production data was imported.
