// Focused structural check for task attachment paste target wiring.
// Run with: npx tsx components/task-detail/TaskFilePasteTarget.check.ts
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const brief = readFileSync('components/task-detail/TaskBriefPanel.tsx', 'utf8');
const stage = readFileSync('components/task-detail/StageActions.tsx', 'utf8');
const button = readFileSync('components/task-detail/TaskFilePasteTargetButton.tsx', 'utf8');

assert.match(brief, /import \{ useTaskFilePasteTarget \} from ['"]@\/contexts\/TaskFilePasteContext['"]/);
assert.match(stage, /import \{ useTaskFilePasteTarget \} from ['"]@\/contexts\/TaskFilePasteContext['"]/);
assert.match(button, /accessibilityRole="button"/);
assert.match(button, /accessibilityLabel=\{stateLabel\}/);
assert.match(button, /accessibilityHint=/);
assert.match(button, /accessibilityState=\{\{ selected: isArmed, disabled \}\}/);
assert.match(button, /onPress=\{onPress\}/);
assert.match(button, /min-h-\[44px\]/);
assert.match(button, /Platform\.OS !== ['"]web['"]/);
assert.match(button, /Arm paste to/);
assert.match(button, /Paste target:/);
assert.match(button, /until another target is selected/);

assert.equal((brief.match(/useTaskFilePasteTarget\(/g) || []).length, 1);
assert.match(brief, /id: ['"]task-brief['"][\s\S]*?enabled: canUpload && !uploading/);
assert.match(brief, /existingFiles: data\?\.task_attachments \?\? \[\]/);
assert.match(brief, /async function uploadFiles\(files: \{ uri: string; name: string; size: number; type: string \}\[\]\): Promise<boolean>/);
assert.match(brief, /if \(!user \|\| !data \|\| files\.length === 0\) return false/);
assert.match(brief, /await refresh\(\);[\s\S]*?return true;/);
assert.match(brief, /setErrorMsg\(err\.message \|\| ['"]Upload failed['"]\);[\s\S]*?return false;/);
assert.match(brief, /onFiles: \(files\) => uploadFiles\(files\.map\(fileToStaged\)\)/);
assert.match(brief, /<TaskFilePasteTargetButton[\s\S]*?onPress=\{armBriefPaste\}/);
assert.match(brief, /useTaskFilePasteTarget\([\s\S]*?if \(!data\) return null;/);
assert.match(brief, /flex-row flex-wrap gap-3 pt-2 border-t border-surface-border\/30/);

assert.equal((stage.match(/useTaskFilePasteTarget\(/g) || []).length, 1);
assert.match(stage, /id: ['"]stage-evidence['"][\s\S]*?enabled: preShowSubmitForm && !preIsUploading/);
assert.match(stage, /existingFiles: stagedFiles/);
assert.match(stage, /onFiles: \(files\) => setStagedFiles\(\(prev\) => \[\.\.\.prev, \.\.\.files\.map\(fileToStaged\)\]\)/);
assert.match(stage, /<TaskFilePasteTargetButton[\s\S]*?onPress=\{armEvidencePaste\}/);
assert.match(stage, /useTaskFilePasteTarget\([\s\S]*?if \(!data\) return null;/);

assert.doesNotMatch(brief, /useSmartPaste/);
assert.doesNotMatch(stage, /useSmartPaste/);
assert.equal((brief.match(/<TaskFilePasteTargetButton/g) || []).length, 1);
assert.equal((stage.match(/<TaskFilePasteTargetButton/g) || []).length, 1);

console.log('TaskFilePasteTarget.check: all assertions passed');
