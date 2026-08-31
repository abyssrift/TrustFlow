// Self-check for nextDragDepth: the window-level OS-file-drag counter behind
// useIsFileDragActive. dragenter/dragleave fire per element boundary so they
// must balance back to 0; drop/dragend must hard-reset. Framework-free —
// run with: npx tsx hooks/useWebDnd.dragactive.check.ts
//
// useWebDnd.ts imports react-native + react-native-reanimated (flow syntax
// tsx can't parse); stub both before requiring it. Kept as plain statements +
// require() so esbuild doesn't hoist the import above the stub.
// ponytail: minimal shim; the pure helper under test touches neither module.
const _mod = require('node:module');
const _load = _mod._load;
_mod._load = (req: string, ...rest: any[]) =>
  req === 'react-native'
    ? { Platform: { OS: 'test' }, Animated: {}, Easing: {} }
    : req === 'react-native-reanimated'
    ? { useReducedMotion: () => false }
    : _load(req, ...rest);

import assert from 'node:assert';
const { nextDragDepth } = require('./useWebDnd') as typeof import('./useWebDnd');

// enter / enter / leave / leave → back to inactive (depth 0).
let d = 0;
d = nextDragDepth(d, 'enter'); assert.strictEqual(d, 1, 'first dragenter → depth 1 (active)');
d = nextDragDepth(d, 'enter'); assert.strictEqual(d, 2, 'nested dragenter → depth 2 (still active)');
d = nextDragDepth(d, 'leave'); assert.strictEqual(d, 1, 'one dragleave → depth 1 (still active)');
d = nextDragDepth(d, 'leave'); assert.strictEqual(d, 0, 'balanced dragleave → depth 0 (inactive)');

// A stray dragleave with no matching enter can't drive the counter negative.
assert.strictEqual(nextDragDepth(0, 'leave'), 0, 'dragleave floors at 0');

// drop / dragend hard-reset from any depth (drag left the window mid-flight).
assert.strictEqual(nextDragDepth(3, 'reset'), 0, 'drop/dragend resets to 0');

// active = depth > 0 — sanity on the boundary the store reads.
assert.strictEqual(nextDragDepth(0, 'enter') > 0, true, 'one enter is active');
assert.strictEqual(nextDragDepth(1, 'leave') > 0, false, 'last leave is inactive');

console.log('nextDragDepth self-check passed');
