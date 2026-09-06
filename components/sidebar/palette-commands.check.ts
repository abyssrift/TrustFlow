// Framework-free self-check for #346/#347 palette input parsing + registry.
// Run: npx tsx components/sidebar/palette-commands.check.ts
import assert from 'node:assert';
import { parseInputMode, PALETTE_COMMANDS } from './palette-commands';

// parseInputMode — the branching that keeps `>` and the create prefixes in one place.
assert.deepStrictEqual(parseInputMode('>foo'), { mode: 'command', text: 'foo' });
assert.deepStrictEqual(parseInputMode('>'), { mode: 'command', text: '' });
assert.deepStrictEqual(parseInputMode('> '), { mode: 'command', text: '' });
assert.deepStrictEqual(parseInputMode('nt buy milk'), { mode: 'create-task', text: 'buy milk' });
assert.deepStrictEqual(parseInputMode('NT Buy Milk'), { mode: 'create-task', text: 'Buy Milk' });
assert.deepStrictEqual(parseInputMode('new task: ship it'), { mode: 'create-task', text: 'ship it' });
assert.deepStrictEqual(parseInputMode('new project: X'), { mode: 'create-project', text: 'X' });
assert.deepStrictEqual(parseInputMode('np Roadmap'), { mode: 'create-project', text: 'Roadmap' });
assert.deepStrictEqual(parseInputMode('hello'), { mode: 'normal', text: 'hello' });
// `nt`/`np` without the trailing space are NOT prefixes.
assert.deepStrictEqual(parseInputMode('nt'), { mode: 'normal', text: 'nt' });
assert.deepStrictEqual(parseInputMode('nonprofit'), { mode: 'normal', text: 'nonprofit' });
// `>` wins over a create prefix that would otherwise match after it.
assert.strictEqual(parseInputMode('>nt x').mode, 'command');

// Registry shape — ids unique, run is callable, icon+label present.
const ids = new Set<string>();
for (const c of PALETTE_COMMANDS) {
  assert.ok(c.id && !ids.has(c.id), `duplicate/empty command id: ${c.id}`);
  ids.add(c.id);
  assert.ok(typeof c.label === 'string' && c.label.length > 0);
  assert.ok(typeof c.icon === 'string' && c.icon.length > 0);
  assert.strictEqual(typeof c.run, 'function');
}
assert.ok(ids.has('toggle-theme') && ids.has('copy-page-link') && ids.has('sign-out'));

// toggle-theme cycles ThemeContext without closing (no ctx.close call).
let set: string | null = null;
let closed = false;
const toggle = PALETTE_COMMANDS.find((c) => c.id === 'toggle-theme')!;
toggle.run({
  theme: 'light', setTheme: (t) => { set = t; }, pathname: '/x',
  signOut: async () => {}, successToast: () => {}, errorToast: () => {},
  close: () => { closed = true; },
});
assert.ok(set && set !== 'light', 'toggle-theme should advance to a different theme');
assert.strictEqual(closed, false, 'toggle-theme should stay open');

console.log('palette-commands.check.ts: OK');
