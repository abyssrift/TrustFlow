/**
 * fix_add_hook.js
 *
 * For each file in the "needs manual" list:
 * 1. Adds `import { useThemeColors } from '@/hooks/useThemeColors';` if missing
 * 2. Inserts `const colors = useThemeColors();` as the FIRST line inside each
 *    React component body (uppercase-named function or const arrow).
 * 3. Then runs the var(--) → colors.X substitutions.
 * 4. Deduplicates any existing `const colors` declarations.
 *
 * SAFE INJECTION RULE:
 * - We find the exact line that opens a component body: ends with `) {` or `) => {`
 * - We insert on the very next line ONLY if `const colors` is not already within
 *   the next 3 lines (prevents double-injection).
 * - We NEVER use regex on multi-line spans to avoid mis-matching nested functions.
 */

const fs   = require('fs');
const path = require('path');

// ─── FILES TO PROCESS ────────────────────────────────────────────────────────
const ROOT  = 'c:/Users/j/Documents/Github/TrustFlow';

const TARGETS = [
  'app/(auth)/login.web.tsx',
  'app/(auth)/sign-up.web.tsx',
  'app/admin/notifications.web.tsx',
  'app/admin/pipelines.web.tsx',
  'app/admin/roles.web.tsx',
  'app/modal.web.tsx',
  'app/notifications/preferences.tsx',
  'app/notifications/preferences.web.tsx',
  'app/onboarding.web.tsx',
  'app/platform-admin/index.tsx',
  'app/platform-admin/index.web.tsx',
  'components/analytics/PerformanceChart.web.tsx',
  'components/analytics/ProfileAnalytics.tsx',
  'components/analytics/TimerDeliverabilityChart.web.tsx',
  'components/common/ConfirmModal.tsx',
  'components/intelligence/IntelligenceSections.tsx',
  'components/intelligence/RadarWidgets.tsx',
  'components/intelligence/ReportFiltersModal.tsx',
  'components/intelligence/_analytics_desktop.tsx',
  'components/intelligence/_archives_desktop.tsx',
  'components/intelligence/_filehub_desktop.tsx',
  'components/intelligence/_graphs_desktop.tsx',
  'components/intelligence/_index_adaptive.tsx',
  'components/intelligence/_index_desktop.tsx',
  'components/intelligence/_ReportGenerator_desktop.tsx',
  'components/intelligence/_reports_desktop.tsx',
  'components/intelligence/_targets_desktop.tsx',
  'components/kanban/KanbanPersonalizer.tsx',
  'components/pipeline-editor/graph/ConnectionLines.tsx',
  'components/pipeline-editor/graph/GraphCanvas.tsx',
  'components/pipeline-editor/graph/StageNode.tsx',
  'components/pipeline-editor/StageBuilder.web.tsx',
  'components/profile/ProfileAvatar.tsx',
  'components/profile/ProfileGeneralForm.tsx',
  'components/profile/SecurityForm.tsx',
  'components/Sidebar.web.tsx',
  'components/tabs/_analytics_adaptive.tsx',
  'components/tabs/_analytics_desktop.tsx',
  'components/tabs/_index_desktop.tsx',
  'components/tabs/_people_adaptive.tsx',
  'components/tabs/_people_desktop.tsx',
  'components/tabs/_profile_adaptive.tsx',
  'components/tabs/_profile_desktop.tsx',
  'components/tabs/_projects_desktop.tsx',
  'components/tabs/_tasks_desktop.tsx',
  'components/task-detail/EditTaskModal.tsx',
  'components/task-detail/StageActions.tsx',
  'components/tasks/AssignmentModal.web.tsx',
  'components/tasks/CreateTaskModal.web.tsx',
  'components/tasks/CreateTaskSheet.tsx',
];

// ─── VAR MAP ─────────────────────────────────────────────────────────────────
const VAR_MAP = [
  ['--color-primary',           'primary'],
  ['--brand-primary',           'primary'],
  ['--color-secondary',         'secondary'],
  ['--color-accent',            'accent'],
  ['--brand-accent',            'accent'],
  ['--color-text-main',         'textMain'],
  ['--text-main',               'textMain'],
  ['--color-text-muted',        'textMuted'],
  ['--text-muted',              'textMuted'],
  ['--color-text-dim',          'textDim'],
  ['--text-dim',                'textDim'],
  ['--color-success',           'success'],
  ['--state-success',           'success'],
  ['--color-danger',            'danger'],
  ['--state-danger',            'danger'],
  ['--color-warning',           'warning'],
  ['--state-warning',           'warning'],
  ['--color-info',              'info'],
  ['--state-info',              'info'],
  ['--color-border',            'border'],
  ['--surface-border',          'border'],
  ['--color-surface-border',    'border'],
  ['--color-background',        'background'],
  ['--color-card',              'card'],
  ['--surface-card',            'card'],
  ['--color-surface-card',      'card'],
  ['--surface-overlay',         'card'],
  ['--color-surface-overlay',   'card'],
  ['--color-surface-background','background'],
  ['--color-brand-primary',     'primary'],
  ['--color-success-dim',       'success__dim'],
  ['--color-danger-dim',        'danger__dim'],
  ['--color-warning-dim',       'warning__dim'],
  ['--color-primary-dim',       'primary__dim'],
];

const DIM_BASE  = { 'success__dim':'success', 'danger__dim':'danger', 'warning__dim':'warning', 'primary__dim':'primary' };
const DIM_ALPHA = '26';

function alphaHex(op) {
  return Math.round(parseFloat(op) * 255).toString(16).padStart(2, '0');
}
function resolveExpr(prop, hex) {
  if (prop.endsWith('__dim')) return `(colors.${DIM_BASE[prop]} + '${hex || DIM_ALPHA}')`;
  if (hex) return `(colors.${prop} + '${hex}')`;
  return `colors.${prop}`;
}

function applyReplacements(txt) {
  for (const [cssVar, prop] of VAR_MAP) {
    const e = cssVar.replace(/-/g, '\\-');
    txt = txt.replace(new RegExp(`([a-zA-Z]+)="rgba\\(var\\(${e}\\),\\s*([0-9.]+)\\)"`, 'g'), (_, a, op) => `${a}={${resolveExpr(prop, alphaHex(op))}}`);
    txt = txt.replace(new RegExp(`([a-zA-Z]+)="rgb\\(var\\(${e}\\)\\)"`,                 'g'), `$1={${resolveExpr(prop)}}`);
    txt = txt.replace(new RegExp(`([a-zA-Z]+)="var\\(${e}\\)"`,                          'g'), `$1={${resolveExpr(prop)}}`);
    txt = txt.replace(new RegExp(`'rgba\\(var\\(${e}\\),\\s*([0-9.]+)\\)'`,              'g'), (_, op) => resolveExpr(prop, alphaHex(op)));
    txt = txt.replace(new RegExp(`"rgba\\(var\\(${e}\\),\\s*([0-9.]+)\\)"`,              'g'), (_, op) => resolveExpr(prop, alphaHex(op)));
    txt = txt.replace(new RegExp(`'rgb\\(var\\(${e}\\)\\)'`,                             'g'), resolveExpr(prop));
    txt = txt.replace(new RegExp(`"rgb\\(var\\(${e}\\)\\)"`,                             'g'), resolveExpr(prop));
    txt = txt.replace(new RegExp(`'var\\(${e}\\)'`,                                      'g'), resolveExpr(prop));
    txt = txt.replace(new RegExp(`"var\\(${e}\\)"`,                                      'g'), resolveExpr(prop));
  }
  return txt;
}

// ─── HOOK INJECTION (line-by-line, surgical) ──────────────────────────────────
// A line is considered a component-opening line if:
//   - It matches a component function/arrow declaration pattern
//   - i.e. starts with `export default function Foo(` or `function Foo(` or
//     `const Foo = (` or `export function Foo(`  (uppercase F)
// We then insert `  const colors = useThemeColors();` on the very next line,
// UNLESS that line (or the one after) already contains `const colors`.
const COMPONENT_OPEN_RE = /^(?:export\s+(?:default\s+)?)?(?:function\s+[A-Z]|const\s+[A-Z])[a-zA-Z0-9_]*\s*(?:<[^>]*>)?\s*[=(]/;

function injectColorsDecl(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);

    if (!COMPONENT_OPEN_RE.test(line.trim())) continue;

    // Find the opening `{` — it might be on this line or one of the next few
    let braceLineIdx = -1;
    for (let j = i; j < Math.min(i + 10, lines.length); j++) {
      // Look for a line that ends with `{` (the component body open)
      if (/\{\s*$/.test(lines[j])) {
        braceLineIdx = j;
        break;
      }
    }
    if (braceLineIdx === -1) continue;

    // If the brace was on a future line, push the intervening lines
    for (let j = i + 1; j <= braceLineIdx; j++) {
      out.push(lines[j]);
    }
    i = braceLineIdx;

    // Check if const colors is already present in the next 5 lines
    const lookAhead = lines.slice(i + 1, i + 6).join('\n');
    if (lookAhead.includes('const colors')) continue;

    // Determine indentation from the brace line
    const indent = (lines[braceLineIdx].match(/^(\s*)/) || ['', '  '])[1] + '  ';
    out.push(`${indent}const colors = useThemeColors();`);
  }
  return out;
}

// ─── IMPORT INJECTION ────────────────────────────────────────────────────────
const HOOK_IMPORT = `import { useThemeColors } from '@/hooks/useThemeColors';`;

function ensureImport(txt) {
  if (txt.includes("from '@/hooks/useThemeColors'") || txt.includes('from "@/hooks/useThemeColors"')) {
    return txt;
  }
  // Remove wrong import path if present
  txt = txt.replace(/^import\s+\{[^}]*useThemeColors[^}]*\}\s+from\s+['"]@\/lib\/themeColors['"];?\r?\n/m, '');

  // Insert after the last import block
  const lines = txt.split('\n');
  let lastImportLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('import ')) lastImportLine = i;
  }
  if (lastImportLine !== -1) {
    lines.splice(lastImportLine + 1, 0, HOOK_IMPORT);
    return lines.join('\n');
  }
  return HOOK_IMPORT + '\n' + txt;
}

// ─── DEDUPLICATE const colors ─────────────────────────────────────────────────
function dedup(txt) {
  return txt.replace(
    /([ \t]*const colors = useThemeColors\(\);[ \t]*\r?\n)((?:[ \t]*\r?\n)*)([ \t]*const colors = useThemeColors\(\);[ \t]*\r?\n)/g,
    '$1'
  );
}

// ─── PROCESS ─────────────────────────────────────────────────────────────────
let fixed = 0;

for (const rel of TARGETS) {
  const filePath = path.join(ROOT, rel.replace(/\//g, path.sep));
  if (!fs.existsSync(filePath)) {
    console.log('⚠  Not found:', rel);
    continue;
  }

  let txt = fs.readFileSync(filePath, 'utf8');
  const original = txt;

  // 1. Fix import
  txt = ensureImport(txt);

  // 2. Inject `const colors` at component openings
  const eol = txt.includes('\r\n') ? '\r\n' : '\n';
  let lines = txt.split(/\r?\n/);
  lines = injectColorsDecl(lines);
  txt = lines.join(eol);

  // 3. Deduplicate
  txt = dedup(txt);

  // 4. Replace all var(--) usages
  txt = applyReplacements(txt);

  if (txt !== original) {
    fs.writeFileSync(filePath, txt, 'utf8');
    console.log('✓', rel);
    fixed++;
  } else {
    console.log('–  (no changes)', rel);
  }
}

console.log(`\nDone. ${fixed} / ${TARGETS.length} file(s) updated.`);
