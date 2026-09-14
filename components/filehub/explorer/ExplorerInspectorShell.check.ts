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
assert.doesNotMatch(source, /style=/, 'inspector sizing must use class-based styling');
assert.doesNotMatch(source, /w-\[\$\{inspectorWidth\}px\]/, 'inspector width must not be dynamically interpolated');
assert.match(source, /INSPECTOR_WIDTH_CLASSES/, 'supported inspector widths must use an explicit class map');
assert.match(source, /FALLBACK_INSPECTOR_WIDTH_CLASS = 'w-96'/, 'unsupported inspector widths need a safe static fallback');
assert.match(source, /max-w-full/, 'inspector width must be bounded to its parent');
assert.match(source, /flex-shrink-0/, 'inspector pane must not shrink below its requested width');
assert.match(source, /<Text[^>]*>←<\/Text>/, 'mobile back affordance must render a recognizable arrow');
assert.match(source, /mobilePane:\s*'collection'\s*\|\s*'inspector'/, 'mobile pane must remain controlled');
assert.match(source, /onRequestCollection:\s*\(\)\s*=>\s*void/, 'back affordance callback must remain generic');

console.log('ExplorerInspectorShell.check: ok');
