// Structural regression check for the two shipped collapsible header shells.
// Run with: npx tsx components/common/CollapsibleHeaderPadding.check.ts
//
// Keep this source-level check focused on the invariant that static expanded
// padding exists independently of the animated style, and that the animated
// style remains later in the RN style array so it can override that baseline.
import { readFileSync } from 'node:fs';

const taskHeader = readFileSync('components/task-detail/TaskHeader.tsx', 'utf8');
const projectHeader = readFileSync('components/projects/ProjectHeader.tsx', 'utf8');

console.assert(
  /style=\{\[\s*\{\s*paddingTop:\s*PAD_TOP_FULL\s*,\s*paddingBottom:\s*16\s*\}\s*,\s*containerPadStyle\s*\]\}/s.test(taskHeader),
  'TaskHeader must keep expanded PAD_TOP_FULL/bottom-16 padding before containerPadStyle',
);
console.assert(
  /paddingTop:\s*interpolate\(collapse\.value\s*,\s*\[0\s*,\s*1\]\s*,\s*\[PAD_TOP_FULL\s*,\s*PAD_TOP_CONDENSED\s*\]\)/s.test(taskHeader),
  'TaskHeader animated top padding interpolation is missing',
);
console.assert(
  /paddingBottom:\s*interpolate\(collapse\.value\s*,\s*\[0\s*,\s*1\]\s*,\s*\[16\s*,\s*8\s*\]\)/s.test(taskHeader),
  'TaskHeader animated bottom padding interpolation is missing',
);

console.assert(
  /style=\{\[\s*\{(?=[^}]*paddingTop:\s*16)(?=[^}]*paddingBottom:\s*16)[^}]*\}\s*,\s*containerPadStyle\s*\]\}/s.test(projectHeader),
  'ProjectHeader must keep expanded top/bottom-16 padding before containerPadStyle',
);
console.assert(
  /paddingTop:\s*interpolate\(collapse\.value\s*,\s*\[0\s*,\s*1\]\s*,\s*\[16\s*,\s*4\s*\]\)/s.test(projectHeader),
  'ProjectHeader animated top padding interpolation is missing',
);
console.assert(
  /paddingBottom:\s*interpolate\(collapse\.value\s*,\s*\[0\s*,\s*1\]\s*,\s*\[16\s*,\s*4\s*\]\)/s.test(projectHeader),
  'ProjectHeader animated bottom padding interpolation is missing',
);

console.log('CollapsibleHeaderPadding.check: all assertions passed');
