import { useThemeColors } from '@/hooks/useThemeColors';
import Tooltip from '@/components/common/Tooltip';
import { FontAwesome } from '@expo/vector-icons';
import React, { useCallback, useState } from 'react';
import { LayoutChangeEvent, Text, TouchableOpacity, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import Popup from './Popup';
import { useCalendarMonth, MonthGrid, QUICK_ACTIONS, getQuickActionDate } from '@/lib/calendarPicker';
import { useCalendarPickerLayout } from '@/lib/calendarPicker';
import type { CalendarScale } from '@/lib/calendarPicker';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

const MS_DAY = 86400000;

const RANGE_PRESETS = [
  { label: '7D',  days: 7   },
  { label: '30D', days: 30  },
  { label: '90D', days: 90  },
  { label: '6M',  days: 180 },
  { label: '12M', days: 365 },
];

const fmtISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysBetween = (from: string, to: string) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / MS_DAY);
const fmtShort = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type CalendarProps = {
  selectedDate?: string | null;
  onSelect: (date: string) => void;
  rangeDate?: string | null;
  accentColor?: string;
  rangeColor?: string;
  scale?: CalendarScale;
  showDaysBetween?: boolean;
  showQuickSelect?: boolean;

  mode?: 'single' | 'range';
  onApplyRange?: (from: string, to: string) => void;
  maxDays?: number | null;
  onUpgrade?: () => void;

  visible?: boolean;
  onClose?: () => void;
  title?: string;
  dual_display?: boolean;
  sidebarContent?: React.ReactNode;

  floatingStyle?: any;
};

function QuickMenuSidebar({ onSelect, isFull, isFloating }: { onSelect: (date: string) => void; isFull: boolean; isFloating?: boolean }) {
  if (isFloating && !isFull) {
    return (
      <View className="w-[124px] bg-surface-background/50 border-r border-surface-border p-2.5">
        <Text className="text-typography-main text-sm font-black uppercase tracking-wider text-center px-1 pt-0.5 pb-2.5 mb-2 border-b border-surface-border">Quick</Text>
        <View className="flex-1 justify-between">
          {QUICK_ACTIONS.map(action => (
            <TouchableOpacity key={action.label} onPress={() => onSelect(getQuickActionDate(action.days))} className="px-2.5 py-2 rounded-lg hover:bg-surface-overlay active:opacity-60">
              <Text className="text-typography-main font-bold text-[10px] uppercase tracking-wide">{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }
  return (
    <View className={`${isFull ? 'w-44 p-5' : 'w-[124px] p-2.5'} bg-surface-background/50`}>
      <Text className={`text-typography-main font-black uppercase tracking-wider text-center px-1 border-b border-surface-border ${isFull ? 'text-base pt-0.5 pb-3 mb-3' : 'text-sm pt-0.5 pb-2.5 mb-2'}`}>Quick</Text>
      <View className="flex-1 justify-between">
        {QUICK_ACTIONS.map(action => (
          <TouchableOpacity key={action.label} onPress={() => onSelect(getQuickActionDate(action.days))} className={`rounded-lg hover:bg-surface-overlay active:opacity-60 ${isFull ? 'px-3.5 py-3' : 'px-2.5 py-2'}`}>
            <Text className={`text-typography-main font-bold uppercase tracking-wide ${isFull ? 'text-xs' : 'text-[10px]'}`}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function RangePresetRail({ maxDays, onPreset, onShowUpgrade }: {
  maxDays: number | null;
  onPreset: (days: number) => void;
  onShowUpgrade: (msg: string) => void;
}) {
  return (
    <View className="w-44 p-5 bg-surface-background/50">
      <Text className="text-typography-dim text-[9px] font-black uppercase tracking-[0.15em] mb-3">Presets</Text>
      {RANGE_PRESETS.map(p => {
        const locked = maxDays !== null && p.days > maxDays;
        return (
          <TouchableOpacity
            key={p.label}
            onPress={() => {
              if (locked) onShowUpgrade(`This range exceeds your plan's ${maxDays}-day limit. Upgrade to unlock longer ranges.`);
              else onPreset(p.days);
            }}
            className="flex-row items-center px-3 py-2.5 rounded-lg active:opacity-60"
          >
            <Text className={`text-typography-main font-bold text-[11px] uppercase tracking-wider ${locked ? 'opacity-40' : ''}`}>{p.label}</Text>
            {locked && <Text className="text-typography-dim text-[9px] ml-auto">Locked</Text>}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function Calendar({
  selectedDate: selectedDateProp = null,
  onSelect,
  rangeDate: rangeDateProp = null,
  accentColor,
  rangeColor,
  scale,
  showDaysBetween = true,
  showQuickSelect,
  mode = 'single',
  onApplyRange,
  maxDays = null,
  onUpgrade,
  visible,
  onClose,
  title,
  dual_display: dualDisplayProp,
  sidebarContent,
  floatingStyle,
}: CalendarProps) {
  const colors = useThemeColors();
  const resolvedAccentColor = accentColor ?? colors.primary;
  const resolvedRangeColor = rangeColor ?? colors.secondary;

  const isFloating = !!floatingStyle;
  const isPopup = visible !== undefined;
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setMeasuredWidth(prev => prev !== w ? w : prev);
  }, []);

  const layout = useCalendarPickerLayout({ scale, showQuickSelect });
  const resolvedCompact = isPopup
    ? (!scale || scale === 'compact')
    : (isFloating ? layout.resolvedCompact : (scale ? scale === 'compact' : (measuredWidth ? measuredWidth <= 768 : true)));
  const resolvedShowQuickSelect = isPopup
    ? (showQuickSelect ?? false)
    : (isFloating ? layout.resolvedShowQuickSelect : (showQuickSelect ?? (measuredWidth != null && !resolvedCompact && measuredWidth > 768 ? true : false)));
  const showTwoMonths = isFloating ? layout.isDesktop : (isPopup ? (dualDisplayProp ?? false) : false);
  const resolvedScale: CalendarScale = resolvedCompact ? 'compact' : 'full';
  const isFull = !resolvedCompact;

  const [rangeStart, setRangeStart] = useState<string | null>(mode === 'range' ? selectedDateProp : null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(mode === 'range' ? rangeDateProp : null);
  const [rangePhase, setRangePhase] = useState<'idle' | 'pending' | 'committed'>(
    mode === 'range' && selectedDateProp && rangeDateProp ? 'committed' : 'idle',
  );
  const [upgradeMsg, setUpgradeMsg] = useState<string | null>(null);

  const calSelected = mode === 'range' ? rangeStart : selectedDateProp;
  const calRange = mode === 'range' ? rangeEnd : rangeDateProp;
  const cal = useCalendarMonth(calSelected, calRange);

  const handleDayClick = useCallback((date: string) => {
    if (mode === 'single') { onSelect(date); return; }
    setUpgradeMsg(null);
    if (rangePhase === 'idle' || rangePhase === 'committed') { setRangeStart(date); setRangeEnd(null); setRangePhase('pending'); return; }
    if (rangePhase === 'pending' && rangeStart) {
      const start = new Date(rangeStart).getTime();
      const end = new Date(date).getTime();
      const from = fmtISO(new Date(Math.min(start, end)));
      const to = fmtISO(new Date(Math.max(start, end)));
      const nDays = daysBetween(from, to) + 1;
      if (maxDays !== null && nDays > maxDays) { setUpgradeMsg(`This range (${nDays} days) exceeds your plan's ${maxDays}-day limit. Upgrade to unlock longer ranges.`); return; }
      setRangeStart(from); setRangeEnd(to); setRangePhase('committed');
    }
  }, [mode, rangePhase, rangeStart, maxDays, onSelect]);

  const handlePreset = useCallback((days: number) => {
    setUpgradeMsg(null);
    const from = fmtISO(new Date(Date.now() - (days - 1) * MS_DAY));
    const to = fmtISO(new Date());
    const nDays = daysBetween(from, to) + 1;
    if (maxDays !== null && nDays > maxDays) { setUpgradeMsg(`This range (${nDays} days) exceeds your plan's ${maxDays}-day limit. Upgrade to unlock longer ranges.`); return; }
    setRangeStart(from); setRangeEnd(to); setRangePhase('committed');
  }, [maxDays]);

  const handleApply = useCallback(() => {
    if (rangeStart && rangeEnd) {
      const from = fmtISO(new Date(Math.min(new Date(rangeStart).getTime(), new Date(rangeEnd).getTime())));
      const to = fmtISO(new Date(Math.max(new Date(rangeStart).getTime(), new Date(rangeEnd).getTime())));
      onApplyRange?.(from, to);
    }
    onClose?.();
  }, [rangeStart, rangeEnd, onApplyRange, onClose]);

  const displayFrom = mode === 'range' && rangePhase === 'committed' && rangeStart && rangeEnd
    ? fmtISO(new Date(Math.min(new Date(rangeStart).getTime(), new Date(rangeEnd).getTime()))) : null;
  const displayTo = mode === 'range' && rangePhase === 'committed' && rangeStart && rangeEnd
    ? fmtISO(new Date(Math.max(new Date(rangeStart).getTime(), new Date(rangeEnd).getTime()))) : null;
  const displayDays = displayFrom && displayTo ? daysBetween(displayFrom, displayTo) + 1 : null;

  const rangeModeSidebar = mode === 'range' && (sidebarContent ?? (showQuickSelect ? <RangePresetRail maxDays={maxDays} onPreset={handlePreset} onShowUpgrade={setUpgradeMsg} /> : null));
  const singleModeSidebar = mode === 'single' && (sidebarContent ?? (resolvedShowQuickSelect ? <QuickMenuSidebar onSelect={handleDayClick} isFull={isFull} isFloating={isFloating} /> : null));
  const resolvedSidebar = mode === 'range' ? rangeModeSidebar : singleModeSidebar;

  const commonContent = (
    <>
      {mode === 'range' && upgradeMsg && (
        <View className="mx-5 mt-3 p-4 rounded-2xl border" style={{ backgroundColor: colors.warning + '15', borderColor: colors.warning + '40' }}>
          <Text className="text-xs font-bold mb-2" style={{ color: colors.warning }}>{upgradeMsg}</Text>
          <View className="flex-row gap-3">
            {onUpgrade && <TouchableOpacity onPress={onUpgrade} className="px-4 py-2 rounded-xl" style={{ backgroundColor: colors.primary }}><Text className="text-white text-[10px] font-black uppercase tracking-widest">Upgrade</Text></TouchableOpacity>}
            <TouchableOpacity onPress={() => setUpgradeMsg(null)} className="px-4 py-2 rounded-xl" style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}><Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Dismiss</Text></TouchableOpacity>
          </View>
        </View>
      )}

      <View className={`flex-row items-center justify-between border-b border-surface-border bg-surface-background/30 ${isFloating && resolvedCompact ? 'p-2' : 'px-5 py-4'}`}>
        <TouchableOpacity onPress={cal.handlePrevMonth} className={`items-center justify-center rounded-xl bg-surface-overlay border border-surface-border hover:border-brand-primary ${resolvedCompact && isFloating ? 'w-7 h-7' : 'w-10 h-10'}`}>
          <FontAwesome name="chevron-left" size={12} className="text-typography-muted" />
        </TouchableOpacity>
        {!isFloating || !showTwoMonths ? (
          <View className="items-center">
            <Text className={`text-typography-main font-black uppercase tracking-widest ${resolvedCompact && isFloating ? 'text-xs' : 'text-sm'}`}>{MONTHS[cal.month]}</Text>
            <Text className="text-typography-muted text-[10px] font-bold">{cal.year}</Text>
          </View>
        ) : (
          <View className="flex-row items-center gap-2">
            <FontAwesome name="calendar-o" size={14} className="text-brand-primary" />
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.4em]">Objective Timeline</Text>
          </View>
        )}
        <Tooltip label="Next month">
          <TouchableOpacity onPress={cal.handleNextMonth} className={`items-center justify-center rounded-xl bg-surface-overlay border border-surface-border hover:border-brand-primary ${resolvedCompact && isFloating ? 'w-7 h-7' : 'w-10 h-10'}`}>
            <FontAwesome name="chevron-right" size={12} className="text-typography-muted" />
          </TouchableOpacity>
        </Tooltip>
      </View>

      {showDaysBetween && cal.rangeDays !== null && mode === 'single' && (
        <View className="items-center justify-center py-2 border-b border-surface-border bg-surface-background/20">
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">{cal.rangeDays} days between</Text>
        </View>
      )}

      {mode === 'range' && rangePhase !== 'committed' && (
        <View className="flex-row items-center gap-2 px-5 py-3 border-b border-surface-border bg-surface-background/20">
          <View
            className="flex-1 items-center py-2.5 rounded-2xl"
            style={{
              backgroundColor: `${resolvedAccentColor}15`,
              borderWidth: 1.5,
              borderColor: rangePhase === 'idle' ? resolvedAccentColor : `${resolvedAccentColor}40`,
            }}
          >
            <Text className="text-typography-dim text-[9px] font-black uppercase tracking-widest">1. Start</Text>
            <Text className="text-typography-main font-bold text-sm mt-0.5">{rangeStart ? fmtShort(rangeStart) : 'Pick a date'}</Text>
          </View>
          <Text className="text-typography-dim font-bold text-lg">→</Text>
          <View
            className="flex-1 items-center py-2.5 rounded-2xl"
            style={{
              backgroundColor: rangePhase === 'pending' ? `${resolvedRangeColor}15` : 'transparent',
              borderWidth: 1.5,
              borderColor: rangePhase === 'pending' ? resolvedRangeColor : colors.border,
            }}
          >
            <Text className="text-typography-dim text-[9px] font-black uppercase tracking-widest">2. End</Text>
            <Text className={`font-bold text-sm mt-0.5 ${rangePhase === 'pending' ? 'text-typography-main' : 'text-typography-dim'}`}>
              {rangePhase === 'pending' ? 'Pick a date' : '—'}
            </Text>
          </View>
        </View>
      )}

      <View className="flex-row">
        <View className="flex-1">
          <MonthGrid days={cal.calendarDays1} year={cal.year} month={cal.month} accentColor={resolvedAccentColor} rangeColor={resolvedRangeColor} scale={resolvedScale} onSelect={(day) => handleDayClick(cal.formatDate(day, cal.year, cal.month))} isToday={(day) => cal.isToday(day, cal.year, cal.month)} isSelected={(day) => cal.isSelected(day, cal.year, cal.month)} isRangeSelected={(day) => cal.isRangeSelected(day, cal.year, cal.month)} isBetween={(day) => cal.isBetween(day, cal.year, cal.month)} />
        </View>
        {showTwoMonths && (
          <>
            <View className="w-px bg-surface-border my-8" />
            <View className="flex-1">
              <MonthGrid days={cal.calendarDays2} year={cal.yearNext} month={cal.monthNext} accentColor={resolvedAccentColor} rangeColor={resolvedRangeColor} scale={resolvedScale} onSelect={(day) => handleDayClick(cal.formatDate(day, cal.yearNext, cal.monthNext))} isToday={(day) => cal.isToday(day, cal.yearNext, cal.monthNext)} isSelected={(day) => cal.isSelected(day, cal.yearNext, cal.monthNext)} isRangeSelected={(day) => cal.isRangeSelected(day, cal.yearNext, cal.monthNext)} isBetween={(day) => cal.isBetween(day, cal.yearNext, cal.monthNext)} />
            </View>
          </>
        )}
      </View>

      {!showTwoMonths && mode === 'single' && isFloating && (
        <TouchableOpacity onPress={() => onSelect(getQuickActionDate(0))} className="border-t border-surface-border items-center p-3">
          <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">Jump to Today</Text>
        </TouchableOpacity>
      )}

      {mode === 'range' && rangePhase === 'committed' && displayFrom && displayTo && (
        <View className="flex-row items-center justify-center gap-2 px-5 py-3 border-t border-surface-border bg-surface-background/20">
          <View className="flex-1 items-center py-3 rounded-2xl" style={{ backgroundColor: colors.primary + '15', borderWidth: 1, borderColor: colors.primary + '30' }}>
            <Text className="text-typography-dim text-[9px] font-black uppercase tracking-widest">From</Text>
            <Text className="text-typography-main font-bold text-sm mt-0.5">{fmtShort(displayFrom)}</Text>
          </View>
          <Text className="text-typography-dim font-bold text-lg">→</Text>
          <View className="flex-1 items-center py-3 rounded-2xl" style={{ backgroundColor: colors.primary + '15', borderWidth: 1, borderColor: colors.primary + '30' }}>
            <Text className="text-typography-dim text-[9px] font-black uppercase tracking-widest">To</Text>
            <Text className="text-typography-main font-bold text-sm mt-0.5">{fmtShort(displayTo)}</Text>
          </View>
          {displayDays !== null && (
            <View className="items-center px-3">
              <Text className="text-typography-main font-black text-sm">{displayDays}</Text>
              <Text className="text-typography-dim text-[9px] font-black uppercase tracking-widest">{displayDays === 1 ? 'day' : 'days'}</Text>
            </View>
          )}
          <TouchableOpacity onPress={handleApply} className="px-6 py-3 rounded-2xl" style={{ backgroundColor: colors.primary }}>
            <Text className="text-white text-[10px] font-black uppercase tracking-widest">Apply</Text>
          </TouchableOpacity>
        </View>
      )}
    </>
  );

  if (isFloating) {
    return (
      <View style={floatingStyle} className={`bg-surface-card border border-surface-border premium-shadow overflow-hidden ${resolvedCompact ? 'rounded-2xl' : 'rounded-[2.5rem]'}`}>
        <View className="flex-row">
          {resolvedSidebar}
          <View className="flex-1">
            {commonContent}
          </View>
        </View>
      </View>
    );
  }

  if (isPopup) {
    const hasSidebar = !!resolvedSidebar;
    const MONTH_WIDTH = isFull ? 340 : 260;
    // RangePresetRail is always w-44 (176); QuickMenuSidebar is w-44 full / w-[124px] compact.
    const SIDEBAR_WIDTH = isFull || mode === 'range' ? 176 : 124;
    const GAP = 48;
    const monthCount = showTwoMonths ? 2 : 1;
    const computedMaxWidth = monthCount * MONTH_WIDTH + GAP + (hasSidebar ? SIDEBAR_WIDTH + 1 : 0);

    return (
      <Popup visible={visible!} onClose={onClose!} presentation="auto" title={title ?? (mode === 'range' ? 'Select Date Range' : 'Select Date')} maxWidth={computedMaxWidth} sideMenu={resolvedSidebar}>
        <View style={{ overflow: 'hidden' }}>{commonContent}</View>
      </Popup>
    );
  }

  if (!resolvedSidebar) {
    return <View onLayout={handleLayout}>{commonContent}</View>;
  }
  return (
    <View onLayout={handleLayout} className="flex-row">
      {resolvedSidebar}
      <View className="flex-1">{commonContent}</View>
    </View>
  );
}
