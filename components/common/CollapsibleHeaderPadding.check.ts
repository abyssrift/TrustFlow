// Structural regression check for the two shipped collapsible header shells.
// Run with: npx tsx components/common/CollapsibleHeaderPadding.check.ts
//
// Keep this source-level check focused on the invariant that static expanded
// padding exists independently of the animated style, and that the animated
// style remains later in the RN style array so it can override that baseline.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const taskHeader = readFileSync('components/task-detail/TaskHeader.tsx', 'utf8');
const projectHeader = readFileSync('components/projects/ProjectHeader.tsx', 'utf8');

assert.match(
  taskHeader,
  /style=\{\[\s*\{\s*paddingTop:\s*PAD_TOP_FULL\s*,\s*paddingBottom:\s*16\s*\}\s*,\s*containerPadStyle\s*\]\}/s,
  'TaskHeader must keep expanded PAD_TOP_FULL/bottom-16 padding before containerPadStyle',
);
assert.match(
  taskHeader,
  /paddingTop:\s*interpolate\(collapse\.value\s*,\s*\[0\s*,\s*1\]\s*,\s*\[PAD_TOP_FULL\s*,\s*PAD_TOP_CONDENSED\s*\]\)/s,
  'TaskHeader animated top padding interpolation is missing',
);
assert.match(
  taskHeader,
  /paddingBottom:\s*interpolate\(collapse\.value\s*,\s*\[0\s*,\s*1\]\s*,\s*\[16\s*,\s*8\s*\]\)/s,
  'TaskHeader animated bottom padding interpolation is missing',
);

assert.match(
  projectHeader,
  /style=\{\[\s*\{(?=[^}]*paddingTop:\s*16)(?=[^}]*paddingBottom:\s*16)[^}]*\}\s*,\s*containerPadStyle\s*\]\}/s,
  'ProjectHeader must keep expanded top/bottom-16 padding before containerPadStyle',
);
assert.match(
  projectHeader,
  /paddingTop:\s*interpolate\(collapse\.value\s*,\s*\[0\s*,\s*1\]\s*,\s*\[16\s*,\s*4\s*\]\)/s,
  'ProjectHeader animated top padding interpolation is missing',
);
assert.match(
  projectHeader,
  /paddingBottom:\s*interpolate\(collapse\.value\s*,\s*\[0\s*,\s*1\]\s*,\s*\[16\s*,\s*4\s*\]\)/s,
  'ProjectHeader animated bottom padding interpolation is missing',
);

console.log('CollapsibleHeaderPadding.check: all assertions passed');
