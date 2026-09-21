// Totality check for ModalHost's type->component mapping —
// `npx tsx components/common/ModalHost.check.ts`.
//
// ModalHost.tsx switches on `active.type` for every ModalType. This mirrors
// that switch as a plain map so the mapping stays total: the `Record<ModalType,
// ...>` fails `tsc` if a ModalType gains no entry, and the runtime asserts
// below fail if the mirror drifts from what ModalHost actually wires.
import type { ModalType } from '../../contexts/ModalDispatchContext';
import type { CapabilityName } from '../../lib/capabilities';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Wiring = 'wired' | 'stub';

const REQUIRED_CAPABILITIES: Record<ModalType, CapabilityName> = {
  'create-task': 'task.create',
  'create-project': 'project.create',
  'generate-report': 'report.generate',
  'new-role': 'role.create',
  'create-portfolio': 'portfolio.create',
  upload: 'upload.create',
};

// Keep in lockstep with the switch in ModalHost.tsx.
const MAPPING: Record<ModalType, Wiring> = {
  'create-task': 'wired',       // <TaskCreationProvider><CreateTaskModal/>
  'create-project': 'wired',    // <ProjectFolderModal/>
  'generate-report': 'wired',   // <ReportGenerator/> (_ReportGenerator_adaptive)
  'new-role': 'wired',          // #338: <RoleEditorContainer/> (owns RoleManagerProvider)
  'create-portfolio': 'wired',  // <CreatePortfolioModal/>
  'upload': 'wired',            // #340: <UploadComposerModal/> (web + native; both use UploadManagerContext)
};

const types = Object.keys(MAPPING) as ModalType[];

console.assert(types.length === 6, `expected 6 ModalType entries, got ${types.length}`);

const wired = types.filter((t) => MAPPING[t] === 'wired');
console.assert(
  wired.length === 6,
  `expected 6 wired modals, got ${wired.length}: ${wired.join(', ')}`,
);

for (const t of types) {
  console.assert(
    MAPPING[t] === 'wired' || MAPPING[t] === 'stub',
    `ModalType ${t} has no wiring decision`,
  );
}

const hostSource = readFileSync(join(process.cwd(), 'components/common/ModalHost.tsx'), 'utf8');
const capabilityMap = hostSource.match(/const MODAL_CAPABILITIES: Record<ModalType, CapabilityName> = \{([\s\S]*?)\n\};/)?.[1];
assert.ok(capabilityMap, 'ModalHost must declare a total ModalType->CapabilityName map');
for (const [type, capability] of Object.entries(REQUIRED_CAPABILITIES)) {
  assert.ok(
    new RegExp(`['"]?${type}['"]?:\\s*['"]${capability}['"]`).test(capabilityMap ?? ''),
    `${type} must map to ${capability}`,
  );
}
assert.ok(
  /useCapabilities\(Object\.values\(MODAL_CAPABILITIES\)\)/.test(hostSource),
  'ModalHost must evaluate all mapped capabilities through one useCapabilities call',
);
assert.ok(
  /capabilities\[MODAL_CAPABILITIES\[active\.type\]\]/.test(hostSource),
  'active modal authorization must use its mapped capability',
);
assert.ok(
  /if \(!decision\s*\|\|\s*decision\.loading\s*\|\|\s*decision\.allowed !== true\) return null/.test(hostSource),
  'ModalHost must fail closed for missing, loading, or denied decisions',
);
assert.ok(
  /if \(active && decision && !decision\.loading && decision\.allowed !== true\) \{\s*dismiss\(\)/.test(hostSource),
  'ModalHost must dismiss an active modal after a loaded denial',
);
console.assert(/initialFiles=\{active\.payload\.initialFiles\}/.test(hostSource), 'upload initialFiles seed not forwarded');
console.assert(/activeGroup=\{active\.payload\.activeGroup\}/.test(hostSource), 'upload activeGroup seed not forwarded');

console.log('ModalHost.check: ok', MAPPING);
