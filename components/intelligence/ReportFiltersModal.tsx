import { FilterChipGroup, FilterSection } from '@/components/common/FilterPanel';
import { useThemeColors } from '@/hooks/useThemeColors';
import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Tooltip from '@/components/common/Tooltip';
import { DateRangeControls, isoDay } from '@/components/intelligence/DateRangeFilter';

export type ReportFilters = {
  statuses: string[];
  types: string[];
  dateFrom: string | null; // YYYY-MM-DD
  dateTo:   string | null; // YYYY-MM-DD
};

export const EMPTY_FILTERS: ReportFilters = { statuses: [], types: [], dateFrom: null, dateTo: null };

// tone maps to a colors.* key at render time.
const STATUS_OPTIONS = [
  { value: 'completed',  label: 'Completed',  icon: 'check-circle',     tone: 'success' as const, iconColor: '#22c55e' },
  { value: 'processing', label: 'Processing', icon: 'circle-o-notch',   tone: 'info'    as const, iconColor: '#3b82f6' },
  { value: 'pending',    label: 'Pending',    icon: 'clock-o',          tone: 'warning' as const, iconColor: '#fbbf24' },
  { value: 'failed',     label: 'Failed',     icon: 'times-circle',     tone: 'danger'  as const, iconColor: '#ef4444' },
];

export const REPORT_TYPE_OPTIONS = [
  { value: 'performance_audit',        label: 'Overview',             icon: 'file-pdf-o'   },
  { value: 'worker_comparison',        label: 'People Compare',      icon: 'users'         },
  { value: 'team_comparison',          label: 'Team Compare',        icon: 'users'         },
  { value: 'workflow_analysis',        label: 'Pipeline Review',     icon: 'rocket'        },
  { value: 'user_performance_series',  label: 'Perf Timeline',       icon: 'line-chart'    },
  { value: 'user_performance_summary', label: 'Perf Summary',        icon: 'user'          },
  { value: 'pipeline_stage_dwell',     label: 'Stage Dwell',         icon: 'clock-o'       },
  { value: 'pipeline_throughput',      label: 'Throughput',          icon: 'area-chart'    },
  { value: 'personnel_comparison',     label: 'People Cost',         icon: 'balance-scale' },
  { value: 'targets_status',           label: 'Targets & SLA',       icon: 'bullseye'      },
  { value: 'personal_pulse',           label: 'Personal Snapshot',   icon: 'heartbeat'     },
  { value: 'multi_report',             label: 'Bundle',              icon: 'files-o'       },
  { value: 'projects',                 label: 'Projects',            icon: 'folder-open-o' },
];

const MS_DAY = 86400000;

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

// Filter body only — no modal, no Popup. The reports shells mount this inside
// the slide-down panel (SlideDownPanel) directly beneath the header's Filters
// button, so opening filters does not cover the page, it expands under the
// trigger.
//
// Fully controlled: the shell owns `filters` and we write straight into it via
// `onChange`. There is deliberately no local draft copy — filters apply as you
// touch them (no Apply/Save step), so a mirrored draft would only introduce a
// reseed/auto-apply sync loop for no benefit.
type Props = {
  /** Commit a new filter state (fires on every interaction — auto-apply). */
  onChange: (filters: ReportFilters) => void;
  filters: ReportFilters;
};

export default function FilterPanelReportBody({ onChange, filters }: Props) {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const isCompact = width < 768;

  const { statuses, types, dateFrom, dateTo } = filters;

  const isDirty = statuses.length > 0 || types.length > 0 || !!dateFrom || !!dateTo;

  const toggle = (val: string, list: string[], key: 'statuses' | 'types') => {
    onChange({ ...filters, [key]: list.includes(val) ? list.filter(x => x !== val) : [...list, val] });
  };

  // DateRangeControls needs concrete dates; fall back to a sensible default
  // window when no range is active ("anytime").
  const fallbackFrom = isoDay(new Date(Date.now() - 30 * MS_DAY));
  const fallbackTo = isoDay(new Date());

  const header = (
    <View className="flex-row items-center justify-between mb-4">
      <View className="flex-row items-center gap-2">
        <FontAwesome name="filter" size={13} className="text-brand-primary" />
        <Text className="text-typography-main font-black text-sm uppercase tracking-widest">Filters</Text>
      </View>
      <Tooltip label={isDirty ? 'Clear all filters' : 'No active filters'}>
        <TouchableOpacity
          onPress={() => onChange(EMPTY_FILTERS)}
          disabled={!isDirty}
          accessibilityRole="button"
          accessibilityLabel="Clear all filters"
          className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-xl border"
          style={{
            borderColor: isDirty ? colors.danger : colors.border,
            opacity: isDirty ? 1 : 0.4,
          }}
        >
          <FontAwesome name="times" size={10} color={isDirty ? colors.danger : colors.textMuted} />
          <Text
            className="text-[10px] font-black uppercase tracking-wider"
            style={{ color: isDirty ? colors.danger : colors.textMuted }}
          >
            Clear Filters
          </Text>
        </TouchableOpacity>
      </Tooltip>
    </View>
  );

  return (
    <>
      {header}

      {/* STATUS */}
      <FilterSection label="Status">
        <FilterChipGroup>
          {STATUS_OPTIONS.map(opt => {
            const active = statuses.includes(opt.value);
            const toneColor = colors[opt.tone];
            return (
              <TouchableOpacity
                key={opt.value}
                onPress={() => toggle(opt.value, statuses, 'statuses')}
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
        </FilterChipGroup>
      </FilterSection>

      {/* TYPE */}
      <FilterSection label="Report Type" compact={isCompact}>
        <FilterChipGroup>
          {REPORT_TYPE_OPTIONS.map(opt => {
            const active = types.includes(opt.value);
            return (
              <TouchableOpacity
                key={opt.value}
                onPress={() => toggle(opt.value, types, 'types')}
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
        </FilterChipGroup>
      </FilterSection>

      {/* DATE RANGE — verbatim copy of the Performance screen's date range */}
      <FilterSection label="Date Range">
        <DateRangeControls
          from={dateFrom ?? fallbackFrom}
          to={dateTo ?? fallbackTo}
          setFrom={d => onChange({ ...filters, dateFrom: d })}
          setTo={d => onChange({ ...filters, dateTo: d })}
        />
      </FilterSection>
    </>
  );
}