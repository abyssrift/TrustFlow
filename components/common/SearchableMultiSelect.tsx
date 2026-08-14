import { FontAwesome } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Image, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useThemeColors } from '@/hooks/useThemeColors';

// ─────────────────────────────────────────────────────────────────────────────
// SearchableMultiSelect — the reusable, scalable picker for popup/sheet forms
// (issues #221 / #222 / #255). Replace large pill walls and stacked checkbox
// lists with a searchable, grouped, compact multi-select that stays usable at
// 10+ options.
//
// Design lineage: the searchable grouped permission list in
// `RoleEditorSheet.web.tsx` (drill-in / dedicated-pane picking) generalized to
// any item type. Grid-free by design — flex-row/column only (CSS grid renders
// wrong in this RN-web build; see ui-consistency.md "Filter controls").
//
// It renders rows inline and does NOT own a ScrollView: nest it inside the
// popup/sheet body that already scrolls, so a huge list rides the parent
// scroll and never fights it with a nested pane.
// ─────────────────────────────────────────────────────────────────────────────

export type SearchableMultiSelectItem = {
  id: string;
  label: string;
  description?: string | null;
  /** Leading swatch / accent color (role.color, team.color, ...). */
  color?: string | null;
  /** Grouping key — items with the same `category` sit under one header. */
  category?: string;
  /** Rendered as a lock badge; taps are ignored (inherited / system-owned). */
  disabled?: boolean;
  /** Text beside a disabled item's lock, e.g. "via team". */
  disabledLabel?: string;
  /** Avatar shown instead of the color swatch. */
  avatarUrl?: string | null;
  /** FontAwesome glyph used as the leading swatch when no color/avatar. */
  icon?: string;
  /** Optional trailing badge, e.g. "System". */
  badge?: string;
};

type KeyedItem = SearchableMultiSelectItem & { key: string };

export type SearchableMultiSelectProps = {
  /** Section caption, e.g. "Direct Roles". */
  title: string;
  items: SearchableMultiSelectItem[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  searchPlaceholder?: string;
  /** Shown when search matches nothing. */
  emptyText?: string;
  /** Check/active accent (defaults to brand primary). */
  accent?: string;
  /** Compact chips of the current selection above the list ("N selected"). */
  showSelectedChips?: boolean;
  /** Hide the per-category "All/Clear" toggle. */
  hideBulkToggle?: boolean;
  /** Force a flat list (ignore `category` grouping). */
  flat?: boolean;
};

export default function SearchableMultiSelect({
  title,
  items,
  selectedIds,
  onToggle,
  searchPlaceholder,
  emptyText = 'No matching items.',
  accent,
  showSelectedChips = true,
  hideBulkToggle = false,
  flat = false,
}: SearchableMultiSelectProps) {
  const c = useThemeColors();
  const [query, setQuery] = useState('');
  const accentColor = accent ?? c.primary;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const q = query.trim().toLowerCase();
  const visible: KeyedItem[] = useMemo(() => {
    const withKeys = items.map(it => ({ ...it, key: `${it.id}-${it.label}` }));
    if (!q) return withKeys;
    return withKeys.filter(it =>
      it.label.toLowerCase().includes(q) ||
      (it.description ?? '').toLowerCase().includes(q) ||
      (it.category ?? '').toLowerCase().includes(q));
  }, [items, q]);

  const groups = useMemo(() => {
    if (flat) return [''] as const;
    const seen: string[] = [];
    for (const it of visible) {
      const cat = it.category ?? '';
      if (!seen.includes(cat)) seen.push(cat);
    }
    return seen;
  }, [visible, flat]);

  const total = selectedSet.size;

  const groupItems = (cat: string) => visible.filter(it => (it.category ?? '') === cat);
  const selCount = (cat: string) => visible.filter(it => (it.category ?? '') === cat && selectedSet.has(it.id)).length;

  const toggleSet = (cat: string, ids: string[], on: boolean) => {
    ids.forEach(id => {
      const item = visible.find(it => it.id === id);
      if (item?.disabled) return;
      if (on && !selectedSet.has(id)) onToggle(id);
      if (!on && selectedSet.has(id)) onToggle(id);
    });
  };

  return (
    <View className="w-full">
      {/* Header row: caption + selected count */}
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">{title}</Text>
        <Text className="text-[10px] font-black" style={{ color: total > 0 ? accentColor : c.textDim }}>
          {total} selected
        </Text>
      </View>

      {/* Selected chips (optional) */}
      {showSelectedChips && selectedSet.size > 0 && (
        <View className="flex-row flex-wrap gap-1.5 mb-2.5">
          {items.filter(it => selectedSet.has(it.id)).slice(0, 6).map(it => (
            <View
              key={it.id}
              className="flex-row items-center px-2.5 py-1.5 rounded-lg"
              style={{ backgroundColor: accentColor + '14', borderWidth: 1, borderColor: accentColor + '3D' }}
            >
              {it.color && (
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: it.color?.includes('var') ? c.primary : it.color, marginRight: 6 }} />
              )}
              <Text className="text-[9px] font-black uppercase tracking-widest" style={{ color: accentColor }} numberOfLines={1}>
                {it.label}
              </Text>
            </View>
          ))}
          {selectedSet.size > 6 && (
            <View className="px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
              <Text className="text-[9px] font-black uppercase tracking-widest" style={{ color: c.textMuted }}>
                +{selectedSet.size - 6}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Search */}
      <View className="flex-row items-center px-3 py-2.5 rounded-xl mb-3 gap-2" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
        <FontAwesome name="search" size={12} color={c.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={searchPlaceholder ?? `Search ${title.toLowerCase()}...`}
          placeholderTextColor={c.textMuted}
          className="flex-1 text-xs font-bold py-0.5"
          style={{ color: c.textMain } as any}
        />
        {q.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} className="w-6 h-6 items-center justify-center rounded-full" style={{ backgroundColor: c.border + '40' }}>
            <FontAwesome name="times" size={10} color={c.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Empty search state */}
      {visible.length === 0 && (
        <View className="py-8 items-center">
          <FontAwesome name="search" size={20} color={c.textDim} style={{ marginBottom: 8 }} />
          <Text className="text-xs font-bold text-center" style={{ color: c.textMuted }}>{emptyText}</Text>
        </View>
      )}

      {/* Grouped rows */}
      {groups.map(cat => {
        const catItems = groupItems(cat);
        if (catItems.length === 0) return null;
        const catIds = catItems.map(it => it.id);
        const allSelected = catItems.length > 0 && catItems.every(it => it.disabled || selectedSet.has(it.id));
        const anyToggleable = catItems.some(it => !it.disabled);
        return (
          <View key={cat || '__flat__'} className="mb-3">
            {!flat && (
              <View className="flex-row items-center mb-1.5">
                <View className="w-1.5 h-1.5 rounded-full mr-2 flex-shrink-0" style={{ backgroundColor: accentColor }} />
                <Text className="text-typography-main text-[11px] font-black uppercase tracking-widest flex-1">{cat || 'General'}</Text>
                <Text className="text-[10px] font-black mr-2" style={{ color: c.textMuted }}>{selCount(cat)}/{catItems.length}</Text>
                {anyToggleable && !hideBulkToggle && (
                  <TouchableOpacity onPress={() => toggleSet(cat, catIds, !allSelected)} className="px-2.5 py-1 rounded-lg" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
                    <Text className="text-[9px] font-black uppercase tracking-widest" style={{ color: allSelected ? c.textMuted : accentColor }}>
                      {allSelected ? 'Clear' : 'All'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            <View className="gap-1">
              {catItems.map(it => {
                const isActive = selectedSet.has(it.id);
                const isLocked = !!it.disabled;
                const swatchColor = it.color?.includes('var') ? c.primary : (it.color || accentColor);
                return (
                  <TouchableOpacity
                    key={it.key}
                    onPress={() => !isLocked && onToggle(it.id)}
                    activeOpacity={isLocked ? 1 : 0.7}
                    className={`flex-row items-center px-3 py-2.5 rounded-xl border ${isLocked ? '' : 'transition-all'}`}
                    style={{
                      backgroundColor: isActive ? accentColor + '0D' : 'transparent',
                      borderColor: isActive ? accentColor + '66' : c.border,
                      opacity: isLocked ? 0.6 : 1,
                    }}
                  >
                    {/* Leading swatch / avatar / icon */}
                    {it.avatarUrl ? (
                      <View className="w-7 h-7 rounded-full overflow-hidden mr-3 flex-shrink-0" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
                        <Image source={{ uri: it.avatarUrl }} className="w-full h-full" />
                      </View>
                    ) : it.color || it.icon ? (
                      <View className="w-6 h-6 rounded-lg items-center justify-center mr-3 flex-shrink-0" style={{ backgroundColor: swatchColor }}>
                        {it.icon && <FontAwesome name={it.icon as any} size={11} color="#fff" />}
                      </View>
                    ) : null}

                    <View className="flex-1 min-w-0">
                      <View className="flex-row items-center">
                        <Text style={{ color: isActive ? c.textMain : c.textMuted }} className="font-black text-[11px] tracking-tight flex-shrink" numberOfLines={1}>
                          {it.label}
                        </Text>
                        {it.badge && (
                          <View className="ml-2 px-1.5 py-0.5 rounded flex-shrink-0" style={{ backgroundColor: accentColor + '14' }}>
                            <Text className="text-[8px] font-black uppercase tracking-widest" style={{ color: accentColor }}>{it.badge}</Text>
                          </View>
                        )}
                      </View>
                      {it.description && (
                        <Text style={{ color: c.textDim }} className="text-[10px] font-bold leading-4 mt-0.5" numberOfLines={1}>
                          {it.description}
                        </Text>
                      )}
                    </View>

                    {/* Trailing: lock or checkbox */}
                    {isLocked ? (
                      <View className="flex-row items-center ml-2 flex-shrink-0">
                        <FontAwesome name="lock" size={10} color={accentColor} />
                        {it.disabledLabel && (
                          <Text className="text-[8px] font-black uppercase tracking-widest ml-1" style={{ color: accentColor }}>{it.disabledLabel}</Text>
                        )}
                      </View>
                    ) : (
                      <View
                        className="w-5 h-5 rounded-md items-center justify-center ml-2 flex-shrink-0"
                        style={{ backgroundColor: isActive ? accentColor : 'transparent', borderWidth: 1, borderColor: isActive ? accentColor : c.border }}
                      >
                        {isActive && <FontAwesome name="check" size={9} color="#fff" />}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}