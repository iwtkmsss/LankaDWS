# User search audit — 2026-10-09

All people selectors search from the first non-whitespace Unicode character and return at most **5** users. Empty input does not fetch suggestions. Selected people are resolved by ID independently of search pages. Root `AGENTS.md` records these permanent rules.

## Central implementations

- `packages/contracts/src/user-search.ts`: result cap, query length, Unicode/apostrophe normalization, shared limit schema and safe option type.
- `apps/api/src/common/search-users.ts`: full-dataset SQL search, eligibility constraints, exclusions and ranking. It queries exact matches, prefixes, then substrings; at most three bounded queries together return five users. Workspace and active-account constraints cannot be overridden by a caller. `apps/api/src/prisma/sqlite-adapter.ts` reports the installed SQLite build's actual bind-parameter limit to Prisma, avoiding its conservative 999 fallback for large exclusion lists.
- `apps/web/src/shared/api/user-search.ts`: the only people-search request builder, including normalization, result limit, administrator eligibility, company/context parameters, selected-user exclusions and cancellation signal. Short requests use `/employees`; long explicit exclusion lists use the validated JSON body at `POST /employees/search`, with the same server implementation.
- `apps/web/src/shared/lib/useUserSearch.ts`: shared debounce, IME handling, cache and immediate cancellation/hiding of stale results.
- `apps/web/src/features/employees/UserSearchCombobox.tsx`: reusable keyboard-accessible selector with avatars. It reuses the request builder and existing `AsyncTaskCombobox` behavior; no directory preload.

Active administrators are included by default. Company employee/manager assignment explicitly requests employee accounts because those operations require `USER`. Unit managers admit active administrators. Contextual mentions retain their aggregate access and audience/participant restrictions.

## Coverage

| Surface | Shared implementation / adapter |
| --- | --- |
| Task list: responsible, reporter, collaborator, watcher | `TasksPage.tsx`, `UserSearchCombobox`, `/employees` selector mode |
| Task detail: participant/reporter/responsible and subtask selectors | `TasksPage.tsx`, `UserSearchCombobox` |
| Task creation: reporter and participant roles | `TaskParticipantsSection.tsx`, `UserSearchCombobox`; draft IDs are not filtered against a search page |
| Task options users | `task-catalog.service.ts` -> server `searchUsers`; no initial user preload |
| Drive sharing | `DriveDialogs.tsx`, `UserSearchCombobox`; existing shares excluded before SQL cap |
| Main chat sidebar, new direct/group chat, adding participants | `useUserSearch` -> shared request builder -> `messages.service.ts` -> server `searchUsers`; canonical direct-thread enrichment retained |
| Right communication panel chat search | Same hook and chat adapter |
| Notification recipient | Same hook and chat adapter |
| Mentions in chat, tasks and feed | `MentionTextarea` -> same hook/request builder -> contextual adapters -> server `searchUsers` |
| Company creation: manager and employees | `features/organization/CompanyCreateForm.tsx`, `UserSearchCombobox`; selected people cached separately |
| Organization company/unit manager and employee selectors | `AdminOrganizationPage.tsx`, `UserSearchCombobox`; actual unit membership and transfers preserved; existing unit members excluded by `excludeOrgUnitId` in SQL |
| Directory manager filters | `ContentPages.tsx`, `OrganizationUniversePage.tsx`, `UserSearchCombobox`; eligible managers constrained in SQL |
| Global search people | `communication/search.controller.ts` -> server `searchUsers`; avatars returned to `CommandPalette`; task results retain their own limit |

Chat participant selectors exclude already selected/current participants before the database result limit. Feed mention search uses audience predicates directly in SQL and does not expand a whole company into user IDs just to find suggestions. Permission checks still run before contextual searches.

Global search combines tasks and people in one request, so its existing mixed-result client remains separate; all user matching/ranking runs in the shared server implementation. Message text search and task/catalog search are separate behaviors with their own limits.

Chat recommendations remain an explicit separate recent/context scoring feature. Client, prefetch and server now all use the shared limit of five, including older clients requesting larger pages.

## Avatars

The common user combobox uses the existing `Avatar` component for each result, including its placeholder for missing/broken images. Chat and mention lists retain their existing avatar presentation. Global people search now also shows avatars.

## Full directories and membership lists

`/employees` without a selector limit, `/admin/users` and `/org/units/:id/employees` represent full directory/member displays. Their lists are not silently capped at five. Directory name/username matching reuses `userSearchPredicate`; job-title matching is retained. These listing endpoints still need a separate pagination design as the product grows. They are no longer loaded as a selector catalogue.

## Clear task filters

The clear button remains at the bottom-right below expanded filters, blue with an outline when filters/non-default roles are selected, gray and disabled otherwise. Clearing resets all task filters, roles, legacy tab and pagination.

## Validation

Focused checks cover SQLite search across more than 1000 users, ranking, the five-result cap, administrator inclusion, workspace/active/eligibility restrictions, exclusions before the cap, contextual access, no blank fetch, stale-query cancellation, IME, avatar rendering and preserved selections. UI checks cover tasks, chat, organization selectors and responsive dropdown geometry. No full release pipeline or production dataset benchmark is implied.

Commands/results for this change:

- `npm run typecheck --workspace @lankadws/web` — passed.
- `npm run typecheck --workspace @lankadws/api` — passed.
- `npm run typecheck --workspace @lankadws/contracts` — passed.
- `npm run lint --workspace @lankadws/web`, `npm run lint --workspace @lankadws/api`, `npm run lint --workspace @lankadws/contracts` — passed.
- `npm run test --workspace @lankadws/contracts` — 24 tests passed.
- `npm run test --workspace @lankadws/api -- src/common/search-users.test.ts src/modules/employees/employees.controller.test.ts src/modules/communication/messages-user-search.test.ts src/modules/communication/chat-recommendations.test.ts src/modules/tasks/task-catalog.search.test.ts src/modules/tasks/task-participants.service.test.ts src/modules/feed/feed.service.test.ts src/modules/feed/feed-user-search.test.ts --maxWorkers=1` — 58 tests passed.
- Web focused Vitest groups (`npm run test --workspace @lankadws/web -- <target paths> --maxWorkers=1`) — passed for the shared request/hook/combobox, task filters/draft, Drive, mentions, chat/navigation/composer/sidebar, right panel and organization forms.
- `git diff --check` for touched tracked paths — passed.
- Local browser checks — first-letter search, no blank requests, admin names/usernames, avatars, task dropdown widths at 1440/768/390, chat/global search, unit/company eligibility, SQL membership exclusion, and a JSON search with 1000 excluded IDs all passed. No entity creation or membership/permission changes were submitted during browser validation.
