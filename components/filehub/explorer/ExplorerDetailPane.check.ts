import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'components/filehub/explorer/ExplorerDetailPane.tsx'), 'utf8');

assert.match(source, /const canView = capabilities\?\.canView === true/);
assert.match(source, /\{canView && <View className="flex-row flex-wrap gap-2 border-b border-surface-border p-4">/,
  'custom detail actions must be gated by the shared view capability');

console.log('ExplorerDetailPane: source checks passed');
