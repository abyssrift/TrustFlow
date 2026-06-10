/**
 * fix_script_damage.js
 * 
 * Repairs damage done by fix_all_vars.js:
 * 1. Fixes double-brace `){{\n  const colors` → `{\n  const colors`
 * 2. Removes duplicate `const colors = useThemeColors();` lines
 * 3. Removes `const colors = useThemeColors();` injected into non-component
 *    functions (lowercase names, helper fns, etc.)
 * 4. Fixes import path: @/lib/themeColors → @/hooks/useThemeColors
 */

const fs   = require('fs');
const path = require('path');

const SKIP = new Set(['node_modules', '.git', '.expo', 'dist', 'build', 'android', 'ios', 'scratch']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const f = path.join(dir, e);
    if (fs.statSync(f).isDirectory()) walk(f, out);
    else if (f.endsWith('.tsx') || f.endsWith('.ts')) out.push(f);
  }
  return out;
}

const files = walk('c:/Users/j/Documents/Github/TrustFlow');
let changed = 0;

for (const filePath of files) {
  let txt = fs.readFileSync(filePath, 'utf8');
  const original = txt;

  // ── 1. Fix double braces: `){{\n  const colors` → `{\n  const colors`
  //    The script injected `{\n  const colors` but the original `{` was already there.
  //    Pattern: `) {{\r\n  const colors` or `) {{\n  const colors`
  txt = txt.replace(/(\)[ \t]*)\{\{(\r?\n[ \t]+const colors = useThemeColors\(\);)/g, '$1{$2');

  // Also fix the case where the function signature ends with `{{\r\n` without colors immediately after
  // (e.g. `function Foo() {{\n` where colors was already present elsewhere in fn body)
  txt = txt.replace(/\)\s*\{\{(\r?\n)/g, ') {$1');

  // ── 2. Remove duplicate `const colors = useThemeColors();` — keep only one per scope
  //    Find any occurrence of the line appearing twice in a row (with optional blank lines between)
  txt = txt.replace(/([ \t]*const colors = useThemeColors\(\);[ \t]*\r?\n)([ \t]*\r?\n)*([ \t]*const colors = useThemeColors\(\);[ \t]*\r?\n)/g, '$1');

  // ── 3. Fix wrong import path: @/lib/themeColors → @/hooks/useThemeColors
  txt = txt.replace(
    /import\s*\{([^}]*)\}\s*from\s*['"]@\/lib\/themeColors['"]/g,
    (match, imports) => {
      // Only keep useThemeColors from the hooks path; drop other named imports (they're separate)
      if (imports.includes('useThemeColors')) {
        return `import { useThemeColors } from '@/hooks/useThemeColors'`;
      }
      return match; // leave non-hook imports alone (getPrimaryColor etc.)
    }
  );

  // ── 4. Remove `const colors = useThemeColors();` injected into arrow helpers
  //    that are NOT React components (lowercase first letter or all-caps)
  //    Strategy: if `colors.` is never used in the function body, remove the declaration.
  //    We do a simple pass: remove lines that are `const colors = useThemeColors();`
  //    followed by no `colors.` usage before the next closing `}` at same indent level.
  //    This is complex; instead just deduplicate aggressively.

  // ── 5. Remove `const colors = useThemeColors();` injected inside non-JSX helper arrow fns
  //    e.g. `const loadData = async () => {\n  const colors = useThemeColors();`
  //    Heuristic: if the const is inside a lowercase-named arrow fn
  txt = txt.replace(
    /(const [a-z][a-zA-Z0-9_]* = (?:async\s*)?\([^)]*\)\s*(?::\s*[^=>{]+)?\s*=>\s*\{[ \t]*\r?\n)([ \t]*)const colors = useThemeColors\(\);[ \t]*\r?\n/g,
    '$1'
  );

  // Also remove from non-component function declarations (lowercase name)
  txt = txt.replace(
    /(function [a-z][a-zA-Z0-9_]*\s*\([^)]*\)[^{]*\{[ \t]*\r?\n)([ \t]*)const colors = useThemeColors\(\);[ \t]*\r?\n/g,
    '$1'
  );

  if (txt !== original) {
    fs.writeFileSync(filePath, txt, 'utf8');
    console.log('✓ Fixed:', path.relative('c:/Users/j/Documents/Github/TrustFlow', filePath));
    changed++;
  }
}

console.log(`\nDone. ${changed} file(s) repaired.`);
