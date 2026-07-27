import Popup from '@/components/common/Popup';
import PremiumCalendarPicker from '@/components/common/PremiumCalendarPicker';
import { FontAwesome } from '@expo/vector-icons';
import { useThemeColors } from '@/hooks/useThemeColors';
import React, { useEffect, useState } from 'react';
import { Modal, Platform, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Tooltip from '@/components/common/Tooltip';

export type ReportFilters = {
  statuses: string[];
  types: string[];
  dateFrom: string | null; // YYYY-MM-DD
  dateTo:   string | null; // YYYY-MM-DD
};

export const EMPTY_FILTERS: ReportFilters = { statuses: [], types: [], dateFrom: null, dateTo: null };

// tone maps to a colors.* key at render time — these render inside a <Modal>
// subtree, so theme tokens must be resolved via useThemeColors(), not classNames.
const STATUS_OPTIONS = [
  { value: 'completed',  label: 'Completed',  icon: 'check-circle',     tone: 'success' as const, iconColor: '#22c55e' },
  { value: 'processing', label: 'Processing', icon: 'circle-o-notch',   tone: 'info'    as const, iconColor: '#3b82f6' },
  { value: 'pending',    label: 'Pending',    icon: 'clock-o',          tone: 'warning' as const, iconColor: '#fbbf24' },
  { value: 'failed',     label: 'Failed',     icon: 'times-circle',     tone: 'danger'  as const, iconColor: '#ef4444' },
];

export const REPORT_TYPE_OPTIONS = [
  { value: 'performance_audit',        label: 'Overview',             icon: 'bar-chart'     },
  { value: 'worker_comparison',        label: 'People Compare',       icon: 'users'         },
  { value: 'team_comparison',          label: 'Team Compare',         icon: 'group'         },
  { value: 'workflow_analysis',        label: 'Pipeline Review',      icon: 'rocket'        },
  { value: 'user_performance_series',  label: 'Perf Timeline',        icon: 'line-chart'    },
  { value: 'user_performance_summary', label: 'Perf Summary',         icon: 'user'          },
  { value: 'pipeline_stage_dwell',     label: 'Stage Dwell',          icon: 'clock-o'       },
  { value: 'pipeline_throughput',      label: 'Throughput',           icon: 'area-chart'    },
  { value: 'personnel_comparison',     label: 'People Cost',          icon: 'balance-scale' },
  { value: 'targets_status',           label: 'Targets & SLA',        icon: 'bullseye'      },
  { value: 'personal_pulse',           label: 'Personal Snapshot',    icon: 'heartbeat'     },
  { value: 'multi_report',             label: 'Bundle',               icon: 'files-o'       },
  { value: 'projects',                 label: 'Projects',             icon: 'folder-open-o' },
];

const DATE_PRESETS = [
  { label: 'Today',    days: 0  },
  { label: 'Last 7d',  days: 7  },
  { label: 'Last 30d', days: 30 },
  { label: 'Last 90d', days: 90 },
];

const isoDate = (d: Date) => d.toISOString().split('T')[0];

export function applyReportFilters<T extends { status: string; report_type: string; created_at: string }>(
  reports: T[],
  f: ReportFilters,
): T[] {
  if (!f.statuses.length && !f.types.length && !f.dateFrom && !f.dateTo) return reports;
  const fromTs = f.dateFrom ? new Date(f.dateFrom + 'T00:00:00').getTime() : null;
  const toTs   = f.dateTo   ? new Date(f.dateTo   + 'T23:59:59').getTime() : null;
  return reports.filter(r => {
    if (f.statuses.length && !f.statuses.includes(r.status)) return false;
    if (f.types.length && !f.types.includes(r.report_type)) return false;
    if (fromTs !== null || toTs !== null) {
      const t = new Date(r.created_at).getTime();
      if (fromTs !== null && t < fromTs) return false;
      if (toTs !== null && t > toTs) return false;
    }
    return true;
  });
}

export function countActiveFilters(f: ReportFilters): number {
  let c = 0;
  if (f.statuses.length) c++;
  if (f.types.length) c++;
  if (f.dateFrom || f.dateTo) c++;
  return c;
}

export function describeDateRange(f: ReportFilters): string | null {
  if (!f.dateFrom && !f.dateTo) return null;
  if (f.dateFrom && f.dateTo) return `${f.dateFrom} → ${f.dateTo}`;
  if (f.dateFrom) return `From ${f.dateFrom}`;
  return `Until ${f.dateTo}`;
}

type Props = {
  visible: boolean;
  onClose: () => void;
  onApply: (filters: ReportFilters) => void;
  initial: ReportFilters;
};

export default function ReportFiltersModal({ visible, onClose, onApply, initial }: Props) {
  const colors = useThemeColors();
  const { width, height } = useWindowDimensions();
  const isCompact = width < 768;

  const [statuses, setStatuses] = useState<string[]>(initial.statuses);
  const [types, setTypes]       = useState<string[]>(initial.types);
  const [dateFrom, setDateFrom] = useState<string | null>(initial.dateFrom);
  const [dateTo, setDateTo]     = useState<string | null>(initial.dateTo);
  const [activeDateField, setActiveDateField] = useState<'from' | 'to'>('from');

  useEffect(() => {
    if (visible) {
      setStatuses(initial.statuses);
      setTypes(initial.types);
      setDateFrom(initial.dateFrom);
      setDateTo(initial.dateTo);
      setActiveDateField('from');
    }
  }, [visible, initial]);

  const toggle = (val: string, list: string[], set: (v: string[]) => void) => {
    set(list.includes(val) ? list.filter(x => x !== val) : [...list, val]);
  };

  const applyPreset = (days: number) => {
    const today = new Date();
    const from = new Date();
    from.setDate(today.getDate() - days);
    setDateFrom(isoDate(from));
    setDateTo(isoDate(today));
  };

  const clearDates = () => {
    setDateFrom(null);
    setDateTo(null);
  };

  const handleClearAll = () => {
    setStatuses([]);
    setTypes([]);
    clearDates();
  };

  const handleApply = () => {
    onApply({ statuses, types, dateFrom, dateTo });
    onClose();
  };

  const containerClass = isCompact
    ? 'flex-1'
    : 'w-full max-w-3xl rounded-[40px] premium-shadow overflow-hidden';

  const scrollMaxHeight = isCompact ? undefined : Math.min(720, height - 220);

  const content = (
        <>
          {/* Header */}
          <View
            className={`flex-row items-center justify-between ${isCompact ? 'px-6 pt-14 pb-5' : 'p-8'}`}
            style={{ borderBottomWidth: 1, borderColor: colors.border }}
          >
            <View className="flex-1 pr-4">
              <Text className="font-black uppercase tracking-[0.3em] text-[9px] mb-1" style={{ color: colors.primary }}>Refine</Text>
              <Text className="text-2xl font-black tracking-tight" style={{ color: colors.textMain }}>Filter Reports</Text>
              {!isCompact && (
                <Text className="text-xs mt-1" style={{ color: colors.textMuted }}>Narrow down by status, type, and date range.</Text>
              )}
            </View>
            <Tooltip label="Close">
              <TouchableOpacity
                onPress={onClose}
                className="w-10 h-10 items-center justify-center rounded-xl"
                style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}
              >
                <FontAwesome name="close" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            </Tooltip>
          </View>

          <ScrollView
            className={isCompact ? 'flex-1' : ''}
            style={!isCompact ? { maxHeight: scrollMaxHeight } : undefined}
            contentContainerStyle={{ padding: isCompact ? 24 : 32 }}
            showsVerticalScrollIndicator={false}
          >
            {/* STATUS */}
            <Text className="text-[10px] font-black uppercase tracking-[0.2em] mb-4" style={{ color: colors.textMuted }}>Status</Text>
            <View className="flex-row flex-wrap gap-2 mb-8">
              {STATUS_OPTIONS.map(opt => {
                const active = statuses.includes(opt.value);
                const toneColor = colors[opt.tone];
                return (
                  <TouchableOpacity
                    key={opt.value}
                    onPress={() => toggle(opt.value, statuses, setStatuses)}
                    className="flex-row items-center gap-2 px-4 py-3 rounded-2xl border hover:bg-surface-overlay"
                    style={{
                      backgroundColor: active ? toneColor + '1A' : colors.background,
                      borderColor: active ? toneColor : colors.border,
                    }}
                  >
                    <FontAwesome
                      name={opt.icon as any}
                      size={11}
                      color={active ? opt.iconColor : colors.textMuted}
                    />
                    <Text
                      className="text-[10px] font-black uppercase tracking-widest"
                      style={{ color: active ? toneColor : colors.textMuted }}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* TYPE */}
            <Text className="text-[10px] font-black uppercase tracking-[0.2em] mb-4" style={{ color: colors.textMuted }}>Report Type</Text>
            <View className="flex-row flex-wrap gap-2 mb-8">
              {REPORT_TYPE_OPTIONS.map(opt => {
                const active = types.includes(opt.value);
                return (
                  <TouchableOpacity
                    key={opt.value}
                    onPress={() => toggle(opt.value, types, setTypes)}
                    className="flex-row items-center gap-2 px-4 py-3 rounded-2xl border hover:bg-surface-overlay"
                    style={{
                      backgroundColor: active ? colors.primary : colors.background,
                      borderColor: active ? colors.primary : colors.border,
                    }}
                  >
                    <FontAwesome
                      name={opt.icon as any}
                      size={11}
                      color={active ? 'white' : colors.textMuted}
                    />
                    <Text
                      className="text-[10px] font-black uppercase tracking-widest"
                      style={{ color: active ? '#fff' : colors.textMuted }}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* DATE RANGE */}
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: colors.textMuted }}>Date Range</Text>
              {(dateFrom || dateTo) && (
                <TouchableOpacity onPress={clearDates}>
                  <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.primary }}>Clear Dates</Text>
                </TouchableOpacity>
              )}
            </View>

            <View className="flex-row flex-wrap gap-2 mb-5">
              {DATE_PRESETS.map(p => (
                <TouchableOpacity
                  key={p.label}
                  onPress={() => applyPreset(p.days)}
                  className="flex-1 min-w-[80px] py-3 rounded-xl hover:bg-surface-overlay"
                  style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background }}
                >
                  <Text className="text-center font-black text-[10px] uppercase tracking-widest" style={{ color: colors.textMuted }}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* From / To selector */}
            <View className="flex-row gap-2 mb-5">
              <TouchableOpacity
                onPress={() => setActiveDateField('from')}
                className="flex-1 py-4 px-4 rounded-2xl border"
                style={{
                  backgroundColor: activeDateField === 'from' ? colors.primary + '1A' : colors.background,
                  borderColor: activeDateField === 'from' ? colors.primary : colors.border,
                }}
              >
                <Text className="text-[9px] font-black uppercase tracking-widest text-center" style={{ color: colors.textMuted }}>From</Text>
                <Text
                  className="text-center font-black text-sm mt-1"
                  style={{ color: activeDateField === 'from' ? colors.primary : colors.textMain }}
                  numberOfLines={1}
                >
                  {dateFrom ?? 'Anytime'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setActiveDateField('to')}
                className="flex-1 py-4 px-4 rounded-2xl border"
                style={{
                  backgroundColor: activeDateField === 'to' ? colors.primary + '1A' : colors.background,
                  borderColor: activeDateField === 'to' ? colors.primary : colors.border,
                }}
              >
                <Text className="text-[9px] font-black uppercase tracking-widest text-center" style={{ color: colors.textMuted }}>To</Text>
                <Text
                  className="text-center font-black text-sm mt-1"
                  style={{ color: activeDateField === 'to' ? colors.primary : colors.textMain }}
                  numberOfLines={1}
                >
                  {dateTo ?? 'Anytime'}
                </Text>
              </TouchableOpacity>
            </View>

            <PremiumCalendarPicker
              scale="compact"
              showDaysBetween
              selectedDate={activeDateField === 'from' ? dateFrom : dateTo}
              onSelect={(date) => {
                if (activeDateField === 'from') {
                  setDateFrom(date);
                  if (!dateTo) setActiveDateField('to');
                } else {
                  setDateTo(date);
                }
              }}
              accentColor={activeDateField === 'from' ? colors.primary : colors.secondary}
              rangeDate={activeDateField === 'from' ? dateTo : dateFrom}
              rangeColor={activeDateField === 'from' ? colors.secondary : colors.primary}
            />
          </ScrollView>

          {/* Footer */}
          <View
            className={`flex-row gap-3 ${isCompact ? 'px-6 py-5 pb-8' : 'p-8'}`}
            style={{ borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.card + '80' }}
          >
            <TouchableOpacity
              onPress={handleClearAll}
              className="flex-1 py-4 rounded-2xl items-center"
              style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}
            >
              <Text className="font-black uppercase tracking-widest text-[11px]" style={{ color: colors.textMuted }}>Clear All</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleApply}
              className="flex-[2] py-4 rounded-2xl items-center"
              style={{ backgroundColor: colors.primary }}
            >
              <Text className="text-white font-black uppercase tracking-widest text-[11px]">Apply Filters</Text>
            </TouchableOpacity>
          </View>
        </>
  );

  if (Platform.OS === 'web') {
    return (
      <Popup
        visible={visible}
        onClose={onClose}
        presentation="auto"
        scrollable={false}
        maxWidth={768}
        containerClassName="rounded-[40px] premium-shadow overflow-hidden"
      >
        {content}
      </Popup>
    );
  }

  // TODO(#93-native): remove this branch once native is testable — see issue #93/#115.
  // Old raw-Modal path preserved untouched so native behavior doesn't change yet.
  return (
    <Modal
      visible={visible}
      transparent={!isCompact}
      animationType={isCompact ? 'slide' : 'fade'}
      onRequestClose={onClose}
    >
      <View
        className={`flex-1 ${isCompact ? '' : 'bg-black/70 items-center justify-center px-4'}`}
        style={isCompact ? { backgroundColor: colors.background } : undefined}
      >
        <View className={containerClass} style={{ backgroundColor: colors.card, ...(isCompact ? {} : { borderWidth: 1, borderColor: colors.border }) }}>
          {content}
        </View>
      </View>
    </Modal>
  );
}
