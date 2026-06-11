import { useTaskDetail } from '@/contexts/TaskDetailContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { openStorageFile, SUBMISSION_BUCKET } from '@/lib/storage';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import CollapsibleCard from './CollapsibleCard';

function getCategoryUI(colors: ReturnType<typeof useThemeColors>): Record<string, { icon: string; color: string; label: string }> {
  return {
    image: { icon: 'file-image-o', color: colors.primary, label: 'Images' },
    document: { icon: 'file-pdf-o', color: colors.danger, label: 'Documents' },
    spreadsheet: { icon: 'file-excel-o', color: colors.success, label: 'Spreadsheets' },
    other: { icon: 'file-o', color: colors.textMuted, label: 'Other' },
  };
}

function formatSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

type FilterType = 'all' | 'image' | 'document' | 'spreadsheet';

export default function EvidencePanel() {
  const { data } = useTaskDetail();
  const colors = useThemeColors();
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [showPendingReview, setShowPendingReview] = useState(true);

  const { groupedEvidence, stats } = useMemo(() => {
    if (!data?.submissions) return { groupedEvidence: {}, stats: { all: 0, image: 0, document: 0, spreadsheet: 0 } };
    const categoryUI = getCategoryUI(colors);

    const filteredByStatus = showPendingReview
      ? data.submissions
      : data.submissions.filter(s => s.status === 'confirmed');

    const all = filteredByStatus.flatMap(s =>
      (s.attachments || []).map(a => {
        // Fallback for legacy items without a category column
        const cat = a.category || 'other';
        const ui = categoryUI[cat] || categoryUI.other;

        return {
          ...a,
          submitted_by: s.submitted_by?.full_name,
          submitted_at: s.submitted_at,
          stage_name: s.stage_name || 'Legacy',
          category: cat,
          icon: ui.icon,
          color: ui.color
        };
      })
    );

    const filtered = activeFilter === 'all'
      ? all
      : all.filter(a => a.category === activeFilter);

    const groups: Record<string, any[]> = {};
    filtered.forEach(item => {
      if (!groups[item.stage_name]) groups[item.stage_name] = [];
      groups[item.stage_name].push(item);
    });

    const currentStats = {
      all: all.length,
      image: all.filter(a => a.category === 'image').length,
      document: all.filter(a => a.category === 'document').length,
      spreadsheet: all.filter(a => a.category === 'spreadsheet').length,
    };

    return { groupedEvidence: groups, stats: currentStats };
  }, [data?.submissions, activeFilter, showPendingReview, colors]);

  if (!data || stats.all === 0) return null;

  return (
    <CollapsibleCard
      title="Evidence & Proofs"
      headerRight={
        <View className="flex-row items-center gap-3">
          <TouchableOpacity
            onPress={() => setShowPendingReview(!showPendingReview)}
            className={`px-2 py-1.5 rounded-lg border flex-row items-center ${showPendingReview ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
          >
            <Text className={`text-[8px] font-black uppercase tracking-tighter ${showPendingReview ? 'text-white' : 'text-typography-muted'}`}>
              {showPendingReview ? 'Show Pending' : 'Confirmed Only'}
            </Text>
          </TouchableOpacity>
          <View className="bg-brand-primary/10 px-2 py-0.5 rounded-md">
            <Text className="text-brand-primary text-[8px] font-black uppercase tracking-tighter">Verified Assets</Text>
          </View>
        </View>
      }
    >
      {/* Filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4 -mx-1">
        {(['all', 'image', 'document', 'spreadsheet'] as FilterType[]).map((f) => (
          <TouchableOpacity
            key={f}
            onPress={() => setActiveFilter(f)}
            className={`mx-1 px-3 py-1.5 rounded-lg border ${activeFilter === f ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
          >
            <Text className={`text-[10px] font-black uppercase ${activeFilter === f ? 'text-white' : 'text-typography-muted'}`}>
              {f === 'all' ? 'All' : getCategoryUI(colors)[f]?.label} ({stats[f]})
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Grouped Content */}
      <View className="gap-6">
        {Object.entries(groupedEvidence).map(([stage, items]) => (
          <View key={stage}>
            <View className="flex-row items-center mb-3">
              <View className="h-[1px] flex-1 bg-surface-border" />
              <Text className="mx-3 text-typography-muted text-[9px] font-black uppercase tracking-widest">{stage}</Text>
              <View className="h-[1px] flex-1 bg-surface-border" />
            </View>
            
            <View className="gap-2.5">
              {items.map((ev, idx) => {
                return (
                  <TouchableOpacity
                    key={`${ev.id}-${idx}`}
                    onPress={async () => {
                      openStorageFile(SUBMISSION_BUCKET, ev.storage_path || ev.file_url);
                    }}
                    className="flex-row items-center bg-surface-background p-3 rounded-xl border border-surface-border/50 active:opacity-75"
                  >
                    <View className="w-8 h-8 rounded-lg bg-surface-card items-center justify-center mr-3">
                      <FontAwesome name={ev.icon as any} size={14} color={ev.color} />
                    </View>

                    <View className="flex-1 mr-2">
                      <Text className="text-typography-main text-xs font-bold" numberOfLines={1}>
                        {ev.file_name}
                      </Text>
                      <View className="flex-row items-center mt-0.5">
                        <Text className="text-typography-muted text-[9px] uppercase font-black">
                          {formatSize(ev.file_size || 0)}
                        </Text>
                        <Text className="text-typography-muted text-[9px] mx-1.5 opacity-30">|</Text>
                        <Text className="text-typography-muted text-[9px]">
                          {ev.submitted_by}
                        </Text>
                      </View>
                    </View>

                    <FontAwesome name="external-link" size={10} color={colors.textMuted} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}
      </View>
    </CollapsibleCard>
  );
}
