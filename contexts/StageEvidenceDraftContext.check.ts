import assert from 'node:assert/strict';
import fs from 'node:fs';

const web = fs.readFileSync('contexts/StageEvidenceDraftContext.web.tsx', 'utf8');
const native = fs.readFileSync('contexts/StageEvidenceDraftContext.tsx', 'utf8');
const layout = fs.readFileSync('app/_layout.web.tsx', 'utf8');

assert.match(web, /useStagedFileLifecycle\(activeDraft\.stagedFiles\)/);
assert.match(native, /StageEvidenceDraftProvider\(\{ children, scopeKey: _scopeKey \}: \{ children: React\.ReactNode; scopeKey\?: string \}\)/);
assert.match(web, /StageEvidenceDraftProvider/);
assert.match(web, /useStageEvidenceDraft/);
assert.match(web, /blankStageEvidenceDraft\(activeScopeKey\)/);
assert.match(native, /useState<PastedFile\[\]>\(\[\]\)/);
assert.match(native, /useStagedFileLifecycle\(stagedFiles\)/);
assert.match(native, /return <>{children}<\/>/);
assert.match(layout, /<StageEvidenceDraftProvider scopeKey=\{pathname\}>[\s\S]*?<TaskFilePasteProvider scopeKey=\{pathname\}>/);
assert.doesNotMatch(web, /AsyncStorage|localStorage|submitWithEvidence|upload/);

console.log('StageEvidenceDraftContext.check: all assertions passed');
