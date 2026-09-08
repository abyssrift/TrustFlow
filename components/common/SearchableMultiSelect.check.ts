import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('components/common/SearchableMultiSelect.tsx', 'utf8');

for (const contract of [
  'query?: string',
  'onQueryChange?: (q: string) => void',
  'loading?: boolean',
  'errorText?: string | null',
  'selectedItems?: SearchableMultiSelectItem[]',
  'autoFocus?: boolean',
  'onClearSelection?: () => void',
  'function dedupeItems(items: SearchableMultiSelectItem[])',
  'dedupeItems(selectedItems ?? []).filter(item => selectedSet.has(item.id))',
  'const selectedChipItems = selectedItems ? uniqueSelectedItems : uniqueItems.filter(it => selectedSet.has(it.id));',
  'accessibilityLabel="Clear all"',
  'onClearSelection();',
  'autoFocus={autoFocus}',
  "currentQuery.trim() ? emptyText : 'No items available.'",
  'if (isControlledSearch || !q) return withKeys;',
  'accessibilityLabel={it.disabled ? undefined : `Remove ${it.label}`}',
  'onPress={it.disabled ? undefined : () => onToggle(it.id)}',
  'min-h-11',
  'onQueryChange?.(nextQuery);',
  'onPress={() => setSearchQuery(\'\')}',
  'accessibilityRole="progressbar"',
]) {
  assert.ok(source.includes(contract), `SearchableMultiSelect contract missing: ${contract}`);
}

assert.ok(!source.includes('const [query, setQuery] = useState'), 'legacy local query state should be renamed for controlled search');
console.log('SearchableMultiSelect.check: OK');
