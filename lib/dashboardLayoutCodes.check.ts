// Self-check for lib/dashboardLayoutCodes.ts — run:
//   npx tsx lib/dashboardLayoutCodes.check.ts
//
// No framework (ponytail, mirrors lib/dashboardWidgets.check.ts): plain asserts
// against the parts that actually break. Import is a TRUST BOUNDARY, so most of
// this file is rejection paths — a pasted code is a string a stranger wrote.

import assert from 'node:assert';
import {
  LAYOUT_CODE_PREFIX,
  LAYOUT_PRESETS,
  MAX_CODE_INSTANCES,
  buildLayout,
  buildPreset,
  decodeLayout,
  describeBuild,
  encodeLayout,
  isLayoutError,
  type LayoutBuild,
} from './dashboardLayoutCodes';
import {
  ALL_WIDGET_SIZES,
  WIDGET_META,
  isWidgetType,
  type WidgetInstance,
} from './dashboardWidgets';

const ALLOW_ALL = () => true;
const DENY_ALL = (p: string | null) => p === null;
const allow = (...keys: string[]) => (p: string | null) => p === null || keys.includes(p);

/** decodeLayout narrowed to the success branch, or a failed assert saying why. */
const ok = (result: ReturnType<typeof decodeLayout>, why: string): LayoutBuild => {
  assert.ok(!isLayoutError(result), `${why} — got error: ${isLayoutError(result) ? result.error : ''}`);
  return result as LayoutBuild;
};

// ── Round trip ───────────────────────────────────────────────────────────
const layout: WidgetInstance[] = [
  { id: 'facts-1', type: 'facts', size: 'l', config: {} },
  { id: 'pipeline-overview-1', type: 'pipeline-overview', size: 'm', config: { period: 'month' } },
  { id: 'recent-activity-1', type: 'recent-activity', size: 'm', config: { limit: '10' } },
  { id: 'my-work-1', type: 'my-work', size: 'm', config: {} },
];

const code = encodeLayout(layout);
assert.ok(code.startsWith(LAYOUT_CODE_PREFIX), 'a code is recognisable before it is decoded');
assert.ok(/^TFD1-[A-Za-z0-9\-_]+$/.test(code), 'the body is base64url — no padding, nothing needing URL-escaping');

const round = ok(decodeLayout(code, { can: ALLOW_ALL }), 'a code this build wrote must decode');
assert.deepStrictEqual(
  round.instances.map(i => ({ type: i.type, size: i.size, config: i.config })),
  layout.map(i => ({ type: i.type, size: i.size, config: i.config })),
  'type, size and config survive the round trip exactly',
);
assert.deepStrictEqual(round.skipped, [], 'nothing is dropped from a code the same build produced');
assert.deepStrictEqual(
  round.instances.map(i => i.id),
  ['facts-1', 'pipeline-overview-1', 'recent-activity-1', 'my-work-1'],
  'ids are MINTED by addInstance, not carried — they only match here because the importer starts empty',
);
assert.ok(
  !code.includes('facts-1') && !/[A-Za-z0-9\-_]*id/.test(JSON.stringify(round.instances[0].id) + ''),
  'sanity: nothing about the exporter travels in the code but type/size/config',
);

// An empty config is not emitted at all, so an untouched dashboard makes a
// shorter code than a configured one.
assert.ok(
  encodeLayout([{ id: 'x', type: 'my-work', size: 'm', config: {} }]).length <
  encodeLayout([{ id: 'x', type: 'recent-activity', size: 'm', config: { limit: '20' } }]).length,
  'a config-free widget costs fewer characters than one carrying a setting',
);

// ── Nothing company-scoped may ever leave ────────────────────────────────
// The structural rule: a value is emitted only when the REGISTRY declares it as
// an option. A pipeline id, a stage id or a user id is not a member of any
// declared option set, so it cannot be encoded — this asserts that, rather than
// trusting the comment beside it.
const contaminated: WidgetInstance[] = [
  {
    id: 'pipeline-overview-1',
    type: 'pipeline-overview',
    size: 'l',
    config: {
      period: 'month',
      pipelineIds: '2f1c9a44-3f5e-4a1b-9c2d-8e7f6a5b4c3d',
      successStageIds: 'a1b2c3d4-e5f6-4718-9a0b-1c2d3e4f5a6b',
      userId: 'deadbeef-0000-4000-8000-000000000000',
    },
  },
];
const contaminatedCode = encodeLayout(contaminated);
const decodedBody = Buffer.from(
  contaminatedCode.slice(LAYOUT_CODE_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/'),
  'base64',
).toString('binary');
for (const secret of ['2f1c9a44', 'a1b2c3d4', 'deadbeef', 'pipelineIds', 'successStageIds', 'userId']) {
  assert.ok(!decodedBody.includes(secret), `${secret}: a code carries shape, never scope`);
  assert.ok(!contaminatedCode.includes(secret), `${secret}: and it is not hiding in the encoded string either`);
}
assert.deepStrictEqual(
  ok(decodeLayout(contaminatedCode, { can: ALLOW_ALL }), 'the clean part still travels').instances[0].config,
  { period: 'month' },
  'the one declared, declared-valued key survives; the three id-shaped strangers do not',
);

// A value that is id-SHAPED but somehow declared would still be refused — the
// belt behind the closed-option-set rule. Asserted through the public API by
// checking that no declared option is id-shaped in the first place.
for (const type of Object.keys(WIDGET_META) as (keyof typeof WIDGET_META)[]) {
  for (const field of WIDGET_META[type].configFields) {
    for (const option of field.options) {
      assert.ok(
        option.value.length <= 32 && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(option.value),
        `${type}/${field.key}: a config field may not offer an id as a value — a code would have to drop it`,
      );
    }
  }
}

// ── Rejection paths: every one returns a sentence, never a throw ─────────
const rejected = (input: string, why: string) => {
  const result = decodeLayout(input, { can: ALLOW_ALL });
  assert.ok(isLayoutError(result), why);
  const message = (result as { error: string }).error;
  assert.ok(message.length > 0 && /[.\-—]$|TFD1-$/.test(message.trim()), `${why}: the error must be a real sentence`);
  return message;
};

rejected('', 'an empty field is not a code');
rejected('   ', 'whitespace is not a code');
rejected('hello world', 'arbitrary text is refused by the prefix, before any parsing');
rejected('TFD-abc', 'a prefix with no version number is not this format');
rejected('tfd1-abc', 'the prefix is case-sensitive — a mangled paste is not silently accepted');
const newer = rejected('TFD2-abc', 'a FUTURE format version is refused with its own message');
assert.ok(/newer version/i.test(newer), 'and that message tells the user the app is behind, not that the code is broken');
rejected(LAYOUT_CODE_PREFIX + 'not*valid*base64', 'a character outside the base64url alphabet is corruption');
rejected(LAYOUT_CODE_PREFIX + 'A', 'a 1-char group carries 6 bits — not enough for a byte');
rejected(LAYOUT_CODE_PREFIX, 'the prefix alone decodes to nothing');
rejected(LAYOUT_CODE_PREFIX + 'a'.repeat(5000), 'a code longer than the cap is refused before it is decoded');

// Valid base64url that is not valid JSON, and valid JSON that is not a layout.
const b64 = (raw: string) => Buffer.from(raw, 'binary').toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
rejected(LAYOUT_CODE_PREFIX + b64('{{{not json'), 'a malformed JSON body is caught, not thrown');
rejected(LAYOUT_CODE_PREFIX + b64('{"widgets":[]}'), 'a JSON object is not the array this format uses');
rejected(LAYOUT_CODE_PREFIX + b64('"a string"'), 'a JSON string is not a layout');
rejected(LAYOUT_CODE_PREFIX + b64('[]'), 'an empty layout would blank the dashboard — refused with its own sentence');
rejected(
  LAYOUT_CODE_PREFIX + b64('[["not-a-widget","m"],["also-fake","l"]]'),
  'a code of nothing but unknown types is refused rather than applied as an empty dashboard',
);
const noAccess = decodeLayout(
  LAYOUT_CODE_PREFIX + b64('[["pipeline-overview","l"],["projection-strip","l"]]'),
  { can: DENY_ALL },
);
assert.ok(isLayoutError(noAccess), 'a code whose every widget is gated is refused, not applied empty');
assert.ok(/access/i.test((noAccess as { error: string }).error), 'and it says WHY: access, not corruption');

// ── Hard cap ─────────────────────────────────────────────────────────────
const many = Array.from({ length: 40 }, () => ['my-performance', 'm']);
const capped = ok(decodeLayout(LAYOUT_CODE_PREFIX + b64(JSON.stringify(many)), { can: ALLOW_ALL }), 'over-cap is not fatal');
assert.strictEqual(
  capped.instances.length, MAX_CODE_INSTANCES,
  'a code cannot create more than the cap — my-performance is deliberately not a singleton, so nothing else would stop it',
);
assert.strictEqual(capped.skipped.length, 40 - MAX_CODE_INSTANCES);
assert.ok(capped.skipped.every(s => s.reason === 'over-cap'), 'and the overflow is reported as the cap, not as junk');
assert.strictEqual(
  encodeLayout(Array.from({ length: 40 }, (_, n): WidgetInstance => (
    { id: `my-performance-${n}`, type: 'my-performance', size: 'm', config: {} }
  ))).length,
  encodeLayout(Array.from({ length: MAX_CODE_INSTANCES }, (_, n): WidgetInstance => (
    { id: `my-performance-${n}`, type: 'my-performance', size: 'm', config: {} }
  ))).length,
  'the encoder caps too — a huge local layout cannot produce a code the decoder will truncate',
);

// ── Unknown type dropped, siblings survive ───────────────────────────────
const mixed = ok(decodeLayout(
  LAYOUT_CODE_PREFIX + b64('[["my-work","m"],["widget-from-2027","l"],["last-worked-on","m"],17,null,["facts"]]'),
  { can: ALLOW_ALL },
), 'unknown entries are dropped, never fatal');
assert.deepStrictEqual(
  mixed.instances.map(i => i.type), ['my-work', 'last-worked-on', 'facts'],
  'a type from a newer build is skipped and the rest of the code still applies',
);
assert.deepStrictEqual(
  mixed.skipped, [
    { type: 'widget-from-2027', reason: 'unknown' },
    { type: 'unknown widget', reason: 'unknown' },
    { type: 'unknown widget', reason: 'unknown' },
  ],
  'a non-array entry is reported too, with a label safe to print',
);
assert.strictEqual(
  mixed.instances[2].size, WIDGET_META['facts'].defaultSize,
  'an entry with no size at all takes the type default rather than becoming undefined',
);

// ── Size clamped to allowedSizes ─────────────────────────────────────────
const sizes = ok(decodeLayout(
  LAYOUT_CODE_PREFIX + b64('[["facts","s"],["pipeline-completion","l"],["recent-activity","s"],["my-work","xl"],["last-worked-on",99]]'),
  { can: ALLOW_ALL },
), 'a bad size is clamped, not rejected');
assert.deepStrictEqual(
  sizes.instances.map(i => i.size),
  ['l', 'm', 's', 'm', 'm'],
  "facts withdrew 's' and pipeline-completion withdrew 'l', so both clamp to their default; a size the type allows is kept; a non-size clamps too",
);
for (const instance of sizes.instances) {
  const allowed = WIDGET_META[instance.type].allowedSizes ?? ALL_WIDGET_SIZES;
  assert.ok(allowed.includes(instance.size), `${instance.type}: an imported size must be one the type renders`);
}

// ── Config: unknown key dropped, bad value defaulted, absent left absent ─
const configs = ok(decodeLayout(LAYOUT_CODE_PREFIX + b64(JSON.stringify([
  ['pipeline-overview', 'l', { period: 'month', rows: '500', pipelineIds: 'abc', __proto__: 'x' }],
  ['recent-activity', 'm', { limit: 'all of them' }],
  ['my-performance', 'm', {}],
  ['pipeline-overview', 'l', { period: { evil: true } }],
])), { can: ALLOW_ALL }), 'config junk is filtered, not fatal');
assert.deepStrictEqual(
  configs.instances[0].config, { period: 'month' },
  'only keys the type DECLARES survive — the walk is over configFields, so an undeclared key has no way in',
);
assert.deepStrictEqual(
  configs.instances[1].config, { limit: '5' },
  "a declared key with a value outside its options falls back to that field's default",
);
assert.deepStrictEqual(
  configs.instances[2].config, {},
  'an absent key stays absent — the widget reads its default at render time, same as a fresh add',
);
assert.deepStrictEqual(
  configs.instances[3].config, { period: 'week' },
  'a non-string value is not a declared option either, so it defaults',
);
assert.strictEqual(
  Object.getPrototypeOf(configs.instances[0].config), Object.prototype,
  'a `__proto__` key in a pasted code does not reach the object it would poison',
);

// ── Singleton de-duplication ─────────────────────────────────────────────
const dupes = ok(decodeLayout(
  LAYOUT_CODE_PREFIX + b64('[["my-work","m"],["my-work","l"],["facts","l"],["facts","m"],["pipeline-overview","l"],["pipeline-overview","m"]]'),
  { can: ALLOW_ALL },
), 'duplicates are de-duped, not fatal');
assert.deepStrictEqual(
  dupes.instances.map(i => i.type), ['my-work', 'facts', 'pipeline-overview', 'pipeline-overview'],
  'a singleton appears once however many times the code names it; a non-singleton keeps both copies',
);
assert.deepStrictEqual(
  dupes.skipped, [{ type: 'my-work', reason: 'duplicate' }, { type: 'facts', reason: 'duplicate' }],
  'and the dropped copies are reported',
);
assert.strictEqual(dupes.instances[0].size, 'm', 'the FIRST copy wins — a later duplicate never overwrites it');
assert.deepStrictEqual(
  dupes.instances.map(i => i.id),
  ['my-work-1', 'facts-1', 'pipeline-overview-1', 'pipeline-overview-2'],
  'ids are unique across the imported layout — a duplicate key remounts widgets on every reorder',
);

// ── Permission filtering, using the same predicate as the rest ───────────
const gated = '[["facts","l"],["pipeline-overview","l"],["projection-strip","l"],["filehub-inbox","m"],["my-work","m"]]';
const asMember = ok(decodeLayout(LAYOUT_CODE_PREFIX + b64(gated), { can: DENY_ALL }), 'a gated code still applies its ungated part');
assert.deepStrictEqual(
  asMember.instances.map(i => i.type), ['facts', 'my-work'],
  'a member with no permissions gets only the widgets that need none — never a card they cannot read',
);
assert.deepStrictEqual(
  asMember.skipped.map(s => s.reason), ['permission', 'permission', 'permission'],
  'and each one is reported as permission, so the preview can be honest about why',
);
const asAnalyst = ok(decodeLayout(LAYOUT_CODE_PREFIX + b64(gated), { can: allow('analytics.view', 'filehub:view') }), '');
assert.deepStrictEqual(
  asAnalyst.instances.map(i => i.type), ['facts', 'pipeline-overview', 'filehub-inbox', 'my-work'],
  'the filter is per-permission, not all-or-nothing — project.view is the only one missing here',
);
assert.strictEqual(
  ok(decodeLayout(LAYOUT_CODE_PREFIX + b64('[["filehub-inbox","m"],["my-work","m"]]'), { can: allow('filehub.view') }), '')
    .instances.length,
  1,
  'FileHub keys are COLONS: the dotted spelling grants nothing, exactly as addWidgetBlock says',
);

// ── Built-in presets go through the SAME path ────────────────────────────
assert.deepStrictEqual(
  LAYOUT_PRESETS.map(p => p.id), ['focus', 'lead', 'owner'],
  'three presets, one per way this dashboard is actually used',
);
assert.strictEqual(new Set(LAYOUT_PRESETS.map(p => p.id)).size, LAYOUT_PRESETS.length, 'preset ids are unique — they are React keys');

for (const preset of LAYOUT_PRESETS) {
  assert.ok(preset.name.length > 0 && preset.blurb.length > 0, `${preset.id}: a preset the user picks blind needs both lines`);
  assert.ok(preset.instances.length > 0 && preset.instances.length <= MAX_CODE_INSTANCES, `${preset.id}: within the cap`);

  const built = buildPreset(preset, ALLOW_ALL);
  assert.deepStrictEqual(
    built.skipped, [],
    `${preset.id}: with every permission a preset must apply WHOLE — a skip here is a typo in the preset, not a user problem`,
  );
  assert.deepStrictEqual(
    built.instances.map(i => i.type), preset.instances.map(i => i.type),
    `${preset.id}: the declared order is the applied order`,
  );
  for (const instance of built.instances) {
    assert.ok(isWidgetType(instance.type), `${preset.id}: every type must be in the registry`);
    const allowed = WIDGET_META[instance.type].allowedSizes ?? ALL_WIDGET_SIZES;
    assert.ok(allowed.includes(instance.size), `${preset.id}/${instance.type}: a declared size the type refuses would clamp silently`);
  }
  // The declared sizes and configs must survive untouched, or the preset is
  // lying about what it sets up.
  for (let i = 0; i < preset.instances.length; i++) {
    const seed = preset.instances[i];
    if (seed.size) assert.strictEqual(built.instances[i].size, seed.size, `${preset.id}: declared size is kept`);
    if (seed.config) assert.deepStrictEqual(built.instances[i].config, seed.config, `${preset.id}: declared config is kept`);
  }

  // The whole point of routing presets through buildLayout: a permissionless
  // member gets a smaller dashboard, not a dashboard of locked cards.
  const degraded = buildPreset(preset, DENY_ALL);
  assert.ok(
    degraded.instances.every(i => WIDGET_META[i.type].requiredPermission === null),
    `${preset.id}: a preset degrades to what the viewer may actually see`,
  );
  assert.strictEqual(
    degraded.instances.length + degraded.skipped.length, preset.instances.length,
    `${preset.id}: every declared widget is either applied or reported — nothing vanishes silently`,
  );
}
assert.ok(
  buildPreset(LAYOUT_PRESETS[0], DENY_ALL).instances.length === LAYOUT_PRESETS[0].instances.length,
  'the personal preset needs no permission at all — that is what makes it the safe default for a new member',
);
assert.ok(
  buildPreset(LAYOUT_PRESETS[2], DENY_ALL).instances.length < LAYOUT_PRESETS[2].instances.length,
  'the owner preset genuinely degrades, so the branch above is exercised rather than vacuous',
);

// A preset is a layout, so it encodes and decodes like any other.
const presetCode = encodeLayout(buildPreset(LAYOUT_PRESETS[1], ALLOW_ALL).instances);
assert.deepStrictEqual(
  ok(decodeLayout(presetCode, { can: ALLOW_ALL }), 'a preset survives a trip through the code format').instances.map(i => i.type),
  LAYOUT_PRESETS[1].instances.map(i => i.type),
  'presets and codes are the same thing at rest, which is why they share one apply path',
);

// ── buildLayout is reachable directly, and behaves the same ──────────────
assert.deepStrictEqual(
  buildLayout([{ type: 'my-work' }, { type: 'nope' }], ALLOW_ALL),
  { instances: [{ id: 'my-work-1', type: 'my-work', size: 'm', config: {} }], skipped: [{ type: 'nope', reason: 'unknown' }] },
  'one path, two sources: the preset call and the decode call are both this',
);

// ── describeBuild: the preview the user reads before replacing anything ──
assert.match(describeBuild(round), /^Adds 4 widgets, replacing/, 'the count and the consequence come first');
assert.match(describeBuild(buildLayout([{ type: 'my-work' }], ALLOW_ALL)), /Adds 1 widget,/, 'singular reads correctly');
const preview = describeBuild(asMember);
assert.match(preview, /Adds 2 widgets/);
assert.match(preview, /3 skipped — you don't have access to them\./, 'skips are named by REASON, in the user\'s language');
assert.ok(!/undefined|NaN|\[object/.test(preview), 'the preview never leaks an internal value');
assert.ok(
  !describeBuild(round).includes('skipped'),
  'a clean code says nothing about skips — a preview that always mentions them stops meaning anything',
);
assert.match(describeBuild(capped), new RegExp(`at most ${MAX_CODE_INSTANCES} widgets`), 'the cap explains itself');

// ── A real code, printed, so a format change is visible in the diff ──────
const example = encodeLayout(buildPreset(LAYOUT_PRESETS[2], ALLOW_ALL).instances);
console.log(`  example code (${LAYOUT_PRESETS[2].name}, ${example.length} chars): ${example}`);
console.log(`  decodes to: ${JSON.stringify(
  ok(decodeLayout(example, { can: ALLOW_ALL }), '').instances.map(i => `${i.type}/${i.size}`),
)}`);

console.log('lib/dashboardLayoutCodes.check.ts: ALL CHECKS PASSED');
