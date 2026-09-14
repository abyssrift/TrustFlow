import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const source = readFileSync(join(process.cwd(), 'components/filehub/explorer/ExplorerInspectorShell.tsx'), 'utf8');

for (const pattern of [
  /(?:from|import)\s+['"`]@?[^'"`]*(?:supabase|contexts?)[^'"`]*['"`]/i,
  /(?:from|import)\s+['"`]@?[^'"`]*(?:permission|authorization|router|storage|upload|rpc)[^'"`]*['"`]/i,
  /(?:from|import)\s+['"`]@?[^'"`]*(?:normalize|normalization|viewer|preview|filehub|project)[^'"`]*['"`]/i,
]) {
  assert.doesNotMatch(source, pattern, `presentation shell has a forbidden domain import: ${pattern}`);
}

assert.doesNotMatch(source, /useFileViewer|FilePreview|Supabase|FileHub|ProjectRecord/i, 'presentation shell must not depend on domain viewer or record types');
assert.match(source, /mobilePane:\s*'collection'\s*\|\s*'inspector'/, 'mobile pane must remain controlled');
assert.match(source, /onRequestCollection:\s*\(\)\s*=>\s*void/, 'back affordance callback must remain generic');

console.log('ExplorerInspectorShell.check: ok');
