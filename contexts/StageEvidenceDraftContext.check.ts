import assert from 'node:assert/strict';
import fs from 'node:fs';

const web = fs.readFileSync('contexts/StageEvidenceDraftContext.web.tsx', 'utf8');
const native = fs.readFileSync('contexts/StageEvidenceDraftContext.tsx', 'utf8');
const layout = fs.readFileSync('app/_layout.web.tsx', 'utf8');

assert.match(web, /useStagedFileLifecycle\(draft\.stagedFiles\)/);
assert.match(web, /StageEvidenceDraftProvider/);
assert.match(web, /useStageEvidenceDraft/);
assert.match(web, /stagedFiles: \[\]/);
assert.match(native, /useState<PastedFile\[\]>\(\[\]\)/);
assert.match(native, /useStagedFileLifecycle\(stagedFiles\)/);
assert.match(native, /return <>{children}<\/>/);
assert.match(layout, /<StageEvidenceDraftProvider key=\{pathname\}>[\s\S]*?<TaskFilePasteProvider key=\{pathname\}>/);
assert.doesNotMatch(web, /AsyncStorage|localStorage|submitWithEvidence|upload/);

console.log('StageEvidenceDraftContext.check: all assertions passed');
