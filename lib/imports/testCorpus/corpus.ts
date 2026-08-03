// Multi-industry test corpus for the Phase 9 spreadsheet classifier (plan §18,
// issue #142 Phase 9). Data only — no assertions, no I/O, no classifier import
// beyond types. `generate.ts` turns these into real .xlsx files; `benchmark.ts`
// scores the classifier against the ground truth recorded here.
//
// WHY THIS EXISTS
// The classifier was written while looking at ONE real file (a Qatari audit
// firm's engagement register) and scores 22/22 on it. That number cannot tell
// us whether content-first classification generalises. These eleven workbooks
// are eleven different industries, authored to be *plausible*, not to be
// passable. Where the classifier is wrong on them, it is wrong.
//
// NO REAL DATA. Every company, person, email, phone number, MLS number, MRN and
// container number below is invented. Nothing here was copied from any client
// file.
//
// GROUND TRUTH IS AUTHORED, NOT OBSERVED. Every `columns[i].primitive` is what
// the column really holds, decided when the cells were written — never adjusted
// afterwards to match what the classifier said. `alsoOk` exists only where two
// primitives are both defensible readings of the same cells (a column of story
// points is an enum and a number), and is used three times in total.

import type { ColumnAnomalyKind, ColumnPrimitive, DateOrder, SheetCell } from '../spreadsheetMapping';

export type ColumnTruth = {
  /** the header text as authored (before the classifier trims it) */
  header: string;
  /** what the cells REALLY hold */
  primitive: ColumnPrimitive;
  /** other primitives that are a defensible reading of the same cells */
  alsoOk?: ColumnPrimitive[];
  /** the order the dates were authored in, when the column holds slash dates */
  dateOrder?: DateOrder;
  /**
   * Inconsistencies the column was authored to CONTAIN (plan §21). The
   * benchmark scores these both ways: a missed one is a silent corruption, and
   * an anomaly reported on a column that has none is noise the user learns to
   * click past — which is just as bad. Absent means "this column is clean".
   */
  anomalies?: ColumnAnomalyKind[];
  /** why this is the truth / what the trap is */
  note?: string;
};

/**
 * A row that is not a data row. `continuation`/`blank`/`section` are kinds the
 * classifier knows; `total`/`subtotal`/`footer` it reports as `summary`;
 * `duplicate` is an annotation on a row that IS data. Recorded so the benchmark
 * can report a gap instead of pretending it is one.
 */
export type RowTrap = {
  /** a distinctive cell value, used to locate the row after the xlsx roundtrip */
  marker: string;
  kind: 'continuation' | 'total' | 'subtotal' | 'footer' | 'section' | 'header_repeat' | 'duplicate';
  note?: string;
};

export type WorkbookSpec = {
  id: string;
  industry: string;
  /** 0-based index of the real header row within `aoa` */
  headerRow: number;
  /** the column that should name the entity — null when the sheet HAS none */
  nameColumn: number | null;
  columns: ColumnTruth[];
  rowTraps?: RowTrap[];
  /** how many genuinely blank separator rows were authored */
  blankRows?: number;
  aoa: SheetCell[][];
  notes: string;
};

// ─── 1. Construction — subcontractor buyout schedule ────────────────────────
// Title banner + blank row above the table, a leading empty column, US MM/DD
// dates, $ money, percentages, one duplicated subcontractor, a wrapped
// subcontractor name (continuation) and a TOTAL footer.

const CONSTRUCTION: WorkbookSpec = {
  id: 'construction-subk-schedule',
  industry: 'Construction — subcontractor buyout schedule',
  headerRow: 3,
  nameColumn: 3,
  notes:
    'Entity name is neither leftmost nor called "name". Bluestone appears twice (two packages), ' +
    'which is normal and demotes the name column below the all-unique "SOW Ref".',
  columns: [
    { header: '', primitive: 'empty', note: 'leading blank column, no header' },
    { header: 'Pkg #', primitive: 'unique_id' },
    { header: 'Trade', primitive: 'freetext', note: 'category vocabulary, one repeat' },
    { header: 'Subcontractor', primitive: 'freetext', note: 'THE entity name; repeats once' },
    { header: 'SOW Ref', primitive: 'unique_id' },
    { header: 'Contract Value', primitive: 'money', note: '$ + thousands separators, all distinct' },
    { header: 'Retention', primitive: 'money', note: 'percentages — 10% / 5%' },
    { header: 'NTP', primitive: 'date', dateOrder: 'MDY', note: 'US MM/DD, jargon header' },
    { header: 'Sub Completion', primitive: 'date', dateOrder: 'MDY' },
    { header: 'PM', primitive: 'enum' },
    { header: '% Comp', primitive: 'money', note: 'percentages, mostly distinct' },
    { header: 'COI Exp', primitive: 'date', dateOrder: 'MDY', note: 'insurance-cert expiry, jargon header' },
    { header: 'Notes', primitive: 'freetext' },
  ],
  rowTraps: [
    { marker: 'Ceilings LLC', kind: 'continuation', note: 'tail of "Meridian Interiors and", wrapped in the source' },
    { marker: 'TOTAL', kind: 'footer', note: 'sums Contract Value' },
  ],
  blankRows: 1,
  aoa: [
    [null, 'Marina Tower — Phase 2 · Subcontractor Buyout Schedule'],
    [null, 'Rev C — issued 03/14/2026 — Sterling Ridge Construction Group'],
    [null, null],
    ['', 'Pkg #', 'Trade', 'Subcontractor', 'SOW Ref', 'Contract Value', 'Retention', 'NTP', 'Sub Completion', 'PM', '% Comp', 'COI Exp', 'Notes'],
    ['', '02-100', 'Sitework', 'Redhawk Earthworks LLC', 'SOW-4412', '$1,240,000', '10%', '01/06/2026', '04/30/2026', 'D. Ruiz', '65%', '12/31/2026', 'Mobilized, 2 crews'],
    ['', '03-200', 'Concrete', 'Bluestone Concrete Group', 'SOW-4418', '$3,410,000', '10%', '01/20/2026', '08/15/2026', 'D. Ruiz', '40%', '09/30/2026', 'Deck pours 2 wks behind'],
    ['', '03-210', 'Concrete', 'Bluestone Concrete Group', 'SOW-4419', '$410,000', '10%', '04/06/2026', '07/15/2026', 'D. Ruiz', '80%', '09/30/2026', 'Podium slab only'],
    ['', '05-120', 'Structural Steel', 'Ironvale Steel Erectors', 'SOW-4423', '$2,880,000', '5%', '02/03/2026', '09/30/2026', 'P. Almeida', '25%', '11/30/2026', ''],
    ['', '07-400', 'Roofing', 'Summit Ridge Roofing Co', 'SOW-4431', '$640,000', '10%', '05/11/2026', '10/02/2026', 'P. Almeida', '0%', '06/30/2026', 'Awaiting shop dwgs'],
    ['', '08-800', 'Glazing', 'Clearline Facade Systems', 'SOW-4437', '$1,975,000', '5%', '03/16/2026', '11/14/2026', 'D. Ruiz', '10%', '12/31/2026', ''],
    ['', '09-300', 'Drywall', 'Meridian Interiors and', 'SOW-4440', '$1,120,000', '10%', '06/01/2026', '12/18/2026', 'L. Novak', '0%', '07/31/2026', ''],
    ['', '', '', 'Ceilings LLC', '', '', '', '', '', '', '', '', ''],
    ['', '15-100', 'Plumbing', 'Harborline Mechanical', 'SOW-4444', '$2,310,000', '10%', '02/17/2026', '10/30/2026', 'L. Novak', '30%', '08/31/2026', 'RFI 118 open'],
    ['', '16-100', 'Electrical', 'Voltaic Power Systems', 'SOW-4451', '$3,060,000', '10%', '02/17/2026', '11/20/2026', 'L. Novak', '35%', '08/31/2026', ''],
    ['', '21-000', 'Fire Protection', 'Redline Suppression Inc', 'SOW-4455', '$780,000', '5%', '07/06/2026', '12/04/2026', 'P. Almeida', '0%', '10/31/2026', ''],
    [null, null, null, null, null, null, null, null, null, null, null, null, null],
    ['', '', '', 'TOTAL', '', '$17,825,000', '', '', '', '', '', '', ''],
  ],
};

// ─── 2. Law firm — matter list ──────────────────────────────────────────────
// ISO dates, a header that lies ("Conflict Check" holds the date the check
// cleared), a rate column that is half prose, a money column that survives only
// because it contains a zero, and a TOTALS footer.

const LAW: WorkbookSpec = {
  id: 'law-matter-list',
  industry: 'Law firm — open matter list',
  headerRow: 0,
  nameColumn: 2,
  notes: '"Conflict Check" reads like a boolean and holds dates. "Last Activity" is half prose, half ISO dates.',
  columns: [
    { header: 'Matter No', primitive: 'unique_id' },
    { header: 'Client', primitive: 'freetext', note: '6 clients over 11 matters — just misses the enum ratio' },
    { header: 'Matter Description', primitive: 'unique_id', note: 'THE entity name' },
    { header: 'Practice', primitive: 'enum', note: 'internal codes: CORP / LIT / IP / R/E' },
    { header: 'Responsible Atty', primitive: 'enum', note: 'initials' },
    { header: 'Opened', primitive: 'date', note: 'ISO — no order question to ask' },
    { header: 'Status', primitive: 'enum' },
    { header: 'Rate', primitive: 'money', note: 'mixed: hourly numbers + "Fixed fee" / "Contingency 33%"' },
    { header: 'WIP', primitive: 'money', note: 'text money, every value distinct' },
    { header: 'A/R', primitive: 'money', note: 'parenthesised negatives AND zeros' },
    { header: 'Last Activity', primitive: 'freetext', note: 'a third of the cells are ISO dates' },
    { header: 'Conflict Check', primitive: 'date', note: 'HEADER LIES: reads boolean, holds the clearance date' },
  ],
  rowTraps: [{ marker: 'TOTALS', kind: 'footer' }],
  aoa: [
    ['Matter No', 'Client', 'Matter Description', 'Practice', 'Responsible Atty', 'Opened', 'Status', 'Rate', 'WIP', 'A/R', 'Last Activity', 'Conflict Check'],
    ['2026-0114', 'Vantage Grid Energy', 'Series B financing — 40M', 'CORP', 'JMK', '2025-11-03', 'Open', 425, '12,450.00', '0', 'Drafted SPA revisions', '2025-10-28'],
    ['2026-0115', 'Vantage Grid Energy', 'IP assignment audit', 'IP', 'ALP', '2025-11-03', 'Open', 425, '8,900.00', '(1,200.00)', '2026-01-14', '2025-10-28'],
    ['2026-0121', 'Halcyon Foods Ltd', 'Distribution agmt dispute', 'LIT', 'RTC', '2025-12-09', 'Open', 'Contingency 33%', '44,120.00', '18,400.00', 'Deposition scheduled', '2025-12-01'],
    ['2026-0122', 'Halcyon Foods Ltd', 'Lease renewal — Unit 7', 'R/E', 'ALP', '2026-01-05', 'Closed', 350, '2,300.00', '0', '2026-02-02', '2025-12-18'],
    ['2026-0130', 'Brightwater Clinics', 'Employment claim — Reyes', 'LIT', 'RTC', '2026-01-19', 'Open', 500, '21,780.00', '6,500.00', 'Mediation set for March', '2026-01-12'],
    ['2026-0131', 'Brightwater Clinics', 'HIPAA policy refresh', 'CORP', 'JMK', '2026-01-19', 'On hold', 'Fixed fee', '4,000.00', '0', '', '2026-01-12'],
    ['2026-0140', 'Nordvik Shipping AS', 'Charterparty arbitration', 'LIT', 'RTC', '2026-02-02', 'Open', 500, '63,210.00', '31,900.00', 'Award pending', '2026-01-26'],
    ['2026-0141', 'Nordvik Shipping AS', 'Vessel mortgage discharge', 'CORP', 'ALP', '2026-02-02', 'Closed', 350, '3,150.00', '0', '2026-03-11', '2026-01-26'],
    ['2026-0148', 'Cinder Peak Mining', 'Permit appeal — Lot 12', 'LIT', 'RTC', '2026-02-17', 'Open', 'Contingency 33%', '19,400.00', '0', 'Hearing continued', '2026-02-10'],
    ['2026-0152', 'Orpheus Media Group', 'Trademark opposition', 'IP', 'ALP', '2026-03-02', 'Open', 425, '7,650.00', '2,100.00', '2026-03-20', '2026-02-24'],
    ['2026-0155', 'Orpheus Media Group', 'Talent agmt template', 'CORP', 'JMK', '2026-03-02', 'Open', 'Fixed fee', '1,200.00', '0', '', '2026-02-24'],
    ['', '', 'TOTALS', '', '', '', '', '', '188,160.00', '59,100.00', '', ''],
  ],
};

// ─── 3. Marketing agency — campaign tracker (Spanish/English mixed) ─────────
// European decimal money (1.200,00), "k" shorthand, percentages, DD/MM dates
// including one column where every value is <= 12, a mid-table subtotal and a
// TOTAL footer that both land IN the name column.

const MARKETING: WorkbookSpec = {
  id: 'marketing-campaign-tracker',
  industry: 'Marketing agency — campaign tracker (ES/EN)',
  headerRow: 0,
  nameColumn: 0,
  notes: 'Mixed-language sheet. European decimal separators, "8.4k" shorthand, and % — three money dialects.',
  columns: [
    { header: 'Campaña', primitive: 'unique_id', note: 'THE entity name' },
    { header: 'Cliente', primitive: 'enum' },
    { header: 'Canal', primitive: 'enum', alsoOk: ['freetext'], note: '8 channels over 10 campaigns' },
    { header: 'Owner', primitive: 'enum' },
    { header: 'Fecha inicio', primitive: 'date', dateOrder: 'DMY', note: 'EU DD/MM, decidable (17, 21, 23, 30)' },
    { header: 'Fecha fin', primitive: 'date', dateOrder: 'DMY', note: 'EU DD/MM where EVERY value is <= 12 — genuinely ambiguous' },
    { header: 'Presupuesto (€)', primitive: 'money', note: 'European decimals: "€ 12.500,00"' },
    { header: 'Gasto real', primitive: 'money', note: 'k-shorthand: "8.4k", "22k", mixed with plain numbers' },
    { header: 'ROI', primitive: 'money', note: 'percentages' },
    { header: 'Estado', primitive: 'enum', note: 'Spanish values incl. an accented one' },
    { header: 'Notas', primitive: 'freetext', note: 'mixed ES/EN prose' },
  ],
  rowTraps: [
    { marker: 'Subtotal Q1', kind: 'subtotal', note: 'mid-table, lands in the name column' },
    { marker: 'TOTAL', kind: 'footer', note: 'lands in the name column' },
  ],
  blankRows: 1,
  aoa: [
    ['Campaña', 'Cliente', 'Canal', 'Owner', 'Fecha inicio', 'Fecha fin', 'Presupuesto (€)', 'Gasto real', 'ROI', 'Estado', 'Notas'],
    ['Lanzamiento Primavera', 'Verdemar Retail', 'Instagram', 'A. Fontana', '17/01/2026', '01/03/2026', '€ 12.500,00', '8.4k', '230%', 'Activa', 'Creatividades aprobadas'],
    ['Q1 Brand Refresh', 'Northlake Outfitters', 'Google Ads', 'M. Reyes', '03/02/2026', '05/04/2026', '€ 30.000,00', '22k', '185%', 'Activa', ''],
    ['Retargeting Verano', 'Verdemar Retail', 'Meta', 'A. Fontana', '21/02/2026', '12/05/2026', '€ 8.750,00', '3.1k', '96%', 'Pausada', 'Presupuesto congelado'],
    ['Email Nurture EN/ES', 'Cobalt Fitness', 'Email', 'S. Duarte', '05/01/2026', '02/04/2026', '€ 4.200,00', '4200', '310%', 'Finalizada', 'Best performer to date'],
    ['Influencers Otoño', 'Northlake Outfitters', 'TikTok', 'M. Reyes', '30/03/2026', '09/06/2026', '€ 18.000,00', '11.5k', '142%', 'Activa', ''],
    ['Feria Sectorial', 'Ardent Logistics', 'Eventos', 'S. Duarte', '12/04/2026', '12/04/2026', '€ 26.400,00', '26400', '58%', 'Finalizada', 'Coste por lead alto'],
    ['Subtotal Q1', '', '', '', '', '', '€ 99.850,00', '75.4k', '', '', ''],
    ['Programmatic Always-On', 'Cobalt Fitness', 'Display', 'A. Fontana', '02/01/2026', '12/12/2026', '€ 60.000,00', '41k', '173%', 'Activa', 'Renovación anual'],
    ['Podcast Sponsorship', 'Ardent Logistics', 'Audio', 'M. Reyes', '16/03/2026', '11/09/2026', '€ 9.900,00', '9900', '88%', 'En revisión', 'Pending client sign-off'],
    ['Search Brand Defense', 'Verdemar Retail', 'Google Ads', 'S. Duarte', '09/02/2026', '08/08/2026', '€ 15.300,00', '12.2k', '204%', 'Activa', ''],
    ['UGC Contest', 'Cobalt Fitness', 'Instagram', 'A. Fontana', '23/04/2026', '07/07/2026', '€ 7.500,00', '2.9k', '61%', 'Pausada', 'Legal review ES/EN'],
    [null, null, null, null, null, null, null, null, null, null, null],
    ['TOTAL', '', '', '', '', '', '€ 192.550,00', '133.2k', '', '', ''],
  ],
};

// ─── 4. Medical clinic — appointment schedule ───────────────────────────────
// The sheet with NO usable entity name column. Patients are identified by MRN
// only (numeric), everything else is a repeated vocabulary. The classifier must
// say it has no name column rather than picking one.

const CLINIC: WorkbookSpec = {
  id: 'clinic-appointment-schedule',
  industry: 'Medical clinic — appointment schedule',
  headerRow: 0,
  nameColumn: null,
  notes:
    'NO usable entity name column exists: the only unique column is a numeric MRN and every other ' +
    'column is a repeated vocabulary. Also: every date value is <= 12, so the order is undecidable.',
  columns: [
    { header: 'MRN', primitive: 'unique_id', note: 'numeric medical record number — an id, but not a NAME' },
    { header: 'Slot', primitive: 'date', dateOrder: 'MDY', note: 'US MM/DD but every value <= 12 — undecidable' },
    { header: 'Provider', primitive: 'enum' },
    { header: 'Dept', primitive: 'enum' },
    { header: 'Visit Type', primitive: 'enum' },
    { header: 'Status', primitive: 'enum' },
    { header: 'Room', primitive: 'enum' },
    { header: 'Dur (min)', primitive: 'enum', alsoOk: ['money'], note: 'durations — no primitive exists for units' },
    { header: 'Copay', primitive: 'money' },
    { header: 'Ins Verified', primitive: 'enum', note: 'real TRUE/FALSE booleans' },
  ],
  aoa: [
    ['MRN', 'Slot', 'Provider', 'Dept', 'Visit Type', 'Status', 'Room', 'Dur (min)', 'Copay', 'Ins Verified'],
    [884213, '03/04/2026', 'Dr. Reyes', 'Cardiology', 'Follow-up', 'Confirmed', 'R1', 30, 25, true],
    [771904, '03/04/2026', 'Dr. Okonkwo', 'Endocrine', 'New', 'Confirmed', 'R2', 45, 40, true],
    [903117, '03/05/2026', 'Dr. Reyes', 'Cardiology', 'Telehealth', 'Cancelled', 'R1', 15, 0, false],
    [812640, '04/06/2026', 'Dr. Vance', 'Primary', 'Follow-up', 'Arrived', 'R3', 30, 25, true],
    [755328, '04/06/2026', 'Dr. Okonkwo', 'Endocrine', 'Follow-up', 'Confirmed', 'R2', 30, 25, false],
    [869451, '05/07/2026', 'Dr. Vance', 'Primary', 'New', 'Confirmed', 'R4', 60, 40, true],
    [790286, '05/08/2026', 'Dr. Reyes', 'Cardiology', 'Follow-up', 'Arrived', 'R1', 30, 25, true],
    [934770, '06/09/2026', 'Dr. Vance', 'Primary', 'Telehealth', 'Confirmed', 'R3', 15, 0, false],
    [718035, '06/10/2026', 'Dr. Okonkwo', 'Endocrine', 'New', 'Cancelled', 'R2', 45, 40, true],
    [846192, '07/11/2026', 'Dr. Reyes', 'Cardiology', 'Follow-up', 'Confirmed', 'R1', 30, 25, true],
    [802514, '08/12/2026', 'Dr. Vance', 'Primary', 'Follow-up', 'Confirmed', 'R4', 30, 25, false],
    [777063, '09/12/2026', 'Dr. Okonkwo', 'Endocrine', 'Telehealth', 'Arrived', 'R2', 15, 0, true],
    [921348, '10/12/2026', 'Dr. Reyes', 'Cardiology', 'New', 'Confirmed', 'R1', 60, 40, true],
    [864205, '11/12/2026', 'Dr. Vance', 'Primary', 'Follow-up', 'Confirmed', 'R3', 30, 25, false],
  ],
};

// ─── 5. Software consultancy — sprint plan (5 columns) ──────────────────────
// The smallest realistic register. Two equally-unique textual columns: a ticket
// key and a human summary. Only one of them is a name.

const SPRINT: WorkbookSpec = {
  id: 'consultancy-sprint-plan',
  industry: 'Software consultancy — sprint plan',
  headerRow: 0,
  nameColumn: 1,
  notes: 'Five columns. "Ticket" and "Summary" are both unique and textual; only "Summary" names anything.',
  columns: [
    { header: 'Ticket', primitive: 'unique_id' },
    { header: 'Summary', primitive: 'unique_id', note: 'THE entity name' },
    { header: 'Assignee', primitive: 'enum' },
    { header: 'SP', primitive: 'enum', alsoOk: ['money'], note: 'story points — a repeated numeric vocabulary' },
    { header: 'Sprint', primitive: 'enum' },
  ],
  aoa: [
    ['Ticket', 'Summary', 'Assignee', 'SP', 'Sprint'],
    ['TF-1204', 'Split billing service from checkout', 'H. Ndiaye', 8, '2026-S3'],
    ['TF-1211', 'Idempotency keys on webhook intake', 'H. Ndiaye', 5, '2026-S3'],
    ['TF-1216', 'Migrate audit log to partitioned table', 'P. Grewal', 8, '2026-S3'],
    ['TF-1219', 'Fix N+1 on org member list', 'S. Bello', 2, '2026-S3'],
    ['TF-1223', 'SSO metadata refresh job', 'P. Grewal', 3, '2026-S4'],
    ['TF-1228', 'Rate limit the export endpoint', 'S. Bello', 3, '2026-S4'],
    ['TF-1230', 'Backfill missing tenant ids', 'H. Ndiaye', 5, '2026-S4'],
    ['TF-1233', 'Retire the v1 search index', 'P. Grewal', 1, '2026-S4'],
  ],
};

// ─── 6. Manufacturing — work orders (40 columns) ────────────────────────────
// The wide one. Excel serial dates as raw numbers, cost columns whose values sit
// inside the serial-date range, booleans in three dialects (Y/N, 1/0, ✓), a
// mid-table subtotal and a grand-total footer, and an entity whose identity is a
// NUMBER (the work order), not a piece of text.

const MFG_HEADERS = [
  'WO#', 'Part No', 'Rev', 'Description', 'Qty Ord', 'Qty Comp', 'Scrap', 'UOM', 'Machine', 'Shift',
  'Operator', 'Setup Hrs', 'Run Hrs', 'Std Hrs', 'Var Hrs', 'Rel Date', 'Due Date', 'Fin Date', 'Status', 'Pri',
  'Customer', 'PO#', 'Mat Cost', 'Lab Cost', 'OH', 'Tot Cost', 'Yield', 'Insp Req', 'QA Pass', 'Cert',
  'Lot', 'Bin', 'Line', 'Cell', 'Tooling', 'Hold Reason', 'Rework', 'Batch', 'Notes', 'Updated',
];

const MANUFACTURING: WorkbookSpec = {
  id: 'manufacturing-work-orders',
  industry: 'Manufacturing — shop-floor work orders (40 columns)',
  headerRow: 0,
  nameColumn: 0,
  notes:
    'The entity IS the work order number. Cost columns are raw numbers inside the Excel-serial range. ' +
    'Booleans appear as Y/N, 1/0 and ✓ in the same sheet.',
  columns: [
    { header: 'WO#', primitive: 'unique_id', note: 'THE entity name — and it is numeric' },
    { header: 'Part No', primitive: 'enum', alsoOk: ['freetext'], note: 'five parts over ten orders' },
    { header: 'Rev', primitive: 'enum' },
    { header: 'Description', primitive: 'freetext', note: 'repeats with the part' },
    { header: 'Qty Ord', primitive: 'money', note: 'a quantity — no unit primitive exists' },
    { header: 'Qty Comp', primitive: 'money' },
    { header: 'Scrap', primitive: 'money' },
    { header: 'UOM', primitive: 'enum' },
    { header: 'Machine', primitive: 'enum' },
    { header: 'Shift', primitive: 'enum', note: 'shift 1/2/3, a vocabulary that happens to be numeric' },
    { header: 'Operator', primitive: 'enum' },
    { header: 'Setup Hrs', primitive: 'money', note: 'hours, with repeats' },
    { header: 'Run Hrs', primitive: 'money', note: 'hours, every value distinct' },
    { header: 'Std Hrs', primitive: 'money' },
    { header: 'Var Hrs', primitive: 'money', note: 'parenthesised negatives' },
    { header: 'Rel Date', primitive: 'date', note: 'raw Excel serial' },
    { header: 'Due Date', primitive: 'date', note: 'raw Excel serial' },
    { header: 'Fin Date', primitive: 'date', note: 'raw Excel serial, partly blank' },
    { header: 'Status', primitive: 'enum' },
    { header: 'Pri', primitive: 'enum' },
    { header: 'Customer', primitive: 'enum' },
    { header: 'PO#', primitive: 'unique_id' },
    { header: 'Mat Cost', primitive: 'money', note: 'TRAP: every value sits in the Excel serial range' },
    { header: 'Lab Cost', primitive: 'money', note: 'all distinct' },
    { header: 'OH', primitive: 'money', note: 'repeats' },
    { header: 'Tot Cost', primitive: 'money', note: 'TRAP: 9 of 10 values sit in the serial range' },
    { header: 'Yield', primitive: 'money', note: 'percentages' },
    { header: 'Insp Req', primitive: 'enum', note: 'Y/N boolean' },
    { header: 'QA Pass', primitive: 'enum', note: '1/0 boolean' },
    { header: 'Cert', primitive: 'enum', note: '✓ / blank boolean' },
    { header: 'Lot', primitive: 'unique_id' },
    { header: 'Bin', primitive: 'enum' },
    { header: 'Line', primitive: 'enum' },
    { header: 'Cell', primitive: 'enum' },
    { header: 'Tooling', primitive: 'enum', alsoOk: ['freetext'], note: 'multi-valued, semicolon separated; 5 distinct over 10' },
    { header: 'Hold Reason', primitive: 'freetext', note: 'sparse — 2 cells filled' },
    { header: 'Rework', primitive: 'enum', note: 'real TRUE/FALSE booleans' },
    { header: 'Batch', primitive: 'enum' },
    { header: 'Notes', primitive: 'freetext' },
    { header: 'Updated', primitive: 'date', note: 'ISO datetime' },
  ],
  rowTraps: [
    { marker: 'Line 1 subtotal', kind: 'subtotal' },
    { marker: 'GRAND TOTAL', kind: 'footer' },
  ],
  aoa: [
    MFG_HEADERS,
    [100234, 'PN-4471-A', 'B', 'Bracket, mounting, 6mm', 250, 250, 3, 'EA', 'HAAS-VF2', 1, 'M. Okafor', 1.5, 12.4, 11.0, 1.4, 46023, 46050, 46048, 'Closed', 'MED', 'Northwind Valves', 'PO-88231', 24500, 8200, 4100, 36800, '98.5%', 'Y', 1, '✓', 'L-2026-0033', 'A12', 'L1', 'C3', 'T-441; T-118', '', false, 'B-01', 'Ran long on setup', '2026-03-14 09:12'],
    [100235, 'PN-4471-A', 'B', 'Bracket, mounting, 6mm', 500, 496, 4, 'EA', 'HAAS-VF2', 2, 'D. Herrera', 1.5, 23.1, 22.0, 1.1, 46027, 46057, 46055, 'Closed', 'MED', 'Northwind Valves', 'PO-88240', 31200, 9100, 3800, 44100, '99.2%', 'Y', 1, '✓', 'L-2026-0041', 'A12', 'L1', 'C3', 'T-441; T-118', '', false, 'B-01', '', '2026-03-18 16:40'],
    [100238, 'PN-5510-C', 'A', 'Housing, pump, cast', 120, 118, 2, 'EA', 'MAZAK-QT', 1, 'M. Okafor', 3.25, 41.7, 38.5, 3.2, 46031, 46066, 46064, 'Closed', 'HIGH', 'Cinder Peak Mining', 'PO-88255', 45900, 11400, 4100, 61300, '98.3%', 'Y', 1, '✓', 'L-2026-0044', 'B04', 'L2', 'C1', 'T-902', '', true, 'B-02', 'One rework for finish', '2026-03-22 11:05'],
    [100241, 'PN-3302-B', 'D', 'Shaft, drive, 40mm', 80, 80, 0, 'EA', 'OKUMA-LB', 3, 'A. Kovacs', 2.0, 18.9, 18.0, 0.9, 46034, 46061, 46060, 'Closed', 'LOW', 'Ardent Logistics', 'PO-88262', 22800, 7300, 3800, 33900, '100%', 'N', 1, '', 'L-2026-0047', 'C09', 'L2', 'C2', 'T-118', '', false, 'B-02', '', '2026-03-24 08:20'],
    [100244, 'PN-6120-A', 'A', 'Manifold, 4-port', 60, 57, 3, 'EA', 'MAZAK-QT', 1, 'D. Herrera', 4.5, 52.3, 47.0, 5.3, 46038, 46075, '', 'In progress', 'HIGH', 'Northwind Valves', 'PO-88274', 52300, 13200, 4900, 70500, '95.0%', 'Y', 0, '', 'L-2026-0052', 'B04', 'L1', 'C1', 'T-902; T-441', 'Awaiting cert paperwork', true, 'B-03', 'Held at final insp', '2026-04-02 13:55'],
    ['', '', '', 'Line 1 subtotal', 890, 883, 10, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 108000, 30500, 12700, 151200, '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    [100247, 'PN-5510-C', 'A', 'Housing, pump, cast', 90, 90, 0, 'EA', 'MAZAK-QT', 2, 'A. Kovacs', 3.25, 31.2, 30.0, 1.2, 46041, 46079, 46077, 'Closed', 'MED', 'Cinder Peak Mining', 'PO-88281', 27600, 8800, 4100, 39200, '100%', 'Y', 1, '✓', 'L-2026-0055', 'B04', 'L2', 'C1', 'T-902', '', false, 'B-03', '', '2026-04-06 10:10'],
    [100250, 'PN-7744-E', 'C', 'Cover plate, stainless', 400, 392, 8, 'EA', 'TRUMPF-L', 1, 'M. Okafor', 1.0, 27.5, 26.0, 1.5, 46045, 46083, 46081, 'Closed', 'MED', 'Verdemar Retail', 'PO-88290', 38400, 10100, 4400, 51800, '98.0%', 'N', 1, '✓', 'L-2026-0061', 'D02', 'L3', 'C4', 'T-330', '', false, 'B-04', '', '2026-04-11 15:32'],
    [100253, 'PN-6120-A', 'A', 'Manifold, 4-port', 75, 71, 4, 'EA', 'MAZAK-QT', 3, 'D. Herrera', 4.5, 63.8, 58.0, 5.8, 46049, 46090, '', 'In progress', 'HIGH', 'Northwind Valves', 'PO-88301', 61200, 15600, 5800, 82600, '94.7%', 'Y', 0, '', 'L-2026-0064', 'B04', 'L1', 'C1', 'T-902; T-441', 'Material short', true, 'B-04', 'Partial release', '2026-04-15 09:47'],
    [100256, 'PN-3302-B', 'D', 'Shaft, drive, 40mm', 110, 110, 0, 'EA', 'OKUMA-LB', 2, 'A. Kovacs', 2.0, 24.6, 24.0, 0.6, 46052, 46094, 46092, 'Closed', 'LOW', 'Ardent Logistics', 'PO-88312', 29900, 8600, 3800, 41000, '100%', 'N', 1, '✓', 'L-2026-0068', 'C09', 'L2', 'C2', 'T-118', '', false, 'B-05', '', '2026-04-19 12:03'],
    [100259, 'PN-7744-E', 'C', 'Cover plate, stainless', 300, 288, 12, 'EA', 'TRUMPF-L', 1, 'M. Okafor', 1.0, 21.3, 19.5, 1.8, 46056, 46098, 46096, 'Closed', 'MED', 'Verdemar Retail', 'PO-88320', 43100, 11900, 4400, 58700, '96.0%', 'Y', 1, '✓', 'L-2026-0072', 'D02', 'L3', 'C4', 'T-330', '', true, 'B-05', 'Scrap above target', '2026-04-24 17:19'],
    ['', '', '', 'GRAND TOTAL', 1985, 1952, 36, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 376900, 104200, 43200, 519900, '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ],
};

// ─── 7. Real estate — listings pipeline ─────────────────────────────────────
// A merged group header above the real header row, a "Name" column that holds
// the AGENT (not the listing), parenthesised negatives, text-month dates mixed
// with prose, and a wrapped address (continuation).

const REAL_ESTATE: WorkbookSpec = {
  id: 'realestate-listings-pipeline',
  industry: 'Real estate — listings pipeline',
  headerRow: 1,
  nameColumn: 1,
  notes:
    'Two-row header (merged group banner over the real header). The column literally called "Name" holds ' +
    'the listing agent — a fresh instance of the §18.1 trap.',
  columns: [
    { header: 'MLS #', primitive: 'unique_id', note: 'numeric' },
    { header: 'Address', primitive: 'unique_id', note: 'THE entity name' },
    { header: 'Type', primitive: 'enum' },
    { header: 'List Price', primitive: 'money', note: '$ money, all distinct' },
    { header: 'Last Reduction', primitive: 'money', note: 'parenthesised negatives, sparse' },
    { header: 'DOM', primitive: 'money', note: 'days on market' },
    { header: 'Name', primitive: 'enum', note: 'HEADER LIES: this is the agent, not the listing' },
    { header: 'Mobile', primitive: 'phone' },
    { header: 'Open House', primitive: 'date', note: 'text-month dates mixed with "By appt"' },
  ],
  rowTraps: [{ marker: 'Residences 1204-1206', kind: 'continuation', note: 'tail of the Beacon address' }],
  aoa: [
    ['Listing', '', '', 'Pricing', '', '', 'Agent', '', ''],
    ['MLS #', 'Address', 'Type', 'List Price', 'Last Reduction', 'DOM', 'Name', 'Mobile', 'Open House'],
    [1188402, '412 Harborview Dr, Unit 9', 'Condo', '$1,250,000', '(15,000)', 12, 'Renata Cole', '(305) 555-0142', '12 Apr 2026'],
    [1188577, '88 Larkspur Lane', 'Single Family', '$865,000', '', 45, 'Renata Cole', '(305) 555-0142', 'By appt'],
    [1189003, '7 Old Mill Rd', 'Single Family', '$1,940,000', '(60,000)', 3, 'Devon Marsh', '(305) 555-0188', '19 Apr 2026'],
    [1189210, '250 Canal St, PH2', 'Condo', '$3,100,000', '', 88, 'Devon Marsh', '(305) 555-0188', 'By appt'],
    [1189544, 'The Beacon at Riverside — Tower B', 'Condo', '$720,000', '(25,000)', 7, 'Ines Duval', '(305) 555-0170', '26 Apr 2026'],
    ['', 'Residences 1204-1206', '', '', '', '', '', '', ''],
    [1189811, '19 Chestnut Ct', 'Townhome', '$540,000', '', 22, 'Ines Duval', '(305) 555-0170', '3 May 2026'],
    [1190022, '900 Sundial Way', 'Single Family', '$1,375,000', '(40,000)', 15, 'Renata Cole', '(305) 555-0142', 'By appt'],
    [1190310, '44 Peregrine Pl', 'Townhome', '$610,000', '', 61, 'Devon Marsh', '(305) 555-0188', '10 May 2026'],
  ],
};

// ─── 8. Freight forwarding — shipment register ──────────────────────────────
// All-abbreviation headers, ISO ETD against a month-year ETA ("Feb-26"),
// currency-prefixed money, weights that partly overlap the serial-date range,
// placeholder dashes in an id column, a blank separator and a TOTALS footer.

const FREIGHT: WorkbookSpec = {
  id: 'freight-shipment-register',
  industry: 'Freight forwarding — shipment register',
  headerRow: 0,
  nameColumn: 0,
  notes: 'Trade jargon throughout. "ETA" holds month-year strings; "Wgt (kg)" partly overlaps the Excel serial range.',
  columns: [
    { header: 'Ref', primitive: 'unique_id', note: 'THE entity name — a shipment IS its reference' },
    { header: 'BOL', primitive: 'unique_id' },
    { header: 'Shipper', primitive: 'enum' },
    { header: 'Consignee', primitive: 'enum' },
    { header: 'Mode', primitive: 'enum' },
    { header: 'ETD', primitive: 'date', note: 'ISO' },
    { header: 'ETA', primitive: 'date', note: 'month-year text: "Feb-26"' },
    { header: 'POL', primitive: 'enum', note: 'UN/LOCODE port codes' },
    { header: 'POD', primitive: 'enum' },
    { header: 'Ctr#', primitive: 'unique_id', note: 'container numbers with em-dash placeholders' },
    { header: 'Pcs', primitive: 'money', note: 'piece count' },
    { header: 'Wgt (kg)', primitive: 'money', note: 'raw numbers, 3 of 9 inside the serial-date range' },
    { header: 'Freight', primitive: 'money', note: 'currency-prefixed: "USD 18,400", "QAR 3,600"' },
    { header: 'Curr', primitive: 'enum' },
    { header: 'Cleared', primitive: 'enum', note: 'Y/N boolean with a blank' },
  ],
  rowTraps: [{ marker: 'TOTALS', kind: 'footer' }],
  blankRows: 1,
  aoa: [
    ['Ref', 'BOL', 'Shipper', 'Consignee', 'Mode', 'ETD', 'ETA', 'POL', 'POD', 'Ctr#', 'Pcs', 'Wgt (kg)', 'Freight', 'Curr', 'Cleared'],
    ['SHP-26-0441', 'BOL-772104', 'Meridian Textiles', 'Cobalt Fitness', 'Sea', '2026-01-14', 'Feb-26', 'QAJBO', 'NLRTM', 'MSKU4471182', 420, 12450, 'USD 18,400', 'USD', 'Y'],
    ['SHP-26-0442', 'BOL-772119', 'Anselm Ceramics', 'Verdemar Retail', 'Air', '2026-01-19', 'Jan-26', 'TRIST', 'DEHAM', '—', 36, 3200, 'EUR 6,150', 'EUR', 'Y'],
    ['SHP-26-0455', 'BOL-772203', 'Northlake Outfitters', 'Ardent Logistics', 'Sea', '2026-02-02', 'Mar-26', 'CNSHA', 'USLAX', 'TGHU9982114', 1180, 24500, 'USD 41,900', 'USD', 'N'],
    ['SHP-26-0461', 'BOL-772288', 'Meridian Textiles', 'Cobalt Fitness', 'Road', '2026-02-11', 'Feb-26', 'QAJBO', 'SAJED', '—', 18, 980, 'QAR 3,600', 'QAR', 'Y'],
    ['SHP-26-0470', 'BOL-772341', 'Halcyon Foods Ltd', 'Verdemar Retail', 'Sea', '2026-02-23', 'Apr-26', 'BRSSZ', 'NLRTM', 'CMAU5510772', 860, 41000, 'USD 52,300', 'USD', 'N'],
    ['SHP-26-0478', 'BOL-772402', 'Anselm Ceramics', 'Ardent Logistics', 'Air', '2026-03-04', 'Mar-26', 'TRIST', 'QAJBO', '—', 52, 7600, 'EUR 9,880', 'EUR', 'Y'],
    ['SHP-26-0483', 'BOL-772455', 'Northlake Outfitters', 'Cobalt Fitness', 'Sea', '2026-03-16', 'May-26', 'CNSHA', 'DEHAM', 'OOLU7712043', 940, 18200, 'USD 33,750', 'USD', 'N'],
    ['SHP-26-0491', 'BOL-772510', 'Halcyon Foods Ltd', 'Verdemar Retail', 'Sea', '2026-03-28', 'Apr-26', 'BRSSZ', 'USLAX', 'MSKU4488210', 1420, 33000, 'USD 47,120', 'USD', ''],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    ['TOTALS', '', '', '', '', '', '', '', '', '', 4926, 140930, '', '', ''],
  ],
};

// ─── 9. Recruitment — candidate pipeline (Arabic headers AND values) ────────
// A register in a non-Latin script, with Latin-script emails, phones and one
// Latin source column so the asymmetry shows up inside a single file.

const RECRUITMENT: WorkbookSpec = {
  id: 'recruitment-candidate-pipeline-ar',
  industry: 'Recruitment — candidate pipeline (Arabic)',
  headerRow: 0,
  nameColumn: 0,
  notes:
    'Headers AND entity names are Arabic script; emails, phones and the source column are Latin. ' +
    'Everything the classifier needs is present — in a script it does not read.',
  columns: [
    { header: 'الاسم', primitive: 'unique_id', note: 'THE entity name — Arabic script' },
    { header: 'الوظيفة', primitive: 'enum', note: 'Arabic job titles, 3 distinct' },
    { header: 'المصدر', primitive: 'enum', note: 'Latin-script values in an Arabic-headed column' },
    { header: 'المرحلة', primitive: 'enum', note: 'Arabic pipeline stages' },
    { header: 'تاريخ التقديم', primitive: 'date', dateOrder: 'DMY' },
    { header: 'البريد الإلكتروني', primitive: 'email' },
    { header: 'الهاتف', primitive: 'phone' },
    { header: 'الراتب المتوقع', primitive: 'money', note: 'QAR-prefixed, two "18k" shorthand cells' },
    { header: 'ملاحظات', primitive: 'freetext', note: 'Arabic prose' },
  ],
  aoa: [
    ['الاسم', 'الوظيفة', 'المصدر', 'المرحلة', 'تاريخ التقديم', 'البريد الإلكتروني', 'الهاتف', 'الراتب المتوقع', 'ملاحظات'],
    ['سارة المنصوري', 'محاسب أول', 'LinkedIn', 'مقابلة أولى', '18/01/2026', 's.mansouri@example.com', '+974 3312 7788', 'QAR 12,000', 'خبرة سبع سنوات'],
    ['خالد الهاجري', 'مطور برمجيات', 'Referral', 'اختبار تقني', '22/01/2026', 'k.hajri@example.com', '+974 5541 2093', 'QAR 18,000', ''],
    ['نورة العتيبي', 'محاسب أول', 'Agency', 'عرض', '03/02/2026', 'n.otaibi@example.com', '+974 6620 4471', 'QAR 12,000', 'تحتاج تأشيرة عمل'],
    ['فيصل الكواري', 'مدير مشروع', 'LinkedIn', 'مقابلة أولى', '11/02/2026', 'f.kuwari@example.com', '+974 3390 8812', '18k', ''],
    ['مريم الدوسري', 'مطور برمجيات', 'Referral', 'مرفوض', '19/02/2026', 'm.dosari@example.com', '+974 7712 3345', 'QAR 15,500', 'راتب أعلى من الميزانية'],
    ['عبدالله الشمري', 'مدير مشروع', 'Agency', 'اختبار تقني', '27/02/2026', 'a.shamri@example.com', '+974 5503 9910', 'QAR 21,000', ''],
    ['هند البوعينين', 'محاسب أول', 'LinkedIn', 'عرض', '09/03/2026', 'h.buainain@example.com', '+974 6640 1177', '18k', 'قبلت العرض مبدئياً'],
    ['يوسف الأنصاري', 'مطور برمجيات', 'Referral', 'مقابلة أولى', '16/03/2026', 'y.ansari@example.com', '+974 3327 5566', 'QAR 16,800', ''],
    ['لطيفة المري', 'مدير مشروع', 'Agency', 'مرفوض', '24/03/2026', 'l.marri@example.com', '+974 7708 6621', 'QAR 19,400', 'انسحبت من العملية'],
  ],
};

// ─── 10. A nearly-empty sheet ───────────────────────────────────────────────

const NEARLY_EMPTY: WorkbookSpec = {
  id: 'edge-nearly-empty',
  industry: 'Edge case — a header and one row',
  headerRow: 0,
  nameColumn: 0,
  notes: 'One data row. Nothing can be inferred from repetition; the classifier must still not fall over.',
  columns: [
    { header: 'Project', primitive: 'freetext', note: 'one row — unique vs repeated is unknowable' },
    { header: 'Owner', primitive: 'freetext' },
    { header: 'Due', primitive: 'date' },
  ],
  aoa: [
    ['Project', 'Owner', 'Due'],
    ['Warehouse safety audit', 'K. Osei', '2026-05-01'],
  ],
};

// ─── 11. A single-column sheet ──────────────────────────────────────────────

const SINGLE_COLUMN: WorkbookSpec = {
  id: 'edge-single-column',
  industry: 'Edge case — one column of site names',
  headerRow: 0,
  nameColumn: 0,
  notes: 'A perfectly importable list of eight project names in one column.',
  columns: [{ header: 'Site', primitive: 'unique_id', note: 'THE entity name' }],
  aoa: [
    ['Site'],
    ['Doha Corniche'],
    ['Al Wakrah Beach'],
    ['Lusail Marina'],
    ['Msheireb Downtown'],
    ['Education City'],
    ['Ras Laffan'],
    ['Umm Salal'],
    ['Al Khor Corniche'],
  ],
};

export const CORPUS: WorkbookSpec[] = [
  CONSTRUCTION,
  LAW,
  MARKETING,
  CLINIC,
  SPRINT,
  MANUFACTURING,
  REAL_ESTATE,
  FREIGHT,
  RECRUITMENT,
  NEARLY_EMPTY,
  SINGLE_COLUMN,
];
