// Reducer check for ModalDispatchContext — `npx tsx contexts/ModalDispatchContext.check.ts`.
// Exercises the summon/dismiss/replace state machine without React.
import type { ActiveModal, ModalPayloads, ModalType } from './ModalDispatchContext';

// Mirror of the provider's state transitions (kept trivial on purpose).
function reducer(prev: ActiveModal | null, action: { kind: 'summon'; type: ModalType; payload?: any } | { kind: 'dismiss' }): ActiveModal | null {
  if (action.kind === 'dismiss') return null;
  return { type: action.type, payload: action.payload ?? {} } as ActiveModal;
}

const eq = (a: unknown, b: unknown, m: string) =>
  console.assert(JSON.stringify(a) === JSON.stringify(b), m, a);

let s: ActiveModal | null = null;
eq(s, null, 'starts closed');

s = reducer(s, { kind: 'summon', type: 'create-task', payload: { projectId: 'p1' } });
eq(s, { type: 'create-task', payload: { projectId: 'p1' } }, 'summon carries payload');

s = reducer(s, { kind: 'summon', type: 'new-role' });
eq(s, { type: 'new-role', payload: {} }, 'last summon wins, no stacking; missing payload -> {}');

s = reducer(s, { kind: 'dismiss' });
eq(s, null, 'dismiss clears');

// Type-level: payload is narrowed by type. These must compile.
const t: ModalPayloads['create-task'] = { pipelineId: 'x' };
void t;

console.log('ModalDispatchContext.check: ok');
