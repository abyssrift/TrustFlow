// Heuristic query parser — the "smart" front end of global search (Features.md #5).
// Turns raw typed text into { terms, types, field, from, to } WITHOUT an LLM:
// detects entity-type hints, a date FIELD (due/completed/created) and a wide
// range of natural-language date expressions, leaving the rest as terms for the
// server's websearch_to_tsquery. Pure + synchronous so it runs on every keystroke.
//
// ponytail: English + common formats only. Upgrade path if i18n/fuzzier phrasing
// is ever needed = swap parseQuery() for an async understand() (LLM) behind the
// same ParsedQuery shape — nothing downstream changes.

export type SearchType = 'task' | 'file' | 'report' | 'comment' | 'person';
export type DateField = 'created' | 'due' | 'completed';

export type ParsedQuery = {
  terms: string;            // leftover text → server tsquery
  types: SearchType[];      // entity filter (empty = all)
  field: DateField | null;  // which date column the range applies to (tasks)
  from: string | null;      // ISO timestamptz
  to: string | null;        // ISO timestamptz
  humanized: string | null; // human chip, e.g. "Tasks · Due · last week"
};

const TYPE_WORDS: Record<string, SearchType> = {
  task: 'task', tasks: 'task', todo: 'task', todos: 'task',
  file: 'file', files: 'file', doc: 'file', docs: 'file',
  document: 'file', documents: 'file', attachment: 'file', attachments: 'file',
  report: 'report', reports: 'report',
  comment: 'comment', comments: 'comment', note: 'comment', notes: 'comment',
  person: 'person', people: 'person', user: 'person', users: 'person',
  member: 'person', members: 'person', staff: 'person', teammate: 'person',
};

const MONTHS = ['january','february','march','april','may','june','july',
  'august','september','october','november','december'];
const WEEKDAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

const DAY = 86400000;

function clone(d: Date) { return new Date(d.getTime()); }
function startOfDay(d: Date) { const x = clone(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date)   { const x = clone(d); x.setHours(23, 59, 59, 999); return x; }
function startOfMonth(y: number, m: number) { return new Date(y, m, 1, 0, 0, 0, 0); }
function endOfMonth(y: number, m: number)   { return new Date(y, m + 1, 0, 23, 59, 59, 999); }
function startOfYear(y: number) { return new Date(y, 0, 1, 0, 0, 0, 0); }
function endOfYear(y: number)   { return new Date(y, 11, 31, 23, 59, 59, 999); }
// week = Monday..Sunday
function startOfWeek(d: Date) { const x = startOfDay(d); const back = (x.getDay() + 6) % 7; return new Date(x.getTime() - back * DAY); }
function endOfWeek(d: Date)   { return endOfDay(new Date(startOfWeek(d).getTime() + 6 * DAY)); }
function iso(d: Date) { return d.toISOString(); }

type Range = { from: Date; to: Date };
type DateHit = Range & { label: string; matched: string };

// Resolve a single date "anchor" (a day or a span): today, a weekday, a month
// (± day), an ISO date, or a bare year. Used standalone and by before/after/between.
function resolveAnchor(tok: string, now: Date): DateHit | null {
  const lc = tok.trim().toLowerCase();

  if (lc === 'today')     { const d = now; return { from: startOfDay(d), to: endOfDay(d), label: 'today', matched: tok }; }
  if (lc === 'yesterday') { const d = new Date(startOfDay(now).getTime() - DAY); return { from: startOfDay(d), to: endOfDay(d), label: 'yesterday', matched: tok }; }
  if (lc === 'tomorrow')  { const d = new Date(startOfDay(now).getTime() + DAY); return { from: startOfDay(d), to: endOfDay(d), label: 'tomorrow', matched: tok }; }

  // ISO 2026-07-03
  const isoM = lc.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoM) { const d = new Date(+isoM[1], +isoM[2] - 1, +isoM[3]); if (!isNaN(d.getTime())) return { from: startOfDay(d), to: endOfDay(d), label: isoM[0], matched: tok }; }

  // month (+ optional day): "july", "july 3"
  const monM = lc.match(new RegExp(`^(${MONTHS.join('|')})(?:\\s+(\\d{1,2}))?$`));
  if (monM) {
    const m = MONTHS.indexOf(monM[1]); const y = now.getFullYear();
    if (monM[2]) { const d = new Date(y, m, +monM[2]); return { from: startOfDay(d), to: endOfDay(d), label: `${monM[1]} ${monM[2]}`, matched: tok }; }
    return { from: startOfMonth(y, m), to: endOfMonth(y, m), label: monM[1], matched: tok };
  }

  // bare year 2025
  const yM = lc.match(/^(20\d{2})$/);
  if (yM) { const y = +yM[1]; return { from: startOfYear(y), to: endOfYear(y), label: yM[1], matched: tok }; }

  return null;
}

// Detect the first (most specific) date expression in the text.
function detectDate(text: string, now: Date): DateHit | null {
  const lc = text.toLowerCase();

  // between A and B
  const betweenM = lc.match(/\bbetween\s+([\w-]+(?:\s+\d{1,2})?)\s+and\s+([\w-]+(?:\s+\d{1,2})?)\b/);
  if (betweenM) {
    const a = resolveAnchor(betweenM[1], now); const b = resolveAnchor(betweenM[2], now);
    if (a && b) { const lo = a.from < b.from ? a : b; const hi = a.from < b.from ? b : a; return { from: lo.from, to: hi.to, label: `${lo.label}–${hi.label}`, matched: betweenM[0] }; }
  }

  // before / after / since / until X
  const opM = lc.match(/\b(before|after|since|until)\s+([\w-]+(?:\s+\d{1,2})?)\b/);
  if (opM) {
    const a = resolveAnchor(opM[2], now);
    if (a) {
      const op = opM[1];
      if (op === 'before') return { from: startOfYear(1970), to: a.from, label: `before ${a.label}`, matched: opM[0] };
      if (op === 'until')  return { from: startOfYear(1970), to: a.to,   label: `until ${a.label}`,  matched: opM[0] };
      if (op === 'after')  return { from: a.to, to: endOfYear(now.getFullYear() + 5), label: `after ${a.label}`, matched: opM[0] };
      /* since */          return { from: a.from, to: endOfYear(now.getFullYear() + 5), label: `since ${a.label}`, matched: opM[0] };
    }
  }

  // relative: "last/past N days|weeks|months|years"
  const relN = lc.match(/\b(?:last|past)\s+(\d+)\s+(day|week|month|year)s?\b/);
  if (relN) {
    const n = +relN[1]; const unit = relN[2]; const to = endOfDay(now); let from = startOfDay(now);
    if (unit === 'day')   from = startOfDay(new Date(now.getTime() - n * DAY));
    if (unit === 'week')  from = startOfDay(new Date(now.getTime() - n * 7 * DAY));
    if (unit === 'month') { const d = clone(now); d.setMonth(d.getMonth() - n); from = startOfDay(d); }
    if (unit === 'year')  { const d = clone(now); d.setFullYear(d.getFullYear() - n); from = startOfDay(d); }
    return { from, to, label: `last ${n} ${unit}${n === 1 ? '' : 's'}`, matched: relN[0] };
  }

  // "N days/weeks/months ago" → that single day/point
  const agoM = lc.match(/\b(\d+)\s+(day|week|month|year)s?\s+ago\b/);
  if (agoM) {
    const n = +agoM[1]; const unit = agoM[2]; const d = clone(now);
    if (unit === 'day') d.setTime(d.getTime() - n * DAY);
    if (unit === 'week') d.setTime(d.getTime() - n * 7 * DAY);
    if (unit === 'month') d.setMonth(d.getMonth() - n);
    if (unit === 'year') d.setFullYear(d.getFullYear() - n);
    return { from: startOfDay(d), to: endOfDay(d), label: agoM[0], matched: agoM[0] };
  }

  // today / yesterday / tomorrow (standalone words)
  for (const kw of ['today', 'yesterday', 'tomorrow']) {
    if (new RegExp(`\\b${kw}\\b`).test(lc)) { const a = resolveAnchor(kw, now)!; return { ...a, matched: kw }; }
  }

  // this/last/next week|month|year (calendar-accurate)
  const spanM = lc.match(/\b(this|last|next)\s+(week|month|year)\b/);
  if (spanM) {
    const which = spanM[1]; const unit = spanM[2];
    if (unit === 'week') {
      const base = which === 'this' ? now : new Date(now.getTime() + (which === 'last' ? -7 : 7) * DAY);
      return { from: startOfWeek(base), to: endOfWeek(base), label: `${which} week`, matched: spanM[0] };
    }
    if (unit === 'month') {
      const d = clone(now); d.setMonth(d.getMonth() + (which === 'this' ? 0 : which === 'last' ? -1 : 1));
      return { from: startOfMonth(d.getFullYear(), d.getMonth()), to: endOfMonth(d.getFullYear(), d.getMonth()), label: `${which} month`, matched: spanM[0] };
    }
    const y = now.getFullYear() + (which === 'this' ? 0 : which === 'last' ? -1 : 1);
    return { from: startOfYear(y), to: endOfYear(y), label: `${which} year`, matched: spanM[0] };
  }

  // quarters: "Q2", "this quarter", "last quarter"
  const qM = lc.match(/\bq([1-4])\b/) || (/\bthis quarter\b/.test(lc) ? ['this quarter', String(Math.floor(now.getMonth() / 3) + 1)] as RegExpMatchArray : null)
    || (/\blast quarter\b/.test(lc) ? ['last quarter', String(Math.floor(now.getMonth() / 3))] as RegExpMatchArray : null);
  if (qM) {
    let q = +qM[1]; let y = now.getFullYear();
    if (q === 0) { q = 4; y -= 1; }               // "last quarter" wrapped past Q1
    const m0 = (q - 1) * 3;
    return { from: startOfMonth(y, m0), to: endOfMonth(y, m0 + 2), label: qM[0].startsWith('q') ? `Q${q}` : qM[0], matched: qM[0] };
  }

  // weekday with modifier: "last monday", "this friday", "next tuesday"
  const wdM = lc.match(new RegExp(`\\b(last|this|next)\\s+(${WEEKDAYS.join('|')})\\b`));
  if (wdM) {
    const which = wdM[1]; const target = WEEKDAYS.indexOf(wdM[2]); const cur = now.getDay();
    let delta = target - cur;
    if (which === 'last') delta = delta >= 0 ? delta - 7 : delta;
    else if (which === 'next') delta = delta <= 0 ? delta + 7 : delta;
    const d = new Date(startOfDay(now).getTime() + delta * DAY);
    return { from: startOfDay(d), to: endOfDay(d), label: `${which} ${wdM[2]}`, matched: wdM[0] };
  }

  // ISO date anywhere
  const isoAny = lc.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoAny) { const a = resolveAnchor(isoAny[1], now); if (a) return { ...a, matched: isoAny[1] }; }

  // month name (+ optional day) anywhere: "in june", "on july 3"
  const monAny = lc.match(new RegExp(`\\b(?:in |on )?(${MONTHS.join('|')})(?:\\s+(\\d{1,2}))?\\b`));
  if (monAny) {
    const a = resolveAnchor(`${monAny[1]}${monAny[2] ? ' ' + monAny[2] : ''}`, now);
    if (a) return { ...a, matched: monAny[0] };
  }

  // bare year anywhere
  const yAny = lc.match(/\b(20\d{2})\b/);
  if (yAny) { const a = resolveAnchor(yAny[1], now); if (a) return { ...a, matched: yAny[1] }; }

  return null;
}

// which date column the range targets
function detectField(text: string): { field: DateField | null; matched: string | null } {
  if (/\b(due|deadline)\b/i.test(text))              return { field: 'due', matched: (text.match(/\b(due|deadline)\b/i) || [])[0] || null };
  if (/\b(completed|finished|closed)\b/i.test(text)) return { field: 'completed', matched: (text.match(/\b(completed|finished|closed)\b/i) || [])[0] || null };
  if (/\b(created|added|opened)\b/i.test(text))      return { field: 'created', matched: (text.match(/\b(created|added|opened)\b/i) || [])[0] || null };
  return { field: null, matched: null };
}

function stripFirst(text: string, matched: string) {
  return text.replace(new RegExp(escapeRe(matched), 'i'), ' ');
}

export function parseQuery(raw: string, now: Date = new Date()): ParsedQuery {
  let text = (raw || '').trim();
  const types: SearchType[] = [];
  const chips: string[] = [];

  // 1. explicit "type:" prefix
  text = text.replace(/\b(task|file|report|comment|person|people|user|member)s?:/gi, (_, w: string) => {
    const t = TYPE_WORDS[w.toLowerCase()]; if (t && !types.includes(t)) types.push(t); return ' ';
  });

  // 2. date field (due/completed/created)
  const { field, matched: fieldMatched } = detectField(text);
  if (fieldMatched) text = stripFirst(text, fieldMatched);

  // 3. date expression (strip matched substring from terms)
  let from: Date | null = null, to: Date | null = null;
  const hit = detectDate(text, now);
  if (hit) { from = hit.from; to = hit.to; chips.push(cap(hit.label)); text = stripFirst(text, hit.matched); }

  // 4. bare type words anywhere in the remaining text
  const kept: string[] = [];
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    const t = TYPE_WORDS[tok.toLowerCase()];
    if (t) { if (!types.includes(t)) types.push(t); }
    else kept.push(tok);
  }

  // 5. due/completed are task-only concepts → narrow to tasks if no type was given
  if ((field === 'due' || field === 'completed') && types.length === 0) types.push('task');

  const terms = kept.join(' ').trim();

  const typeLabel = types.length ? types.map(pluralLabel).join(', ') : null;
  const fieldLabel = field ? cap(field) : null;
  const parts = [typeLabel, fieldLabel, ...chips].filter(Boolean);
  const humanized = parts.length ? parts.join(' · ') : null;

  return { terms, types, field, from: from ? iso(from) : null, to: to ? iso(to) : null, humanized };
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function pluralLabel(t: SearchType) { return { task: 'Tasks', file: 'Files', report: 'Reports', comment: 'Comments', person: 'People' }[t]; }
function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
