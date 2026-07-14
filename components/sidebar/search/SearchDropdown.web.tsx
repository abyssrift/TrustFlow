import { useThemeColors } from '@/hooks/useThemeColors';
import type { GroupedResults, SearchResult } from '@/hooks/useGlobalSearch';
import type { ParsedQuery, SearchType } from '@/hooks/useSearchQuery';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import SearchResultRow from './SearchResultRow.web';

const GROUP_ORDER: SearchType[] = ['task', 'file', 'report', 'comment'];
const GROUP_LABEL: Record<SearchType, string> = {
  task: 'Tasks', file: 'Files', report: 'Reports', comment: 'Comments',
};
const PER_GROUP = 4; // dropdown preview cap; full list lives on /search

export default function SearchDropdown({
  visible,
  query,
  parsed,
  grouped,
  results,
  loading,
  recent,
  onPickRecent,
  onRemoveRecent,
  onClearRecent,
  onSubmit,
  onNavigate,
}: {
  visible: boolean;
  query: string;
  parsed: ParsedQuery;
  grouped: GroupedResults;
  results: SearchResult[];
  loading: boolean;
  recent: string[];
  onPickRecent: (q: string) => void;
  onRemoveRecent: (q: string) => void;
  onClearRecent: () => void;
  onSubmit: () => void;
  onNavigate: () => void;
}) {
  const colors = useThemeColors();
  if (!visible) return null;

  const typing = query.trim().length > 0;

  return (
    <View
      // Sits under the input; parent search container is position:relative.
      style={{ position: 'absolute', top: 44, left: 0, right: 0, zIndex: 200 }}
      className="rounded-2xl border border-surface-border bg-surface-card p-2 shadow-lg transition-all duration-200"
    >
      {/* intent chip — shows what the parser understood */}
      {typing && parsed.humanized ? (
        <View className="flex-row items-center gap-2 px-2 pb-2 pt-1">
          <FontAwesome name="magic" size={11} color={colors.primary} />
          <Text className="text-[11px] font-bold" style={{ color: colors.primary }}>
            {parsed.humanized}
          </Text>
        </View>
      ) : null}

      {!typing ? (
        // ── Empty state: recent searches ──────────────────────────────────
        recent.length === 0 ? (
          <View className="items-center px-3 py-6">
            <FontAwesome name="search" size={18} color={colors.textDim} />
            <Text className="text-typography-muted text-xs mt-2">Search tasks, files, reports…</Text>
          </View>
        ) : (
          <View>
            <View className="flex-row items-center justify-between px-2 py-1">
              <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest">Recent</Text>
              <Pressable onPress={onClearRecent} hitSlop={6}>
                <Text className="text-[10px] font-bold" style={{ color: colors.textDim }}>Clear</Text>
              </Pressable>
            </View>
            {recent.map((q) => (
              <View key={q} className="flex-row items-center rounded-xl hover:bg-surface-overlay">
                <Pressable onPress={() => onPickRecent(q)} className="flex-1 flex-row items-center gap-3 px-3 py-2">
                  <FontAwesome name="history" size={13} color={colors.textDim} />
                  <Text numberOfLines={1} className="text-typography-main text-sm flex-1">{q}</Text>
                </Pressable>
                <Pressable onPress={() => onRemoveRecent(q)} hitSlop={6} className="px-3">
                  <FontAwesome name="times" size={12} color={colors.textDim} />
                </Pressable>
              </View>
            ))}
          </View>
        )
      ) : loading && results.length === 0 ? (
        // ── Loading ───────────────────────────────────────────────────────
        <View className="items-center py-6">
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : results.length === 0 ? (
        // ── No results ────────────────────────────────────────────────────
        <View className="items-center px-3 py-6">
          <Text className="text-typography-muted text-xs">No results for “{query.trim()}”</Text>
        </View>
      ) : (
        // ── Grouped results ───────────────────────────────────────────────
        <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
          {GROUP_ORDER.filter((t) => grouped[t]?.length).map((t) => (
            <View key={t} className="mb-1">
              <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest px-2 py-1">
                {GROUP_LABEL[t]} ({grouped[t]!.length})
              </Text>
              {grouped[t]!.slice(0, PER_GROUP).map((r) => (
                <SearchResultRow key={`${r.type}-${r.id}`} result={r} onNavigate={onNavigate} />
              ))}
            </View>
          ))}
          <Pressable
            onPress={onSubmit}
            className="flex-row items-center justify-center gap-2 rounded-xl py-2.5 mt-1 hover:bg-surface-overlay"
          >
            <Text className="text-sm font-bold" style={{ color: colors.primary }}>
              See all {results.length} result{results.length === 1 ? '' : 's'}
            </Text>
            <FontAwesome name="arrow-right" size={11} color={colors.primary} />
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}
