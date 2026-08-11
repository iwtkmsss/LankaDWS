# Decisions

No unresolved product contradiction was found. The repository's prior `frontend/` and `backend/` scaffold contained no user work beyond the initial commit, so it was moved to the required `apps/web` and `apps/api` paths instead of keeping parallel workspaces.

## 2026-07-27 — One organization with recursive departments

BertCRM no longer models several selectable companies. A user operates in one organization, while structure is represented by the existing recursive `OrgUnit.parentId` hierarchy, so a department may contain any number of nested subdepartments.

The current `companyId` columns remain only as a transitional persistence key to avoid a destructive rewrite of historical SQLite migrations and foreign keys. Runtime scope always resolves to the principal's single organization record, rejects legacy alternative IDs, removes `company=all`, and no longer exposes company switching, company creation, multi-company user assignment or company-scoped navigation. The demo «BERT Сервіс» boundary is now the «Сервісний відділ» node under «Операції».

## 2026-07-22 — Capability foundation before feature modules

The migration plan is guidance, not a reason to expose incomplete parity. Company capability infrastructure is implemented before Feed/Groups/Drive UI, with every new capability disabled by default. This lets future modules roll out per company without dead navigation, while the existing Overview, Messages and Calendar remain usable.

The first navigation simplification is intentionally independent from those feature gates: the four daily destinations have a fixed order and all existing secondary functionality remains reachable through «Ще». The change reuses the approved Onest, navy/cobalt tokens, Lucide icons and existing shell geometry; it does not introduce a parallel visual system.

## 2026-07-23 — Evidence-based SaaS/CRM UX rules

The provided high-conversion research is adopted as a delivery quality bar, with “conversion” interpreted for BertCRM as successful completion of a work task. The hard gates are ethical UX, WCAG 2.2 AA, reduced-motion support and Core Web Vitals targets. The SaaS-specific emphasis is progressive disclosure, task-oriented information architecture and a clear dominant action instead of exposing every available module at once.

Images remain conditional: they are used only when they add meaning or improve a decision. The company-structure workflow therefore uses the existing code-native visual system and real seeded avatars rather than a generated decorative illustration. Its first useful release is read-only, company-scoped and privacy-safe; group UI stays behind its capability and release gate until the full user workflow is ready.

## 2026-07-23 — Import safety before import controls

The F1 import foundation is implemented as a control plane and a read-only readiness view, not as a partial runner. The database now enforces immutable sealed packages, compatible delta ancestry, scoped mapping and activation evidence, exclusive apply leases, preserved external ID maps and an append-only change journal. These invariants live below the future worker and UI so a caller cannot bypass them accidentally.

Production `APPLY` is intentionally unavailable while D-011, D-012, D-020, D-023 and D-024 remain unresolved. The admin screen uses the existing BertCRM cards, typography, tokens and Lucide language to show one dominant outcome—blocked or ready—followed by the concrete gates. It does not display raw source fields, offer a disabled imitation of an apply workflow or add decorative generated imagery.

## 2026-07-23 — Signed dataset verification before an importer

The next migration increment is a verifier, not a source reader or target writer. A strict v1 envelope now pins the audited Bitrix/Percona environment, requires safe relative child paths and mandatory evidence files, and signs deterministic canonical bytes with Ed25519. Every declared child is checked against its signed size/SHA-256 and `checksums.sha256`; unknown keys, traversal, links escaping the root, filesystem mutation and malformed service files fail closed with stable codes.

The operator entry point reads an explicit absolute `BITRIX_SNAPSHOT_ROOT` outside the repository and runs without NestJS or Prisma. Human and JSON output contain safe IDs, relative paths, counters and hashes only. A browser uploader was rejected for this stage because the real dataset belongs in encrypted Operations storage and is far beyond a convenient or safe web-upload workflow. This decision establishes preflight evidence but deliberately leaves all DDB blockers and production `APPLY` closed.

## 2026-07-23 — Company mapping is signed evidence, not an inferred fallback

The manifest now requires `reports/company-mapping.json` with an explicit privacy-safe v1 contract. It contains opaque source-root keys/fingerprints, stable target company IDs/codes, fixed authoritative resolution precedence and Product/Security/Data evidence references. The manifest signature covers the artifact hash, so a second redundant signature format is not introduced.

The validator never reports source roots or approver identities. It exposes aggregate coverage only and blocks version/source mismatch, missing approvals, quarantined roots and unresolved cross-company entities. This formalizes the evidence shape without pretending that DDB-007/D-024 is resolved: the real source inventory, mapping choices and cross-company policy still require owner approval before DB-backed validation or import.

## 2026-07-23 — Signed company mapping must equal active target state

The mapping artifact now names its target workspace, and a separate Ops command reruns the complete signed-filesystem preflight before touching the database. Only then does it read the exact active `SourceCompanyMapping` scope and compare it as a set with the signed roots, target IDs/codes, workspace and active company state. Missing, retargeted, unexpected, duplicated or invalid target rows fail closed.

The database step is intentionally read-only and bounded. Its report contains only the target workspace/version, hashes, aggregate counters and stable issue codes; source-root keys, company names/codes and raw database errors remain private. It does not seal a dataset or imply that real DDB-007/D-024 owner approval is complete.

## 2026-07-23 — Work focus replaces decorative dashboard heroes

The authenticated Overview and Administration first view now follows the provided SaaS/CRM research as a task-completion surface. It keeps the established Onest, navy/cobalt, card and Lucide visual language, but replaces oversized decorative hero imagery with a compact focus panel: one status, one next step and one concrete primary action. Supporting metrics are navigable, generic link labels are explicit, empty admin warnings are hidden and the effective company scope survives the first click even when login initially lands on `/overview` without a query string.

The change does not remove useful project imagery globally. Lifecycle, authentication and error visuals remain where they explain context; generated or stock dashboard images are rejected unless a later workflow demonstrates information value. Desktop, 412 px and 320 px browser checks confirm the working content appears in the first viewport, and the primary task action opens the expected detail while preserving company scope.

## 2026-07-23 — Exporter sealing is one idempotent Ops step

Operations no longer has to hand-author hashes, the checksum index or the signed envelope. A strict external seal request contains evidence-backed dataset metadata and a non-secret signer/key reference, while the Ed25519 private key remains in a separate file outside the repository and dataset. `import:seal-manifest` inventories only allowlisted regular files, derives deterministic source types, hashes stable bytes, creates sorted checksums and a canonical signature, then accepts the output only after the existing independent verifier validates the entire package and company mapping.

The command never overwrites an existing manifest or checksum index. An identical rerun is read-only and returns the same manifest hash; a changed export, unsafe entry, concurrent mutation or mismatched existing output fails closed. Outputs created by the current attempt are removed when verifier round-trip fails. This closes the BertCRM-side manifest-generation gap without claiming that the real source extractor, DDB-007/D-024 approvals, capacity evidence, rehearsal or production `APPLY` is complete.

## 2026-07-23 — Live Feed replaces Overview only after a company capability switch

The first native Feed increment uses canonical `/overview`; it does not add a competing `/feed` route. A company with `FEED` disabled keeps the complete task-first Overview, while an enabled company receives the Feed label, composer and stream atomically. The demo enables only BERT Україна so both rollout states remain directly testable.

`FeedPost` is the editable source and append-only `FeedItem` rows record source versions. Audience rows remain explicit company/group/user principals; acknowledgement expands that audience to a versioned user snapshot in the same transaction. Reading, liking or commenting never creates a receipt. Editing a mandatory post advances the acknowledgement version and snapshots current recipients again. Private denials use existence-safe 404 responses, and read cursors only advance.

The UI applies the provided CRM design research without introducing another visual system: the composer has one primary action, audience labels are persistent, advanced post actions are disclosed on demand, the attention rail contains only actionable counts and mobile moves that rail before the stream. No generated or stock image is added to this dense work screen because imagery would not improve a decision here.

## 2026-07-28 — Overview and Live Feed are separate canonical work surfaces

This decision supersedes the 2026-07-23 routing decision above without deleting its rollout history. `/overview` is again the stable authenticated CRM home for every organization, while `/feed` is the canonical Feed route guarded by both `feed.read` and the existing `FEED` capability. Feed filters, saved views and browser-history state move with the Feed surface to `/feed`; `/overview` is never conditionally relabelled or replaced.

The existing dashboard contract and `GET /dashboard` remain the single Overview data boundary. The response now composes permission-aware task, calendar, announcement, message, notification, Feed-activity and HR lifecycle projections, uses the organization IANA timezone for daily boundaries, and omits unavailable blocks instead of fetching private data for hidden metrics. The existing task-first focus panel remains compact, with navigable KPI and one small task-status analysis rather than a duplicate analytics page.

Blocking overlays share one portal, focus, stack and scroll-lock owner. Drawer keeps its side-panel geometry, Modal provides the Feed composer surface, and Command Palette keeps its keyboard/search specialization. The desktop sidebar groups the same route registry into Основне, Комунікації, Компанія, Управління and Адміністрування; its persisted icon-only state is independent from the mobile menu and does not create alternate routes or authorization gates.

This was the first complete native-post vertical slice, not a claim that F2b migration parity was finished. The subsequent decisions below add attachments, source projections, historical silent materialization and subscription preferences; the checklist remains the current source for outstanding F2b exit work.

## 2026-07-23 — Feed source cards remain projections and imported history stays silent

Task, Event and Announcement activity now appears in Feed only as an immutable reference to the canonical aggregate. `FeedItem.safePayload` carries a versioned source reference and action, never an editable copy of the task description, event or announcement body. Every list response re-authorizes and reloads the current source; the card has one explicit navigation action and no copied post controls. Native task assignment plus block/unblock transitions are relevant, while ordinary task comments and technical churn remain out of the company stream. Announcement projection occurs only after the durable audience materializer has produced receipts.

Attachments reuse the existing `FileObject` → quarantine/scanner → `FileLink` boundary. Publishing can link only files uploaded by the author into the same company, recipients re-use the post audience for authorization, and download remains unavailable until scan state is `CLEAN`. No second blob store or Feed-specific public URL is introduced.

Historical materialization is an importer-internal hook that requires an explicit, dependency-closed set of canonical IDs and a cutover timestamp. It writes idempotent `countsAsUnread=false` projections, suppresses ordinary outbox/notification effects and advances a read cursor only to the newest visible historical item without moving an existing newer cursor backwards. There is deliberately no “import all history” HTTP control while D-020 is unresolved; the future approved importer runner must supply the selected IDs and reconciliation evidence.

The visual treatment follows the provided SaaS/CRM research: source cards are shorter than authored posts, use the existing Lucide/tokens, expose one concrete next step and place the type facet behind one compact selector. Generated imagery remains inappropriate for this dense decision surface.

## 2026-07-23 — Feed subscriptions preserve user intent

Every authorized post reader can choose `ALL`, `MENTIONS` or `NONE` from one compact card control. Author, commenter and mention rules create an initial subscription only when one does not already exist; they never turn a later explicit mute back on. `NONE` remains a durable row rather than absence of a row, so a future comment cannot be mistaken for permission to resubscribe.

Comment notifications are materialized in the same transaction as the comment, use an idempotent per-comment/recipient key and contain only a safe generic snippet. `ALL` receives new comments, `MENTIONS` receives only explicit mentions and `NONE` receives neither. Current active company/audience eligibility is checked again before delivery, while opening the source continues to require normal Feed authorization. Preference changes create no business outbox or audit noise.

The `FOLLOWING` list filter returns only authored posts with an active subscription and remains URL/saved-view compatible. The UI labels are intentionally short enough to keep all primary Feed tabs visible at 412 px, while the three notification outcomes stay progressively disclosed behind the bell control.

## 2026-07-23 — Feed advanced filters stay compositional and local-time correct

Author, date and direct-mention filtering is disclosed behind one compact panel instead of expanding the primary toolbar. The three facets compose with the existing primary tab and type facet, remain URL/saved-view addressable and merge rapid updates through one search-parameter boundary. Previous results stay visible while a new query resolves, avoiding a full-surface loading flash during routine refinement.

The API, not the browser, owns date semantics. A calendar date is converted to an inclusive UTC boundary separately for each capability-authorized company's IANA timezone, including daylight-saving offsets; an inverted range fails validation. `mentioned=true` is an explicit authored-post facet. Author options are derived only from currently accessible posts and re-authorized canonical source projections, so the facet cannot disclose a hidden employee or source.

This follows the provided SaaS/CRM research as an operational UX rule: progressively disclose uncommon precision, keep labels concrete and preserve the user's working context. The surface intentionally reuses the existing Onest/navy/cobalt/Lucide system; decorative generated imagery would add density without improving a Feed decision.

## 2026-07-23 — Feed favourites are private state, not visibility

`FeedUserItemState` stores a user's favourite against the immutable `FeedItem`, so the same mechanism works for authored posts and current canonical Task/Event/Announcement projections. The write endpoint first performs normal capability, audience and source re-authorization and returns an existence-safe 404 for an inaccessible item. The database additionally requires an active same-workspace company assignment when the state is first created. A favourite is never consulted as an authorization grant, produces no business outbox/audit noise and is removed idempotently.

When a post edit or source update materializes a newer immutable projection, the transaction moves deduplicated favourite state for still-active, company-authorized users to the current `FeedItem` and removes it from superseded versions. Consequently, «Обране» follows the logical card instead of pinning stale content, while every read still applies current audience and canonical-source authorization.

The `favorite=true` facet filters any visible item by the current user's state. `important=true` is deliberately not a second personal flag: it maps the legacy important-post meaning to all posts that require acknowledgement. The existing `ACK_REQUIRED` tab remains the actionable subset that the current recipient has not yet confirmed, avoiding two controls with indistinguishable results.

Visually, one familiar star sits in the card header instead of adding a fourth action to the mobile reaction row. The advanced panel keeps «Лише обране» and «Важливі публікації» beside the existing precision facets, with short explanations and URL/saved-view persistence. Desktop and mobile visual QA corrected the global label direction so each option remains a compact horizontal `checkbox + explanation` control.

## 2026-07-23 — Feed recipient and group facets stay exact and existence-safe

`groupId` answers “in which work-group context was this item published?” and matches `FeedPost.groupId` or the explicit group on a standalone File share. `audienceId` answers “to which exact company or person was it addressed?” and matches a typed stored recipient. The two parameters may compose, but neither approximates org membership or expands a legacy right code. Task/Event/Announcement sources still stay excluded when these facets are active because they do not expose the same typed context.

The read-only facet endpoint returns enabled companies plus group and direct-recipient values found in posts the current principal can already read. Hidden groups, inaccessible direct posts and random known IDs therefore yield neither a label nor content. A saved ID that is no longer available is rendered with a generic fallback label so reopening a view does not become an existence oracle.

The panel presents separate «Кому адресовано» and «Робоча група» selects alongside author/date precision because those are distinct questions. They update immediately, share the existing merged URL boundary, persist in saved views and suppress automatic mark-read just like every other filtered view. Desktop uses a balanced three-column grid with the final two binary facets split evenly; mobile keeps a single-column flow and the existing sticky navigation.

## 2026-07-23 — A standalone File card is an explicit revocable ACL source

Uploading a file or attaching it to a post never creates standalone Feed activity. `FeedFileShare` is a separate versioned source created only by the explicit `feed.create + documents.share` mutation with an idempotency key and one exact company, group or direct-user audience. The partial active-audience key prevents duplicate live shares, while database guards bind the owner, file, company, group and recipients to the same active workspace scope.

The immutable `FeedItem` stores only the share ID, action and version—never filename, MIME, size or storage key. A list response re-authorizes the active share, reloads current `FileObject` metadata and applies live group/direct/company membership; the download endpoint independently performs the same share check and still requires `scanStatus=CLEAN`. Revoking advances the source version, records high-risk audit/outbox evidence and immediately removes recipient visibility and download access without deleting historical projection evidence.

The composer keeps two adjacent, literal actions: «Додати файл» means an attachment to the authored post, while «Поширити файл» means a compact standalone card for the currently selected audience. Pending and blocked scanner states replace the download action instead of producing a failing link. The card reuses the existing Onest/navy/cobalt system with a restrained violet file accent, one primary download action and an inline two-step revoke confirmation; no decorative image is introduced into the dense work surface.

## 2026-07-23 — Feed current state is an explicit guarded head, not page-local deduplication

Immutable `FeedItem` rows remain the audit-friendly activity history, but list, unread, read-marker and favourite semantics need exactly one current version for each `(workspace, company, source type, source ID)`. Page-local overfetch and deduplication could repeat an older version on a later cursor page and count several versions as unread. `FeedSourceHead` now points to the current immutable item, advances only by source version and deterministic time/ID ordering, and is protected by database scope/match/regression triggers. Historical rows remain intact; only the mutable pointer changes.

The ordered head index is the primary list boundary, and a second unread index keeps silent imported history out of the live counter path. Post and canonical Task/Event/Announcement/File projection writers advance the head in the same transaction; favourites move to that same item. Reads still re-authorize the canonical source, so the head is a relevance/index primitive and never an access grant.

The F2b evidence runner creates a fresh temporary database and uses the actual service path with source-fingerprint counts, superseded versions, ACL canaries, exact facets and cursor traversal. Its machine artifact records the host, dirty-worktree state, query plans and 20-sample p50/p95 without inventing an acceptance threshold. This local Feed baseline closes the relevance/load-evidence item only; DDB-004 remains open for full topology, concurrency, import, binary, search and restore capacity.

## 2026-07-24 — A subtask is a full Task with a guarded one-level hierarchy

A checklist item remains a lightweight completion mark inside one task. A subtask instead has its own number, assignee, status, priority, deadline, description and comments, while inheriting the parent workspace, company and optional work-group context. The target deliberately supports one child level for the current product scope: a child cannot receive another child, move under a different parent or diverge from the inherited scope. Application checks provide useful errors, and SQLite triggers enforce the same invariants against races or alternate writers.

Creating a child advances the parent version and atomically records idempotency, audit and outbox evidence. Changing a child status also advances that parent version so progress cannot remain silently stale. A parent cannot enter `DONE` while any child is outside `DONE|CANCELLED|ARCHIVED`; the API returns RFC 9457 `409` with only the safe blocker IDs, and the UI links those IDs to authorized child titles after its normal detail projection has been loaded.

The drawer keeps the established BertCRM visual language and treats decomposition as progressive disclosure. The default detail remains compact; opening «Додати підзадачу» exposes externally labelled fields and explains automatic context inheritance. Completion conflict is not a toast that disappears: it is an alert inside the task, receives focus, scrolls into view and offers the concrete blocking child as the next action. No decorative image is introduced because it would compete with a dense operational decision. This decision covers the first Tasks slice only; it does not substitute for the remaining edit, reminder/follower/activity or Chat P0 work in F3.

## 2026-07-24 — Task role explains access; follower remains separate intent

A task keeps exactly one responsible (`Task.assigneeId`) and one creator (`Task.creatorId`). Co-executors and observers are active, soft-removable `TaskParticipant` rows. A co-executor may update the task because that role represents shared execution; an observer may read and comment but cannot mutate status, checklist, recurrence or subtasks. Creator or `tasks.manage` owns the roster. Optional group membership is still an additional mandatory boundary for every role, never an access shortcut.

Removing a participant must revoke direct task, global-search and current Feed-projection access unless another current role still grants it. Every path re-authorizes the canonical task and returns an existence-safe not-found response after access loss. Historical soft-removed rows remain for audit/import reconciliation. A follower will be a separate future notification subscription: observer membership is not silently converted to following, and notification preference will not become an authorization grant.

The four daily perspectives are canonical URL/API values: `RESPONSIBLE`, `CO_EXECUTOR`, `CREATOR` and `OBSERVER`; `ALL` is available only with `tasks.manage`. The UI uses the existing BertCRM tabs, drawer, tokens and typography, keeps participant management progressively disclosed, and collapses the participant grid to one column with 44 px actions on mobile. Decorative imagery remains unsuitable because it would displace live task context on this decision-heavy surface.

Task creation and participant addition bind each idempotency key to an HMAC fingerprint of the normalized request body. A retry of the same operation returns the original result, while reusing the key with a different body fails safely instead of mutating an unrelated roster.

## 2026-07-24 — Personal task intent is private state, not authorization

`TaskFollower`, `TaskUserState` and `TaskReminder` express what one already-authorized person wants to watch, mark or remember. None is an access role and none can keep a task visible after company, group or participant access is revoked. Database guards require an active user and current task scope when intent is created. Comment notification fan-out and reminder delivery re-authorize the canonical task again at delivery time; inaccessible reminders are cancelled and revoked followers are muted instead of becoming delayed information leaks.

Task edit follows the same explicit ownership model as the participant decision. Creator or `tasks.manage` may change ordinary fields and reassign work, but only `tasks.manage` may transfer the creator. Every new responsible or creator must already be an active company user and, for a grouped task, an active group member. The optimistic `expectedVersion` contract rejects stale drawers. Activity exposes only allowlisted Ukrainian event labels, safe changed-field names, actor identity and time—never stored audit payloads.

The UI puts favourite, important and follow in one “Для мене” cluster because they are frequent personal choices, while reminders and history stay behind native progressive disclosure. Personal filters remain exact URL/saved-view facets. The live 1440 px and 360 px checks proved no horizontal overflow, 44 px mobile actions, zero Axe violations with reminder/history content expanded and no application console errors. The surface reuses the established Onest/navy/cobalt/Lucide language; generated imagery would consume task context without helping the decision.

## 2026-07-24 — Task context needs two live authorization checks

A task file or comment attachment inherits access from the canonical task, but work-group membership alone never makes that task visible. A reader still needs to be the creator, responsible, an active co-executor/observer or hold `tasks.manage`; optional group membership is an additional mandatory boundary. Removing the task’s `FileLink` immediately removes task-derived file access, while the canonical `FileObject` remains available to its owner and any other independently authorized link.

A Message, Lifecycle or Document source link is not copied task content. The task projection shows it only when the reader passes both current task authorization and current source authorization, and opening it rechecks the source again. Unknown relation types and revoked sources disappear without exposing a title, filename or existence hint. Comment replies remain one level deep and may reuse only scanner-valid files already linked to the same task.

The drawer presents source links, scanner state, upload and discussion behind compact progressive disclosure in the established Onest/navy/cobalt/Lucide language. At 360 px it has no horizontal overflow, and no decorative image was added because the user’s decision depends on live context rather than illustration.

## 2026-07-24 — Chat read and mute are personal state, not authorization

An active `ThreadParticipant` row is the authorization boundary for reading and posting. `lastReadMessageId` and `notificationMode` describe only that participant’s personal workflow: neither can create, preserve or widen access. The database accepts only a cursor that belongs to the same thread and prevents regression; notification delivery rechecks active membership and suppresses muted recipients without changing message visibility.

A direct conversation is canonical per company and pair. The stored `directKey` is an HMAC over the company and sorted participant IDs, not a reversible concatenation. Creating the same pair again returns the existing thread; thread and message retries reuse body-bound idempotency keys, while a key reused for a different intent fails safely.

The Chat UI keeps search and exact unread state primary, with one-level replies and mute close to the active conversation. On mobile the list and dialogue are separate focused views with an explicit Back action and a composer that remains above the existing bottom navigation. It reuses the established Onest/navy/cobalt/Lucide language; generated imagery is intentionally omitted from this dense operational surface.

## 2026-07-29 — Task creation is one collaborative transactional aggregate

This decision supersedes only the “exactly one responsible” and “guarded one-level hierarchy” limits in the 2026-07-24 task decisions. A task now keeps immutable `createdById`, independently editable `reporterId` and one active `TaskParticipant` row per user with `RESPONSIBLE`, `COLLABORATOR` or `WATCHER`. Multiple responsible participants are equal; no canonical `assigneeId` remains. `Task.parentTaskId` supports recursive decomposition with application-level cycle and scope checks. Checklist items remain lightweight ordered marks rather than subtasks.

The canonical create command validates company/group/project/parent scope and writes task, participants, ordered checklist, tags, normalized relations, expanded reminders, optional recurrence, staged file links, body-bound idempotency, audit and outbox in one SQLite transaction. `Project` and `Tag` are task catalog records inside the existing organization scope; this does not approve a separate project-management aggregate or page. Attachments continue to use `FileObject` quarantine/scanning and `FileLink`; an uncommitted staged upload expires through a durable cleanup job after 24 hours.

Task reminders materialize one durable job per recipient and re-authorize the live task before creating an in-app notification. Recurrence is top-level only, uses the reporter’s IANA timezone through Temporal calendar arithmetic, creates a new task for each occurrence and is protected by both a unique `(recurrenceId, recurrenceOccurrenceAt)` key and a durable job idempotency key. Occurrences copy participant roles, reset checklist completion, retain tags and allowed relations, and copy only relative start/due reminders; absolute reminders are not replayed. Time tracking is a separate `TimeEntry` history with one active timer per user enforced by the persistence boundary.

The `/tasks/new` surface is one responsive modal with five progressively disclosed sections, one fixed submit action, body scroll lock, focus containment, dirty-close confirmation and a seven-day organization/user-scoped local draft. The browser generates a stable idempotency key per unchanged payload, while a changed retry receives a new key. The established task list/detail API remains temporarily available through `TaskCompatibilityService`; it maps the canonical aggregate for existing dashboard, Feed, search and drawer consumers without restoring removed single-assignee persistence.

## 2026-08-11 — Task display numbers are numeric, immutable strings

`Task.id` remains the opaque identity used by routes and relations. `Task.number` is an immutable decimal string allocated from one atomic SQLite sequence inside the same transaction as task creation; canonical create, recurrence and lifecycle task generation share that allocator. A failed transaction therefore rolls back its sequence increment, while concurrent writers receive distinct values. Persistence triggers reject non-digit inserts and number updates.

The migration preserves every non-numeric pre-S11 number in `TaskNumberAlias`, retains a collision-free canonical `TSK-<digits>` suffix where possible, and deterministically assigns the remaining legacy tasks after the current numeric maximum. Task list, relation-option and global search include the alias relation so an old number still resolves to the same opaque task ID.

## 2026-08-11 — Task approval is an explicit, versioned round

An approval round names exactly one approver who already has current task access. `User.approverId` may preselect a suggestion, but never widens task visibility or grants decision authority by itself. Request and decision commands are body-bound idempotent transactions guarded by the task version; a partial unique index permits only one pending round per task. The generic status command cannot set `IN_REVIEW` and cannot move a task while a round is pending.

Requesting approval moves the task to `IN_REVIEW`. The designated approver either moves it to `DONE` or returns it to `IN_PROGRESS` with `NEEDS_CHANGES`; an ordinary negative decision never means cancellation. Material aggregate changes invalidate the pending round and return the task to `IN_PROGRESS`, while comments, personal intent/reminders and time logs do not. Every round remains in history, and request, decision and invalidation reuse task audit, outbox, feed projection and optimistic-version conventions.

After a successful approval, an approver who is still an active `WATCHER` receives a one-time UI offer to leave that role. Leaving reuses canonical version-guarded participant removal; the only authorization exception is that an active `WATCHER` may remove their own row. It does not grant roster editing, and the client drops task-scoped caches and returns to `/tasks` when that removal also revokes the approver's task access.
