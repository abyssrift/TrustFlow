// Self-check for mapModalQueryParams — the pure query-param -> ModalType +
// payload mapper behind hooks/useModalQueryParam.ts (#324). Framework-free.
//   npx tsx hooks/useModalQueryParam.check.ts
//
// useModalQueryParam.ts imports expo-router (which pulls in react-native's
// flow syntax that esbuild/tsx can't parse); the pure fn under test touches
// none of it, so stub that bare module before requiring the file. Same
// _mod._load shim as hooks/useWebDnd.smartpaste.check.ts. Kept as plain
// statements + require() so esbuild doesn't hoist the import above the stub.
const _mod = require('node:module');
const _load = _mod._load;
_mod._load = (req: string, ...rest: any[]) =>
  req === 'expo-router'
    ? { useGlobalSearchParams: () => ({}), useRouter: () => ({ setParams: () => {} }) }
    : req === 'react-native'
    ? { Platform: { OS: 'test' } }
    : _load(req, ...rest);

import assert from 'node:assert';
const { mapModalQueryParams } = require('./useModalQueryParam') as typeof import('./useModalQueryParam');

// 1. task + projectId -> create-task carrying that seed
assert.deepStrictEqual(
  mapModalQueryParams({ new: '1', type: 'task', projectId: 'x' }),
  { type: 'create-task', payload: { projectId: 'x' } },
  'task + projectId should build a create-task payload',
);

// 2. unwired type -> null (silently ignored, see #323)
assert.strictEqual(
  mapModalQueryParams({ new: '1', type: 'portfolio' }),
  null,
  'portfolio is unwired -> null',
);

// 3. report -> generate-report with an empty payload
assert.deepStrictEqual(
  mapModalQueryParams({ new: '1', type: 'report' }),
  { type: 'generate-report', payload: {} },
  'report should map to generate-report',
);

// 3b. role -> new-role (wired in #338), empty payload, NOT falling through to report
assert.deepStrictEqual(
  mapModalQueryParams({ new: '1', type: 'role' }),
  { type: 'new-role', payload: {} },
  'role should map to new-role',
);

// 3c. upload + folderId -> upload carrying that seed (wired in #340)
assert.deepStrictEqual(
  mapModalQueryParams({ new: '1', type: 'upload', folderId: 'f1' }),
  { type: 'upload', payload: { folderId: 'f1' } },
  'upload + folderId should build an upload payload',
);

// 4. missing `new` -> null even with an otherwise-valid type
assert.strictEqual(
  mapModalQueryParams({ type: 'task' }),
  null,
  'no `new` param means no summon',
);

// 5. array-valued params (expo-router can hand back string[]) + pipelineId seed
assert.deepStrictEqual(
  mapModalQueryParams({ new: ['1'], type: ['task'], pipelineId: ['p1'] }),
  { type: 'create-task', payload: { pipelineId: 'p1' } },
  'array-valued params should normalise to their first value',
);

// 6. project + portfolioId -> create-project
assert.deepStrictEqual(
  mapModalQueryParams({ new: '1', type: 'project', portfolioId: 'abc' }),
  { type: 'create-project', payload: { portfolioId: 'abc' } },
  'project + portfolioId should build a create-project payload',
);

// 7. unrecognised type string -> null
assert.strictEqual(
  mapModalQueryParams({ new: '1', type: 'banana' }),
  null,
  'nonsense type -> null',
);

console.log('useModalQueryParam.check.ts: all assertions passed');
