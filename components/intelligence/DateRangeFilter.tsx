import Calendar from '@/components/common/Calendar';
import { bucketsForWidth } from '@/lib/chartBuckets';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useState } from 'react';
import { Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';

// Shared calendar-based time filter for all Intelligence screens (#139).
// One start + end calendar with the days between highlighted, plus quick
// presets. Replaces the scattered 4W/8W/6M/12M / 7d/30d/60d/90d buttons.

const MS_DAY = 86400000;

export const isoDay = (d: Date) => d.toISOString().split('T')[0];

export function daysBetween(from: string, to: string): number {
  return Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / MS_DAY));
}

export function useDateRange(defaultDays = 56) {
  const today = new Date();
  const [from, setFrom] = useState(isoDay(new Date(today.getTime() - defaultDays * MS_DAY)));
  const [to, setTo] = useState(isoDay(today));
  return { from, to, setFrom, setTo, nDays: daysBetween(from, to) };
}

export interface Granularity {
  buckets: number;
  isAuto: boolean;
  set: (n: number) => void;
  reset: () => void;
}

/**
 * Single source of truth for graph granularity on an Intelligence screen.
 * Auto = decided by screen width (bigger screen = finer grain); the user can
 * override it from the top filter bar. Instantiate ONCE per screen and pass
 * `buckets` down to every graph.
 */
export function useGranularity(): Granularity {
  const { width } = useWindowDimensions();
  const [override, setOverride] = useState<number | null>(null);
  return {
    buckets: override ?? bucketsForWidth(width),
    isAuto: override === null,
    set: (n: number) => setOverride(Math.min(31, Math.max(2, n))),
    reset: () => setOverride(null),
  };
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Shared pipeline picker for the top filter bar — single source of truth for
 * which pipeline the graphs on a screen show (#139). Replaces the per-chart
 * pipeline tabs.
 */
export function PipelineSelector({ pipelines, selectedId, onSelect }: {
  pipelines: { id: string; name: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (pipelines.length < 2) return null;
  return (
    <View className="flex-row bg-surface-card border border-surface-border rounded-xl p-1 gap-0.5 max-w-full flex-wrap">
      {pipelines.map(p => (
        <TouchableOpacity
          key={p.id}
          onPress={() => onSelect(p.id)}
          className={`px-3.5 py-2 rounded-lg max-w-[180px] ${selectedId === p.id ? 'bg-brand-primary' : ''}`}
        >
          <Text className={`text-[11px] font-black text-center ${selectedId === p.id ? 'text-white' : 'text-typography-muted'}`} numberOfLines={1}>
            {p.name}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const PRESETS = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: '6M', days: 180 },
  { label: '12M', days: 365 },
];

/**
 * The From -> To pill pair + single range-mode Calendar popup, on its own
 * (issue #262). This is the piece other screens want without the preset row
 * or the granularity stepper — DateRangeControls below composes it with
 * those for the full Intelligence filter bar. `from`/`to` accept `null` for
 * an open-ended/"Anytime" state (shows `placeholder` instead of a date).
 */
export function DateRangePillPicker({ from, to, onApply, maxDays, active = true, placeholder = 'Select', fromPlaceholder, toPlaceholder, onClear }: {
  from: string | null; to: string | null;
  onApply: (from: string, to: string) => void;
  maxDays?: number | null;
  /** Brand-tint the pills (defaults on — pass false when a sibling preset row already owns the active styling). */
  active?: boolean;
  placeholder?: string;
  /** Overrides for the From/To pill labels when the respective date is unset (defaults to `placeholder`). */
  fromPlaceholder?: string;
  toPlaceholder?: string;
  /** When provided, renders a trailing clear button (shown once a date is set) that resets the range. */
  onClear?: () => void;
}) {
  const colors = useThemeColors();
  const [showRangePicker, setShowRangePicker] = useState(false);
  const tint = active ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-card border-surface-border';
  const iconColor = active ? colors.primary : colors.textMuted;
  const textClass = active ? 'text-brand-primary' : 'text-typography-muted';

  return (
    <>
      <View className="flex-row items-center gap-2">
        <TouchableOpacity
          onPress={() => setShowRangePicker(true)}
          className={`px-3.5 py-2 rounded-xl border flex-row items-center gap-2 ${tint}`}
        >
          <FontAwesome name="calendar-o" size={11} color={iconColor} />
          <Text className={`text-[11px] font-bold ${textClass}`}>{from ? fmtDate(from) : (fromPlaceholder ?? placeholder)}</Text>
        </TouchableOpacity>
        <Text className="text-typography-dim font-bold">→</Text>
        <TouchableOpacity
          onPress={() => setShowRangePicker(true)}
          className={`px-3.5 py-2 rounded-xl border flex-row items-center gap-2 ${tint}`}
        >
          <FontAwesome name="calendar-o" size={11} color={iconColor} />
          <Text className={`text-[11px] font-bold ${textClass}`}>{to ? fmtDate(to) : (toPlaceholder ?? placeholder)}</Text>
        </TouchableOpacity>

        {onClear && (from || to) && (
          <TouchableOpacity
            onPress={onClear}
            accessibilityLabel="Clear date range"
            className="px-3 py-2 rounded-xl border items-center justify-center"
            style={{ borderColor: colors.border }}
          >
            <FontAwesome name="times" size={11} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <Calendar
        visible={showRangePicker}
        onClose={() => setShowRangePicker(false)}
        onSelect={() => {}}
        mode="range"
        dual_display
        showQuickSelect
        selectedDate={from}
        rangeDate={to}
        maxDays={maxDays}
        onApplyRange={onApply}
        accentColor={colors.primary}
        rangeColor={colors.secondary}
      />
    </>
  );
}

export function DateRangeControls({ from, to, setFrom, setTo, maxDays, granularity }: {
  from: string; to: string; setFrom: (d: string) => void; setTo: (d: string) => void;
  maxDays?: number | null;
  granularity?: Granularity;
}) {
  const colors = useThemeColors();

  // Active preset is derived, not stored: highlighted only when the range
  // actually matches "last N days ending today".
  const nDays = daysBetween(from, to);
  const endsToday = to === isoDay(new Date());
  const activePreset = endsToday ? PRESETS.find(p => p.days === nDays)?.days ?? null : null;

  const clampFrom = (date: string, end: string) => {
    if (!maxDays) return date;
    const min = new Date(new Date(end).getTime() - maxDays * MS_DAY);
    return new Date(date) < min ? isoDay(min) : date;
  };

  const applyPreset = (days: number) => {
    const today = new Date();
    setFrom(clampFrom(isoDay(new Date(today.getTime() - days * MS_DAY)), isoDay(today)));
    setTo(isoDay(today));
  };

  return (
    <View className="flex-row flex-wrap items-center gap-2">
      {PRESETS.map(p => {
        const locked = !!maxDays && p.days > maxDays;
        const active = activePreset === p.days;
        return (
          <TouchableOpacity
            key={p.label}
            onPress={() => !locked && applyPreset(p.days)}
            disabled={locked}
            className={`px-3.5 py-2 rounded-xl border flex-row items-center gap-1 ${active ? 'bg-brand-primary border-brand-primary' : `bg-surface-card border-surface-border ${locked ? 'opacity-40' : ''}`}`}
          >
            <Text className={`text-[11px] font-black ${active ? 'text-white' : 'text-typography-muted'}`}>{p.label}</Text>
            {locked && <FontAwesome name="lock" size={8} color={colors.textMuted} />}
          </TouchableOpacity>
        );
      })}

      <DateRangePillPicker
        from={from}
        to={to}
        active={activePreset === null}
        maxDays={maxDays}
        onApply={(f, t) => { setFrom(f); setTo(t); }}
      />

      {granularity && (
        <View className="flex-row items-center bg-surface-card border border-surface-border rounded-xl px-1 py-0.5 gap-0.5">
          <FontAwesome name="signal" size={10} color={colors.textMuted} style={{ marginLeft: 6, marginRight: 2 }} />
          <TouchableOpacity onPress={() => granularity.set(granularity.buckets - 1)} className="px-2 py-1.5">
            <Text className="text-typography-muted text-xs font-black">−</Text>
          </TouchableOpacity>
          <Text className="text-typography-main text-[11px] font-black min-w-[18px] text-center">{granularity.buckets}</Text>
          <TouchableOpacity onPress={() => granularity.set(granularity.buckets + 1)} className="px-2 py-1.5">
            <Text className="text-typography-muted text-xs font-black">+</Text>
          </TouchableOpacity>
          {!granularity.isAuto && (
            <TouchableOpacity onPress={granularity.reset} className="px-2 py-1.5">
              <Text className="text-brand-primary text-[9px] font-black uppercase">Auto</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}
