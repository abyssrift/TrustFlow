// Self-check for lib/projectPresentation.ts (Phase 8, #187).
// Run by `npm run check` (scripts/run-checks.mjs auto-discovers *.check.ts).
//
// What would break without it: the health precedence. "Blocked" outranking
// "Overdue" is a product decision (§14.1 — the badge names the thing a human
// can act on), and it is one `if` order away from silently inverting.

import assert from 'node:assert';
import {
  ENTITY_META,
  PROJECTS_VIEWS,
  ageColor,
  dueColor,
  fmtDue,
  initials,
  isProjectsView,
  projectHealth,
  toneColor,
  type EntityKind,
  type PresentationColors,
} from './projectPresentation';

const C: PresentationColors = {
  primary: 'primary', secondary: 'secondary', accent: 'accent', muted: 'muted',
  success: 'success', warning: 'warning', danger: 'danger', info: 'info',
  textMain: 'textMain', textMuted: 'textMuted', textDim: 'textDim',
  border: 'border', card: 'card', background: 'background',
};

// ── Entity identity is total, and every kind is distinguishable ────────────
const KINDS: EntityKind[] = ['project', 'portfolio', 'client', 'board', 'task', 'template'];
for (const k of KINDS) {
  const m = ENTITY_META[k];
  assert.ok(m, `ENTITY_META missing ${k}`);
  assert.ok(m.label.length > 0 && m.plural.length > 0, `${k} needs both label and plural`);
  // §17: an empty state must explain the entity, so every kind owes a sentence.
  assert.ok(m.blurb.length > 40, `${k}'s blurb must actually explain the entity`);
  assert.ok(!/^No /i.test(m.blurb), `${k}'s blurb must not be a "No X" shrug`);
}
// The four entities §17 says users confuse must not share a shape.
const confusable = ['project', 'portfolio', 'board', 'task'] as const;
const shapes = new Set(confusable.map(k => ENTITY_META[k].shape));
assert.strictEqual(shapes.size, confusable.length, 'project/portfolio/board/task must each have their own glyph shape');
const tones = new Set(confusable.map(k => ENTITY_META[k].tone));
assert.strictEqual(tones.size, confusable.length, 'project/portfolio/board/task must each have their own hue');
// A client is a who, so it is the circle; only it is.
assert.strictEqual(ENTITY_META.client.shape, 'circle');
assert.strictEqual(KINDS.filter(k => ENTITY_META[k].shape === 'circle').length, 1);
// A monogram entity carries no icon, an icon entity carries no monogram.
assert.strictEqual(ENTITY_META.client.icon, '', 'client renders a monogram, not an icon');
for (const k of KINDS.filter(k => k !== 'client')) {
  assert.ok(ENTITY_META[k].icon.length > 0, `${k} needs an icon`);
}

// ── Ageing / deadline thresholds (moved out of ProjectsTable.tsx) ──────────
assert.strictEqual(ageColor(null, C), 'textMuted');
assert.strictEqual(ageColor(6, C), 'textMuted');
assert.strictEqual(ageColor(7, C), 'warning');
assert.strictEqual(ageColor(13, C), 'warning');
assert.strictEqual(ageColor(14, C), 'danger');
assert.strictEqual(dueColor(null, C), 'textMuted');
assert.strictEqual(dueColor(-1, C), 'danger');
assert.strictEqual(dueColor(0, C), 'warning');
assert.strictEqual(dueColor(3, C), 'warning');
assert.strictEqual(dueColor(4, C), 'textMuted');

// ── Projects view modes (#191) ─────────────────────────────────────────────
// The guard behind the persisted `projects_view` key. Both projects screens
// read it, so an accepted-but-unrenderable value strands whichever screen the
// user lands on, silently, with no error.
for (const v of PROJECTS_VIEWS) assert.ok(isProjectsView(v), `${v} must be a valid view`);
assert.ok(isProjectsView('timeline'), 'Timeline shipped in #191 — a stored "timeline" must survive a reload');
assert.strictEqual(isProjectsView('gantt'), false, 'a view this build cannot render must fall back');
assert.strictEqual(isProjectsView(null), false);
assert.strictEqual(isProjectsView(undefined), false);
assert.strictEqual(isProjectsView(3), false);
assert.strictEqual(isProjectsView({ view: 'table' }), false);

// ── Wording ────────────────────────────────────────────────────────────────
// "—" used to be the no-due-date string; an em dash is exactly the bare text
// §14.1 bans, so it now says what it means.
assert.strictEqual(fmtDue(null, null), 'No due date');
assert.strictEqual(fmtDue(-3, '2026-01-01'), '3d overdue');
assert.strictEqual(fmtDue(0, '2026-01-01'), 'Due today');
assert.strictEqual(fmtDue(5, '2026-01-01'), '5d left');
assert.strictEqual(initials(null), '?');
assert.strictEqual(initials('   '), '?');
assert.strictEqual(initials('ada lovelace'), 'AL');
assert.strictEqual(initials('Prince'), 'P');

// ── Health precedence — the reason this file exists ────────────────────────
assert.strictEqual(projectHealth({ blocked: true, daysRemaining: -9 }).key, 'blocked');
assert.strictEqual(projectHealth({ flags: ['blocked'], daysRemaining: 30 }).key, 'blocked');
assert.strictEqual(projectHealth({ daysRemaining: -1 }).key, 'overdue');
assert.strictEqual(projectHealth({ flags: ['awaiting_client'], daysRemaining: 30 }).key, 'awaiting-client');
assert.strictEqual(projectHealth({ flags: ['at_risk'], daysRemaining: 30 }).key, 'at-risk');
assert.strictEqual(projectHealth({ flags: ['awaiting_client', 'at_risk'] }).key, 'awaiting-client');
assert.strictEqual(projectHealth({ daysRemaining: 3 }).key, 'due-soon');
assert.strictEqual(projectHealth({ daysRemaining: 4 }).key, 'on-track');
assert.strictEqual(projectHealth({}).key, 'on-track');
// A project with no due date and no flags is on track, not "due soon".
assert.strictEqual(projectHealth({ daysRemaining: null }).key, 'on-track');

// Every health state can say why — a badge with no `detail` is a dead end for
// the user, and the disabled/blocked controls that reuse it would go mute.
for (const input of [
  { blocked: true }, { blocked: true, blockedReason: 'client silent' },
  { daysRemaining: -2 }, { flags: ['awaiting_client'] }, { flags: ['at_risk'] },
  { daysRemaining: 0 }, { daysRemaining: 2 }, {},
]) {
  const h = projectHealth(input);
  assert.ok(h.detail.length > 0, `health ${h.key} must explain itself`);
  assert.ok(h.icon.length > 0, `health ${h.key} must carry an icon`);
  assert.ok(['danger', 'warning', 'success', 'muted'].includes(h.tone));
  assert.ok(toneColor(h.tone, C).length > 0);
}
assert.strictEqual(projectHealth({ blocked: true, blockedReason: '   ' }).detail, 'Blocked, no reason given');

console.log(`projectPresentation: all assertions passed (${KINDS.length} entities, 6 health states)`);
