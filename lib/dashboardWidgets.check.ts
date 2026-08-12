// Self-check for lib/dashboardWidgets.ts — run: npx tsx lib/dashboardWidgets.check.ts
// No framework (ponytail, mirrors lib/multiViewList.check.ts): plain asserts
// against the parts that actually break — storage migration of a config written
// by an older build, the never-persist-the-seed rule, permission filtering,
// singleton enforcement, size cycling and reorder bounds.

import assert from 'node:assert';
import {
  ALL_WIDGET_SIZES,
  WIDGET_BASIS,
  WIDGET_GAP,
  WIDGET_HEIGHT_UNIT,
  WIDGET_META,
  WIDGET_SEED_VERSION,
  WIDGET_TYPES,
  addInstance,
  addWidgetBlock,
  appendNewSeeds,
  cycleInstanceSize,
  cycleSize,
  migrateDashboardConfig,
  moveInstance,
  newInstanceId,
  seedDefaultInstances,
  sizeToFlex,
  visibleInstances,
  widgetHeightTier,
  widgetMinHeight,
  type WidgetInstance,
  type WidgetType,
} from './dashboardWidgets';

const ALLOW_ALL = () => true;
const DENY_ALL = (p: string | null) => p === null;
const allow = (...keys: string[]) => (p: string | null) => p === null || keys.includes(p);

// ── migrateDashboardConfig: junk in storage ──────────────────────────────
assert.strictEqual(migrateDashboardConfig(null), null, 'nothing stored -> caller seeds from scratch');
assert.strictEqual(migrateDashboardConfig('a string'), null, 'a half-written value must not become a config');
assert.strictEqual(migrateDashboardConfig([]), null, 'an array is not a config object');

// ── migrateDashboardConfig: a pre-widget config keeps every field ────────
const legacy = migrateDashboardConfig({
  pipelineIds: ['p1'], successStageIds: ['s1'], useAllPipelines: false,
  overviewMetrics: ['throughput'], overviewPeriod: 'month',
})!;
assert.deepStrictEqual(legacy.pipelineIds, ['p1']);
assert.deepStrictEqual(legacy.successStageIds, ['s1']);
assert.strictEqual(legacy.useAllPipelines, false);
assert.deepStrictEqual(legacy.overviewMetrics, ['throughput']);
assert.strictEqual(legacy.overviewPeriod, 'month');
assert.strictEqual(
  legacy.widgets, undefined,
  'absent widgets must stay absent — synthesizing here would freeze the role-based seed forever',
);

// A config missing the required arrays entirely still comes back renderable.
const sparse = migrateDashboardConfig({ useAllPipelines: true })!;
assert.deepStrictEqual(sparse.pipelineIds, []);
assert.deepStrictEqual(sparse.successStageIds, []);

// ── migrateDashboardConfig: instance-level validation ────────────────────
const stored = migrateDashboardConfig({
  pipelineIds: [], successStageIds: [],
  widgets: [
    { id: 'facts-1', type: 'facts', size: 'l', config: {} },
    { id: 'gone-1', type: 'removed-widget', size: 'l', config: {} },
    { id: 'recent-activity-1', type: 'recent-activity', size: 'xl', config: { limit: '10' } },
    { id: 'facts-1', type: 'pipeline-completion', size: 'm', config: {} },
    { id: 'pipeline-overview-1', type: 'pipeline-overview', size: 'm', config: { period: 'month', rows: 5, bad: { a: 1 } } },
    { id: 'blocked-exceptions-1', type: 'blocked-exceptions', size: 's', config: {} },
    'not an object',
    { type: 'facts', size: 'l' },
  ],
})!;
assert.deepStrictEqual(
  stored.widgets!.map(w => w.type),
  ['facts', 'recent-activity', 'pipeline-completion', 'pipeline-overview', 'blocked-exceptions'],
  'a type this build no longer ships is dropped; its siblings survive, in order',
);
assert.strictEqual(stored.widgets![1].size, 'm', "a size this build doesn't render clamps to 'm'");
assert.strictEqual(
  stored.widgets![4].size, 'm',
  "a size the TYPE stopped allowing also clamps — blocked-exceptions shipped with 's' and withdrew it",
);
assert.strictEqual(
  new Set(stored.widgets!.map(w => w.id)).size, stored.widgets!.length,
  'colliding ids are regenerated — a duplicate key remounts widgets on every reorder',
);
assert.deepStrictEqual(
  stored.widgets![3].config, { period: 'month' },
  'config is string-only: a number and an object value are both dropped',
);
assert.strictEqual(stored.widgetsVersion, 1);

// An intentionally empty dashboard is a choice, not a missing value.
const emptied = migrateDashboardConfig({ pipelineIds: [], successStageIds: [], widgets: [] })!;
assert.deepStrictEqual(emptied.widgets, [], 'widgets: [] survives as [] and must not silently re-seed');

// The seed generation travels with the layout: it is the only thing that can
// tell "a type this user removed" from "a type that did not exist yet".
assert.strictEqual(stored.widgetsSeedVersion, 1, 'a layout stored before seed versioning counts as generation 1');
assert.strictEqual(
  migrateDashboardConfig({ pipelineIds: [], successStageIds: [], widgets: [], widgetsSeedVersion: 7 })!.widgetsSeedVersion,
  7,
  'a stored seed version survives migration untouched',
);

// ── seedDefaultInstances ─────────────────────────────────────────────────
const seedAll = seedDefaultInstances(ALLOW_ALL);
assert.deepStrictEqual(
  seedAll.map(i => i.type),
  [
    'facts', 'pending-time-approvals', 'my-work', 'last-worked-on',
    'projection-strip', 'blocked-exceptions', 'pipeline-overview',
    'recent-activity', 'active-projects',
  ],
  'with every permission, pipeline-completion is skipped — it is the no-analytics fallback',
);

const seedNone = seedDefaultInstances(DENY_ALL);
assert.deepStrictEqual(
  seedNone.map(i => i.type),
  ['facts', 'pending-time-approvals', 'my-work', 'last-worked-on', 'pipeline-completion', 'recent-activity'],
  'a permissionless member gets the personal set, not four company aggregates — the whole point of generation 2',
);
assert.ok(
  seedNone.some(i => i.type === 'my-work') && seedNone.some(i => i.type === 'last-worked-on'),
  'the personal widgets are requiredPermission null precisely so they survive the filter that strips everything else',
);

// A lead / owner keeps every widget they had before generation 2. Adding is
// allowed; silently dropping one of their panels is the regression this guards.
for (const before of ['facts', 'pending-time-approvals', 'projection-strip', 'blocked-exceptions', 'pipeline-overview', 'recent-activity', 'active-projects'] as WidgetType[]) {
  assert.ok(seedAll.some(i => i.type === before), `${before}: generation 2 must not un-seed anything generation 1 seeded`);
}

// Registered, addable, never seeded — and it must be exactly these four, or
// appendNewSeeds is about to push one onto every existing dashboard.
assert.deepStrictEqual(
  WIDGET_TYPES.filter(t => !seedAll.some(i => i.type === t) && !seedNone.some(i => i.type === t)),
  ['my-deadlines', 'live-now', 'filehub-inbox', 'my-performance'],
  'my-deadlines overlaps my-work (which also carries the undated tail); the other three are opt-in by design',
);
// live-now specifically: its only data source is rpc_company_live_sessions,
// which this release adds. Seeded, a build that lands before the migration puts
// a permanently-empty card on every dashboard. It stays a picker entry until the
// function is deployed everywhere.
assert.ok(
  !seedAll.some(i => i.type === 'live-now') && !seedNone.some(i => i.type === 'live-now'),
  'live-now must not be seeded while its RPC can still be missing',
);
assert.ok(
  seedNone.every(i => i.id === `${i.type}-1`),
  'seed ids are stable and readable in a storage dump',
);

// permissionsLoaded is false on first render, so hasPermission returns false for
// EVERYTHING. That window is exactly seedNone — which is why useDashboardLayout
// must not render (or seed) until `hydrated`.
assert.notDeepStrictEqual(seedNone.map(i => i.type), seedAll.map(i => i.type));

// The device's old global period carries into the new per-instance config.
const seedMonthly = seedDefaultInstances(ALLOW_ALL, { pipelineIds: [], successStageIds: [], overviewPeriod: 'month' });
assert.deepStrictEqual(
  seedMonthly.find(i => i.type === 'pipeline-overview')!.config, { period: 'month' },
  'a stored overviewPeriod seeds the instance so nobody loses their choice',
);

// ── Additive re-seeding: the one-way door (#213 review) ──────────────────
// Persisting `widgets` used to end role-based seeding for good, and the edit
// that triggered it could be as small as flipping a chart to Monthly. "Stored
// at generation 0" stands in for a layout saved before ANY of today's types
// existed — the same arithmetic a real bump performs, without faking metadata.
const customized: WidgetInstance[] = [
  { id: 'facts-1', type: 'facts', size: 'l', config: {} },
  { id: 'recent-activity-1', type: 'recent-activity', size: 'm', config: { limit: '10' } },
];
const toppedUp = appendNewSeeds(customized, 0, ALLOW_ALL);
assert.deepStrictEqual(
  toppedUp.slice(0, customized.length), customized,
  'what the user arranged is untouched — new types are appended, never reordered or resized',
);
assert.ok(
  toppedUp.some(i => i.type === 'active-projects'),
  'a type introduced after the stored generation is appended',
);
assert.strictEqual(
  toppedUp.filter(i => i.type === 'facts').length, 1,
  'a singleton already on the dashboard is not appended a second time',
);
assert.deepStrictEqual(
  appendNewSeeds(customized, WIDGET_SEED_VERSION, ALLOW_ALL), customized,
  'a widget the user REMOVED stays removed: nothing at or below their stored generation is a candidate',
);
assert.deepStrictEqual(
  appendNewSeeds(toppedUp, WIDGET_SEED_VERSION, ALLOW_ALL), toppedUp,
  'the next load appends nothing — no duplicates once the generation is stamped',
);
assert.strictEqual(
  appendNewSeeds(toppedUp, 0, ALLOW_ALL).filter(i => i.type === 'pipeline-overview').length, 2,
  'pipeline-overview is deliberately not a singleton, so the stamped generation — not the singleton flag — is what makes this run-once. useDashboardLayout must persist widgetsSeedVersion.',
);
assert.deepStrictEqual(
  appendNewSeeds([], 0, DENY_ALL).map(i => i.type), seedNone.map(i => i.type),
  'appending respects permissions exactly as seeding does',
);

// ── The generation-1 → 2 top-up, which is the reason for this bump ───────
// A REAL stored v1 layout, not a stand-in: what a user who customized before
// this release has in AsyncStorage today. The bump is worth nothing unless
// these three actually land on it.
const storedV1: WidgetInstance[] = [
  { id: 'facts-1', type: 'facts', size: 'l', config: {} },
  { id: 'pipeline-overview-1', type: 'pipeline-overview', size: 'l', config: { period: 'month' } },
  { id: 'recent-activity-1', type: 'recent-activity', size: 'm', config: {} },
];
const v2 = appendNewSeeds(storedV1, 1, ALLOW_ALL);
assert.deepStrictEqual(
  v2.slice(0, storedV1.length), storedV1,
  'the arrangement they made survives the top-up untouched',
);
assert.deepStrictEqual(
  v2.slice(storedV1.length).map(i => i.type),
  ['my-work', 'last-worked-on'],
  'generation 2 delivers the seeded personal widgets to a stored v1 layout, in SEED_ORDER, appended at the end',
);
assert.ok(
  v2.every(i => i.type !== 'my-deadlines' && i.type !== 'live-now'
    && i.type !== 'filehub-inbox' && i.type !== 'my-performance'),
  'a registered type outside SEED_ORDER is never pushed onto an existing dashboard — it stays a picker entry',
);
assert.deepStrictEqual(
  appendNewSeeds(v2, WIDGET_SEED_VERSION, ALLOW_ALL), v2,
  'once useDashboardLayout stamps widgetsSeedVersion, the next load appends nothing',
);
// The other half of the contract: a v1 user who deleted a widget must not have
// it handed back by the generation-2 top-up.
assert.ok(
  appendNewSeeds(
    storedV1.filter(i => i.type !== 'recent-activity'), 1, ALLOW_ALL,
  ).every(i => i.type !== 'recent-activity'),
  'recent-activity shipped at generation 1, so a user who removed it is not a candidate for it at generation 2',
);
assert.strictEqual(
  appendNewSeeds(storedV1, 1, DENY_ALL).length, storedV1.length + 2,
  'the two seeded personal widgets need no permission — a member with none gets both',
);

// ── visibleInstances: a permission revoked after the layout was saved ────
const savedLayout: WidgetInstance[] = [
  { id: 'facts-1', type: 'facts', size: 'l', config: {} },
  { id: 'active-projects-1', type: 'active-projects', size: 'l', config: {} },
  { id: 'pipeline-overview-1', type: 'pipeline-overview', size: 'l', config: {} },
];
assert.deepStrictEqual(
  visibleInstances(savedLayout, allow('analytics.view')).map(i => i.id),
  ['facts-1', 'pipeline-overview-1'],
  'an instance the viewer may no longer access is not rendered',
);
assert.strictEqual(
  visibleInstances(savedLayout, DENY_ALL).length, 1,
  'filtering is read-time only — the caller keeps the full list in storage',
);

// FileHub's permission family is COLONS. `filehub.view` is not a row in
// `permissions` and hasPermission is a plain includes() with no wildcard, so the
// dotted spelling would hide this widget from every user, forever.
assert.strictEqual(WIDGET_META['filehub-inbox'].requiredPermission, 'filehub:view');
const inboxLayout: WidgetInstance[] = [
  { id: 'my-work-1', type: 'my-work', size: 'm', config: {} },
  { id: 'filehub-inbox-1', type: 'filehub-inbox', size: 'm', config: {} },
];
assert.deepStrictEqual(
  visibleInstances(inboxLayout, DENY_ALL).map(i => i.type), ['my-work'],
  'a viewer without filehub:view does not render the inbox — and the personal widget beside it is unaffected',
);
assert.deepStrictEqual(
  visibleInstances(inboxLayout, allow('filehub:view')).map(i => i.type), ['my-work', 'filehub-inbox'],
  'and it comes back the moment they have the key — the instance was never deleted',
);
assert.strictEqual(
  addWidgetBlock('filehub-inbox', [], allow('filehub.view')), 'permission',
  'the dotted spelling is not the key: a build that "normalized" it would fail here rather than in production',
);

// ── singleton enforcement ────────────────────────────────────────────────
assert.strictEqual(addWidgetBlock('facts', [], ALLOW_ALL), null);
assert.strictEqual(
  addWidgetBlock('facts', savedLayout, ALLOW_ALL), 'singleton',
  'a singleton already on the dashboard blocks a second copy',
);
assert.strictEqual(
  addWidgetBlock('active-projects', [], DENY_ALL), 'permission',
  'permission is checked before singleton — it is the more specific reason',
);
assert.strictEqual(
  addWidgetBlock('pipeline-overview', savedLayout, ALLOW_ALL), null,
  'pipeline-overview is deliberately NOT a singleton — weekly + monthly side by side is real',
);
assert.strictEqual(addInstance(savedLayout, 'facts', ALLOW_ALL).length, 3, 'a blocked add is a no-op, not a throw');
assert.strictEqual(addInstance(savedLayout, 'pipeline-overview', ALLOW_ALL).length, 4);
assert.strictEqual(
  addInstance(savedLayout, 'pipeline-overview', ALLOW_ALL)[3].id, 'pipeline-overview-2',
  'a second instance of the same type gets the lowest free integer',
);
assert.strictEqual(newInstanceId('facts', savedLayout), 'facts-2');

// The five singletons of the personal set, each for a concrete reason: one own
// fetch per mount, and for my-deadlines a three-table realtime channel, a 60s
// poll and a focus listener on top. A second instance is a second of all of it.
for (const type of ['my-work', 'my-deadlines', 'last-worked-on', 'live-now', 'filehub-inbox'] as WidgetType[]) {
  assert.strictEqual(WIDGET_META[type].singleton, true, `${type}: each mount owns a fetch — one per dashboard`);
  const one = addInstance([], type, ALLOW_ALL);
  assert.strictEqual(one.length, 1);
  assert.strictEqual(addWidgetBlock(type, one, ALLOW_ALL), 'singleton', `${type}: the picker must refuse a second copy`);
  assert.strictEqual(addInstance(one, type, ALLOW_ALL).length, 1, `${type}: a blocked add is a no-op, not a duplicate`);
}
// The one that is not: it reads AnalyticsContext, which dedup-caches on the date
// range, so a 7-day and a 90-day card side by side is two questions, not two
// copies of one — the same call pipeline-overview already makes for `period`.
assert.strictEqual(WIDGET_META['my-performance'].singleton, undefined);
assert.strictEqual(addWidgetBlock('my-performance', addInstance([], 'my-performance', ALLOW_ALL), ALLOW_ALL), null);

// ── cycleSize ────────────────────────────────────────────────────────────
assert.strictEqual(cycleSize('s'), 'm');
assert.strictEqual(cycleSize('m'), 'l');
assert.strictEqual(cycleSize('l'), 's', 'the cycle wraps rather than dead-ending at l');
assert.strictEqual(cycleSize('l', ['m', 'l']), 'm', "a type that withholds 's' wraps l -> m");
assert.strictEqual(cycleSize('m', ['m', 'l']), 'l');
assert.strictEqual(cycleSize('s', ['m', 'l']), 'm', 'a size persisted before the type narrowed allowedSizes falls back');
assert.strictEqual(cycleSize('m', ['s', 'm']), 's', "a type that withholds 'l' wraps m -> s");
// projection-strip withholds 's', so cycling its instance can never reach it.
const strip: WidgetInstance[] = [{ id: 'projection-strip-1', type: 'projection-strip', size: 'l', config: {} }];
assert.strictEqual(cycleInstanceSize(strip, 'projection-strip-1')[0].size, 'm');

// ── moveInstance: bounds ─────────────────────────────────────────────────
const order = savedLayout.map(i => i.id);
assert.deepStrictEqual(moveInstance(savedLayout, 'facts-1', -1).map(i => i.id), order, 'moving the first widget earlier is a no-op');
assert.deepStrictEqual(moveInstance(savedLayout, 'pipeline-overview-1', 1).map(i => i.id), order, 'moving the last widget later is a no-op');
assert.deepStrictEqual(moveInstance(savedLayout, 'nope', 1).map(i => i.id), order, 'an unknown id is a no-op, not a crash');
const moved = moveInstance(savedLayout, 'facts-1', 1);
assert.deepStrictEqual(moved.map(i => i.id), ['active-projects-1', 'facts-1', 'pipeline-overview-1'], 'a valid move swaps exactly two neighbours');
assert.strictEqual(moved.length, savedLayout.length, 'a move never loses or duplicates an instance');

// ── sizeToFlex: the two properties that silently break the grid ──────────
for (const size of ALL_WIDGET_SIZES) {
  const style = sizeToFlex(size);
  assert.strictEqual(style.flexShrink, 0, `${size}: shrinkable cells never wrap — they become slivers on one line`);
  assert.strictEqual(style.maxWidth, '100%', `${size}: without this, flexBasis 480 overflows a 335px mobile column`);
  assert.strictEqual(style.flexGrow, 1, `${size}: the last row must not have a ragged right edge`);
}

// ── Column arithmetic, written down so a basis change shows up here ──────
// Math.max(1, ...) is not a fudge: `maxWidth: '100%'` is what guarantees a
// cell wider than its container still occupies exactly one row rather than
// overflowing. Drop maxWidth from sizeToFlex and this stops being true.
const perRow = (container: number, size: 's' | 'm') =>
  Math.max(1, Math.floor((container + WIDGET_GAP) / ((WIDGET_BASIS[size] as number) + WIDGET_GAP)));
assert.strictEqual(perRow(1216, 's'), 5, 'desktop (1280 - px-8) fits 5 small widgets per row');
assert.strictEqual(perRow(1216, 'm'), 2, 'desktop fits 2 medium widgets per row');
assert.strictEqual(perRow(960, 's'), 3, 'the 1024px adaptive path fits 3 small widgets per row');
assert.strictEqual(perRow(335, 'm'), 1, 'a 390px viewport fits one medium widget, clamped by maxWidth');

// ── allowedSizes narrowed after shipping ─────────────────────────────────
// `facts` withdrew 's' and `pipeline-completion` withdrew 'l' on the design
// pass, so layouts saved before it carry a size those types no longer render
// properly at. Clamping is migrateDashboardConfig's job (storedSize) — nothing
// downstream re-checks, so a regression here ships a squashed widget silently.
const narrowed = migrateDashboardConfig({
  pipelineIds: [], successStageIds: [],
  widgets: [
    { id: 'facts-1', type: 'facts', size: 's', config: {} },
    { id: 'pipeline-completion-1', type: 'pipeline-completion', size: 'l', config: {} },
    { id: 'recent-activity-1', type: 'recent-activity', size: 's', config: {} },
  ],
})!;
assert.deepStrictEqual(
  narrowed.widgets!.map(w => w.size), ['m', 'm', 's'],
  "a stored size a type has since withdrawn clamps to 'm'; a type that still allows it keeps it",
);

// ── Height tiers ─────────────────────────────────────────────────────────
// The floor that stops one row of cards being three different heights. It is a
// minHeight, never a fixed height, so nothing here caps anything — these
// asserts are about the DERIVATION: a size default that every future type
// inherits, and the two types that opt out of it.
assert.strictEqual(
  widgetMinHeight('recent-activity', 's'), WIDGET_HEIGHT_UNIT,
  "a type that declares no tier takes the size default — 's' is one unit",
);
assert.strictEqual(
  widgetMinHeight('recent-activity', 'm'), WIDGET_HEIGHT_UNIT * 2,
  "and 'm' is two: a bigger size preference is a request for more room",
);
assert.strictEqual(widgetMinHeight('recent-activity', 'l'), WIDGET_HEIGHT_UNIT * 2);
assert.strictEqual(
  widgetMinHeight('facts', 'l'), WIDGET_HEIGHT_UNIT,
  'an override beats the size default: a KPI row gets wider with room, not taller',
);
assert.strictEqual(
  widgetMinHeight('blocked-exceptions', 'm'), WIDGET_HEIGHT_UNIT,
  'the other override — its all-clear one-liner is the state it is in most of the time',
);
assert.strictEqual(
  widgetMinHeight('pending-time-approvals', 'l'), 0,
  'a `bare` type draws its own card; a floor on the wrapper would only pad under it',
);

// THE REGRESSION: pipeline-overview was `bare`, so it was the one card on its
// row with no floor — it rendered at the chart's own content height while every
// neighbour was quantized, which is exactly "the graph is sometimes shorter than
// the other widgets". It wears the shell now, so it gets the same floor its
// row-mates do. Putting `bare: true` back on it fails here.
assert.strictEqual(widgetMinHeight('pipeline-overview', 'l'), WIDGET_HEIGHT_UNIT * 2);
assert.strictEqual(
  widgetMinHeight('pipeline-overview', 'm'), widgetMinHeight('recent-activity', 'm'),
  'the chart and the list beside it in an m/m row are floored to the same height',
);

assert.strictEqual(
  widgetMinHeight('my-performance', 'l'), WIDGET_HEIGHT_UNIT,
  'the third override, same reason as facts: a row of stat tiles gets wider with room, not taller',
);

// Every one of the fourteen types resolves to a usable tier at every size it
// allows, and offers a coherent set of sizes to resolve it at. The six personal
// widgets declare no allowedSizes and (bar my-performance) no heightTier, so
// what this really asserts is that the defaults are still right for them.
for (const type of WIDGET_TYPES) {
  const allowed = WIDGET_META[type].allowedSizes ?? ALL_WIDGET_SIZES;
  assert.ok(allowed.length > 0, `${type}: a type with no allowed size can be added but never rendered`);
  assert.ok(
    allowed.every(s => ALL_WIDGET_SIZES.includes(s)),
    `${type}: allowedSizes may only contain s/m/l — WIDGET_BASIS has no entry for anything else`,
  );
  assert.ok(
    allowed.includes(WIDGET_META[type].defaultSize),
    `${type}: a defaultSize outside allowedSizes seeds an instance at a size the type refuses to cycle back to`,
  );
  for (const size of allowed) {
    const tier = widgetHeightTier(type, size);
    assert.ok(
      tier === 1 || tier === 2 || tier === 3,
      `${type}/${size}: every type/size pair must resolve to a tier of 1-3, declared or defaulted`,
    );
    assert.strictEqual(
      widgetMinHeight(type, size), WIDGET_META[type].bare ? 0 : tier * WIDGET_HEIGHT_UNIT,
      `${type}/${size}: minHeight is the tier times the unit, or 0 when the type draws its own card`,
    );
  }
}

// ── `bare` is the exception, not the default ─────────────────────────────
// Only a panel that draws its own card AND its own heading may be bare. Four
// types were once marked bare and two of them drew no card at all, which is the
// bug this assert exists to stop coming back. The overview chart then left too:
// bare costs a type its height floor, and the chart is the one bare candidate
// that shares a row with floored cards.
assert.deepStrictEqual(
  WIDGET_TYPES.filter(t => WIDGET_META[t].bare), ['pending-time-approvals'],
  'one bare type left, and it is the one that self-hides rather than the one that must line up',
);
// The remaining bare type is exempt from the floor ON PURPOSE — it renders
// nothing at all when its queue is empty or on desktop web, and 360px of card
// around two approval rows is the bug, not the fix.
assert.ok(
  ALL_WIDGET_SIZES.every(s => widgetMinHeight('pending-time-approvals', s) === 0),
  'the bare exemption still applies at every size — no floor under a widget that can collapse',
);

// ── Registry sanity ──────────────────────────────────────────────────────
assert.strictEqual(WIDGET_TYPES.length, 14);
assert.ok(
  WIDGET_TYPES.every(t => (WIDGET_TYPES as WidgetType[]).filter(x => x === t).length === 1),
  'every widget type appears exactly once in the registry',
);
// Every type declaring generation 2 is exactly the personal set, and every one
// of them must be BELOW WIDGET_SEED_VERSION's new value or the top-up above is
// a no-op for it.
assert.deepStrictEqual(
  WIDGET_TYPES.filter(t => (WIDGET_META[t].seedVersion ?? 1) === 2),
  ['my-work', 'my-deadlines', 'last-worked-on', 'live-now', 'filehub-inbox', 'my-performance'],
);
assert.ok(
  WIDGET_TYPES.every(t => (WIDGET_META[t].seedVersion ?? 1) <= WIDGET_SEED_VERSION),
  'a type stamped above WIDGET_SEED_VERSION would never be seeded or appended by anything',
);
// Only the types that genuinely vary between two instances declare a field, and
// each one names the value it varies by in its subtitle.
assert.deepStrictEqual(
  WIDGET_TYPES.filter(t => WIDGET_META[t].configFields.length > 0),
  ['pipeline-overview', 'recent-activity', 'my-performance'],
  'the gear button must stay absent on the other eleven — that is what proves the rule is real',
);
for (const type of WIDGET_TYPES) {
  const meta = WIDGET_META[type];
  for (const field of meta.configFields) {
    assert.ok(
      field.options.some(o => o.value === field.default),
      `${type}/${field.key}: the declared default must be one of the options the sheet offers`,
    );
    assert.ok(meta.subtitle, `${type}: a type with a config field must tell two instances of itself apart`);
  }
}
assert.strictEqual(
  WIDGET_META['my-performance'].subtitle!({ id: 'x', type: 'my-performance', size: 'm', config: {} }),
  'Last 30 days',
  'an instance that has never been configured reports the declared default, not an empty subtitle',
);
assert.strictEqual(
  WIDGET_META['my-performance'].subtitle!({ id: 'x', type: 'my-performance', size: 'm', config: { period: '7' } }),
  'Last 7 days',
);

console.log('lib/dashboardWidgets.check.ts: ALL CHECKS PASSED');
