/**
 * fix_all_vars.js
 * 
 * Replaces ALL remaining `var(--color-*)`, `rgb(var(...))`, `rgba(var(...))` 
 * usages inside JSX prop values with the `colors.*` pattern from useThemeColors().
 * 
 * Strategy:
 * 1. Walk all .tsx / .ts files (excluding node_modules, .expo, etc.)
 * 2. For each file, apply all CSS-var → colors.X replacements
 * 3. If the file changed AND doesn't already import useThemeColors, inject the import
 * 4. If the file changed, inject `const colors = useThemeColors();` at the top of
 *    every React component/function body that references colors.* but doesn't
 *    already have the declaration.
 * 5. Write the file back.
 */

const fs   = require('fs');
const path = require('path');

// ─── VAR → COLORS MAP ──────────────────────────────────────────────────────────
// Maps CSS variable name → { prop: string (key in colors object) }
// Special sentinel "_alpha_" means we need to handle rgba with alpha.
const VAR_MAP = {
  // Brand
  '--color-primary':         'primary',
  '--brand-primary':         'primary',
  '--color-secondary':       'secondary',
  '--color-accent':          'accent',
  '--brand-accent':          'accent',

  // Text
  '--color-text-main':       'textMain',
  '--text-main':             'textMain',
  '--color-text-muted':      'textMuted',
  '--text-muted':            'textMuted',
  '--color-text-dim':        'textDim',
  '--text-dim':              'textDim',

  // States
  '--color-success':         'success',
  '--state-success':         'success',
  '--color-danger':          'danger',
  '--state-danger':          'danger',
  '--color-warning':         'warning',
  '--state-warning':         'warning',
  '--color-info':            'info',
  '--state-info':            'info',

  // Surface / Border
  '--color-border':          'border',
  '--surface-border':        'border',
  '--color-background':      'background',
  '--color-card':            'card',
  '--surface-card':          'card',
  '--surface-overlay':       'card',   // closest equivalent

  // "dim" variants — rendered as hex+alpha approximation
  '--color-success-dim':     'success_dim',
  '--color-danger-dim':      'danger_dim',
  '--color-warning-dim':     'warning_dim',
  '--color-primary-dim':     'primary_dim',
};

// For "_dim" properties that don't exist on the colors object,
// we map them to colors.X + alphaHex approximation.
const DIM_BASE = {
  'success_dim': 'success',
  'danger_dim':  'danger',
  'warning_dim': 'warning',
  'primary_dim': 'primary',
};
const DIM_ALPHA = '26'; // ~15% opacity

function colorExpr(prop, alphaHex) {
  if (prop in DIM_BASE) {
    const base = DIM_BASE[prop];
    return `(colors.${base} + '${alphaHex || DIM_ALPHA}')`;
  }
  if (alphaHex) {
    return `(colors.${prop} + '${alphaHex}')`;
  }
  return `colors.${prop}`;
}

function applyReplacements(txt) {
  for (const [cssVar, prop] of Object.entries(VAR_MAP)) {
    const esc = cssVar.replace(/-/g, '\\-');

    // ── 1. JSX attribute: attr="rgba(var(--x), 0.5)" → attr={(colors.X + 'XX')}
    txt = txt.replace(
      new RegExp(`([a-zA-Z]+)="rgba\\(var\\(${esc}\\),\\s*([0-9.]+)\\)"`, 'g'),
      (_, attr, opac) => {
        const hex = Math.round(parseFloat(opac) * 255).toString(16).padStart(2, '0');
        return `${attr}={${colorExpr(prop, hex)}}`;
      }
    );

    // ── 2. JSX attribute: attr="rgb(var(--x))" → attr={colors.X}
    txt = txt.replace(
      new RegExp(`([a-zA-Z]+)="rgb\\(var\\(${esc}\\)\\)"`, 'g'),
      `$1={${colorExpr(prop)}}`
    );

    // ── 3. JSX attribute: attr="var(--x)" → attr={colors.X}
    txt = txt.replace(
      new RegExp(`([a-zA-Z]+)="var\\(${esc}\\)"`, 'g'),
      `$1={${colorExpr(prop)}}`
    );

    // ── 4. String literal: 'rgba(var(--x), 0.5)' → (colors.X + 'XX')
    txt = txt.replace(
      new RegExp(`'rgba\\(var\\(${esc}\\),\\s*([0-9.]+)\\)'`, 'g'),
      (_, opac) => {
        const hex = Math.round(parseFloat(opac) * 255).toString(16).padStart(2, '0');
        return colorExpr(prop, hex);
      }
    );

    // ── 5. String literal: "rgba(var(--x), 0.5)" → (colors.X + 'XX')
    txt = txt.replace(
      new RegExp(`"rgba\\(var\\(${esc}\\),\\s*([0-9.]+)\\)"`, 'g'),
      (_, opac) => {
        const hex = Math.round(parseFloat(opac) * 255).toString(16).padStart(2, '0');
        return colorExpr(prop, hex);
      }
    );

    // ── 6. String literal: 'rgb(var(--x))' → colors.X
    txt = txt.replace(
      new RegExp(`'rgb\\(var\\(${esc}\\)\\)'`, 'g'),
      colorExpr(prop)
    );

    // ── 7. String literal: "rgb(var(--x))" → colors.X
    txt = txt.replace(
      new RegExp(`"rgb\\(var\\(${esc}\\)\\)"`, 'g'),
      colorExpr(prop)
    );

    // ── 8. String literal: 'var(--x)' → colors.X
    txt = txt.replace(
      new RegExp(`'var\\(${esc}\\)'`, 'g'),
      colorExpr(prop)
    );

    // ── 9. String literal: "var(--x)" → colors.X
    txt = txt.replace(
      new RegExp(`"var\\(${esc}\\)"`, 'g'),
      colorExpr(prop)
    );

    // ── 10. Template literal: `var(--x)` → ${colors.X}  (inside JSX)
    txt = txt.replace(
      new RegExp('`var\\(' + esc + '\\)`', 'g'),
      `\`\${${colorExpr(prop)}}\``
    );
  }

  return txt;
}

// ─── IMPORT INJECTION ──────────────────────────────────────────────────────────
const HOOK_IMPORT = `import { useThemeColors } from '@/hooks/useThemeColors';`;

function ensureImport(txt) {
  if (txt.includes("from '@/hooks/useThemeColors'") || txt.includes('from "@/hooks/useThemeColors"')) {
    return txt;
  }
  // Remove old lib/themeColors import if present (wrong path)
  txt = txt.replace(/^import\s+\{[^}]*useThemeColors[^}]*\}\s+from\s+['"]@\/lib\/themeColors['"];?\r?\n/m, '');

  // Inject after last existing import line
  const importMatch = txt.match(/^(import\s[^\n]*\n)+/m);
  if (importMatch) {
    const idx = importMatch.index + importMatch[0].length;
    return txt.slice(0, idx) + HOOK_IMPORT + '\n' + txt.slice(idx);
  }
  // Fallback: prepend
  return HOOK_IMPORT + '\n' + txt;
}

// ─── COLORS DECLARATION INJECTION ──────────────────────────────────────────────
// Inject `const colors = useThemeColors();` at the top of each component body
// that references `colors.` but doesn't already have the declaration.
function ensureColorsDecl(txt) {
  // If file doesn't reference colors.*, nothing to do.
  if (!/colors\.[a-zA-Z]/.test(txt)) return txt;

  // Regex to match the opening brace of a function/arrow component body.
  // We target: `function ComponentName(` or `const ComponentName = (...) =>`
  // and add the declaration right after the opening `{`.
  const componentBodyRegex = /(?:function\s+[A-Z][a-zA-Z0-9_]*\s*\([^)]*\)[^{]*|const\s+[A-Z][a-zA-Z0-9_]*\s*=\s*(?:<[^>]+>\s*)?\([^)]*\)\s*(?::\s*[^=>{]+)?\s*=>\s*)\{(\r?\n)/g;

  return txt.replace(componentBodyRegex, (match, nl) => {
    // Check if `const colors` already appears within a reasonable distance
    // after this match — we'll just always inject and then deduplicate.
    return match.slice(0, -nl.length) + `{${nl}  const colors = useThemeColors();${nl}`;
  });
}

function deduplicateColorsDecl(txt) {
  // Remove duplicates: two consecutive `const colors = useThemeColors();` lines
  return txt.replace(
    /( *const colors = useThemeColors\(\);[\r\n]+)( *const colors = useThemeColors\(\);[\r\n]+)+/g,
    '$1'
  );
}

// ─── FILE WALKER ───────────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(['node_modules', '.git', '.expo', 'dist', 'build', 'android', 'ios', '.turbo', 'scratch']);

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      walkFiles(full, out);
    } else if (full.endsWith('.tsx') || full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
const ROOT = 'c:/Users/j/Documents/Github/TrustFlow';
const files = walkFiles(ROOT);

let changed = 0;
let skipped = 0;

for (const filePath of files) {
  let txt = fs.readFileSync(filePath, 'utf8');
  const original = txt;

  txt = applyReplacements(txt);

  if (txt === original) {
    skipped++;
    continue;
  }

  // Only inject hook machinery into .tsx files that are React components.
  if (filePath.endsWith('.tsx')) {
    txt = ensureImport(txt);
    txt = ensureColorsDecl(txt);
    txt = deduplicateColorsDecl(txt);
  }

  fs.writeFileSync(filePath, txt, 'utf8');
  console.log('✓ Fixed:', path.relative(ROOT, filePath));
  changed++;
}

console.log(`\nDone. ${changed} file(s) modified, ${skipped} file(s) unchanged.`);
