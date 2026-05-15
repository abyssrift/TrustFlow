import PremiumCalendarPicker from '@/components/common/PremiumCalendarPicker';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';

export type ReportFilters = {
  statuses: string[];
  types: string[];
  dateFrom: string | null; // YYYY-MM-DD
  dateTo:   string | null; // YYYY-MM-DD
};

export const EMPTY_FILTERS: ReportFilters = { statuses: [], types: [], dateFrom: null, dateTo: null };

const STATUS_OPTIONS = [
  {
    value: 'completed',  label: 'Completed',  icon: 'check-circle',
    activeClass: 'bg-state-success/10 border-state-success',
    textActive:  'text-state-success',
    iconColor:   'rgb(var(--state-success))',
  },
  {
    value: 'processing', label: 'Processing', icon: 'circle-o-notch',
    activeClass: 'bg-state-info/10 border-state-info',
    textActive:  'text-state-info',
    iconColor:   'rgb(var(--state-info))',
  },
  {
    value: 'pending',    label: 'Pending',    icon: 'clock-o',
    activeClass: 'bg-state-warning/10 border-state-warning',
    textActive:  'text-state-warning',
    iconColor:   'rgb(var(--state-warning))',
  },
  {
    value: 'failed',     label: 'Failed',     icon: 'times-circle',
    activeClass: 'bg-state-danger/10 border-state-danger',
    textActive:  'text-state-danger',
    iconColor:   'rgb(var(--state-danger))',
  },
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
    ? 'bg-surface-card flex-1'
    : 'bg-surface-card w-full max-w-3xl rounded-[40px] border border-surface-border premium-shadow overflow-hidden';

  const scrollMaxHeight = isCompact ? undefined : Math.min(720, height - 220);

  return (
    <Modal
      visible={visible}
      transparent={!isCompact}
      animationType={isCompact ? 'slide' : 'fade'}
      onRequestClose={onClose}
    >
      <View className={`flex-1 ${isCompact ? 'bg-surface-background' : 'bg-black/70 items-center justify-center px-4'}`}>
        <View className={containerClass}>
          {/* Header */}
          <View className={`flex-row items-center justify-between border-b border-surface-border ${isCompact ? 'px-6 pt-14 pb-5' : 'p-8'}`}>
            <View className="flex-1 pr-4">
              <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[9px] mb-1">Refine</Text>
              <Text className="text-typography-main text-2xl font-black tracking-tight">Filter Reports</Text>
              {!isCompact && (
                <Text className="text-typography-muted text-xs mt-1">Narrow down by status, type, and date range.</Text>
              )}
            </View>
            <TouchableOpacity
              onPress={onClose}
              className="w-10 h-10 items-center justify-center bg-surface-background border border-surface-border rounded-xl"
            >
              <FontAwesome name="close" size={14} color="rgb(var(--text-muted))" />
            </TouchableOpacity>
          </View>

          <ScrollView
            className={isCompact ? 'flex-1' : ''}
            style={!isCompact ? { maxHeight: scrollMaxHeight } : undefined}
            contentContainerStyle={{ padding: isCompact ? 24 : 32 }}
            showsVerticalScrollIndicator={false}
          >
            {/* STATUS */}
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Status</Text>
            <View className="flex-row flex-wrap gap-2 mb-8">
              {STATUS_OPTIONS.map(opt => {
                const active = statuses.includes(opt.value);
                return (
                  <TouchableOpacity
                    key={opt.value}
                    onPress={() => toggle(opt.value, statuses, setStatuses)}
                    className={`flex-row items-center gap-2 px-4 py-3 rounded-2xl border ${
                      active ? opt.activeClass : 'border-surface-border bg-surface-background hover:bg-surface-overlay'
                    }`}
                  >
                    <FontAwesome
                      name={opt.icon as any}
                      size={11}
                      color={active ? opt.iconColor : 'rgb(var(--text-muted))'}
                    />
                    <Text
                      className={`text-[10px] font-black uppercase tracking-widest ${
                        active ? opt.textActive : 'text-typography-muted'
                      }`}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* TYPE */}
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Report Type</Text>
            <View className="flex-row flex-wrap gap-2 mb-8">
              {REPORT_TYPE_OPTIONS.map(opt => {
                const active = types.includes(opt.value);
                return (
                  <TouchableOpacity
                    key={opt.value}
                    onPress={() => toggle(opt.value, types, setTypes)}
                    className={`flex-row items-center gap-2 px-4 py-3 rounded-2xl border ${
                      active
                        ? 'bg-brand-primary border-brand-primary'
                        : 'border-surface-border bg-surface-background hover:bg-surface-overlay'
                    }`}
                  >
                    <FontAwesome
                      name={opt.icon as any}
                      size={11}
                      color={active ? 'white' : 'rgb(var(--text-muted))'}
                    />
                    <Text
                      className={`text-[10px] font-black uppercase tracking-widest ${
                        active ? 'text-white' : 'text-typography-muted'
                      }`}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* DATE RANGE */}
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em]">Date Range</Text>
              {(dateFrom || dateTo) && (
                <TouchableOpacity onPress={clearDates}>
                  <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">Clear Dates</Text>
                </TouchableOpacity>
              )}
            </View>

            <View className="flex-row flex-wrap gap-2 mb-5">
              {DATE_PRESETS.map(p => (
                <TouchableOpacity
                  key={p.label}
                  onPress={() => applyPreset(p.days)}
                  className="flex-1 min-w-[80px] py-3 rounded-xl border border-surface-border bg-surface-background hover:bg-surface-overlay"
                >
                  <Text className="text-center text-typography-muted font-black text-[10px] uppercase tracking-widest">
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* From / To selector */}
            <View className="flex-row gap-2 mb-5">
              <TouchableOpacity
                onPress={() => setActiveDateField('from')}
                className={`flex-1 py-4 px-4 rounded-2xl border ${
                  activeDateField === 'from'
                    ? 'bg-brand-primary/10 border-brand-primary'
                    : 'border-surface-border bg-surface-background'
                }`}
              >
                <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest text-center">From</Text>
                <Text
                  className={`text-center font-black text-sm mt-1 ${
                    activeDateField === 'from' ? 'text-brand-primary' : 'text-typography-main'
                  }`}
                  numberOfLines={1}
                >
                  {dateFrom ?? 'Anytime'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setActiveDateField('to')}
                className={`flex-1 py-4 px-4 rounded-2xl border ${
                  activeDateField === 'to'
                    ? 'bg-brand-primary/10 border-brand-primary'
                    : 'border-surface-border bg-surface-background'
                }`}
              >
                <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest text-center">To</Text>
                <Text
                  className={`text-center font-black text-sm mt-1 ${
                    activeDateField === 'to' ? 'text-brand-primary' : 'text-typography-main'
                  }`}
                  numberOfLines={1}
                >
                  {dateTo ?? 'Anytime'}
                </Text>
              </TouchableOpacity>
            </View>

            <PremiumCalendarPicker
              compact
              selectedDate={activeDateField === 'from' ? dateFrom : dateTo}
              onSelect={(date) => {
                if (activeDateField === 'from') {
                  setDateFrom(date);
                  if (!dateTo) setActiveDateField('to');
                } else {
                  setDateTo(date);
                }
              }}
            />
          </ScrollView>

          {/* Footer */}
          <View
            className={`flex-row gap-3 border-t border-surface-border bg-surface-card/50 ${
              isCompact ? 'px-6 py-5 pb-8' : 'p-8'
            }`}
          >
            <TouchableOpacity
              onPress={handleClearAll}
              className="flex-1 py-4 rounded-2xl bg-surface-background border border-surface-border items-center"
            >
              <Text className="text-typography-muted font-black uppercase tracking-widest text-[11px]">Clear All</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleApply}
              className="flex-[2] py-4 rounded-2xl bg-brand-primary items-center"
            >
              <Text className="text-white font-black uppercase tracking-widest text-[11px]">Apply Filters</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
