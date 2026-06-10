/**
 * fix_bad_imports.js
 *
 * The ensureImport() function in fix_add_hook.js found "the last line starting
 * with `import`" and inserted the useThemeColors import AFTER it. But when that
 * last `import` line was the opening of a multi-line import block like:
 *
 *   import {        ← last line starting with "import "
 *     ActivityIndicator,   ← ensureImport inserted BEFORE this
 *     ...
 *   } from 'react-native';
 *
 * This script finds and removes the misplaced import line, then re-inserts it
 * correctly after the full import block closes.
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

const HOOK_IMPORT = "import { useThemeColors } from '@/hooks/useThemeColors';";

function fixFile(txt) {
  const lines = txt.split('\n');
  const badLines = []; // indices of misplaced hook imports

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("from '@/hooks/useThemeColors'") &&
        !lines[i].includes('from "@/hooks/useThemeColors"')) continue;

    // Check if this is a bad placement: previous non-empty line doesn't end
    // a valid import statement (no ;, no closing quote of a from clause)
    let prev = '';
    for (let j = i - 1; j >= 0; j--) {
      if (lines[j].trim() !== '') { prev = lines[j].trim(); break; }
    }

    // A correctly placed import has a previous line that ends with ; or ' or "
    // or is another import statement, or is empty/comment
    const goodPrev = prev === '' ||
                     prev.endsWith(';') ||
                     prev.endsWith("'") ||
                     prev.endsWith('"') ||
                     prev.startsWith('//') ||
                     prev.startsWith('/*') ||
                     prev.startsWith('*');

    if (!goodPrev) {
      badLines.push(i);
    }
  }

  if (badLines.length === 0) return txt;

  // Remove bad import lines
  const filtered = lines.filter((_, i) => !badLines.includes(i));

  // Now find the correct insertion point: after the last complete import block
  // A complete import block ends with a line matching: `} from '...';` or `import ... from '...';`
  let lastImportEnd = -1;
  let insideMultiLine = false;

  for (let i = 0; i < filtered.length; i++) {
    const t = filtered[i].trim();
    if (t.startsWith('import ')) {
      if (t.includes(' from ') && t.endsWith(';')) {
        // Single-line import
        lastImportEnd = i;
      } else if (t.endsWith('{') || t === 'import {') {
        // Start of multi-line import
        insideMultiLine = true;
      }
    } else if (insideMultiLine && t.startsWith('} from ') && t.endsWith(';')) {
      // End of multi-line import
      lastImportEnd = i;
      insideMultiLine = false;
    } else if (!insideMultiLine && lastImportEnd >= 0 && t !== '' && !t.startsWith('//')) {
      // We've left the import block
      break;
    }
  }

  if (lastImportEnd === -1) {
    filtered.unshift(HOOK_IMPORT);
  } else {
    filtered.splice(lastImportEnd + 1, 0, HOOK_IMPORT);
  }

  return filtered.join('\n');
}

const ROOT  = 'c:/Users/j/Documents/Github/TrustFlow';
const files = walk(ROOT);
let fixed = 0;

for (const filePath of files) {
  const txt = fs.readFileSync(filePath, 'utf8');
  if (!txt.includes("from '@/hooks/useThemeColors'") &&
      !txt.includes('from "@/hooks/useThemeColors"')) continue;

  const result = fixFile(txt);
  if (result !== txt) {
    fs.writeFileSync(filePath, result, 'utf8');
    console.log('✓ Fixed:', path.relative(ROOT, filePath));
    fixed++;
  }
}

console.log(`\nDone. ${fixed} file(s) repaired.`);
