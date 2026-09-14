import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const types = readFileSync(join(root, 'components/filehub/explorer/ExplorerTypes.ts'), 'utf8');
const collection = readFileSync(join(root, 'components/filehub/explorer/ExplorerCollection.tsx'), 'utf8');

assert.match(types, /import type \{ MultiViewListProps \} from ['"]@\/components\/common\/MultiViewList['"];?/);
assert.match(types, /export type ExplorerCollectionProps<T> = MultiViewListProps<T>;/);
assert.doesNotMatch(types, /ExplorerCollectionProps<T>\s*=\s*\{/);

for (const forbidden of [
  'supabase',
  'FileHubContext',
  'permission',
  'router',
  'upload manager',
  'UploadManager',
  'projectFileHubNormalization',
  'ProjectFile',
  'FileHubFile',
]) {
  assert.doesNotMatch(`${types}\n${collection}`, new RegExp(`import[^\n]*${forbidden}`, 'i'));
}

assert.match(collection, /return <MultiViewList \{\.\.\.props\} \/>;/);
assert.doesNotMatch(collection, /use[A-Z]|rpc\(|supabase|storage|permission|router|upload/i);

console.log('ExplorerCollection.check: ok');
