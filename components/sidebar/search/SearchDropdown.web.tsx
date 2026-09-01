import { useThemeColors } from '@/hooks/useThemeColors';
import type { GroupedResults, ResultType, SearchResult } from '@/hooks/useGlobalSearch';
import type { ParsedQuery } from '@/hooks/useSearchQuery';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import Tooltip from '@/components/common/Tooltip';
import { ENTITY_META } from '@/components/entities/EntityUI';
import SearchResultRow from './SearchResultRow';

// Containers first (a project holds tasks holds files) — matches the hierarchy
// Phase 10 is integrating; within a group, rank order still decides.
const GROUP_ORDER: ResultType[] = ['project', 'portfolio', 'task', 'person', 'file', 'report', 'comment'];
const GROUP_LABEL: Record<string, string> = {
  task: 'Tasks', person: 'People', file: 'Files', report: 'Reports', comment: 'Comments', archive: 'Archived',
  project: ENTITY_META.project.plural, portfolio: ENTITY_META.portfolio.plural,
};
const PER_GROUP = 4;             // dropdown preview cap; full list lives on /search
const SPARSE = 5;                // below this, offer the archive fallback

// Teach the non-obvious query powers; rotates while the box is empty.
const TIPS: string[] = [
  'Try “tasks due tomorrow” — filters by due date, not created date.',
  'Search by time: “files last week”, “reports in June”, “2 days ago”.',
  'Filter by type: prefix with “task:”, “file:”, “report:” or “comment:”.',
  'Ranges work: “before July”, “after 2026-01”, “between june and august”.',
  '“completed last month” finds finished tasks; “created this week” the new ones.',
  'Weekdays & quarters too: “last monday”, “this year”, “Q2”.',
  'Projects and portfolios are searchable too — “audit projects”, “portfolio:”.',
];

function Tips({ color }: { color: string }) {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % TIPS.length), 4500);
    return () => clearInterval(t);
  }, []);
  return (
    <View className="flex-row items-start gap-2 px-3 pt-3">
      <FontAwesome name="lightbulb-o" size={12} color={color} style={{ marginTop: 1 }} />
      <Text className="text-typography-muted text-[11px] flex-1 leading-4">{TIPS[i]}</Text>
    </View>
  );
}

export default function SearchDropdown({
  visible,
  query,
  parsed,
  grouped,
  results,
  archives,
  loading,
  searchError,
  recent,
  saved,
  querySaved,
  onToggleSave,
  canViewArchives,
  includeArchived,
  onToggleArchived,
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
  archives: SearchResult[];
  loading: boolean;
  searchError: boolean;
  recent: string[];
  saved: string[];
  querySaved: boolean;
  onToggleSave: () => void;
  canViewArchives: boolean;
  includeArchived: boolean;
  onToggleArchived: () => void;
  onPickRecent: (q: string) => void;
  onRemoveRecent: (q: string) => void;
  onClearRecent: () => void;
  onSubmit: () => void;
  onNavigate: () => void;
}) {
  const colors = useThemeColors();
  if (!visible) return null;

  const typing = query.trim().length > 0;
  const showArchiveToggle = typing && canViewArchives && results.length < SPARSE;

  return (
    <View
      style={{ position: 'absolute', top: 44, left: 0, right: 0, zIndex: 200 }}
      className="rounded-2xl border border-surface-border bg-surface-card p-2 shadow-lg transition-all duration-200"
    >
      {typing && parsed.humanized ? (
        <View className="flex-row items-center gap-2 px-2 pb-2 pt-1">
          <FontAwesome name="magic" size={11} color={colors.primary} />
          <Text className="text-[11px] font-bold" style={{ color: colors.primary }}>{parsed.humanized}</Text>
        </View>
      ) : null}

      {!typing ? (
        // ── Empty state: saved + recent searches + rotating tips ──────────
        <View>
          {saved.length ? (
            <View className="mb-1">
              <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest px-2 py-1">Saved</Text>
              {saved.map((q) => (
                <Pressable key={q} onPress={() => onPickRecent(q)} className="flex-row items-center gap-3 px-3 py-2 rounded-xl hover:bg-surface-overlay">
                  <FontAwesome name="star" size={12} color={colors.primary} />
                  <Text numberOfLines={1} className="text-typography-main text-sm flex-1">{q}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {recent.length === 0 ? (
            <View className="items-center px-3 pt-6 pb-1">
              <FontAwesome name="search" size={18} color={colors.textDim} />
              <Text className="text-typography-muted text-xs mt-2">Search projects, tasks, files…</Text>
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
                  <Tooltip label="Remove" side="left">
                    <Pressable onPress={() => onRemoveRecent(q)} hitSlop={6} className="px-3">
                      <FontAwesome name="times" size={12} color={colors.textDim} />
                    </Pressable>
                  </Tooltip>
                </View>
              ))}
            </View>
          )}
          <View className="border-t border-surface-border mt-2">
            <Tips color={colors.primary} />
          </View>
        </View>
      ) : loading && results.length === 0 ? (
        <View className="items-center py-6"><ActivityIndicator size="small" color={colors.primary} /></View>
      ) : results.length === 0 && archives.length === 0 ? (
        <View className="items-center px-3 py-6">
          <Text className="text-typography-muted text-xs">
            {searchError ? 'Search failed — try again' : `No results for “${query.trim()}”`}
          </Text>
          {showArchiveToggle && !searchError ? <ArchiveToggle colors={colors} on={includeArchived} onPress={onToggleArchived} /> : null}
        </View>
      ) : (
        // ── Grouped results ───────────────────────────────────────────────
        <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
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

          {archives.length ? (
            <View className="mb-1">
              <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest px-2 py-1">
                {GROUP_LABEL.archive} ({archives.length})
              </Text>
              {archives.slice(0, PER_GROUP).map((r) => (
                <SearchResultRow key={`archive-${r.id}`} result={r} onNavigate={onNavigate} />
              ))}
            </View>
          ) : null}

          {showArchiveToggle ? <ArchiveToggle colors={colors} on={includeArchived} onPress={onToggleArchived} /> : null}

          <View className="flex-row items-center justify-between mt-1 px-1">
            <Pressable onPress={onToggleSave} hitSlop={6} className="flex-row items-center gap-1.5 px-2 py-2 rounded-xl hover:bg-surface-overlay">
              <FontAwesome name={querySaved ? 'star' : 'star-o'} size={12} color={querySaved ? colors.primary : colors.textDim} />
              <Text className="text-[11px] font-bold" style={{ color: querySaved ? colors.primary : colors.textDim }}>
                {querySaved ? 'Saved' : 'Save search'}
              </Text>
            </Pressable>
            <Pressable onPress={onSubmit} className="flex-row items-center gap-2 rounded-xl px-3 py-2 hover:bg-surface-overlay">
              <Text className="text-sm font-bold" style={{ color: colors.primary }}>
                See all {results.length} result{results.length === 1 ? '' : 's'}
              </Text>
              <FontAwesome name="arrow-right" size={11} color={colors.primary} />
            </Pressable>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function ArchiveToggle({ colors, on, onPress }: { colors: any; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center justify-center gap-2 rounded-xl py-2 mt-1 hover:bg-surface-overlay">
      <FontAwesome name={on ? 'check-square-o' : 'archive'} size={12} color={colors.textDim} />
      <Text className="text-[11px] font-bold" style={{ color: colors.textDim }}>
        {on ? 'Searching archives too' : 'Also search archives'}
      </Text>
    </Pressable>
  );
}
