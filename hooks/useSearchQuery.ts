// Heuristic query parser — the "smart" front end of global search (Features.md #5).
// Turns raw typed text into { terms, types, from, to } WITHOUT an LLM: detects
// entity-type hints and natural-language date phrases, leaving the rest as terms
// for the server's websearch_to_tsquery. Pure + synchronous so it can run on
// every keystroke.
//
// ponytail: English + common date formats only. Upgrade path if i18n/fuzzier
// phrasing is ever needed = swap parseQuery() for an async understand() (LLM)
// behind the same ParsedQuery shape — nothing downstream changes.

export type SearchType = 'task' | 'file' | 'report' | 'comment';

export type ParsedQuery = {
  terms: string;            // leftover text → server tsquery
  types: SearchType[];      // entity filter (empty = all)
  from: string | null;      // ISO timestamptz
  to: string | null;        // ISO timestamptz
  humanized: string | null; // human chip, e.g. "Tasks · last week"
};

// type hint → canonical type. Singular/plural/synonyms.
const TYPE_WORDS: Record<string, SearchType> = {
  task: 'task', tasks: 'task', todo: 'task', todos: 'task',
  file: 'file', files: 'file', doc: 'file', docs: 'file',
  document: 'file', documents: 'file', attachment: 'file', attachments: 'file',
  report: 'report', reports: 'report',
  comment: 'comment', comments: 'comment', note: 'comment', notes: 'comment',
};

const MONTHS = ['january','february','march','april','may','june','july',
  'august','september','october','november','december'];

const DAY = 86400000;

function startOfDay(d: Date) { d.setHours(0, 0, 0, 0); return d; }
function endOfDay(d: Date)   { d.setHours(23, 59, 59, 999); return d; }
function iso(d: Date)        { return d.toISOString(); }

type DateHit = { from: Date; to: Date; label: string; matched: RegExp | string };

// Detect one date phrase. Returns the range + the exact matched substring so the
// caller can strip it from the terms. First match wins (most specific first).
function detectDate(lc: string, now: Date): DateHit | null {
  const today = startOfDay(new Date(now));

  // relative keywords
  if (/\btoday\b/.test(lc))
    return { from: startOfDay(new Date(now)), to: endOfDay(new Date(now)), label: 'today', matched: /\btoday\b/ };
  if (/\byesterday\b/.test(lc)) {
    const y = new Date(today.getTime() - DAY);
    return { from: startOfDay(new Date(y)), to: endOfDay(new Date(y)), label: 'yesterday', matched: /\byesterday\b/ };
  }
  if (/\blast week\b/.test(lc)) {
    const from = new Date(today.getTime() - 7 * DAY);
    return { from, to: endOfDay(new Date(now)), label: 'last week', matched: /\blast week\b/ };
  }
  if (/\bthis week\b/.test(lc)) {
    const from = new Date(today.getTime() - 6 * DAY);
    return { from, to: endOfDay(new Date(now)), label: 'this week', matched: /\bthis week\b/ };
  }
  if (/\blast month\b/.test(lc)) {
    const from = new Date(today.getTime() - 30 * DAY);
    return { from, to: endOfDay(new Date(now)), label: 'last month', matched: /\blast month\b/ };
  }
  if (/\bthis month\b/.test(lc)) {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from, to: endOfDay(new Date(now)), label: 'this month', matched: /\bthis month\b/ };
  }

  // ISO date: 2026-07-03
  const isoM = lc.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoM) {
    const d = new Date(+isoM[1], +isoM[2] - 1, +isoM[3]);
    if (!isNaN(d.getTime()))
      return { from: startOfDay(new Date(d)), to: endOfDay(new Date(d)), label: isoM[0], matched: isoM[0] };
  }

  // "july", "in june", "on july 3", "july 3"
  const monM = lc.match(new RegExp(`\\b(?:in |on )?(${MONTHS.join('|')})(?:\\s+(\\d{1,2}))?\\b`));
  if (monM) {
    const month = MONTHS.indexOf(monM[1]);
    const year = now.getFullYear();
    if (monM[2]) {
      const d = new Date(year, month, +monM[2]);
      return { from: startOfDay(new Date(d)), to: endOfDay(new Date(d)), label: monM[0].replace(/^(in|on) /, ''), matched: monM[0] };
    }
    const from = new Date(year, month, 1);
    const to = endOfDay(new Date(year, month + 1, 0));
    return { from, to, label: MONTHS[month], matched: monM[0] };
  }

  return null;
}

export function parseQuery(raw: string, now: Date = new Date()): ParsedQuery {
  let text = (raw || '').trim();
  const types: SearchType[] = [];
  let from: Date | null = null;
  let to: Date | null = null;
  const chips: string[] = [];

  // 1. explicit "type:" prefix
  text = text.replace(/\b(task|file|report|comment)s?:/gi, (_, w: string) => {
    const t = TYPE_WORDS[w.toLowerCase()];
    if (t && !types.includes(t)) types.push(t);
    return ' ';
  });

  // 2. date phrase (strip matched substring from terms)
  const hit = detectDate(text.toLowerCase(), now);
  if (hit) {
    from = hit.from; to = hit.to;
    chips.push(cap(hit.label));
    text = typeof hit.matched === 'string'
      ? text.replace(new RegExp(escapeRe(hit.matched), 'i'), ' ')
      : text.replace(hit.matched, ' ');
  }

  // 3. bare type words anywhere in the remaining text
  const tokens = text.split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  for (const tok of tokens) {
    const t = TYPE_WORDS[tok.toLowerCase()];
    if (t) { if (!types.includes(t)) types.push(t); }
    else kept.push(tok);
  }

  const terms = kept.join(' ').trim();

  // humanized chip: "Tasks · last week"
  const typeLabel = types.length ? types.map(pluralLabel).join(', ') : null;
  const parts = [typeLabel, ...chips].filter(Boolean);
  const humanized = parts.length ? parts.join(' · ') : null;

  return { terms, types, from: from ? iso(from) : null, to: to ? iso(to) : null, humanized };
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function pluralLabel(t: SearchType) {
  return { task: 'Tasks', file: 'Files', report: 'Reports', comment: 'Comments' }[t];
}
function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
