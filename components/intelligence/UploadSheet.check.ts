// Run with: npx tsx components/intelligence/UploadSheet.check.ts
// Focused source checks for the adaptive UploadSheet composer contract.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('components/intelligence/_filehub_adaptive.tsx', 'utf8');
const composer = source.slice(source.indexOf('function UploadSheet('), source.indexOf('function GroupCreateSheet('));

assert.match(composer, /mobilePage === 'composer' && pickedFiles\.length > 0/);
assert.match(composer, /className="px-6 pt-3 pb-5 border-t border-surface-border bg-surface-card"/);
assert.match(composer, /accessibilityState=\{\{ disabled: uploading/);
assert.match(composer, /mobilePage === 'recipients'/);
assert.match(composer, /mobilePage === 'destination'/);
assert.match(composer, /clearRecipientSearch\(\); setMobilePage\('composer'\)/);
assert.match(composer, /visibilitySeed\?: 'direct' \| 'broadcast'/);
assert.match(composer, /visibilitySeed === 'broadcast' && canBroadcast/);
assert.match(composer, /recipientSearchRequest\.current \+= 1/);
assert.match(composer, /accessibilityState=\{\{ selected: visibility === 'broadcast' \}\}/);
assert.match(composer, /accessibilityLabel="Done choosing recipients"/);
assert.match(composer, /accessibilityLabel="Choose files"/);
assert.match(composer, /accessibilityLabel="Optional upload details"/);
assert.match(composer, /accessibilityLabel=\{`Remove recipient/);
assert.match(composer, /const \[memberResults, setMemberResults\] = useState<UploadMemberSummary\[\]>\(\[\]\)/);
assert.match(composer, /\.order\('full_name', \{ ascending: true \}\)/);
assert.match(composer, /const seen = new Set<string>\(\)/);
assert.match(composer, /setMemberSearchLoading\(false\)/);
assert.match(composer, /No details/);
assert.match(composer, /Clear all staged files/);

console.log('UploadSheet.check: all assertions passed');
