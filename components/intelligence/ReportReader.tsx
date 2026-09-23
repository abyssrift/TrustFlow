import Popup from '@/components/common/Popup';
import { useThemeColors } from '@/hooks/useThemeColors';
import { FontAwesome } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { getReportReaderModel, type ReportReaderRecord, displayReportValue } from './ReportReaderModel';
export type { ReportReaderRecord } from './ReportReaderModel';
export { getReportReaderModel, displayReportValue } from './ReportReaderModel';

export default function ReportReader({
  visible, report, onClose, onRetry, onDownload, canDownload = false,
}: {
  visible: boolean;
  report?: ReportReaderRecord | null;
  onClose: () => void;
  onRetry?: () => void;
  onDownload?: () => void;
  canDownload?: boolean;
}) {
  const colors = useThemeColors();
  const model = useMemo(() => report ? getReportReaderModel(report) : null, [report]);
  if (!report || !model) return null;
  const failed = report.status === 'failed' || !!model.requiredSourceError;
  const completed = report.status === 'completed';
  return (
    <Popup visible={visible} onClose={onClose} presentation="auto" maxWidth={920}>
      <ScrollView className="max-h-[88vh]" contentContainerClassName="p-6 md:p-8">
        <View className="flex-row items-start gap-4 mb-6">
          <View className="flex-1">
            <Text accessibilityRole="header" className="text-typography-main text-2xl font-black capitalize">{model.title}</Text>
            <Text className="text-typography-muted text-xs mt-1">HTML report reader · {report.id.slice(0, 8).toUpperCase()}</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close report reader" onPress={onClose} className="h-10 w-10 items-center justify-center rounded-xl border border-surface-border bg-surface-card">
            <FontAwesome name="times" size={14} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {failed ? (
          <View accessibilityRole="alert" className="mb-6 rounded-2xl border border-state-danger/40 bg-state-danger/10 p-4">
            <Text className="text-state-danger font-black">This report is not complete</Text>
            <Text className="text-typography-main text-sm mt-1">{model.requiredSourceError || report.error_message || report.error || 'A required source was unavailable. No partial results are shown.'}</Text>
            {onRetry && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry report" onPress={onRetry} className="self-start mt-4 rounded-xl bg-state-danger px-4 py-2"><Text className="text-white font-black">Retry</Text></TouchableOpacity>}
          </View>
        ) : (
          <>
            <View className="flex-row flex-wrap gap-2 mb-6">
              {[
                ['Scope', model.scope], ['Period', model.period], ['Freshness', model.freshness],
                ['Status', displayReportValue(report.status)],
              ].map(([label, value]) => <View key={label} className="min-w-[140px] flex-1 rounded-xl border border-surface-border bg-surface-background p-3"><Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">{label}</Text><Text className="text-typography-main text-sm font-bold mt-1">{value}</Text></View>)}
            </View>
            <View className="rounded-2xl border border-surface-border bg-surface-card p-5 mb-4">
              <Text className="text-typography-main font-black">Findings</Text>
              {model.findings.length ? model.findings.map((finding, index) => <Text key={`${finding}-${index}`} className="text-typography-main text-sm leading-5 mt-3">• {finding}</Text>) : <Text className="text-typography-muted text-sm mt-3">No findings were recorded for this scope and period.</Text>}
            </View>
            <View className="rounded-2xl border border-surface-border bg-surface-card p-5 mb-4">
              <Text className="text-typography-main font-black">Actions</Text>
              {model.actions.length ? model.actions.map((action, index) => <Text key={`${action}-${index}`} className="text-typography-main text-sm leading-5 mt-3">• {action}</Text>) : <Text className="text-typography-muted text-sm mt-3">No follow-up actions were recorded.</Text>}
            </View>
            <View className="rounded-2xl border border-surface-border bg-surface-card p-5 mb-4">
              <Text className="text-typography-main font-black">Detail and definitions</Text>
              <Text className="text-typography-muted text-sm leading-5 mt-3">{model.methodology}</Text>
              {model.metrics.length > 0 && model.metrics.map((metric: any, index: number) => <View key={metric.id || index} className="flex-row items-center justify-between border-t border-surface-border mt-3 pt-3"><Text className="text-typography-main text-sm">{metric.label || metric.name || `Metric ${index + 1}`}</Text><Text className="text-typography-main text-sm font-black">{displayReportValue(metric.value ?? metric.display_value)}</Text></View>)}
              <Text className="text-typography-muted text-xs mt-4">Undefined values are shown as N/A. An observed zero remains 0; it is not treated as missing data.</Text>
              <Text className="text-typography-muted text-xs mt-2">{model.noLeader ? 'No leader: the available population has no positive outcome to rank.' : `Leader: ${model.leaders.join(', ')}`}</Text>
            </View>
          </>
        )}

        <View className="flex-row flex-wrap gap-3 justify-end mt-2">
          {completed && canDownload && onDownload && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Download report" onPress={onDownload} className="rounded-xl bg-brand-primary px-4 py-3"><Text className="text-white font-black">Download</Text></TouchableOpacity>}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close report reader" onPress={onClose} className="rounded-xl border border-surface-border bg-surface-background px-4 py-3"><Text className="text-typography-main font-black">Close</Text></TouchableOpacity>
        </View>
      </ScrollView>
    </Popup>
  );
}
