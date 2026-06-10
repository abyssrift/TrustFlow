/**
 * fix_param_injection.js
 *
 * The fix_add_hook.js script incorrectly injected `const colors = useThemeColors();`
 * inside destructured parameter objects, like:
 *
 *   const Foo = ({
 *     const colors = useThemeColors();  ← WRONG, this is inside params
 *     prop1,
 *     prop2,
 *   }) => { ... }
 *
 * This script removes those bad injections from param lists.
 * It works line-by-line: if `const colors = useThemeColors();` appears on a line
 * that is INSIDE a parameter destructure (i.e., not preceded by a line ending 
 * with `) {` or `=> {`), it removes it.
 *
 * Detection: we track whether we're inside a parameter list by counting 
 * unmatched `(` vs `)` brackets from the start of each component declaration.
 */

const fs   = require('fs');
const path = require('path');

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

function fixFile(txt) {
  const lines = txt.split('\n');
  const out   = [];
  let parenDepth = 0; // track ( ) depth
  let braceDepth = 0; // track { } depth — but only top-level component braces

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Count parens on this line (rough — ignores strings/comments but good enough)
    for (const ch of line) {
      if (ch === '(') parenDepth++;
      if (ch === ')') parenDepth--;
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
    }

    // If this line IS the bad injection AND we're inside a paren scope
    // (meaning we're in a parameter list, not a function body)
    const isColorsLine = /^\s*const colors = useThemeColors\(\);\s*$/.test(line);

    if (isColorsLine) {
      // Look at what the PREVIOUS non-empty line looks like
      let prevLine = '';
      for (let j = i - 1; j >= 0; j--) {
        if (lines[j].trim() !== '') { prevLine = lines[j]; break; }
      }

      // Bad injection signatures:
      // - Previous line ends with `({`  (opening destructured params)
      // - Previous line ends with a comma (we're inside a param list)
      // - Previous line ends with `{` but we came from a `= ({` pattern
      const prevTrimmed = prevLine.trim();
      const prevEndsWithOpenParam = prevTrimmed.endsWith('({');
      const prevEndsWithComma     = prevTrimmed.endsWith(',');
      const prevIsTypeAnnotation  = prevTrimmed.startsWith('}: {') || prevTrimmed === '}: {';

      // Check if next non-empty line is a parameter (identifier followed by comma or ?,)
      let nextLine = '';
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() !== '') { nextLine = lines[j]; break; }
      }
      const nextTrimmed = nextLine.trim();
      // A parameter line looks like: `propName,` or `propName?: ...` or `...rest`
      const nextLooksLikeParam = /^[a-zA-Z_][a-zA-Z0-9_?]*[,:]/.test(nextTrimmed) ||
                                  nextTrimmed.startsWith('...') ||
                                  nextTrimmed.startsWith('}: {') ||
                                  (nextTrimmed.endsWith(',') && !nextTrimmed.includes('=>') && !nextTrimmed.includes('const '));

      if (prevEndsWithOpenParam || prevEndsWithComma || (nextLooksLikeParam && !prevTrimmed.endsWith(') {'))) {
        // This is a bad injection — skip it
        // Also skip the blank line that might have been inserted with it
        console.log(`  Removed bad injection at line ${i + 1}`);
        continue;
      }
    }

    out.push(line);
  }

  return out.join('\n');
}

const ROOT  = 'c:/Users/j/Documents/Github/TrustFlow';
const files = walk(ROOT);
let fixed = 0;

for (const filePath of files) {
  const txt = fs.readFileSync(filePath, 'utf8');

  // Quick check: does this file even have the bad pattern?
  // Bad pattern: `({` on a line, followed within a few lines by `const colors = useThemeColors`
  // before a `) => {` or `) {`
  if (!txt.includes('const colors = useThemeColors()')) continue;

  const fixed_txt = fixFile(txt);

  if (fixed_txt !== txt) {
    fs.writeFileSync(filePath, fixed_txt, 'utf8');
    console.log('✓ Fixed:', path.relative(ROOT, filePath));
    fixed++;
  }
}

console.log(`\nDone. ${fixed} file(s) repaired.`);
