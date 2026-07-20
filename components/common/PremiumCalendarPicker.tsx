import { useThemeColors } from '@/hooks/useThemeColors';
import { FontAwesome } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

type Props = {
  selectedDate: string | null; // ISO string (YYYY-MM-DD) — the date being actively picked
  onSelect: (date: string) => void;
  accentColor?: string;
  compact?: boolean; // single-month, no sidebar — for use inside modals
  showQuickSelect?: boolean; // show quick select sidebar even in compact mode
  rangeDate?: string | null; // the "other" date (e.g. due date when selectedDate is start), shown in rangeColor
  rangeColor?: string; // color for rangeDate; days between selectedDate/rangeDate are tinted with it
  rangeLabel?: string; // label for the days-between badge, e.g. "days"
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const QUICK_ACTIONS = [
  { label: 'Today',     days: 0 },
  { label: 'Tomorrow',  days: 1 },
  { label: '+3 Days',   days: 3 },
  { label: '+1 Week',   days: 7 },
  { label: '+2 Weeks',  days: 14 },
  { label: '+1 Month',  days: 30 },
];

export default function PremiumCalendarPicker({ selectedDate, onSelect, accentColor, compact = false, showQuickSelect = false, rangeDate, rangeColor, rangeLabel = 'days' }: Props) {
  const colors = useThemeColors();
  const resolvedAccentColor = accentColor ?? colors.primary;
  const resolvedRangeColor = rangeColor ?? colors.secondary;
  const { width } = useWindowDimensions();
  const isDesktop = !compact && width > 768;
  const showSidebar = (isDesktop || showQuickSelect) && width > 768;

  const initialDate = selectedDate ? new Date(selectedDate) : new Date();
  const [viewDate, setViewDate] = useState(new Date(initialDate.getFullYear(), initialDate.getMonth(), 1));

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  // Helper for month shifts
  const getNextMonthDate = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 1);
  const getPrevMonthDate = (date: Date) => new Date(date.getFullYear(), date.getMonth() - 1, 1);

  const viewDateNext = getNextMonthDate(viewDate);
  const yearNext = viewDateNext.getFullYear();
  const monthNext = viewDateNext.getMonth();

  const getCalendarDays = (y: number, m: number) => {
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const firstDayOfMonth = new Date(y, m, 1).getDay();
    const days = [];
    for (let i = 0; i < firstDayOfMonth; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  };

  const calendarDays1 = useMemo(() => getCalendarDays(year, month), [year, month]);
  const calendarDays2 = useMemo(() => getCalendarDays(yearNext, monthNext), [yearNext, monthNext]);

  const handlePrevMonth = () => setViewDate(getPrevMonthDate(viewDate));
  const handleNextMonth = () => setViewDate(getNextMonthDate(viewDate));

  const isToday = (day: number, y: number, m: number) => {
    const today = new Date();
    return today.getDate() === day && today.getMonth() === m && today.getFullYear() === y;
  };

  const isSelected = (day: number, y: number, m: number) => {
    if (!selectedDate) return false;
    const d = new Date(selectedDate);
    return d.getFullYear() === y && d.getMonth() === m && d.getDate() === day;
  };

  const isRangeSelected = (day: number, y: number, m: number) => {
    if (!rangeDate) return false;
    const d = new Date(rangeDate);
    return d.getFullYear() === y && d.getMonth() === m && d.getDate() === day;
  };

  const rangeBounds = useMemo(() => {
    if (!selectedDate || !rangeDate) return null;
    const a = new Date(selectedDate).getTime();
    const b = new Date(rangeDate).getTime();
    if (a === b) return null;
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }, [selectedDate, rangeDate]);

  const isBetween = (day: number, y: number, m: number) => {
    if (!rangeBounds) return false;
    const t = new Date(y, m, day).getTime();
    return t > rangeBounds.start && t < rangeBounds.end;
  };

  const rangeDays = rangeBounds ? Math.round((rangeBounds.end - rangeBounds.start) / 86400000) : null;

  const handleSelect = (day: number, y: number, m: number) => {
    onSelect?.(`${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  };

  const handleQuickAction = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    onSelect?.(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  };

  const MonthGrid = ({ days, y, m, title }: { days: (number | null)[], y: number, m: number, title: string }) => (
    <View className={`${isDesktop ? 'flex-1 px-6' : compact ? 'p-3' : 'p-4'}`}>
      <View className={`items-center ${compact ? 'mb-4' : 'mb-6'}`}>
        <Text className={`text-typography-main font-black uppercase tracking-[0.2em] ${compact ? 'text-xs' : 'text-sm'}`}>{title}</Text>
        <Text className="text-typography-muted text-[10px] font-bold mt-1 opacity-60">{y}</Text>
      </View>

      <View className={`flex-row ${compact ? 'mb-2.5' : 'mb-4'}`}>
        {DAYS.map(d => (
          <View key={d} className="w-[14.285%] items-center">
            <Text className="text-typography-dim text-[9px] font-black uppercase tracking-widest">{d.charAt(0)}</Text>
          </View>
        ))}
      </View>

      <View className="flex-row flex-wrap">
        {days.map((day, idx) => (
          <View key={idx} style={{ width: '14.285%', aspectRatio: 1, maxHeight: compact ? 32 : undefined }} className={compact ? 'p-0.5' : 'p-1'}>
            {day !== null ? (() => {
              const selected = isSelected(day, y, m);
              const rangeSelected = isRangeSelected(day, y, m);
              const between = isBetween(day, y, m);
              return (
                <TouchableOpacity
                  onPress={() => handleSelect(day, y, m)}
                  className={`flex-1 items-center justify-center rounded-xl transition-all duration-200 ${
                    selected || rangeSelected
                      ? ''
                      : between
                        ? ''
                        : isToday(day, y, m)
                          ? 'bg-brand-primary/10 border border-brand-primary/30'
                          : 'hover:bg-surface-overlay'
                  }`}
                  style={
                    selected
                      ? { backgroundColor: resolvedAccentColor }
                      : rangeSelected
                        ? { backgroundColor: resolvedRangeColor }
                        : between
                          ? { backgroundColor: `${resolvedAccentColor}1a` }
                          : undefined
                  }
                >
                  <Text className={`text-xs font-bold ${selected || rangeSelected ? 'text-white' : 'text-typography-main'}`}>
                    {day}
                  </Text>
                  {isToday(day, y, m) && !selected && !rangeSelected && (
                    <View className="absolute bottom-1 w-1 h-1 rounded-full" style={{ backgroundColor: resolvedAccentColor }} />
                  )}
                </TouchableOpacity>
              );
            })() : (
              <View className="flex-1" />
            )}
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <View className={`bg-surface-card border border-surface-border premium-shadow ${isDesktop || (showQuickSelect && compact) ? 'flex-row' : 'flex-col'} ${compact ? (!showQuickSelect ? 'w-[252px]' : 'w-[348px]') + ' rounded-2xl' : 'rounded-[2.5rem] overflow-hidden'}`}>
      
      {/* Quick Select - Compact Left Side */}
      {showQuickSelect && compact && (
        <View className="w-24 bg-surface-background/50 border-r border-surface-border items-center pt-4 pb-3 gap-1">
          <View className="items-center mb-3 border-b border-surface-border pb-3 px-2 w-full">
            <Text className="text-typography-main font-black text-xs">Quick</Text>
            <Text className="text-typography-main font-black text-xs">Select</Text>
          </View>
          {QUICK_ACTIONS.map(action => (
            <TouchableOpacity
              key={action.label}
              onPress={() => handleQuickAction(action.days)}
              className="w-full items-center py-2.5 rounded-lg hover:bg-surface-overlay"
            >
              <Text className="text-typography-main font-bold text-[10px] uppercase tracking-wider">{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Sidebar - Desktop Only */}
      {isDesktop && (
        <View className="w-48 bg-surface-background/50 border-r border-surface-border p-6 gap-2">
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-4 opacity-50">Quick Select</Text>
          {QUICK_ACTIONS.map(action => (
            <TouchableOpacity 
              key={action.label}
              onPress={() => handleQuickAction(action.days)}
              className="px-4 py-3 rounded-xl hover:bg-surface-overlay border border-transparent hover:border-surface-border transition-all"
            >
              <Text className="text-typography-main font-bold text-[11px] uppercase tracking-wider">{action.label}</Text>
            </TouchableOpacity>
          ))}
          <View className="flex-1" />
          <TouchableOpacity 
            onPress={() => { const d = new Date(); onSelect?.(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); }}
            className="p-4 border border-brand-primary/20 rounded-2xl items-center hover:bg-brand-primary/5 transition-colors"
          >
            <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">Today</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Main Calendar Area */}
      <View className={(compact && showQuickSelect) ? 'w-[252px]' : compact ? undefined : 'flex-1'}>
        {/* Header (Nav Controls) */}
        <View className={`bg-surface-background/30 flex-row items-center justify-between border-b border-surface-border ${compact ? 'p-3' : 'p-5'}`}>
          <TouchableOpacity 
            onPress={handlePrevMonth}
            className={`items-center justify-center rounded-xl bg-surface-overlay border border-surface-border hover:border-brand-primary transition-colors ${compact ? 'w-8 h-8' : 'w-10 h-10'}`}
          >
            <FontAwesome name="chevron-left" size={12} className="text-typography-muted" />
          </TouchableOpacity>
          
          {!isDesktop && (
            <View className="items-center">
              <Text className={`text-typography-main font-black uppercase tracking-widest ${compact ? 'text-xs' : 'text-sm'}`}>{MONTHS[month]}</Text>
              <Text className="text-typography-muted text-[10px] font-bold">{year}</Text>
            </View>
          )}

          {isDesktop && (
            <View className="flex-row items-center gap-2">
              <FontAwesome name="calendar" size={14} className="text-brand-primary" />
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.4em] ml-2">Objective Timeline</Text>
            </View>
          )}
  
          <TouchableOpacity
            onPress={handleNextMonth}
            className={`items-center justify-center rounded-xl bg-surface-overlay border border-surface-border hover:border-brand-primary transition-colors ${compact ? 'w-8 h-8' : 'w-10 h-10'}`}
          >
            <FontAwesome name="chevron-right" size={12} className="text-typography-muted" />
          </TouchableOpacity>
        </View>

        {rangeDays !== null && (
          <View className="items-center justify-center py-2 border-b border-surface-border bg-surface-background/20">
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">
              {rangeDays} {rangeLabel} between
            </Text>
          </View>
        )}

        {/* Grids */}
        <View className={`flex-row ${!isDesktop ? 'flex-col' : ''}`}>
          <MonthGrid 
            days={calendarDays1} 
            y={year} 
            m={month} 
            title={MONTHS[month]} 
          />
          {isDesktop && (
            <View className="w-px bg-surface-border my-8" />
          )}
          {isDesktop && (
            <MonthGrid 
              days={calendarDays2} 
              y={yearNext} 
              m={monthNext} 
              title={MONTHS[monthNext]} 
            />
          )}
        </View>

        {/* Footer - Mobile Only */}
        {!isDesktop && (
          <TouchableOpacity 
            onPress={() => { const d = new Date(); onSelect?.(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); }}
            className={`border-t border-surface-border items-center ${compact ? 'p-3' : 'p-4'}`}
          >
            <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">Jump to Today</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

