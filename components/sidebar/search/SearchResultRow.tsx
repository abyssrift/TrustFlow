import { useThemeColors } from '@/hooks/useThemeColors';
import { SearchResult, resultRoute } from '@/hooks/useGlobalSearch';
import type { SearchType } from '@/hooks/useSearchQuery';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

const TYPE_ICON: Record<string, React.ComponentProps<typeof FontAwesome>['name']> = {
  task: 'check-square-o',
  file: 'file-o',
  report: 'bar-chart',
  comment: 'comment-o',
  person: 'user',
  archive: 'archive',
};
const TYPE_LABEL: Record<string, string> = {
  task: 'Task', file: 'File', report: 'Report', comment: 'Comment', person: 'Person', archive: 'Archived',
};

// ts_headline wraps matches in <b>…</b>; RN <Text> can't render HTML, so strip tags.
function plain(s: string | null): string {
  return (s || '').replace(/<\/?b>/g, '').replace(/\s+/g, ' ').trim();
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

export default function SearchResultRow({
  result,
  onNavigate,
}: {
  result: SearchResult;
  onNavigate?: () => void;
}) {
  const colors = useThemeColors();
  const router = useRouter();
  const snippet = plain(result.snippet);

  return (
    <Pressable
      onPress={() => {
        onNavigate?.();
        router.push(resultRoute(result) as any);
      }}
      className="flex-row items-center gap-3 rounded-xl px-3 py-2 hover:bg-surface-overlay"
    >
      <View
        className="h-8 w-8 items-center justify-center rounded-lg flex-shrink-0"
        style={{ backgroundColor: `${colors.primary}1A` }}
      >
        <FontAwesome name={TYPE_ICON[result.type]} size={14} color={colors.primary} />
      </View>
      <View className="flex-1 min-w-0">
        <Text numberOfLines={1} className="text-typography-main text-sm font-semibold">
          {result.title || TYPE_LABEL[result.type]}
        </Text>
        {snippet ? (
          <Text numberOfLines={1} className="text-typography-muted text-[11px] mt-0.5">
            {snippet}
          </Text>
        ) : null}
      </View>
      <Text className="text-typography-muted text-[10px] flex-shrink-0">{relTime(result.created_at)}</Text>
    </Pressable>
  );
}
