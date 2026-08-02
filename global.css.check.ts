// Self-check for the global focus treatment — run: npx tsx global.css.check.ts
// (also picked up by `npm run check`).
//
// Focus is styled once, at the bottom of global.css, and nowhere else. Two
// things have to stay true for that to hold, and neither is visible in a diff:
//
//   1. The `:focus-visible` ring must be emitted AFTER Tailwind's utilities.
//      It has the same specificity as `.outline-none` (0,1,0), so the ONLY
//      thing making it win is source order. Move it above `@tailwind
//      utilities`, or into an `@layer`, and every focus ring in the app
//      silently disappears with no error anywhere.
//
//   2. No component may suppress focus locally. 24 inputs once shipped with
//      `outline-none` and showed nothing at all when tabbed to. The global
//      rule already kills the ugly click-focus ring people were reaching for,
//      so a local suppression today is pure accessibility loss.
//
// The sanctioned opt-out is `className="focus-ring-none"` — greppable, unlike
// an inline `outline: none`.
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync('global.css', 'utf8');

// --- 1. ordering ---------------------------------------------------------
const utilities = css.indexOf('@tailwind utilities');
const suppress = css.indexOf(':focus:not(:focus-visible)');
const ring = css.search(/^:focus-visible\s*\{/m);
const optOut = css.indexOf('.focus-ring-none:focus-visible');

assert.ok(utilities >= 0, 'global.css must still include @tailwind utilities');
assert.ok(suppress >= 0, ':focus:not(:focus-visible) rule is missing from global.css');
assert.ok(ring >= 0, ':focus-visible ring rule is missing from global.css');
assert.ok(optOut >= 0, '.focus-ring-none opt-out is missing from global.css');
assert.ok(
  ring > utilities && suppress > utilities,
  'the focus rules must come AFTER @tailwind utilities or .outline-none outranks them by source order',
);

// The ring has to be a real, visible outline in a theme token — a transparent
// or 0-width one is the same as having no ring.
const ringBody = css.slice(ring, css.indexOf('}', ring));
assert.match(ringBody, /outline:\s*[1-9]/, 'the focus ring must have a non-zero outline width');
assert.match(ringBody, /var\(--brand-primary\)/, 'the focus ring must use the brand-primary token, not a hardcoded colour');

// Nothing may live inside an @layer — layered rules lose to unlayered ones
// regardless of order, which would silently disable the ring.
const layerBlocks = [...css.matchAll(/@layer[^{]*\{/g)].map(m => m.index!);
for (const start of layerBlocks) {
  // crude but sufficient: a layer that textually contains a focus rule
  const end = css.indexOf('\n}', start);
  const block = css.slice(start, end < 0 ? css.length : end);
  assert.ok(!block.includes(':focus-visible'), 'focus rules must not sit inside an @layer');
}

// --- 2. no local suppression --------------------------------------------
const SKIP = new Set(['node_modules', '.git', 'website', 'dist', '.expo', 'graphify-out']);
const sources: string[] = [];
(function walk(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.check.ts')) sources.push(full);
  }
})('.');

const FORBIDDEN = [
  { re: /\boutline-none\b/, what: 'the `outline-none` Tailwind class' },
  { re: /outline:\s*['"]none['"]/, what: "an inline `outline: 'none'`" },
  { re: /outlineWidth:\s*0/, what: 'an inline `outlineWidth: 0`' },
  { re: /outlineStyle:\s*['"]none['"]/, what: "an inline `outlineStyle: 'none'`" },
];

const offences: string[] = [];
for (const file of sources) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const { re, what } of FORBIDDEN) {
      if (re.test(line)) offences.push(`${file}:${i + 1} uses ${what}`);
    }
  });
}

assert.deepEqual(
  offences,
  [],
  `focus must not be suppressed in a component — global.css handles it.\n` +
    `Use className="focus-ring-none" if the element genuinely is not a control.\n\n` +
    offences.join('\n'),
);

console.log(`global.css focus rules: all checks passed (${sources.length} source files clean)`);
