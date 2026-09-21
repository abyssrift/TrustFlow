// Run with: npx tsx components/intelligence/ArchiveAdaptiveCompactHeader.check.ts
// Structural contract for the adaptive Cold Storage compact header.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('components/intelligence/_archives_adaptive.tsx', 'utf8');

const headerStart = source.indexOf('{/* Archive compact header row 1 */}');
const headerMiddle = source.indexOf('{/* Archive compact header row 2 */}');
const headerEnd = source.indexOf('{/* Archive collection context */}');
assert(headerStart >= 0 && headerMiddle > headerStart && headerEnd > headerMiddle,
  'adaptive archive header must have two compact rows before collection context');

const firstRow = source.slice(headerStart, headerMiddle);
const secondRow = source.slice(headerMiddle, headerEnd);
assert.match(firstRow, /accessibilityLabel="Back to Intelligence"/, 'row 1 must contain the back action');
assert.match(firstRow, /Cold Storage/, 'row 1 must contain compact title identity');
assert.match(firstRow, /canViewCompany &&/, 'archive scope must remain permission gated');
assert.match(firstRow, /My related archives/, 'personal archive scope choice is missing');
assert.match(firstRow, /Company archives/, 'company archive scope choice is missing');
assert.match(firstRow, /setIncludeCompany\(option\.value\)/, 'archive scope must preserve setIncludeCompany wiring');
assert.match(source.slice(0, headerStart), /px-4 pt-12 pb-3/,
  'top safe-area clearance must remain in the header');
assert.match(firstRow, /className=\{`min-h-11 min-w-11/,
  'scope choices must retain 44x44 targets');

assert.match(secondRow, /onChangeText=\{setSearch\}[\s\S]*accessibilityLabel="Search archives"/,
  'row 2 must retain controlled archive search');
assert.match(secondRow, /<FilterPanel[\s\S]*accessibilityLabel="Filter archives"[\s\S]*<FilterSection label="Type">[\s\S]*<FilterSection label="Status">/,
  'row 2 must keep the existing FilterPanel trigger and filter details');
assert.match(secondRow, /onPress=\{\(\) => void fetchArchives\(\)\}[\s\S]*accessibilityLabel="Refresh archives"/,
  'row 2 must retain refresh wiring');
assert.match(secondRow, /className="h-11 w-11/, 'filter and refresh targets must be at least 44x44');
assert.match(secondRow, /className="h-11 flex-1/, 'search target must be at least 44px tall');

const headerControls = source.slice(headerStart, headerEnd);
assert.doesNotMatch(headerControls, /className="(?:[^"\n]*\s)?h-10\b|className="(?:[^"\n]*\s)?w-10\b|className="(?:[^"\n]*\s)?min-h-10\b/,
  'header controls must not use targets smaller than 44px');
assert.doesNotMatch(headerControls, /text-white/, 'filter badge text must use the semantic typography token');

const collectionContextEnd = source.indexOf('<MultiViewList', headerEnd);
assert(collectionContextEnd > headerEnd, 'collection context must precede the archive list');
const collectionContext = source.slice(headerEnd, collectionContextEnd);
assert.match(collectionContext, /Showing \{visibleArchives\.length\} of \{counts\.total\}/,
  'shown/total must remain in collection context below the header');
assert.match(collectionContext, /selection\.selectAllVisible\(visibleIds\)/,
  'select-all must remain in collection context below the header');
assert.match(collectionContext, /selection\.count > 0[\s\S]*selection\.count === visibleArchives\.length/,
  'selection state must remain connected to the collection context');
assert.match(collectionContext, /selection\.count > 0[\s\S]*selection\.clear\(\)[\s\S]*setDeleteModal\(true\)/,
  'clear-selection and destructive action handlers must remain wired');
assert.match(collectionContext, /selection\.count > 0 \? `\$\{selection\.count\} selected/,
  'active selection metadata must be merged into the collection context');
assert.doesNotMatch(source.slice(headerEnd, source.indexOf('<MultiViewList', headerEnd)),
  /selection\.count > 0[\s\S]*<View className="mx-4 mb-3[^>]*>[\s\S]*<View className="mb-2 flex-row/,
  'selection and collection metadata must not be stacked as competing standalone bars');

const listStart = source.indexOf('<MultiViewList');
const listEnd = source.indexOf('\n        />', listStart);
assert(listStart >= 0 && listEnd > listStart, 'archive MultiViewList must remain in place');
const listProps = source.slice(listStart, listEnd);
for (const invariant of [
  /items=\{visibleArchives\}/,
  /keyExtractor=\{archive => archive\.id\}/,
  /storageKey="cold-storage-adaptive"/,
  /defaultMode="list"/,
  /modes=\{\['list', 'details'\]\}/,
  /renderCard=\{renderCard\}/,
  /renderRow=\{renderRow\}/,
  /columns=\{/,
  /onItemPress=\{archive => setSnapshotModal/,
  /selection=\{selectionProps\}/,
  /loading=\{loading\}/,
  /statusBanner=\{/,
  /emptyState=\{/,
]) {
  assert.match(listProps, invariant, `MultiViewList invariant missing: ${invariant}`);
}

assert.match(source, /const selectionProps = canSelectAndPurge[\s\S]*onToggle:[\s\S]*onPress:[\s\S]*onLongPress:[\s\S]*onKeyDown:/,
  'archive selection handlers must remain wired');
assert.match(source, /const renderActions = \(archive: ArchiveRow\)[\s\S]*setSnapshotModal[\s\S]*setRestoreModal/,
  'inspect and restore actions must remain wired');
assert.match(source, /<FilterSection label="Type">[\s\S]*<FilterSection label="Status">/,
  'existing filter details must remain inside FilterPanel');

console.log('ArchiveAdaptiveCompactHeader.check: all assertions passed');
