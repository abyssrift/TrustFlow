// Focused structural check for provider-backed Stage Evidence draft ownership.
// Run with: npx tsx components/task-detail/StageActions.stageDraft.check.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('components/task-detail/StageActions.tsx', 'utf8');

assert.match(source, /import \{ useStageEvidenceDraft \} from ['"]@\/contexts\/StageEvidenceDraftContext['"]/);
assert.match(source, /const \{ submissionContent, setSubmissionContent, stagedFiles, setStagedFiles, clearDraft \} = useStageEvidenceDraft\(\)/);
assert.doesNotMatch(source, /const \[submissionContent, setSubmissionContent\] = useState/);
assert.doesNotMatch(source, /const \[stagedFiles, setStagedFiles\] = useState/);
assert.doesNotMatch(source, /useStagedFileLifecycle\(stagedFiles\)/);
assert.match(source, /const \[editNewFiles, setEditNewFiles\] = useState<any\[\]>\(\[\]\)/);
assert.match(source, /useStagedFileLifecycle\(editNewFiles\)/);

assert.equal((source.match(/clearDraft\(\)/g) || []).length, 2);
assert.match(source, /const submitted = await submitWithEvidence\(\{[\s\S]*?stagedFiles[\s\S]*?\}\);[\s\S]*?if \(submitted\) clearDraft\(\);/);
assert.match(source, /let submitted = false;[\s\S]*?if \(submitAction\) \{[\s\S]*?submitted = await submitWithEvidence\([\s\S]*?stagedFiles[\s\S]*?\}\);[\s\S]*?\} else \{[\s\S]*?submitted = await submitWithEvidence\([\s\S]*?stagedFiles[\s\S]*?\}\);[\s\S]*?\}[\s\S]*?if \(submitted\) clearDraft\(\);/);

console.log('StageActions.stageDraft.check: all assertions passed');
