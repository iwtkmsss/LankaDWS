# LankaDWS UX delivery rules

This project applies the user-provided `deep-research-report.md` as an operational quality bar, adapted to an authenticated internal SaaS/CRM rather than a marketing landing page.

## Product context

- Site type: `saas_crm`.
- Primary outcome: a user finds the right work context and completes the intended task without confusion or unsafe data exposure.
- Navigation follows user tasks, not the backend module structure.
- Complexity is disclosed progressively; unfinished modules stay hidden or use an explicit unavailable state.

## Required rules

- One dominant task or action per section. Secondary actions use lower visual weight.
- Labels describe the concrete result of an action. Buttons perform actions; links navigate.
- Related controls and content use visible grouping and closer internal spacing than spacing between groups.
- Forms use persistent labels, correct input types and autocomplete where applicable. Placeholders never act as the only accessible name.
- Keyboard operation, visible focus, semantic headings, 24×24 px minimum controls and WCAG 2.2 AA contrast are release gates.
- `prefers-reduced-motion` disables non-essential transitions and animations.
- Images are added only when they convey meaning or help a decision. Content images need meaningful alt text and dimensions; decorative images use empty alt text.
- No autoplay carousel, fake urgency, misleading action, hidden consequence, fabricated proof or intentionally difficult exit.
- UI must reflow without horizontal page overflow at 320 CSS px and remain usable at 200% zoom.

## Performance targets

- LCP ≤ 2.5 s, INP ≤ 200 ms and CLS ≤ 0.1 at the 75th percentile when field data is available.
- Above-the-fold/LCP images are not lazy-loaded and have stable dimensions.
- Prefer existing local assets, code-native icons and the established Onest/navy/cobalt design system over decorative downloads.

## Applied overview pattern

- The first authenticated viewport answers three questions in order: what needs attention, what is the next concrete step and where that action leads.
- Overview focus priority is deterministic: approval decision → active task → lifecycle process → upcoming event → calendar fallback. The focus contains one primary action; supporting counts navigate to their corresponding work lists.
- Administration shows only non-zero attention items and promotes the highest-risk item to the single primary action. A clear state replaces empty zero-value warnings.
- Link labels name their destination (`Всі завдання`, `Відкрити журнал`) instead of generic labels such as `Усі`.
- Dashboard and administration links carry the effective company scope, including the user's primary company when the initial URL has no explicit `company` query.
- Decorative hero imagery is not used on dense authenticated work screens. Existing imagery remains appropriate for lifecycle guidance, authentication and branded error states where it conveys context rather than displacing work.

## Applied Live Feed pattern

- The composer has one dominant action: publish. Creating a task or event stays a secondary canonical navigation action, so Feed never becomes another form for copying those entities.
- Audience is persistent and explicit. Multi-company scope explains why publishing is unavailable instead of guessing a target company.
- Mandatory acknowledgement is visually separate from read/open/like/comment and is never preselected or inferred.
- The desktop attention rail contains only actionable acknowledgement and overdue-task counts; on narrow screens it moves above the feed.
- Post controls use progressive disclosure, replies stop at one nested level and every visible control keeps a text label or accessible name.
- Canonical Task/Event/Announcement/File activity uses a shorter source card than a post: one recognizable type icon, current authorized source data and one destination-specific action. It does not inherit post reactions, comments or editing controls.
- Type filtering stays one compact facet beside the primary tabs and remains URL/saved-view addressable; additional facets should be disclosed without turning the toolbar into a second dashboard.
- Author, local-date and direct-mention facets share one closable advanced panel. They apply immediately, compose in one URL/saved view and retain previous results while refreshing, so a filter change never replaces the whole work surface with a skeleton.
- «Кому адресовано» and «Робоча група» stay separate because recipient and context are different user questions. Company/direct-recipient options come only from enabled companies or accessible posts/file shares; group options come only from accessible active group posts/file shares. Unknown saved IDs remain existence-safe generic labels instead of revealing a hidden name.
- A single star in the card header is the only favourite control. It has an accessible state label, works for posts and canonical source cards and does not widen the crowded reaction/comment/subscription action row. «Важливі» and private «Обране» remain secondary checkboxes in the same advanced panel.
- A post has one compact subscription control with three explicit outcomes: all new comments, mentions only or no notifications. Automatic author/comment/mention subscriptions never overwrite a later user choice, and `Стежу` remains a short URL-addressable filter rather than another dashboard block.
- Attachments keep filename, size and scanner state close together. Pending or rejected files never look downloadable; a linked card polls the existing scanner state and becomes a download only after `CLEAN`.
- «Додати файл» remains an attachment to the current post; «Поширити файл» is a distinct permissioned action that creates a standalone source card for the currently visible audience. Revoke uses an inline confirmation and immediately removes recipient access.
- Dense authenticated Feed surfaces use avatars, typography, spacing, borders and Lucide icons from the existing LankaDWS system; generated or stock imagery is intentionally omitted because it would displace work without helping a decision.

## Applied Chat pattern

- Chat has one primary action: start a dialogue. Search and the exact unread filter stay visible; participant management and other infrequent controls remain progressive disclosure.
- Direct threads are canonical and retry-safe. A repeated create request opens the same pair rather than adding a duplicate conversation; a retry of the same send intent keeps its idempotency key.
- Read position advances only to a message that exists in the thread and never regresses. Mute is private notification intent, not membership or authorization.
- Replies remain visually flat at one level with a compact source preview. The composer preserves unsent text after an error and keeps Enter/Shift+Enter behavior explicit.
- Mobile uses a master/detail flow: the list opens a focused dialogue surface with a clear Back action, persistent thread header and composer above the existing bottom navigation.
- The surface reuses Onest, navy/cobalt tokens, avatars and Lucide icons. Decorative imagery is omitted because it would reduce room for the live conversation.

## Validation for each UI increment

1. Clarity: identify the primary user task, primary action and expected next state.
2. Heuristic review: hierarchy, grouping, progressive disclosure, empty/error/permission states.
3. Accessibility: keyboard, focus, labels, contrast, target size, headings and reflow.
4. Performance: bundle impact, image sizing, layout stability and responsive overflow.
5. Browser QA: desktop and mobile viewport, the main interaction, loading/error states and console warnings.

Real-user first-click/task testing and field Core Web Vitals remain required before calling a production rollout fully validated.
