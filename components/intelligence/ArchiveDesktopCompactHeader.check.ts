import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const screen = readFileSync('components/intelligence/_archives_desktop.tsx', 'utf8');

assert.match(screen, /<IntelligencePageHeader[\s\S]*?density="compact"/, 'Cold Storage opts into the compact shared header');
assert.match(screen, /const \[filtersOpen, setFiltersOpen\] = useState\(false\)/, 'filter panel open state is locally controlled');
const headerStart = screen.indexOf('<IntelligencePageHeader');
const headerEnd = screen.indexOf('      />\n\n      {canPurge', headerStart);
const header = screen.slice(headerStart, headerEnd);
assert.ok(/right=\{[\s\S]*?includeCompany[\s\S]*?onPress=\{\(\) => setFiltersOpen\(\(open\) => !open\)\}/.test(header), 'the visible filter icon in the header toggles filtersOpen');
assert.ok(header.includes('onPress={fetchArchives}'), 'refresh remains in the shared header actions');
assert.ok(!header.includes('<FilterPanel'), 'the FilterPanel body is not nested in the horizontal header actions');
assert.equal((screen.match(/<FilterPanel\b/g) ?? []).length, 1, 'the collection uses exactly one real FilterPanel');

const metadataRows = screen.match(/Collection metadata:/g) ?? [];
assert.equal(metadataRows.length, 1, 'the collection has exactly one metadata row');
const metadataStart = screen.indexOf('Collection metadata:');
const metadataEnd = screen.indexOf('<MultiViewList', metadataStart);
const metadata = screen.slice(metadataStart, metadataEnd);
for (const marker of ['filteredArchives.length', 'archives.length', 'counts.task', 'counts.project', 'counts.conflict', 'loading && <View', '<ActivityIndicator']) {
  assert.ok(metadata.includes(marker), `the single collection metadata row includes ${marker}`);
}
assert.match(screen, /Collection metadata:[\s\S]*?<View className="mb-2 flex-row flex-wrap items-center gap-x-3[\s\S]*?<\/View>\s*<MultiViewList/, 'collection metadata sits immediately before MultiViewList');
assert.doesNotMatch(screen, /Showing \{filteredArchives\.length\} of \{archives\.length\}[^\n]*<\/Text>[\s\S]{0,100}<\/View>\s*<View className="mb-3 flex-row items-center gap-2">/, 'standalone count and category rows are not duplicated');
assert.equal((screen.match(/Showing \{filteredArchives\.length\} of \{archives\.length\}/g) ?? []).length, 1, 'shown/total is not repeated outside the consolidated metadata row');
assert.equal((screen.match(/\{counts\.(?:task|project|conflict)/g) ?? []).length, 3, 'task, project, and conflict counts appear together only once');

const collectionStart = screen.indexOf('<View className="flex-1 min-h-0 px-6 pb-6 pt-4">');
const collectionEnd = screen.indexOf('<MultiViewList', collectionStart);
const collection = screen.slice(collectionStart, collectionEnd);
assert.ok(collection.includes('<FilterPanel') && collection.includes('isOpen={filtersOpen}') && collection.includes('onOpenChange={setFiltersOpen}') && collection.includes('trigger={() => null}'), 'one controlled FilterPanel body renders in the collection area below the header');
assert.ok(collection.includes('<FilterSection label="Type"') && collection.includes('<FilterSection label="Status"'), 'the controlled FilterPanel body retains both filter sections');
assert.ok(collection.includes('active={filters.entity === option.id}') && collection.includes('entity: option.id') && collection.includes('active={filters.status === option.id}') && collection.includes('status: option.id'), 'filter options remain connected to controlled filter state');
assert.match(screen, /search=\{\{ value: search, onChange: setSearch/, 'MultiViewList search stays controlled by archive search state');
assert.match(screen, /loading=\{loading\}/, 'loading remains wired into MultiViewList');
assert.match(screen, /\{canViewAll && \([\s\S]*?accessibilityRole="switch"[\s\S]*?setIncludeCompany/, 'company scope remains permission-gated');
assert.match(screen, /p_include_company: canViewAll && includeCompany/, 'company scope remains connected to archive loading');
assert.match(screen, /selection=\{selectionProps\}/, 'MultiViewList remains connected to archive selection');
assert.match(screen, /selectedIds,\s*onActiveChange: \(\) => \{\},\s*onSelectedIdsChange: setSelectedIds/, 'the selection controller remains connected to archive selection state');
assert.match(screen, /canPurge && selection\.count > 0[\s\S]*?onPress=\{\(\) => setDeleteModal\(true\)\}[\s\S]*?onConfirm=\{handleBulkDelete\}/, 'the conditional purge bar and confirmation remain wired to purge behavior');

console.log('ArchiveDesktopCompactHeader.check: OK');
