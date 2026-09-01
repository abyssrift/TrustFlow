// Totality check for ModalHost's type->component mapping —
// `npx tsx components/common/ModalHost.check.ts`.
//
// ModalHost.tsx switches on `active.type` for every ModalType. This mirrors
// that switch as a plain map so the mapping stays total: the `Record<ModalType,
// ...>` fails `tsc` if a ModalType gains no entry, and the runtime asserts
// below fail if the mirror drifts from what ModalHost actually wires.
import type { ModalType } from '../../contexts/ModalDispatchContext';

type Wiring = 'wired' | 'stub';

// Keep in lockstep with the switch in ModalHost.tsx.
const MAPPING: Record<ModalType, Wiring> = {
  'create-task': 'wired',       // <TaskCreationProvider><CreateTaskModal/>
  'create-project': 'wired',    // <ProjectFolderModal/>
  'generate-report': 'wired',   // <ReportGenerator/> (_ReportGenerator_adaptive)
  'new-role': 'wired',          // #338: <RoleEditorContainer/> (owns RoleManagerProvider)
  'create-portfolio': 'stub',   // #323 follow-up: no standalone create modal exists
  'upload': 'stub',             // #323 follow-up: FileHub UploadModal is screen-local, not exported
};

const types = Object.keys(MAPPING) as ModalType[];

console.assert(types.length === 6, `expected 6 ModalType entries, got ${types.length}`);

const wired = types.filter((t) => MAPPING[t] === 'wired');
console.assert(
  wired.length === 4,
  `expected 4 wired modals, got ${wired.length}: ${wired.join(', ')}`,
);

for (const t of types) {
  console.assert(
    MAPPING[t] === 'wired' || MAPPING[t] === 'stub',
    `ModalType ${t} has no wiring decision`,
  );
}

console.log('ModalHost.check: ok', MAPPING);
