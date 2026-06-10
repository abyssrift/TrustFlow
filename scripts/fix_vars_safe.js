/**
 * fix_vars_safe.js
 *
 * SAFE approach — NO code injection whatsoever.
 *
 * Pass 1 – Fix wrong import path (already done by old scripts):
 *   `@/lib/themeColors` → `@/hooks/useThemeColors`
 *   (lib/themeColors.ts does NOT export useThemeColors — this import is always broken)
 *
 * Pass 2 – For files that ALREADY have useThemeColors imported AND
 *   have at least one `const colors = useThemeColors()` declaration,
 *   replace all remaining var(--*) / rgb(var(--*)) / rgba(var(--*)) usages.
 *
 * Pass 3 – Report files that still have var(--) but no useThemeColors,
 *   so they can be fixed manually.
 *
 * Nothing is ever injected. No function bodies are parsed. No syntax can break.
 */

const fs   = require('fs');
const path = require('path');

// ─── CSS VAR → colors.PROP MAP ────────────────────────────────────────────────
const VAR_MAP = [
  // Brand
  ['--color-primary',         'primary'],
  ['--brand-primary',         'primary'],
  ['--color-secondary',       'secondary'],
  ['--color-accent',          'accent'],
  ['--brand-accent',          'accent'],

  // Text
  ['--color-text-main',       'textMain'],
  ['--text-main',             'textMain'],
  ['--color-text-muted',      'textMuted'],
  ['--text-muted',            'textMuted'],
  ['--color-text-dim',        'textDim'],
  ['--text-dim',              'textDim'],

  // States
  ['--color-success',         'success'],
  ['--state-success',         'success'],
  ['--color-danger',          'danger'],
  ['--state-danger',          'danger'],
  ['--color-warning',         'warning'],
  ['--state-warning',         'warning'],
  ['--color-info',            'info'],
  ['--state-info',            'info'],

  // Surface / Border
  ['--color-border',          'border'],
  ['--surface-border',        'border'],
  ['--color-surface-border',  'border'],
  ['--color-background',      'background'],
  ['--color-card',            'card'],
  ['--surface-card',          'card'],
  ['--color-surface-card',    'card'],
  ['--surface-overlay',       'card'],
  ['--color-surface-overlay', 'card'],
  ['--color-surface-background', 'background'],
  ['--color-brand-primary',   'primary'],

  // "dim" variants — approximated as base color + alpha hex
  ['--color-success-dim',     'success__dim'],
  ['--color-danger-dim',      'danger__dim'],
  ['--color-warning-dim',     'warning__dim'],
  ['--color-primary-dim',     'primary__dim'],
];

// For __dim props, we have no direct field — use base + low-opacity alpha
const DIM_BASE = {
  'success__dim': 'success',
  'danger__dim':  'danger',
  'warning__dim': 'warning',
  'primary__dim': 'primary',
};
const DIM_ALPHA = '26'; // ~15 % opacity

function resolveExpr(prop, alphaHex) {
  if (prop.endsWith('__dim')) {
    const base = DIM_BASE[prop];
    return `(colors.${base} + '${alphaHex || DIM_ALPHA}')`;
  }
  if (alphaHex) {
    return `(colors.${prop} + '${alphaHex}')`;
  }
  return `colors.${prop}`;
}

function alphaHex(opacity) {
  return Math.round(parseFloat(opacity) * 255).toString(16).padStart(2, '0');
}

// ─── REPLACEMENT ENGINE ───────────────────────────────────────────────────────
function applyReplacements(txt) {
  for (const [cssVar, prop] of VAR_MAP) {
    // Escape the var name for use in regex
    const e = cssVar.replace(/-/g, '\\-');

    // 1. JSX attr:  attr="rgba(var(--x), 0.5)"  →  attr={(colors.X + 'XX')}
    txt = txt.replace(
      new RegExp(`([a-zA-Z]+)="rgba\\(var\\(${e}\\),\\s*([0-9.]+)\\)"`, 'g'),
      (_, attr, op) => `${attr}={${resolveExpr(prop, alphaHex(op))}}`
    );

    // 2. JSX attr:  attr="rgb(var(--x))"  →  attr={colors.X}
    txt = txt.replace(
      new RegExp(`([a-zA-Z]+)="rgb\\(var\\(${e}\\)\\)"`, 'g'),
      `$1={${resolveExpr(prop)}}`
    );

    // 3. JSX attr:  attr="var(--x)"  →  attr={colors.X}
    txt = txt.replace(
      new RegExp(`([a-zA-Z]+)="var\\(${e}\\)"`, 'g'),
      `$1={${resolveExpr(prop)}}`
    );

    // 4. Single-quoted string:  'rgba(var(--x), 0.5)'
    txt = txt.replace(
      new RegExp(`'rgba\\(var\\(${e}\\),\\s*([0-9.]+)\\)'`, 'g'),
      (_, op) => resolveExpr(prop, alphaHex(op))
    );

    // 5. Double-quoted string:  "rgba(var(--x), 0.5)"
    txt = txt.replace(
      new RegExp(`"rgba\\(var\\(${e}\\),\\s*([0-9.]+)\\)"`, 'g'),
      (_, op) => resolveExpr(prop, alphaHex(op))
    );

    // 6. Single-quoted string:  'rgb(var(--x))'
    txt = txt.replace(
      new RegExp(`'rgb\\(var\\(${e}\\)\\)'`, 'g'),
      resolveExpr(prop)
    );

    // 7. Double-quoted string:  "rgb(var(--x))"
    txt = txt.replace(
      new RegExp(`"rgb\\(var\\(${e}\\)\\)"`, 'g'),
      resolveExpr(prop)
    );

    // 8. Single-quoted string:  'var(--x)'
    txt = txt.replace(
      new RegExp(`'var\\(${e}\\)'`, 'g'),
      resolveExpr(prop)
    );

    // 9. Double-quoted string:  "var(--x)"
    txt = txt.replace(
      new RegExp(`"var\\(${e}\\)"`, 'g'),
      resolveExpr(prop)
    );
  }
  return txt;
}

// ─── FILE WALKER ──────────────────────────────────────────────────────────────
const SKIP = new Set(['node_modules', '.git', '.expo', 'dist', 'build', 'android', 'ios']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const full = path.join(dir, e);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.tsx') || full.endsWith('.ts')) out.push(full);
  }
  return out;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
const ROOT  = 'c:/Users/j/Documents/Github/TrustFlow';
const files = walk(ROOT);

const needsManual = []; // files that have var(--) but no useThemeColors yet
let fixed = 0;
let importFixed = 0;
let skipped = 0;

for (const filePath of files) {
  let txt = fs.readFileSync(filePath, 'utf8');
  const original = txt;

  // ── Pass 1: Fix wrong import path ──────────────────────────────────────────
  // @/lib/themeColors does NOT export useThemeColors — always broken
  const hadBadImport = txt.includes("from '@/lib/themeColors'") || txt.includes('from "@/lib/themeColors"');
  if (hadBadImport) {
    txt = txt
      .replace(/from\s+'@\/lib\/themeColors'/g, "from '@/hooks/useThemeColors'")
      .replace(/from\s+"@\/lib\/themeColors"/g, 'from "@/hooks/useThemeColors"');
    importFixed++;
  }

  // ── Does this file have var(--) usages at all? ─────────────────────────────
  const hasVarUsage = txt.includes('var(--');
  if (!hasVarUsage) {
    if (txt !== original) {
      fs.writeFileSync(filePath, txt, 'utf8');
    }
    skipped++;
    continue;
  }

  // ── Does this file already have useThemeColors set up? ───────────────────
  const hasHook      = txt.includes('useThemeColors');
  const hasColorsVar = txt.includes('const colors = useThemeColors()');

  if (!hasHook || !hasColorsVar) {
    // Not ready — record and move on (still save import fix if applicable)
    if (txt !== original) {
      fs.writeFileSync(filePath, txt, 'utf8');
    }
    needsManual.push({
      file: path.relative(ROOT, filePath),
      count: (txt.match(/var\(--/g) || []).length,
      hasHook,
      hasColorsVar,
    });
    continue;
  }

  // ── Safe to replace ────────────────────────────────────────────────────────
  txt = applyReplacements(txt);

  if (txt !== original) {
    fs.writeFileSync(filePath, txt, 'utf8');
    console.log('✓ Fixed:', path.relative(ROOT, filePath));
    fixed++;
  } else {
    skipped++;
  }
}

// ─── SUMMARY ──────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log(`✓ ${fixed} file(s) fully fixed`);
console.log(`✓ ${importFixed} import path(s) corrected (@/lib/themeColors → @/hooks/useThemeColors)`);
console.log(`\n⚠  ${needsManual.length} file(s) need manual useThemeColors setup:`);
needsManual.forEach(({ file, count, hasHook, hasColorsVar }) => {
  const reason = !hasHook ? 'no import' : 'import but no const colors';
  console.log(`   [${count} hits, ${reason}]  ${file}`);
});
console.log(`${'═'.repeat(60)}\n`);

if (needsManual.length > 0) {
  console.log('For each file above, add to the top of the component function:');
  console.log("  const colors = useThemeColors();");
  console.log('And add the import if missing:');
  console.log("  import { useThemeColors } from '@/hooks/useThemeColors';\n");
}
