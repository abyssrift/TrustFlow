import SearchResultRow from '@/components/sidebar/search/SearchResultRow';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import type { SearchType } from '@/hooks/useSearchQuery';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

const TABS: { key: SearchType | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'task', label: 'Tasks' },
  { key: 'person', label: 'People' },
  { key: 'file', label: 'Files' },
  { key: 'report', label: 'Reports' },
  { key: 'comment', label: 'Comments' },
];

export default function SearchScreen() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = React.useState('');
  const [tab, setTab] = React.useState<SearchType | 'all'>('all');

  // seed from the ?q= param (and keep in sync if navigated again with a new q)
  React.useEffect(() => {
    if (typeof params.q === 'string') setQuery(params.q);
  }, [params.q]);

  const { results, loading, parsed } = useGlobalSearch(query, {
    types: tab === 'all' ? null : [tab],
    limit: 100,
  });

  return (
    <ScrollView className="flex-1 bg-surface-background" contentContainerStyle={{ padding: 24, maxWidth: 860, width: '100%', alignSelf: 'center' }}>
      {/* search input */}
      <View className="h-11 flex-row items-center gap-2 rounded-2xl border border-surface-border bg-surface-card px-4">
        <FontAwesome name="search" size={14} color={colors.textDim} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          autoFocus
          placeholder="Search tasks, files, reports…"
          placeholderTextColor={colors.textDim}
          className="flex-1 text-base text-typography-main outline-none"
          style={{ paddingVertical: 0 }}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={6}>
            <FontAwesome name="times-circle" size={16} color={colors.textDim} />
          </Pressable>
        ) : null}
      </View>

      {/* intent chip */}
      {parsed.humanized ? (
        <View className="flex-row items-center gap-2 mt-3">
          <FontAwesome name="magic" size={12} color={colors.primary} />
          <Text className="text-xs font-bold" style={{ color: colors.primary }}>{parsed.humanized}</Text>
        </View>
      ) : null}

      {/* type tabs */}
      <View className="flex-row flex-wrap gap-2 mt-4">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              className="px-4 py-1.5 rounded-full border"
              style={{
                backgroundColor: active ? colors.primary : 'transparent',
                borderColor: active ? colors.primary : colors.border,
              }}
            >
              <Text className="text-xs font-bold" style={{ color: active ? '#fff' : colors.textMuted }}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* results */}
      <View className="mt-5">
        {loading && results.length === 0 ? (
          <View className="items-center py-12"><ActivityIndicator color={colors.primary} /></View>
        ) : query.trim() === '' ? (
          <View className="items-center py-12">
            <FontAwesome name="search" size={22} color={colors.textDim} />
            <Text className="text-typography-muted text-sm mt-3">Type to search across everything.</Text>
          </View>
        ) : results.length === 0 ? (
          <View className="items-center py-12">
            <Text className="text-typography-muted text-sm">No results for “{query.trim()}”.</Text>
          </View>
        ) : (
          <View>
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">
              {results.length} result{results.length === 1 ? '' : 's'}
            </Text>
            {results.map((r) => (
              <SearchResultRow key={`${r.type}-${r.id}`} result={r} />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
