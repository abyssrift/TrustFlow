# Reporting redesign: HTML-first, trustworthy snapshots, scheduled delivery

- **Date:** 2026-09-21
- **Status:** Design for user review; not an implementation plan
- **Audience:** Busy managers, analysts, and external clients
- **Approved direction:** HTML-first reading experience with an independent, dedicated PDF renderer consuming the same immutable report snapshot. The PDF is not made by converting, printing, or capturing the HTML UI.

## 1. Purpose and design test

TrustFlow reports should help a reader understand what happened, why it matters, how a value was derived, and what to do next. The system must not turn missing evidence into a confident-looking zero, expose data through a presentation option, or produce a polished but misleading report.

The design is successful only when a user can move from summary to evidence without losing scope, definitions, or time context; when an external-ready artifact contains only data its intended recipient may access; and when a report can be reproduced from its recorded snapshot and metric version.

The system uses three coordinated surfaces, not three analytics implementations:

1. **Report authoring and history** in the app: create, schedule, monitor, inspect, retry where allowed, and download.
2. **HTML report reader**: responsive, navigable, accessible, and the primary interactive experience.
3. **Dedicated PDF report**: deliberately paginated, printable, downloadable snapshot rendered from the same report model and manifest.

Managers, analysts, and client-ready presentation profiles may change hierarchy, explanation, and detail density. They must not change formulas, data scope, authorization, or the underlying snapshot.

## 2. Evidence and current-state framing

The redesign responds to user-supplied screenshots of current production reports. Those screenshots visibly show: funnel stage labels clipped/truncated; a Stage Duration table continuing across a page without repeated headers or report context; sparse page composition with substantial unused space; tiny dense labels/table text; and a later page starting without a report header/context. A Team Comparison screenshot shows three teams with no work/outcomes, yet `Avg Success Rate = 0.0%` and Marketing Team presented as a leader despite 0 points and 0% of maximum. These are treated as **visually confirmed production observations from supplied screenshot regions**, not as a complete visual audit of all pages.

The repository contains report-specific PDF components and a separate browser upload/generation flow. Relevant source anchors include:

- `components/intelligence/reports/generate.ts`: report fetch/model assembly and current PDF creation/upload path (including `pdf(element).toBlob()`); this is evidence that the current PDF path renders a React-PDF document rather than converting the report page DOM.
- `components/intelligence/reports/shared.tsx`: shared report cover/footer, table and chart primitives; the table header is not configured as a repeated/fixed continuation header, and chart primitives own label/layout behavior.
- `components/intelligence/reports/theme.ts`: shared typography scale, including small sizes that warrant a print-specific minimum-size policy.
- `components/intelligence/reports/GeneralReport.tsx`: current KPI and section composition. `buildGeneralKpis` currently has a source-level null-throughput-to-zero path (`cur.throughput ?? 0`); that conflicts with the desired unavailable-vs-zero semantics until verified against the exact current deployed build.
- `components/intelligence/reports/TeamComparisonReport.tsx` and `lib/reporting/reportCalculations.ts`: local source/tests have been changed to preserve null for no-outcome samples and avoid a meaningless all-zero winner. The production screenshot conflicts with that apparent local behavior; production build/data provenance has not yet been reconciled.
- `components/intelligence/_ReportGenerator_desktop.tsx`, `components/intelligence/_ReportGenerator_adaptive.tsx`, and `components/intelligence/reports/generate.ts`: report creation and generation UX entry points.

No full eight-page production PDF was rendered and visually inspected during this design pass. PDF pagination and accessibility concerns beyond the supplied screenshots are therefore source-inferred or unverified, not visually confirmed. The current source path does not establish that a past HTML-to-PDF attempt failed; the approved architecture does not repeat that approach in either case. An `html2pdf.js` dependency alone is not evidence that the current report flow uses it.

Before rollout, identify the deployed production revision, report payload/metric version, and source data conditions behind the all-zero comparison screenshot. Compare it with the local source and regression fixtures. Do not dismiss the screenshot as drift or claim the issue is fixed until that reconciliation is complete.

## 3. Goals, guarantees, and non-goals

### Goals and trust guarantees

- Preserve one canonical metric definition and one authorized dataset scope across HTML, PDF, history, calendar markers, and notification links.
- Make scope, reporting period, timezone, comparison period, data freshness, metric definitions, missingness, and rounding inspectable.
- Represent `not observed`/undefined separately from measured zero. Do not rank or declare a winner when the evidence does not support it.
- Keep report presentation profiles from widening data or permission scope.
- Produce durable, immutable report-run snapshots with enough provenance to explain and reproduce the report.
- Schedule reports safely and idempotently, with access checks at every sensitive boundary.
- Render a readable, navigable HTML report and a separately composed, accessible, print-quality PDF.
- Fail closed on authorization failures and partial data failures; report a useful failure rather than silently presenting incomplete information as complete.

### Non-goals

- No HTML-page capture, browser print, or HTML-to-PDF conversion as the PDF architecture.
- No separate formulas or independently fetched data for audience profiles.
- No default external sharing, public report URLs, PDF email attachments, or implicit access inheritance from the schedule creator.
- No silent zero-filling, synthetic “leader” for a tie/no-outcome population, or hidden partial report.
- No backfill/catch-up burst of missed scheduled runs after entitlement expiry or outage.
- No implementation, database migration, or deployment is authorized by this design document itself.

## 4. Audience and presentation model

Use a layered report model with selectable **presentation profiles**, not forks in report logic:

- **Manager profile (default):** concise summary, key changes, exceptions, decisions/actions, trend context, and short evidence tables. It answers “what needs attention and why?”
- **Analyst profile:** same approved metrics and scope, with formulas/definitions, denominators, comparison logic, filters, data-quality caveats, granular tables, and drill-down affordances. It answers “how was this computed, and where did the movement come from?”
- **Client-ready profile:** restrained narrative and selected, explicitly approved detail; clear period and methodology, no internal-only notes or identifiers. It answers “what should the client know?” It is a presentation choice, not a sharing permission or a data-sanitization substitute.

Every profile uses the same snapshot, metric values, definitions, and security-filtered rows. A report owner selects what sections to include from an allow-listed template. Client-ready output is not externally shareable by default. Any future external recipient flow requires a separate product/security decision and explicit recipient authorization.

## 5. Canonical end-to-end system

### 5.1 Request and scope

An on-demand request or schedule definition records report type, company/tenant, requested organizational scope, filters, presentation profile, reporting-period rule, comparison rule, locale, timezone, and requested outputs. The server validates the request and derives the caller’s permitted scope. Client-supplied IDs and filters are never authorization evidence.

Period boundaries are explicit half-open intervals `[start, end)` in the selected IANA timezone, converted to UTC instants for querying and stored with the timezone and resolved UTC bounds. Calendar periods use the declared calendar convention. UI labels show the full inclusive human-readable dates and timezone. “Previous completed period” never means a rolling interval. Comparison absence is explicit, not silently substituted.

### 5.2 Authorization and data acquisition

The server authorizes each requested report action against the current actor, company, and row-level scope before data access. It fetches only fields needed for the report and applies identical scope/filter semantics to every metric and section. If required data sources fail, the run fails as incomplete unless that source is explicitly optional and the report clearly labels the omission; no partial response may be rendered as a complete report.

For a scheduled run, the worker revalidates that the schedule is active, entitled, within its saved scope, and authorized under current policy. Recipients are revalidated independently. A schedule’s creator does not confer access on recipients or on the worker’s service identity.

### 5.3 Metrics and immutable report snapshot

Metrics are computed from versioned definitions with explicit numerator, denominator, eligible population, aggregation grain, filters, period, comparison, null/zero behavior, and rounding. Aggregate-of-aggregate calculations are prohibited unless mathematically justified and documented. Cross-report and cross-profile values are derived from the same canonical computation.

The run produces an immutable **Report Snapshot** containing normalized source aggregates/approved detail rows, metric values and status (`observed`, `not_available`, `suppressed`, or `failed`), explanatory context, section data, and provenance. It is not a live query at view/download time. Access is still checked every time the snapshot or artifact is viewed or downloaded.

### 5.4 Report model, HTML, PDF, and storage

The snapshot is mapped to a renderer-neutral, versioned Report Model. HTML and PDF are separate renderers of this model:

- **HTML reader:** primary in-app experience; responsive navigation, expandable methodology, accessible tables/charts, section anchors, and drill-down links that re-check authorization and cannot mutate snapshot values.
- **PDF renderer:** dedicated document components and print layout with explicit page templates, pagination, repeated table headers, continued-section context, page numbers, legible typography, chart fallbacks, and accessibility metadata where the renderer supports it. It consumes the same immutable snapshot and manifest—not HTML markup or browser DOM.

The stored run manifest records request/scope snapshot, period/timezone bounds, data-as-of time, metric catalog/version, report-model version, renderer versions, application/build revision, result status, and artifact checksums. Artifacts are private, tenant-scoped, and retrieved only through authorized application paths/short-lived links. Retention and deletion are explicit policy, not incidental object-storage behavior.

### 5.5 History, calendar, notification, and recovery

History lists runs by status, period, creator/schedule, and completion time. A failure row offers a human-readable reason, correlation/run ID, and a retry action only where safe and authorized. Retrying a failed render reuses the immutable snapshot when valid; retrying data acquisition creates a new run/version and is never presented as the old result.

The app-wide calendar shows an upcoming scheduled-run marker only to users currently permitted to view that report/schedule. Event details must not leak report names, scope, recipients, or status to unauthorized viewers. Viewing a marker does not grant schedule-management or run-trigger rights.

Notifications are in-app, with optional email containing a protected link only (never an attachment by default). Notification generation, link opening, and artifact download each re-check recipient membership, report scope, and authorization. Revoked recipients receive no report data even if they retain an old notification.

## 6. Domain contracts

These are design-level contracts; exact storage/API shapes belong in the later implementation plan.

### Report request

Required concepts: `report_type`, `company_id`, requested scope, canonical filters, reporting period, optional comparison period, IANA timezone, locale, presentation profile, selected sections, output formats, requester, and idempotency key. The request is validated and normalized server-side; unknown filters/enums are rejected, not ignored.

### Scope and permissions

Separate capabilities/actions for `report.create`, `report.view`, `report.download`, `report.schedule.manage`, and `report.run.trigger` (names are conceptual; map to the repository’s capability vocabulary). Each is evaluated with tenant/scope constraints. A user may view a report without managing its schedule; may manage a schedule without being a report recipient only if policy explicitly grants that combination. Presentation profile, notification delivery, calendar visibility, and signed URLs never expand scope.

### Metric definition/value

Each metric definition declares stable ID/version, label, semantic description, numerator, denominator, eligible population, aggregation grain, exclusions, unit, period/comparison rules, missingness behavior, rounding, and display format. Each value includes the numeric result or null, status, numerator/denominator where appropriate, sample count, and caveat. `0 / positive denominator` is observed zero. `0 / 0`, absent data, or undefined ratio is not available, not zero. A no-evidence set has no winner. Percentages state their denominator or expose it immediately in accessible detail.

### Dataset and provenance

Dataset metadata includes tenant/scope fingerprint, applied filters, period UTC bounds and timezone, data-as-of timestamp, source query/RPC versions, row/sample counts, exclusion counts, and completeness. No user-visible report combines widgets from different snapshots.

### Manifest

The immutable manifest binds request, dataset, metric catalog, report-model schema, renderers, build revision, artifact hashes, creator/schedule, recipients-at-generation (IDs only, protected), and lifecycle timestamps. It supports audit/reproduction but does not itself authorize access.

### Job state machine and errors

States: `queued -> validating -> collecting -> computing -> snapshot_ready -> rendering_html/rendering_pdf -> storing -> notifying -> succeeded`. Recoverable failure enters `retry_wait` with bounded attempt metadata; terminal states are `failed`, `cancelled`, `skipped_entitlement`, or `skipped_authorization`. A required-source partial failure cannot reach `succeeded`. Each transition is durable and idempotent. Error records contain safe user-facing category/message plus internal correlation details, without leaking protected row data.

### Schedule contract

Schedule stores cadence, period convention, local run time, IANA timezone, weekly weekday or monthly/quarterly run day, report type/scope/filter/profile, recipients, notification preferences, active/paused status, entitlement snapshot/check data, and next resolved occurrence. Occurrence key is unique per schedule and target period, preventing duplicate runs regardless of retries or concurrent workers.

## 7. Scheduled reports (Pro)

### Cadence and period

- **Weekly:** ISO calendar week (Monday 00:00 through the following Monday 00:00, local schedule timezone); run on a configurable weekday/time in the following week and report the immediately prior completed week. Default: Monday at 06:00 local time.
- **Monthly:** previous completed calendar month; run on a configurable day 1–31 and local time in the following month. If the chosen day does not exist, clamp to that month’s final day. Default: day 1 at 06:00.
- **Calendar quarterly:** previous completed calendar quarter (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec); run on a configurable day 1–31/time in the first month after quarter close, clamped to month end. Default: first day at 06:00.

The owner configures an IANA timezone, not a fixed UTC offset. Store each resolved occurrence and UTC instant in the run manifest. For a nonexistent wall-clock time during a DST jump, move to the next valid local instant; for a repeated time, execute once at the earlier occurrence. This is an explicit safe default to keep one idempotent run per scheduled occurrence.

### Access, visibility, and recipients

Schedule creation/management, manual triggering, report viewing, downloading, and recipient administration are distinct permissions. Recipients are explicit, same-tenant principals selected from eligible users; validate access at schedule save, run time, notification dispatch, view, and download. Removed or downgraded users lose access immediately. A schedule event on the existing app-wide calendar is visible only to principals currently permitted to view the associated report/schedule. Management controls remain limited to schedule managers. No external address or cross-tenant recipient is allowed by default.

### Entitlement, failure, retry, and duplicates

Require Pro entitlement at schedule creation and re-check at each occurrence before data collection. If Pro expires, pause/skip future occurrences, preserve completed reports according to retention/access policy, notify schedule managers, and do not backfill missed runs on renewal. A unique occurrence key, transactional job creation, bounded retry with backoff, and idempotent artifact/notification writes prevent duplicate reports or repeated notices. Permanent authorization/data errors stop retry and surface a clear failure; transient infrastructure errors retry within a bounded window. A manager may explicitly run a missed period after entitlement/access is restored, creating a new, clearly labeled manual run.

### Notification

On success, notify authorized recipients in-app and optionally by email. Email contains a protected link and period/status summary only, never the PDF attachment. On failure, notify schedule managers (and optionally configured operational owners) with a safe reason and run ID; do not send failure details to report recipients unless policy permits. Notification is itself idempotent.

## 8. User experience

### Create and schedule

The composer is a guided, compact sequence: report type and audience profile; scope and filters; reporting period/comparison; output and schedule; recipients/notifications; review. Show an exact human-readable example of the period produced by the selected cadence/timezone, the audience/profile distinction, recipient eligibility, and required permissions before saving. A preview uses the same validation and metric definitions but is explicitly marked as a preview, not an immutable delivered run.

### Monitor and inspect

History distinguishes queued/running/succeeded/failed/skipped and shows period, requested scope (when authorized), profile, created-by/schedule, generated time, freshness, and available formats. Progress is honest and stage-based; no endless spinner. Errors include a safe explanation, whether retry is automatic, next retry time, and what the user can do. Partial results are never styled as successful.

The report reader opens with a clear title, period/timezone, freshness, scope summary, and short narrative. It leads with key findings/actions and material changes; the analyst can expand metric definitions, numerators/denominators, filters, sample sizes, and methodology. Detail tables and appendices preserve traceability. Charts have text alternatives and labeled axes; readers can access exact values. Client-ready profiles remove internal-only fields by an explicit allow-list, not by CSS hiding.

### Export

HTML is the default “open report” route. Download PDF is an explicit action and is offered only when a complete PDF artifact exists and the current user has download rights. The PDF begins each page with enough report identity/period context to stand alone; continued tables repeat column headers and label continuation; section headings stay with following content; page numbering is consistent. Layout prioritizes readable type and clear evidence over forcing a fixed page count.

## 9. Presentation and accessibility requirements

- Funnel labels must not clip: allow wrapping/short display labels with full accessible labels and visible detail/tooltip; layout must work at narrow widths and in print.
- Tables must keep headers with data, repeat headers across PDF pages, avoid orphaned rows where possible, provide continuation context, and offer responsive labeled-row presentation on mobile.
- Remove arbitrary whitespace by content-aware grouping, not by shrinking type or stretching charts. Avoid isolated sections and orphan headings.
- Establish a report-specific type scale: target body 11pt or larger in PDF, dense table values/labels at least 9pt, and no critical text below 9pt; web text follows the repository’s UI typography rules and zoom/reflow requirements.
- Use color plus text/icon/shape for status, maintain contrast, and avoid low-contrast muted footers or success/warning fills as the sole signal.
- Use semantic heading order, document language, descriptive chart/table titles, meaningful link names, keyboard navigation, focus visibility, screen-reader-readable values, and logical reading order. PDF tagging/bookmarks and non-Latin glyph/font fallback are mandatory verification targets; current status is unverified.
- No chart should imply a ranking when values are all zero/unavailable or indistinguishable. State “No leader—no outcomes recorded” or the appropriate tie status.

## 10. Architecture ownership boundaries

- **Database/RPC:** tenant-safe row access and narrowly scoped aggregation; authorization wrappers/ACLs remain fail-closed; no renderer logic or client-provided permission claims.
- **Server report service/worker:** normalize and authorize requests, resolve periods, fetch required datasets, calculate canonical metrics, persist immutable snapshot/manifest, execute durable scheduling, render/store artifacts, and deliver notifications under explicit policy.
- **Client composer/history/calendar:** UX and capability-aware controls only; no authoritative access decision, metric calculation, scheduler, or artifact authorization.
- **HTML renderer:** display-only projection of the snapshot; drill-down endpoints reauthorize and identify their scope.
- **PDF renderer:** dedicated document tree/layout from snapshot; deterministic renderer version and explicit page rules; not HTML DOM conversion.
- **Private artifact storage:** tenant-scoped retention and authorized delivery; no public bucket or durable bearer URL as the access model.
- **Notification service:** sends minimum necessary metadata and a protected link; rechecks authorization and is idempotent.

Exact server/queue/PDF technology is deferred to the implementation plan after checking existing repository and Supabase patterns; this design does not prescribe a new parallel job framework.

## 11. Quality gates, tests, and observability

### Correctness and data integrity

- Hand-calculated fixtures for each metric, including 0/positive denominator, 0/0, null-heavy, one record, duplicate, negative, extreme, outlier, and aggregation-grain cases.
- Property tests for totals, percentage bounds where semantically valid, period partition boundaries, and invariant equality across HTML/PDF/profile renderers.
- Reconcile screenshot Team Comparison behavior against exact production revision and a fixture with all-zero/no-outcome teams; assert unavailable/no leader, while observed zero with positive denominator remains 0.
- Assert each section’s scope/filter/time window is the same and provenance states numerator, denominator, sample count, data freshness, and query/metric version.
- Fail closed on unauthorized scope, partial required-source failure, invalid filters, or stale entitlement.

### Authorization and schedule

- Tenant isolation and role matrix for create/view/download/manage/trigger/recipient actions.
- Revocation between schedule creation, run, notification, link open, and download.
- Calendar event visibility tests for report viewer, schedule manager, unrelated tenant/user, revoked recipient, and users lacking scope.
- Idempotency under concurrent scheduler workers, duplicate queue delivery, retry, artifact storage failure, and notification failure.
- Cadence tests across leap years, month ends 28/29/30/31, quarter/year transitions, DST skipped/repeated times, and timezone changes.
- Pro expiry pauses future occurrences, preserves permitted past artifacts, produces no catch-up burst, and renewal resumes only future scheduled periods.

### UI and PDF

- Desktop, tablet, and mobile web checks at narrow and wide widths; zoom/reflow; keyboard-only navigation; screen reader labels/order; contrast; accessible chart alternatives.
- Synthetic empty, one-record, normal, long-label, many-category, very-large-table, long-text, null/zero, and extreme-value report snapshots.
- Render every PDF page with the production renderer in CI/release qualification; inspect rasterized pages and extract text. Assert no clipped/overflowing text, missing glyphs, blank pages, orphan headings, split unheaded tables, tiny critical text, missing page context, or absent page numbering. Include Arabic/non-Latin samples and long organization/user names.
- Golden-page visual review at representative report sizes plus structural checks for PDF language, headings/bookmarks/tagging/reading order to the degree supported by renderer/tooling.
- Compare HTML and PDF values, labels, period, filters, missingness, and manifest IDs for the same snapshot; never require identical layout.
- Operational telemetry: run latency by stage, queue age, retries, failure categories, source query latency/row counts, render duration/memory, artifact sizes, duplicate suppression, notification outcomes, and entitlement/access skips. Avoid logging sensitive report rows.

Release gate: no critical correctness or authorization findings open; all acceptance tests pass; the exact production/local metric discrepancy is reconciled; representative HTML/PDF pages have been visually reviewed; and an authorized owner signs off retention, recipient, and calendar visibility policy.

## 12. Migration path (design-level sequencing)

This is a dependency-aware direction, not an execution plan.

1. **Contain correctness and reconcile reality:** preserve null-vs-zero and no-leader semantics; identify the deployed build and source data behind screenshot discrepancies; verify authorization and current report storage access. Do not declare fixed based only on local tests.
2. **Lock contracts and tests:** establish canonical metric definitions, period semantics, scope/permission matrix, manifest, and pathological fixtures before moving renderers.
3. **Separate report model from renderers:** produce versioned snapshots and a renderer-neutral model; keep current report types working through adapters while validating parity.
4. **Build the HTML reader and authoring/history UX:** responsive, provenance-rich experience with capability-aware create/inspect/download and honest errors. Roll out behind a feature flag or report-type cohort if existing release patterns support it.
5. **Add durable schedule lifecycle and calendar integration:** Pro checks, idempotent occurrences, explicit recipients, authorization rechecks, protected-link notifications, expiry and recovery behavior. Reuse the existing app-wide calendar; do not introduce a second calendar surface.
6. **Rebuild the dedicated PDF layout from snapshots:** fix page system, typography, table continuation, chart labels, context, accessibility, and pathological cases. Keep the PDF renderer independent of HTML.
7. **Migrate report types and retire old paths:** migrate one report type at a time after metric and renderer parity; remove legacy generation only after stored-history and rollback policy are clear.
8. **Scale and polish:** benchmark actual data sizes, bound payloads/queries/jobs, add caching only with complete scope/version keys, tune accessibility and visual polish.

## 13. Decisions and safe defaults

### Approved by user

- HTML-first report reader, only if it is a genuinely good experience.
- Dedicated PDF renderer/layout from the same immutable snapshot; never HTML-to-PDF conversion.
- Mixed managers/analysts/external-client audience, supported through consistent metric/presentation profiles.
- Pro weekly, monthly, and calendar-quarter schedules; previous completed period; configurable run day/time/timezone.
- Scheduled markers on the existing app-wide calendar, visible only to appropriately authorized users.
- Calendar quarterly means Jan–Mar/Apr–Jun/Jul–Sep/Oct–Dec.
- Month days 29–31 clamp to the last day of the target month.

### Safe defaults in this design

- Weekly periods are ISO Monday–Sunday; weekly run day is configured in the week after that completed period.
- Monthly runs occur in the month after the closed report month; quarterly runs in the first month after quarter close.
- Default run time 06:00 local; default weekly Monday, monthly day 1, quarterly day 1.
- IANA timezone is stored; nonexistent DST time moves to the next valid instant; repeated time executes once at its earlier occurrence.
- No external recipients/sharing or email attachments by default; email is optional protected-link delivery.
- Pro expiration pauses future runs, preserves completed artifacts subject to policy, and does not backfill.
- Undefined metrics are N/A, observed zero remains zero, and no evidence means no leader.

### Decisions still needed before implementation

- Exact capability names/mapping and role combinations for create, schedule management, trigger, view, download, and recipient administration.
- Artifact/history retention duration, deletion/legal hold behavior, and what completed reports remain visible after plan lapse or a user leaves the company.
- Whether email notification is opt-in per recipient, schedule-wide, or both; confirmation of allowed email provider and data-minimization requirements.
- Whether a schedule owner can transfer ownership or be deleted/deactivated; authorized admin recovery path.
- Whether client-ready profile is only an internal presentation mode initially or may later be used for explicit external recipients. Default here is internal-only, with no external sharing.
- Whether users may select report sections/metrics freely or only from curated templates in the first release.
- Whether preview is required before every one-off generation or optional; preview never constitutes a saved/delivered report.
- Final verification window and owner for production-vs-local screenshot mismatch; required build/data provenance to declare reconciliation complete.

## 14. Design acceptance criteria

The design is ready to become an implementation plan only after user review and these invariants are accepted:

1. A metric value carries definition, numerator/denominator or reason unavailable, sample count, period, scope, freshness, and version provenance.
2. Missing/undefined is never silently represented as measured zero; all-zero/no-outcome data has no winner.
3. Same snapshot means same numbers, filters, period, and missingness in HTML, PDF, profile, and history.
4. Presentation profile cannot broaden data or permission scope.
5. Tenant/scope and action authorization are checked server-side at create, schedule, run, calendar visibility, notification, view, and download.
6. Scheduled occurrence is unique and durable; retries cannot duplicate reports or notifications; required partial failures cannot appear successful.
7. Schedule dates and report periods are deterministic across month ends, calendar quarters, leap days, timezone, and DST.
8. Expired Pro entitlement causes no new run or catch-up burst; completed reports follow an explicit retention/access policy.
9. HTML works accessibly on desktop and mobile; PDF is a separate renderer with readable text, repeated table headers, continuation context, correct page composition, and verified glyph/reading-order behavior.
10. Production behavior is reconciled against local source and tests before claiming screenshot-observed correctness issues are resolved.

## 15. Self-review

- **Scope:** design/spec only. No code, migration, tests, or implementation plan is included here.
- **Placeholders:** no unresolved “TBD” blocks are used. Decisions that genuinely require product/security ownership are enumerated in §13 rather than guessed.
- **Consistency:** HTML-first describes the reader experience, not the PDF production technique. PDF is an independent renderer over the same immutable snapshot. Audience profiles do not fork analytics or authorization. External sharing remains off by default.
- **Evidence discipline:** production screenshot findings are attributed to user-supplied screenshot regions. Whole-document PDF visual inspection, PDF accessibility behavior, deployed revision, and exact production/local metric parity remain unverified. Source-level concerns are labeled accordingly.
- **Schedule semantics:** weekly, monthly, and quarter periods and run placement are explicit; run dates use an IANA timezone, DST policy, month-end clamp, and unique occurrence identity.
- **Security/recovery:** view, download, schedule management, run trigger, calendar visibility, and recipient access remain distinct; each sensitive action rechecks current authorization. Failures, retries, entitlement lapse, duplicate delivery, and retention assumptions are covered.
- **Readiness:** suitable for user review. Implementation planning remains gated on written user approval and resolution or acceptance of the decisions in §13.
