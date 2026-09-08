// Focused source check for upload scope seeding and folder integrity.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const source = readFileSync(join(process.cwd(), 'components/filehub/UploadComposerModal.web.tsx'), 'utf8');

assert.match(source, /visibilitySeed\?: 'direct' \| 'broadcast'/, 'web composer visibility seed prop missing');
assert.match(source, /activeGroup \? 'group' : visibilitySeed \?\? 'direct'/, 'group/default visibility seed precedence missing');
assert.match(source, /folder\.id === prev\.folderId/, 'folder scope validation missing');
assert.match(source, /folderId: null/, 'invalid scoped folder is not cleared');
assert.match(source, /folderId !== undefined \? folderId : prev\.folderId/, 'valid initial folder preservation guard missing');
assert.match(source, /data, error.*!error/s, 'folder fetch error guard missing');
assert.match(source, /Map<string, MemberSummary>/, 'recipient records must be canonicalized by id with concrete type');
assert.match(source, /recipientRequestRef/, 'recipient search stale-response guard missing');
assert.match(source, /setTimeout\(async/, 'recipient search debounce missing');
assert.match(source, /recipientIds: selectedRecipientIds/, 'upload payload must derive recipient ids at upload time');
assert.match(source, /query=\{recipientSearch\}.*onQueryChange=\{setRecipientSearch\}/s, 'searchable recipient query API missing');
assert.doesNotMatch(source, /visibility: opt\.value as any, recipientIds: \[\]/, 'visibility changes must preserve selected recipients');
assert.match(source, /type MemberSummary =/, 'member records need a concrete summary type');
assert.doesNotMatch(source, /setRecipientRecords\(prev => \{[\s\S]*rows\.forEach/, 'search results must not become selected recipients');
assert.match(source, /className="w-11 h-11 items-center justify-center rounded-xl border"/, 'audience selector must use compact 44x44 controls');
assert.doesNotMatch(source, /Direct Send/, 'large direct-send visibility control should be removed');
assert.match(source, /isDesktop \|\| mobilePage === 'form'/, 'picker pages must omit the upload footer');
assert.match(source, /isDesktop && draft\.visibility === 'direct'.*SearchableMultiSelect/s, 'full recipient picker must be desktop-only in form page');
assert.match(source, /Destination[\s\S]*setDetailsOpen[\s\S]*Tags[\s\S]*Caption/, 'destination must remain outside optional details while tags/caption are inside');
assert.match(source, /finishPicker.*w-11 h-11/, 'mobile picker back control must be 44x44');
assert.match(source, /from\('users'\).*order\('full_name'\).*if \(query\)/s, 'blank recipient query must load default alphabetical members');
assert.match(source, /new Map\(\(data \|\| \[\]\)\.map/, 'member result rows must be deduplicated');
assert.match(source, /autoFocus onClearSelection/, 'mobile recipient picker must autofocus and expose explicit clear selection');
assert.match(source, /Done choosing destination/, 'mobile picker needs a Done action');
assert.match(source, /Clear all staged files/, 'file staging needs explicit clear-all affordance');
assert.match(source, /No details/, 'empty details summary must be explicit');
assert.match(source, /\[recipientSearch, visible\]/, 'recipient defaults must reload when modal becomes visible');
assert.match(source, /setDetailsOpen\(false\)/, 'details must reset on close');
assert.match(source, /Top level \(no folder\)/, 'empty destination needs explicit root copy');
assert.match(source, /w-11 h-11 bg-black\/50/, 'file tile remove controls must be 44px');
assert.match(source, /setSearchingMembers\(false\)/, 'close must reset member loading state');
assert.match(source, /keyboardShouldPersistTaps="handled"/, 'picker search must preserve taps while keyboard is open');
assert.match(source, /Done choosing recipients.*Done choosing destination/s, 'picker Done label must reflect active picker');
assert.match(source, /accessibilityLabel="Add more files"/, 'internal Add More tile needs accessibility label');
assert.match(source, /mobilePage === 'recipients'\) finishPicker/, 'audience switch must clean up recipient picker state');
assert.match(source, /Left column:[\s\S]*flexGrow: 2, flexBasis: 0, minWidth: 0/, 'file pane must shrink and wrap instead of forcing metadata overflow');
assert.match(source, /Right column:[\s\S]*flexGrow: 3, flexBasis: 0, minWidth: 0/, 'metadata pane must retain enough desktop width for its controls');

console.log('UploadComposerModal.check: ok');
