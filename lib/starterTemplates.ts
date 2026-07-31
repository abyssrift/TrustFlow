/**
 * Starter template library (issue: Bulk Create Projects dead-end in a fresh
 * workspace — see docs/PROJECT_HIERARCHY_PLAN.md §2, §4, §7).
 *
 * The only way to get a `project_templates` row was previously "finish a
 * project, then Save as Template" — so a brand-new company with zero
 * projects could never reach Bulk Create. These are curated, researched
 * starting points across common back-office / delivery sectors. Picking one
 * calls `rpc_create_starter_template` to materialize it into a REAL,
 * ordinary, editable `project_templates` row for the caller's company —
 * after that it behaves exactly like a template saved from a finished
 * project. Nothing here is a database row; this file IS the library.
 *
 * Contract (matches project_templates.body / rpc_create_template_from_project
 * exactly): title, description, category, priority, weight, estimated_hours,
 * due_offset_days? — relative dates only, no pipeline_id (a starter can't
 * know a company's boards; rpc_instantiate_template already falls back), no
 * assignee_team_id (can't know a company's teams), no template language
 * (literal titles, not `{{project.name}}`).
 *
 * `category` groups tasks into phases (plan §3.1 — grouping within a level
 * is a field, not a hierarchy level).
 */

export type StarterPriority = 'urgent' | 'high' | 'medium' | 'low';

export type StarterTaskItem = {
  title: string;
  description: string;
  category: string;
  priority: StarterPriority;
  /** 1-10, mirrors the `tasks_weight_1_10` CHECK constraint. */
  weight: number;
  estimated_hours: number;
  /** Days from project start_date. Omit when a due date is genuinely open-ended. */
  due_offset_days?: number;
};

export type StarterTemplate = {
  /** Stable slug, local to this file — never sent to the DB. */
  id: string;
  /** Groups templates in the picker UI. */
  sector: string;
  name: string;
  description: string;
  color: string;
  tasks: StarterTaskItem[];
};

export const STARTER_TEMPLATES: StarterTemplate[] = [
  // ── Audit & Assurance ──────────────────────────────────────────────────
  {
    id: 'statutory-audit',
    sector: 'Audit & Assurance',
    name: 'Statutory Financial Statement Audit',
    description: 'End-to-end external audit engagement from client acceptance through opinion issuance, following the standard planning → fieldwork → review → reporting arc.',
    color: '#6366f1',
    tasks: [
      { title: 'Client acceptance & engagement letter', description: 'Done when the engagement letter is signed and independence has been confirmed.', category: 'Planning', priority: 'high', weight: 3, estimated_hours: 4, due_offset_days: 0 },
      { title: 'Preliminary risk assessment & materiality calculation', description: 'Done when overall and performance materiality are set and documented with the basis used.', category: 'Planning', priority: 'high', weight: 5, estimated_hours: 6, due_offset_days: 3 },
      { title: 'Understand internal controls (walkthroughs)', description: 'Done when key transaction cycles have been walked through and control deficiencies noted.', category: 'Planning', priority: 'medium', weight: 5, estimated_hours: 8, due_offset_days: 5 },
      { title: 'Draft audit plan & staffing schedule', description: 'Done when the audit plan is approved by the engagement partner and staff are assigned to sections.', category: 'Planning', priority: 'medium', weight: 4, estimated_hours: 4, due_offset_days: 6 },
      { title: 'Request trial balance and supporting schedules', description: 'Done when the client has delivered the full PBC (prepared-by-client) list.', category: 'Fieldwork', priority: 'high', weight: 3, estimated_hours: 2, due_offset_days: 7 },
      { title: 'Trial balance tie-out to general ledger', description: 'Done when every TB line agrees to the GL and variances are explained.', category: 'Fieldwork', priority: 'high', weight: 6, estimated_hours: 6, due_offset_days: 10 },
      { title: 'Cash & bank confirmations', description: 'Done when confirmations are sent, received, and reconciled to book balances.', category: 'Fieldwork', priority: 'medium', weight: 4, estimated_hours: 4, due_offset_days: 12 },
      { title: 'Accounts receivable circularization', description: 'Done when the confirmation sample is selected, sent, followed up, and exceptions resolved.', category: 'Fieldwork', priority: 'high', weight: 7, estimated_hours: 10, due_offset_days: 14 },
      { title: 'Inventory count observation', description: 'Done when the physical count has been observed and test counts agree to the client count sheets.', category: 'Fieldwork', priority: 'high', weight: 7, estimated_hours: 8, due_offset_days: 15 },
      { title: 'Fixed asset additions & disposals testing', description: 'Done when a sample of additions/disposals is vouched to supporting documentation.', category: 'Fieldwork', priority: 'medium', weight: 5, estimated_hours: 6, due_offset_days: 17 },
      { title: 'Accounts payable & accrued liabilities testing', description: 'Done when a search for unrecorded liabilities is complete and accruals are recalculated.', category: 'Fieldwork', priority: 'medium', weight: 6, estimated_hours: 8, due_offset_days: 18 },
      { title: 'Revenue recognition testing', description: 'Done when the sample of revenue transactions is tested for cutoff and recognition criteria.', category: 'Fieldwork', priority: 'high', weight: 8, estimated_hours: 10, due_offset_days: 20 },
      { title: 'Payroll & related-party transactions testing', description: 'Done when payroll expense is substantively tested and related-party disclosures are confirmed complete.', category: 'Fieldwork', priority: 'medium', weight: 5, estimated_hours: 6, due_offset_days: 21 },
      { title: 'Subsequent events review', description: 'Done when the period from year-end to report date has been reviewed for events requiring adjustment or disclosure.', category: 'Fieldwork', priority: 'medium', weight: 4, estimated_hours: 4, due_offset_days: 24 },
      { title: 'Going concern assessment', description: "Done when management's going concern assessment has been evaluated and conclusion documented.", category: 'Review', priority: 'high', weight: 6, estimated_hours: 5, due_offset_days: 25 },
      { title: 'Draft financial statements & disclosures', description: 'Done when the draft FS and notes are complete and tie to the working papers.', category: 'Review', priority: 'high', weight: 7, estimated_hours: 10, due_offset_days: 26 },
      { title: 'Manager review of working papers', description: 'Done when all review notes are cleared or escalated to the partner.', category: 'Review', priority: 'high', weight: 6, estimated_hours: 8, due_offset_days: 28 },
      { title: 'Partner review & clearance of review points', description: 'Done when the partner signs off and no open review points remain.', category: 'Review', priority: 'urgent', weight: 7, estimated_hours: 6, due_offset_days: 30 },
      { title: 'Management representation letter', description: 'Done when the signed rep letter is on file, dated as of the report date.', category: 'Reporting', priority: 'medium', weight: 3, estimated_hours: 2, due_offset_days: 31 },
      { title: 'Draft audit opinion & issue working papers to client', description: 'Done when the opinion is drafted, cleared through quality control, and issued.', category: 'Reporting', priority: 'high', weight: 5, estimated_hours: 4, due_offset_days: 32 },
      { title: 'Client closing meeting', description: 'Done when findings and the management letter are presented to the client.', category: 'Reporting', priority: 'medium', weight: 3, estimated_hours: 3, due_offset_days: 33 },
      { title: 'File archival & quality control sign-off', description: 'Done when the file is locked, archived per retention policy, and QC sign-off is recorded.', category: 'Reporting', priority: 'low', weight: 2, estimated_hours: 2, due_offset_days: 35 },
    ],
  },
  {
    id: 'monthly-bookkeeping-close',
    sector: 'Audit & Assurance',
    name: 'Month-End Bookkeeping Close',
    description: 'Recurring monthly close cycle: transaction categorization, reconciliations, adjusting entries, and a client-ready financial package.',
    color: '#22c55e',
    tasks: [
      { title: 'Collect bank & credit card statements', description: 'Done when all statements for the period are downloaded and filed.', category: 'Prep', priority: 'high', weight: 3, estimated_hours: 1, due_offset_days: 0 },
      { title: 'Import & categorize transactions', description: 'Done when every bank feed transaction is categorized to the correct GL account.', category: 'Prep', priority: 'high', weight: 5, estimated_hours: 4, due_offset_days: 1 },
      { title: 'Bank reconciliation', description: 'Done when the book balance agrees to the statement balance with all reconciling items identified.', category: 'Reconciliation', priority: 'high', weight: 5, estimated_hours: 3, due_offset_days: 2 },
      { title: 'Credit card reconciliation', description: 'Done when each card account ties to its statement.', category: 'Reconciliation', priority: 'medium', weight: 4, estimated_hours: 2, due_offset_days: 2 },
      { title: 'Accounts receivable aging review', description: 'Done when the AR aging is reviewed and stale balances are flagged for follow-up.', category: 'Reconciliation', priority: 'medium', weight: 4, estimated_hours: 2, due_offset_days: 3 },
      { title: 'Accounts payable aging review', description: 'Done when the AP aging is reviewed and any past-due items are flagged.', category: 'Reconciliation', priority: 'medium', weight: 4, estimated_hours: 2, due_offset_days: 3 },
      { title: 'Payroll journal entry posting', description: 'Done when payroll register totals are posted and reconciled to the payroll provider report.', category: 'Reconciliation', priority: 'high', weight: 4, estimated_hours: 2, due_offset_days: 4 },
      { title: 'Fixed asset & depreciation schedule update', description: 'Done when the depreciation schedule reflects the current period and ties to the GL.', category: 'Reconciliation', priority: 'low', weight: 3, estimated_hours: 2, due_offset_days: 4 },
      { title: 'Prepaid & accrual adjusting entries', description: 'Done when prepaid amortization and accrual entries are posted for the period.', category: 'Reconciliation', priority: 'medium', weight: 4, estimated_hours: 3, due_offset_days: 5 },
      { title: 'Trial balance review & variance analysis', description: 'Done when month-over-month variances above threshold are explained.', category: 'Review', priority: 'high', weight: 6, estimated_hours: 3, due_offset_days: 6 },
      { title: 'Management financial package preparation', description: 'Done when P&L, balance sheet, and cash flow statements are compiled with commentary.', category: 'Reporting', priority: 'high', weight: 5, estimated_hours: 3, due_offset_days: 7 },
      { title: 'Client review call & sign-off', description: 'Done when the client has reviewed the package and confirmed no outstanding questions.', category: 'Reporting', priority: 'medium', weight: 3, estimated_hours: 1, due_offset_days: 8 },
    ],
  },

  // ── Tax Preparation ─────────────────────────────────────────────────────
  {
    id: 'business-tax-return',
    sector: 'Tax Preparation',
    name: 'Business Tax Return Preparation',
    description: 'Corporate/pass-through tax return cycle from organizer intake through e-file, including book-to-tax adjustments and multi-level review.',
    color: '#f59e0b',
    tasks: [
      { title: 'Client tax organizer intake', description: 'Done when the completed organizer and prior-year return are received.', category: 'Intake', priority: 'high', weight: 3, estimated_hours: 2, due_offset_days: 0 },
      { title: 'Prior-year return & carryforward review', description: 'Done when carryforward items (NOLs, credits, basis) are schedule and verified.', category: 'Intake', priority: 'medium', weight: 3, estimated_hours: 2, due_offset_days: 1 },
      { title: 'Gather W-2/1099/K-1 source documents', description: 'Done when all information returns referenced in the organizer are on file.', category: 'Intake', priority: 'high', weight: 4, estimated_hours: 3, due_offset_days: 3 },
      { title: 'Reconcile books to tax trial balance', description: 'Done when the tax TB ties to the client’s year-end books.', category: 'Preparation', priority: 'high', weight: 5, estimated_hours: 4, due_offset_days: 5 },
      { title: 'Book-to-tax adjustments (M-1/M-3)', description: 'Done when all permanent and timing differences are identified and scheduled.', category: 'Preparation', priority: 'high', weight: 6, estimated_hours: 6, due_offset_days: 7 },
      { title: 'Depreciation & Section 179 schedule', description: 'Done when the fixed asset tax depreciation schedule is updated and elections are documented.', category: 'Preparation', priority: 'medium', weight: 5, estimated_hours: 4, due_offset_days: 8 },
      { title: 'Compute estimated tax payments', description: 'Done when next-year estimates are calculated and vouchers prepared.', category: 'Preparation', priority: 'medium', weight: 4, estimated_hours: 3, due_offset_days: 9 },
      { title: 'Prepare federal return', description: 'Done when the federal return is complete and internally consistent.', category: 'Preparation', priority: 'high', weight: 7, estimated_hours: 8, due_offset_days: 11 },
      { title: 'Prepare state return(s)', description: 'Done when all applicable state/local returns are prepared and apportionment is supported.', category: 'Preparation', priority: 'medium', weight: 5, estimated_hours: 5, due_offset_days: 12 },
      { title: 'Diagnostic review & error resolution', description: 'Done when all software diagnostics are cleared or explained.', category: 'Review', priority: 'high', weight: 5, estimated_hours: 3, due_offset_days: 13 },
      { title: 'Preparer review of return', description: 'Done when a second preparer has reviewed the return line-by-line against source docs.', category: 'Review', priority: 'high', weight: 6, estimated_hours: 4, due_offset_days: 14 },
      { title: 'Partner/EA review & sign-off', description: 'Done when the signing preparer approves the return for delivery.', category: 'Review', priority: 'urgent', weight: 6, estimated_hours: 3, due_offset_days: 15 },
      { title: 'Client review meeting & e-file authorization (8879)', description: 'Done when the client has reviewed the return and signed the e-file authorization.', category: 'Filing', priority: 'medium', weight: 3, estimated_hours: 2, due_offset_days: 16 },
      { title: 'E-file federal & state returns', description: 'Done when e-file acknowledgments are received for all filed returns.', category: 'Filing', priority: 'high', weight: 3, estimated_hours: 1, due_offset_days: 17 },
    ],
  },

  // ── Marketing / Creative Agency ─────────────────────────────────────────
  {
    id: 'agency-campaign-launch',
    sector: 'Marketing & Creative Agency',
    name: 'Campaign Launch',
    description: 'Full-funnel agency campaign from brief to go-live: strategy, creative concepting, asset production, and channel launch.',
    color: '#ec4899',
    tasks: [
      { title: 'Kickoff & brief intake', description: 'Done when the creative brief is signed off by the client and internal team.', category: 'Strategy', priority: 'high', weight: 3, estimated_hours: 2, due_offset_days: 0 },
      { title: 'Audience & competitive research', description: 'Done when target audience personas and a competitive landscape summary are documented.', category: 'Strategy', priority: 'medium', weight: 4, estimated_hours: 6, due_offset_days: 2 },
      { title: 'Campaign strategy & messaging framework', description: 'Done when core messaging pillars and positioning are approved internally.', category: 'Strategy', priority: 'high', weight: 6, estimated_hours: 8, due_offset_days: 5 },
      { title: 'Budget & media plan', description: 'Done when channel budget allocation and flighting are finalized.', category: 'Strategy', priority: 'medium', weight: 4, estimated_hours: 4, due_offset_days: 6 },
      { title: 'Creative concept development', description: 'Done when at least two creative directions are ready to present.', category: 'Creative', priority: 'high', weight: 7, estimated_hours: 10, due_offset_days: 9 },
      { title: 'Client concept presentation & approval', description: 'Done when the client has selected and approved a creative direction.', category: 'Creative', priority: 'high', weight: 4, estimated_hours: 3, due_offset_days: 11 },
      { title: 'Copywriting (all channels)', description: 'Done when copy for every planned channel/format is drafted and approved.', category: 'Creative', priority: 'medium', weight: 5, estimated_hours: 8, due_offset_days: 13 },
      { title: 'Design assets (static)', description: 'Done when static creative is finalized in every required size/format.', category: 'Creative', priority: 'medium', weight: 6, estimated_hours: 10, due_offset_days: 15 },
      { title: 'Video/motion asset production', description: 'Done when video/motion assets are edited, graded, and exported in required specs.', category: 'Production', priority: 'medium', weight: 7, estimated_hours: 14, due_offset_days: 18 },
      { title: 'Landing page build', description: 'Done when the campaign landing page is built, responsive, and content-complete.', category: 'Production', priority: 'medium', weight: 5, estimated_hours: 8, due_offset_days: 19 },
      { title: 'Internal QA & brand compliance review', description: 'Done when all assets pass brand guideline and QA checklist review.', category: 'Production', priority: 'high', weight: 4, estimated_hours: 3, due_offset_days: 20 },
      { title: 'Client final approval', description: 'Done when the client has signed off on all final assets.', category: 'Production', priority: 'high', weight: 3, estimated_hours: 2, due_offset_days: 21 },
      { title: 'Channel setup & tracking/UTM configuration', description: 'Done when all campaigns are built in-platform with tracking verified end-to-end.', category: 'Launch', priority: 'medium', weight: 4, estimated_hours: 4, due_offset_days: 22 },
      { title: 'Campaign go-live', description: 'Done when all channels are live and initial delivery is confirmed.', category: 'Launch', priority: 'urgent', weight: 5, estimated_hours: 3, due_offset_days: 23 },
      { title: 'Post-launch performance report', description: 'Done when a results deck with KPIs vs. targets is delivered to the client.', category: 'Launch', priority: 'low', weight: 3, estimated_hours: 3, due_offset_days: 30 },
    ],
  },

  // ── Software Delivery ────────────────────────────────────────────────────
  {
    id: 'product-release-launch',
    sector: 'Software Delivery',
    name: 'Product Release / Launch',
    description: 'A feature or product release from requirements through production rollout and post-launch monitoring.',
    color: '#0ea5e9',
    tasks: [
      { title: 'Requirements gathering & scoping', description: 'Done when scope is documented and acceptance criteria agreed with stakeholders.', category: 'Discovery', priority: 'high', weight: 4, estimated_hours: 6, due_offset_days: 0 },
      { title: 'Technical design & architecture doc', description: 'Done when the design doc is reviewed and approved by tech leads.', category: 'Discovery', priority: 'high', weight: 6, estimated_hours: 10, due_offset_days: 3 },
      { title: 'Sprint planning & backlog grooming', description: 'Done when work is broken into estimated, sprint-ready tickets.', category: 'Discovery', priority: 'medium', weight: 3, estimated_hours: 3, due_offset_days: 5 },
      { title: 'Core feature implementation', description: 'Done when the primary feature code is complete and merged to the integration branch.', category: 'Build', priority: 'high', weight: 9, estimated_hours: 40, due_offset_days: 7 },
      { title: 'API/integration implementation', description: 'Done when all required API endpoints and third-party integrations are functional.', category: 'Build', priority: 'high', weight: 7, estimated_hours: 20, due_offset_days: 14 },
      { title: 'Database migration & schema changes', description: 'Done when migrations are written, reversible, and tested against a staging copy.', category: 'Build', priority: 'medium', weight: 5, estimated_hours: 8, due_offset_days: 15 },
      { title: 'Unit & integration test coverage', description: 'Done when new code paths have automated test coverage passing in CI.', category: 'Build', priority: 'high', weight: 6, estimated_hours: 16, due_offset_days: 18 },
      { title: 'Internal QA pass', description: 'Done when QA has executed the test plan and logged all defects found.', category: 'Hardening', priority: 'high', weight: 6, estimated_hours: 12, due_offset_days: 21 },
      { title: 'Bug triage & fixes', description: 'Done when all release-blocking defects are resolved and verified.', category: 'Hardening', priority: 'high', weight: 7, estimated_hours: 16, due_offset_days: 23 },
      { title: 'Performance & load testing', description: 'Done when the release meets agreed performance/load targets.', category: 'Hardening', priority: 'medium', weight: 5, estimated_hours: 8, due_offset_days: 25 },
      { title: 'Security review', description: 'Done when the security checklist is complete with no unresolved high-severity findings.', category: 'Hardening', priority: 'high', weight: 5, estimated_hours: 6, due_offset_days: 26 },
      { title: 'Staging deployment & smoke test', description: 'Done when the release is deployed to staging and smoke tests pass.', category: 'Hardening', priority: 'medium', weight: 4, estimated_hours: 4, due_offset_days: 27 },
      { title: 'Release notes & documentation', description: 'Done when release notes and user-facing docs are published.', category: 'Launch', priority: 'low', weight: 3, estimated_hours: 4, due_offset_days: 28 },
      { title: 'Go-to-market / customer comms prep', description: 'Done when in-app announcements, emails, and support docs are ready to send.', category: 'Launch', priority: 'medium', weight: 4, estimated_hours: 5, due_offset_days: 28 },
      { title: 'Production deployment', description: 'Done when the release is live in production with no rollback triggered.', category: 'Launch', priority: 'urgent', weight: 5, estimated_hours: 4, due_offset_days: 29 },
      { title: 'Post-launch monitoring & hotfix window', description: 'Done when the monitoring window closes with error rates back to baseline.', category: 'Launch', priority: 'high', weight: 4, estimated_hours: 6, due_offset_days: 30 },
    ],
  },

  // ── Legal ─────────────────────────────────────────────────────────────
  {
    id: 'civil-litigation-matter',
    sector: 'Legal',
    name: 'Civil Litigation Matter',
    description: 'A civil litigation matter from intake through trial or settlement, covering pleadings, discovery, motion practice, and resolution.',
    color: '#78716c',
    tasks: [
      { title: 'Conflict check & engagement letter', description: 'Done when the conflict check clears and the signed engagement letter is on file.', category: 'Intake', priority: 'high', weight: 3, estimated_hours: 2, due_offset_days: 0 },
      { title: 'Initial client interview & case assessment', description: 'Done when the facts are documented and a preliminary case assessment memo is drafted.', category: 'Intake', priority: 'high', weight: 4, estimated_hours: 3, due_offset_days: 1 },
      { title: 'Draft & file pleadings (complaint/answer)', description: 'Done when the initial pleading is filed and served.', category: 'Intake', priority: 'high', weight: 6, estimated_hours: 8, due_offset_days: 5 },
      { title: 'Litigation hold & document preservation notice', description: 'Done when the hold notice is issued to all relevant custodians.', category: 'Discovery', priority: 'high', weight: 4, estimated_hours: 2, due_offset_days: 6 },
      { title: 'Written discovery requests (interrogatories, RFPs)', description: 'Done when written discovery is served on opposing counsel.', category: 'Discovery', priority: 'medium', weight: 5, estimated_hours: 6, due_offset_days: 10 },
      { title: 'Document review & privilege log', description: 'Done when responsive documents are reviewed, produced, and privilege is logged.', category: 'Discovery', priority: 'medium', weight: 6, estimated_hours: 16, due_offset_days: 15 },
      { title: 'Depositions', description: 'Done when all key fact witness depositions are taken or defended.', category: 'Discovery', priority: 'high', weight: 8, estimated_hours: 20, due_offset_days: 25 },
      { title: 'Expert witness retention & reports', description: 'Done when expert reports are finalized and disclosed per the scheduling order.', category: 'Discovery', priority: 'medium', weight: 6, estimated_hours: 10, due_offset_days: 30 },
      { title: 'Draft & file dispositive motion', description: 'Done when a summary judgment (or equivalent) motion is filed with supporting brief.', category: 'Motion Practice', priority: 'high', weight: 7, estimated_hours: 12, due_offset_days: 35 },
      { title: 'Respond to opposing motions', description: 'Done when oppositions/replies are filed by the court deadline.', category: 'Motion Practice', priority: 'high', weight: 6, estimated_hours: 8, due_offset_days: 40 },
      { title: 'Motion hearing', description: 'Done when the hearing is attended and the ruling is received and logged.', category: 'Motion Practice', priority: 'high', weight: 5, estimated_hours: 4, due_offset_days: 45 },
      { title: 'Settlement conference / mediation', description: 'Done when the mediation session concludes, whether or not settlement is reached.', category: 'Resolution', priority: 'medium', weight: 5, estimated_hours: 6, due_offset_days: 50 },
      { title: 'Trial preparation & witness prep', description: 'Done when witnesses are prepped and the trial outline is finalized.', category: 'Trial Prep', priority: 'high', weight: 8, estimated_hours: 20, due_offset_days: 55 },
      { title: 'Prepare exhibits & trial binder', description: 'Done when the exhibit list is finalized and trial binders are assembled.', category: 'Trial Prep', priority: 'medium', weight: 5, estimated_hours: 8, due_offset_days: 58 },
      { title: 'Trial or final settlement', description: 'Done when the matter concludes by verdict or executed settlement agreement.', category: 'Resolution', priority: 'urgent', weight: 9, estimated_hours: 24, due_offset_days: 65 },
      { title: 'Closing letter & file closure', description: 'Done when the closing letter is sent and the file is closed per retention policy.', category: 'Resolution', priority: 'low', weight: 2, estimated_hours: 2, due_offset_days: 70 },
    ],
  },

  // ── Construction / Engineering ───────────────────────────────────────────
  {
    id: 'commercial-construction-project',
    sector: 'Construction & Engineering',
    name: 'Commercial Construction Project',
    description: 'A commercial build from preconstruction through occupancy handover — permitting, procurement, phased construction, and closeout.',
    color: '#f97316',
    tasks: [
      { title: 'Site survey & geotechnical report', description: 'Done when the survey and soils report are received and reviewed by the design team.', category: 'Preconstruction', priority: 'high', weight: 5, estimated_hours: 8, due_offset_days: 0 },
      { title: 'Permit application & approvals', description: 'Done when building permits are submitted and approved by the jurisdiction.', category: 'Preconstruction', priority: 'high', weight: 5, estimated_hours: 6, due_offset_days: 5 },
      { title: 'Design development & drawings finalization', description: 'Done when construction documents are stamped and issued for construction.', category: 'Preconstruction', priority: 'high', weight: 7, estimated_hours: 20, due_offset_days: 10 },
      { title: 'Cost estimating & budget approval', description: 'Done when the owner has approved the final construction budget.', category: 'Preconstruction', priority: 'high', weight: 5, estimated_hours: 8, due_offset_days: 15 },
      { title: 'Subcontractor bidding & selection', description: 'Done when all major trade packages are bid and awarded.', category: 'Procurement', priority: 'medium', weight: 5, estimated_hours: 10, due_offset_days: 20 },
      { title: 'Material procurement & long-lead ordering', description: 'Done when long-lead items are ordered with confirmed delivery dates.', category: 'Procurement', priority: 'medium', weight: 4, estimated_hours: 6, due_offset_days: 22 },
      { title: 'Site mobilization & safety plan', description: 'Done when the site is mobilized and the site-specific safety plan is posted.', category: 'Construction', priority: 'medium', weight: 3, estimated_hours: 4, due_offset_days: 25 },
      { title: 'Site work & foundation', description: 'Done when foundation inspection passes and is signed off by the inspector.', category: 'Construction', priority: 'high', weight: 8, estimated_hours: 40, due_offset_days: 28 },
      { title: 'Structural framing', description: 'Done when framing inspection passes for all levels.', category: 'Construction', priority: 'high', weight: 9, estimated_hours: 60, due_offset_days: 40 },
      { title: 'MEP rough-in (mechanical/electrical/plumbing)', description: 'Done when all rough-in trades pass inspection.', category: 'Construction', priority: 'high', weight: 8, estimated_hours: 40, due_offset_days: 55 },
      { title: 'Building envelope & exterior finishes', description: 'Done when the building is weather-tight and exterior finishes are complete.', category: 'Construction', priority: 'medium', weight: 7, estimated_hours: 30, due_offset_days: 70 },
      { title: 'Interior finishes & fixtures', description: 'Done when interior finishes, fixtures, and equipment are installed.', category: 'Construction', priority: 'medium', weight: 6, estimated_hours: 30, due_offset_days: 85 },
      { title: 'Progress inspections & punch list tracking', description: 'Done when all scheduled progress inspections pass and a live punch list is maintained.', category: 'Construction', priority: 'medium', weight: 5, estimated_hours: 12, due_offset_days: 95 },
      { title: 'Final inspection & certificate of occupancy', description: 'Done when the certificate of occupancy is issued.', category: 'Closeout', priority: 'high', weight: 6, estimated_hours: 8, due_offset_days: 100 },
      { title: 'Punch list completion', description: 'Done when every punch list item is resolved and verified.', category: 'Closeout', priority: 'medium', weight: 4, estimated_hours: 10, due_offset_days: 103 },
      { title: 'As-built drawings & O&M manual handover', description: 'Done when as-builts and operations/maintenance manuals are delivered to the owner.', category: 'Closeout', priority: 'low', weight: 3, estimated_hours: 6, due_offset_days: 106 },
      { title: 'Client walkthrough & project handover', description: 'Done when the owner signs off on final walkthrough and keys/access are transferred.', category: 'Closeout', priority: 'medium', weight: 3, estimated_hours: 3, due_offset_days: 108 },
    ],
  },

  // ── Insurance ─────────────────────────────────────────────────────────
  {
    id: 'property-claim-handling',
    sector: 'Insurance',
    name: 'Property Claim Handling',
    description: 'A property insurance claim from first notice of loss through settlement and file closure.',
    color: '#14b8a6',
    tasks: [
      { title: 'First notice of loss (FNOL) intake', description: 'Done when the claim is logged with a claim number and initial details captured.', category: 'Intake', priority: 'urgent', weight: 3, estimated_hours: 1, due_offset_days: 0 },
      { title: 'Coverage verification & policy review', description: 'Done when coverage, limits, and exclusions applicable to the loss are confirmed.', category: 'Intake', priority: 'high', weight: 4, estimated_hours: 2, due_offset_days: 0 },
      { title: 'Assign adjuster & schedule inspection', description: 'Done when an adjuster is assigned and the site inspection is scheduled.', category: 'Intake', priority: 'high', weight: 2, estimated_hours: 1, due_offset_days: 1 },
      { title: 'Site inspection & damage assessment', description: 'Done when the loss site has been inspected and damage scope documented.', category: 'Investigation', priority: 'high', weight: 6, estimated_hours: 4, due_offset_days: 3 },
      { title: 'Photograph & document damages', description: 'Done when photo/video evidence and a damage inventory are filed with the claim.', category: 'Investigation', priority: 'medium', weight: 4, estimated_hours: 2, due_offset_days: 3 },
      { title: 'Request repair estimates / contractor bids', description: 'Done when at least two comparable repair estimates are on file.', category: 'Investigation', priority: 'medium', weight: 4, estimated_hours: 3, due_offset_days: 5 },
      { title: 'Fraud/red-flag investigation (if applicable)', description: 'Done when red flags are reviewed and cleared or escalated to SIU.', category: 'Investigation', priority: 'medium', weight: 5, estimated_hours: 4, due_offset_days: 6 },
      { title: 'Review policy limits, deductibles & exclusions', description: 'Done when the payable scope is finalized against policy terms.', category: 'Adjustment', priority: 'high', weight: 5, estimated_hours: 3, due_offset_days: 8 },
      { title: 'Calculate loss reserve', description: 'Done when the reserve is set and entered in the claims system.', category: 'Adjustment', priority: 'high', weight: 4, estimated_hours: 2, due_offset_days: 8 },
      { title: 'Prepare settlement offer', description: 'Done when the settlement worksheet and offer letter are ready to send.', category: 'Adjustment', priority: 'high', weight: 5, estimated_hours: 3, due_offset_days: 10 },
      { title: 'Negotiate settlement with policyholder', description: 'Done when the policyholder accepts a settlement amount.', category: 'Adjustment', priority: 'high', weight: 5, estimated_hours: 4, due_offset_days: 12 },
      { title: 'Approve & issue payment', description: 'Done when payment is issued and confirmed received.', category: 'Resolution', priority: 'urgent', weight: 4, estimated_hours: 2, due_offset_days: 14 },
      { title: 'Subrogation review', description: 'Done when a subrogation opportunity is identified and referred, or ruled out.', category: 'Resolution', priority: 'low', weight: 3, estimated_hours: 2, due_offset_days: 16 },
      { title: 'Close claim file & quality audit', description: 'Done when the file passes quality audit and is marked closed.', category: 'Resolution', priority: 'low', weight: 2, estimated_hours: 1, due_offset_days: 18 },
    ],
  },

  // ── Recruitment ───────────────────────────────────────────────────────
  {
    id: 'hiring-pipeline',
    sector: 'Recruitment',
    name: 'Hiring Pipeline (Single Requisition)',
    description: 'A single-role hiring pipeline from intake with the hiring manager through offer and background check.',
    color: '#a855f7',
    tasks: [
      { title: 'Intake meeting with hiring manager', description: 'Done when role requirements, level, and comp band are agreed with the hiring manager.', category: 'Intake', priority: 'high', weight: 3, estimated_hours: 1, due_offset_days: 0 },
      { title: 'Write & approve job description', description: 'Done when the JD is written and approved for posting.', category: 'Intake', priority: 'medium', weight: 3, estimated_hours: 2, due_offset_days: 1 },
      { title: 'Post job & activate sourcing channels', description: 'Done when the requisition is live on job boards and sourcing channels.', category: 'Sourcing', priority: 'medium', weight: 2, estimated_hours: 1, due_offset_days: 2 },
      { title: 'Resume screening', description: 'Done when all applicants are screened and a shortlist is produced.', category: 'Sourcing', priority: 'medium', weight: 4, estimated_hours: 4, due_offset_days: 5 },
      { title: 'Recruiter phone screens', description: 'Done when shortlisted candidates complete a recruiter screen.', category: 'Interviewing', priority: 'high', weight: 4, estimated_hours: 5, due_offset_days: 8 },
      { title: 'Hiring manager interview', description: 'Done when the hiring manager has interviewed advancing candidates.', category: 'Interviewing', priority: 'high', weight: 4, estimated_hours: 4, due_offset_days: 12 },
      { title: 'Panel / technical interview', description: 'Done when the panel/technical round is complete with scorecards submitted.', category: 'Interviewing', priority: 'high', weight: 5, estimated_hours: 6, due_offset_days: 15 },
      { title: 'Reference checks', description: 'Done when references are checked for the leading candidate.', category: 'Interviewing', priority: 'medium', weight: 3, estimated_hours: 2, due_offset_days: 18 },
      { title: 'Compile candidate scorecards & debrief', description: 'Done when the hiring team has debriefed and selected a final candidate.', category: 'Interviewing', priority: 'medium', weight: 3, estimated_hours: 2, due_offset_days: 19 },
      { title: 'Extend offer & negotiate', description: 'Done when the candidate accepts a written offer.', category: 'Offer', priority: 'high', weight: 4, estimated_hours: 2, due_offset_days: 21 },
      { title: 'Background check & onboarding paperwork', description: 'Done when the background check clears and onboarding paperwork is filed.', category: 'Offer', priority: 'medium', weight: 3, estimated_hours: 2, due_offset_days: 23 },
    ],
  },

  // ── Real Estate ───────────────────────────────────────────────────────
  {
    id: 'residential-purchase-transaction',
    sector: 'Real Estate',
    name: 'Residential Purchase Transaction',
    description: 'A residential purchase from executed contract through closing — due diligence, financing, and title clearance.',
    color: '#84cc16',
    tasks: [
      { title: 'Execute purchase agreement', description: 'Done when the purchase agreement is fully executed by both parties.', category: 'Under Contract', priority: 'high', weight: 4, estimated_hours: 2, due_offset_days: 0 },
      { title: 'Open escrow & deposit earnest money', description: 'Done when escrow is opened and earnest money is deposited and confirmed.', category: 'Under Contract', priority: 'high', weight: 3, estimated_hours: 1, due_offset_days: 1 },
      { title: 'Order title search & preliminary report', description: 'Done when the preliminary title report is received and reviewed.', category: 'Due Diligence', priority: 'medium', weight: 4, estimated_hours: 2, due_offset_days: 2 },
      { title: 'Schedule & complete home inspection', description: 'Done when the inspection report is delivered to the buyer.', category: 'Due Diligence', priority: 'high', weight: 5, estimated_hours: 4, due_offset_days: 5 },
      { title: 'Negotiate repair/credit requests', description: 'Done when repair or credit terms are agreed and documented in an addendum.', category: 'Due Diligence', priority: 'medium', weight: 4, estimated_hours: 3, due_offset_days: 8 },
      { title: 'Order appraisal', description: 'Done when the appraisal is ordered and the report is received.', category: 'Financing', priority: 'high', weight: 4, estimated_hours: 2, due_offset_days: 9 },
      { title: 'Buyer loan underwriting & conditions', description: 'Done when underwriting conditions are cleared by the lender.', category: 'Financing', priority: 'high', weight: 6, estimated_hours: 6, due_offset_days: 15 },
      { title: 'Homeowners insurance binder', description: 'Done when a homeowners insurance binder is on file for closing.', category: 'Financing', priority: 'medium', weight: 3, estimated_hours: 2, due_offset_days: 18 },
      { title: 'Clear title & resolve liens', description: 'Done when title is clear of liens/encumbrances not accepted by the buyer.', category: 'Due Diligence', priority: 'high', weight: 5, estimated_hours: 4, due_offset_days: 20 },
      { title: 'Final loan approval (clear to close)', description: "Done when the lender issues “clear to close.”", category: 'Financing', priority: 'high', weight: 5, estimated_hours: 3, due_offset_days: 24 },
      { title: 'Final walkthrough', description: 'Done when the buyer completes the final walkthrough with no unresolved issues.', category: 'Closing', priority: 'medium', weight: 3, estimated_hours: 2, due_offset_days: 27 },
      { title: 'Closing disclosure review', description: 'Done when both parties have reviewed and acknowledged the closing disclosure.', category: 'Closing', priority: 'high', weight: 4, estimated_hours: 2, due_offset_days: 27 },
      { title: 'Sign closing documents & fund', description: 'Done when documents are signed and funds are disbursed.', category: 'Closing', priority: 'urgent', weight: 5, estimated_hours: 3, due_offset_days: 29 },
      { title: 'Recording & key handover', description: 'Done when the deed is recorded and keys are handed to the buyer.', category: 'Closing', priority: 'medium', weight: 3, estimated_hours: 1, due_offset_days: 30 },
    ],
  },

  // ── Clinical / Medical Billing ─────────────────────────────────────────
  {
    id: 'medical-billing-revenue-cycle',
    sector: 'Clinical & Medical Billing',
    name: 'Medical Billing Revenue Cycle',
    description: 'A single-encounter revenue cycle from registration through payment posting and denial follow-up.',
    color: '#ef4444',
    tasks: [
      { title: 'Patient registration & insurance verification', description: 'Done when demographics and insurance eligibility are verified and on file.', category: 'Intake', priority: 'high', weight: 4, estimated_hours: 1, due_offset_days: 0 },
      { title: 'Prior authorization request', description: 'Done when required prior authorization is obtained (or confirmed not required).', category: 'Intake', priority: 'high', weight: 4, estimated_hours: 2, due_offset_days: 1 },
      { title: 'Charge capture from encounter', description: 'Done when all billable services from the encounter are captured.', category: 'Coding', priority: 'high', weight: 4, estimated_hours: 1, due_offset_days: 2 },
      { title: 'ICD-10/CPT coding & compliance review', description: 'Done when codes are assigned and pass compliance review.', category: 'Coding', priority: 'high', weight: 6, estimated_hours: 3, due_offset_days: 3 },
      { title: 'Claim scrubbing & edits resolution', description: 'Done when the claim passes all payer edit checks.', category: 'Submission', priority: 'high', weight: 5, estimated_hours: 2, due_offset_days: 4 },
      { title: 'Submit claim to clearinghouse/payer', description: 'Done when the claim is accepted by the clearinghouse.', category: 'Submission', priority: 'high', weight: 3, estimated_hours: 1, due_offset_days: 5 },
      { title: 'Payer adjudication tracking', description: 'Done when the claim status is confirmed as adjudicated.', category: 'Submission', priority: 'medium', weight: 3, estimated_hours: 1, due_offset_days: 12 },
      { title: 'Payment posting & EOB reconciliation', description: 'Done when the payment is posted and reconciled against the EOB/ERA.', category: 'Follow-up', priority: 'high', weight: 4, estimated_hours: 2, due_offset_days: 18 },
      { title: 'Denial management & appeals', description: 'Done when denied lines are corrected and resubmitted or appealed.', category: 'Follow-up', priority: 'high', weight: 6, estimated_hours: 4, due_offset_days: 22 },
      { title: 'Patient statement generation', description: 'Done when the patient statement for the remaining balance is generated and sent.', category: 'Follow-up', priority: 'medium', weight: 3, estimated_hours: 1, due_offset_days: 25 },
      { title: 'Patient collections follow-up', description: 'Done when the patient balance is collected or placed on a payment plan.', category: 'Follow-up', priority: 'low', weight: 3, estimated_hours: 2, due_offset_days: 32 },
      { title: 'Aging report review & write-off decisions', description: 'Done when aged balances are reviewed and write-off decisions are documented.', category: 'Follow-up', priority: 'medium', weight: 4, estimated_hours: 2, due_offset_days: 40 },
    ],
  },

  // ── Manufacturing ─────────────────────────────────────────────────────
  {
    id: 'new-product-introduction',
    sector: 'Manufacturing',
    name: 'New Product Introduction (NPI)',
    description: 'A new product introduction from concept through full production ramp, following a standard NPI/DFM gate structure.',
    color: '#3b82f6',
    tasks: [
      { title: 'Product requirements & spec definition', description: 'Done when the product requirements document is approved.', category: 'Concept', priority: 'high', weight: 5, estimated_hours: 6, due_offset_days: 0 },
      { title: 'Feasibility & cost analysis', description: 'Done when target cost and manufacturing feasibility are confirmed.', category: 'Concept', priority: 'medium', weight: 4, estimated_hours: 5, due_offset_days: 4 },
      { title: 'Design for manufacturability (DFM) review', description: 'Done when the DFM review is complete and design changes are logged.', category: 'Design', priority: 'high', weight: 6, estimated_hours: 8, due_offset_days: 8 },
      { title: 'Bill of materials (BOM) creation', description: 'Done when the engineering BOM is complete and released.', category: 'Design', priority: 'medium', weight: 5, estimated_hours: 5, due_offset_days: 12 },
      { title: 'Prototype build', description: 'Done when a functional prototype is built and available for testing.', category: 'Design', priority: 'high', weight: 7, estimated_hours: 16, due_offset_days: 16 },
      { title: 'Supplier sourcing & tooling quotes', description: 'Done when supplier quotes and tooling lead times are secured.', category: 'Design', priority: 'medium', weight: 5, estimated_hours: 6, due_offset_days: 18 },
      { title: 'Prototype testing & design iteration', description: 'Done when prototype test results are reviewed and design updates are closed out.', category: 'Validation', priority: 'high', weight: 7, estimated_hours: 12, due_offset_days: 24 },
      { title: 'Pilot production run', description: 'Done when the pilot run is complete and yield/quality data is captured.', category: 'Validation', priority: 'high', weight: 7, estimated_hours: 16, due_offset_days: 32 },
      { title: 'Quality/reliability testing (DVT)', description: 'Done when design validation testing passes acceptance criteria.', category: 'Validation', priority: 'high', weight: 6, estimated_hours: 10, due_offset_days: 38 },
      { title: 'Process FMEA & control plan', description: 'Done when the process FMEA and control plan are documented and approved.', category: 'Validation', priority: 'medium', weight: 5, estimated_hours: 6, due_offset_days: 42 },
      { title: 'Regulatory/compliance certification', description: 'Done when required certifications (safety, EMC, etc.) are obtained.', category: 'Validation', priority: 'high', weight: 6, estimated_hours: 10, due_offset_days: 46 },
      { title: 'Line setup & work instructions', description: 'Done when the production line is set up with approved work instructions.', category: 'Ramp', priority: 'medium', weight: 5, estimated_hours: 8, due_offset_days: 52 },
      { title: 'Operator training', description: 'Done when line operators are trained and signed off as qualified.', category: 'Ramp', priority: 'medium', weight: 3, estimated_hours: 4, due_offset_days: 55 },
      { title: 'First production run (PPAP/sign-off)', description: 'Done when the first production run is approved via PPAP or equivalent sign-off.', category: 'Ramp', priority: 'high', weight: 6, estimated_hours: 10, due_offset_days: 58 },
      { title: 'Ramp to full production volume', description: 'Done when the line sustains target production volume at target yield.', category: 'Ramp', priority: 'medium', weight: 4, estimated_hours: 6, due_offset_days: 65 },
      { title: 'Post-launch quality review', description: 'Done when early-life field/quality data is reviewed against targets.', category: 'Ramp', priority: 'low', weight: 3, estimated_hours: 4, due_offset_days: 75 },
    ],
  },

  // ── Event Production ────────────────────────────────────────────────────
  {
    id: 'corporate-event-production',
    sector: 'Event Production',
    name: 'Corporate Event Production',
    description: 'A corporate event from brief through onsite execution and post-event wrap-up.',
    color: '#eab308',
    tasks: [
      { title: 'Event brief & objectives', description: 'Done when event goals, audience, and success metrics are agreed.', category: 'Planning', priority: 'high', weight: 3, estimated_hours: 2, due_offset_days: 0 },
      { title: 'Venue sourcing & contract', description: 'Done when the venue contract is signed and deposit paid.', category: 'Planning', priority: 'high', weight: 4, estimated_hours: 4, due_offset_days: 3 },
      { title: 'Budget & vendor procurement plan', description: 'Done when the event budget and vendor list are approved.', category: 'Planning', priority: 'medium', weight: 4, estimated_hours: 3, due_offset_days: 5 },
      { title: 'Run-of-show & program design', description: 'Done when the run-of-show is drafted and approved by stakeholders.', category: 'Planning', priority: 'medium', weight: 5, estimated_hours: 5, due_offset_days: 10 },
      { title: 'Speaker/talent booking & briefing', description: 'Done when all speakers/talent are booked and briefed on the program.', category: 'Production', priority: 'medium', weight: 4, estimated_hours: 4, due_offset_days: 14 },
      { title: 'Catering & AV vendor booking', description: 'Done when catering and AV vendors are booked and requirements confirmed.', category: 'Production', priority: 'medium', weight: 3, estimated_hours: 3, due_offset_days: 16 },
      { title: 'Registration platform setup', description: 'Done when the registration site is live and tested end-to-end.', category: 'Production', priority: 'medium', weight: 4, estimated_hours: 4, due_offset_days: 18 },
      { title: 'Marketing/invitations & RSVP tracking', description: 'Done when invitations are sent and RSVP tracking is active.', category: 'Production', priority: 'medium', weight: 4, estimated_hours: 5, due_offset_days: 20 },
      { title: 'Signage & branding production', description: 'Done when all signage and branded materials are printed/produced.', category: 'Production', priority: 'low', weight: 3, estimated_hours: 4, due_offset_days: 25 },
      { title: 'Site walkthrough & floor plan finalization', description: 'Done when the venue walkthrough is complete and the floor plan is finalized.', category: 'Onsite', priority: 'medium', weight: 4, estimated_hours: 3, due_offset_days: 28 },
      { title: 'Load-in & AV/staging setup', description: 'Done when load-in is complete and AV/staging pass a technical check.', category: 'Onsite', priority: 'high', weight: 5, estimated_hours: 8, due_offset_days: 29 },
      { title: 'Rehearsal & tech check', description: 'Done when a full run-through with talent and AV is complete.', category: 'Onsite', priority: 'high', weight: 4, estimated_hours: 4, due_offset_days: 29 },
      { title: 'Event day execution', description: 'Done when the event concludes on-program with no unresolved incidents.', category: 'Onsite', priority: 'urgent', weight: 7, estimated_hours: 12, due_offset_days: 30 },
      { title: 'Load-out & vendor settlement', description: 'Done when load-out is complete and vendor invoices are settled.', category: 'Wrap-up', priority: 'medium', weight: 3, estimated_hours: 4, due_offset_days: 31 },
      { title: 'Post-event survey & report', description: 'Done when the attendee survey results and event report are shared with stakeholders.', category: 'Wrap-up', priority: 'low', weight: 3, estimated_hours: 3, due_offset_days: 35 },
    ],
  },
];

/** STARTER_TEMPLATES grouped by sector, in source order — what the picker UI renders. */
export function starterTemplatesBySector(): Array<[string, StarterTemplate[]]> {
  const map = new Map<string, StarterTemplate[]>();
  for (const t of STARTER_TEMPLATES) {
    const list = map.get(t.sector) ?? [];
    list.push(t);
    map.set(t.sector, list);
  }
  return Array.from(map.entries());
}
