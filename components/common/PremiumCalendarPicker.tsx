import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, useWindowDimensions, Platform } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { cssInterop } from 'react-native-css-interop';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

type Props = {
  selectedDate: string | null; // ISO string (YYYY-MM-DD)
  onSelect: (date: string) => void;
  accentColor?: string;
  compact?: boolean; // single-month, no sidebar — for use inside modals
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

export default function PremiumCalendarPicker({ selectedDate, onSelect, accentColor = 'rgb(var(--brand-primary))', compact = false }: Props) {
  const { width } = useWindowDimensions();
  const isDesktop = !compact && width > 768;

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

  const handleSelect = (day: number, y: number, m: number) => {
    const d = new Date(y, m, day);
    onSelect?.(d.toISOString().split('T')[0]);
  };

  const handleQuickAction = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    onSelect?.(d.toISOString().split('T')[0]);
  };

  const MonthGrid = ({ days, y, m, title }: { days: (number | null)[], y: number, m: number, title: string }) => (
    <View className={`flex-1 ${isDesktop ? 'px-6' : 'p-4'}`}>
      <View className="items-center mb-6">
        <Text className="text-typography-main font-black text-sm uppercase tracking-[0.2em]">{title}</Text>
        <Text className="text-typography-muted text-[10px] font-bold mt-1 opacity-60">{y}</Text>
      </View>

      <View className="flex-row mb-4">
        {DAYS.map(d => (
          <View key={d} className="w-[14.285%] items-center">
            <Text className="text-typography-dim text-[9px] font-black uppercase tracking-widest">{d.charAt(0)}</Text>
          </View>
        ))}
      </View>

      <View className="flex-row flex-wrap">
        {days.map((day, idx) => (
          <View key={idx} style={{ width: '14.285%', aspectRatio: 1 }} className="p-1">
            {day !== null ? (
              <TouchableOpacity
                onPress={() => handleSelect(day, y, m)}
                className={`flex-1 items-center justify-center rounded-xl transition-all duration-200 ${
                  isSelected(day, y, m) 
                    ? 'bg-brand-primary' 
                    : isToday(day, y, m) 
                      ? 'bg-brand-primary/10 border border-brand-primary/30' 
                      : 'hover:bg-surface-overlay'
                }`}
              >
                <Text className={`text-xs font-bold ${isSelected(day, y, m) ? 'text-white' : 'text-typography-main'}`}>
                  {day}
                </Text>
                {isToday(day, y, m) && !isSelected(day, y, m) && (
                  <View className="absolute bottom-1 w-1 h-1 rounded-full bg-brand-primary" />
                )}
              </TouchableOpacity>
            ) : (
              <View className="flex-1" />
            )}
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <View className={`bg-surface-card rounded-[2.5rem] border border-surface-border overflow-hidden premium-shadow ${isDesktop ? 'flex-row' : 'flex-col'}`}>
      
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
            onPress={() => onSelect(new Date().toISOString().split('T')[0])}
            className="p-4 border border-brand-primary/20 rounded-2xl items-center hover:bg-brand-primary/5 transition-colors"
          >
            <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">Today</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Main Calendar Area */}
      <View className="flex-1">
        {/* Header (Nav Controls) */}
        <View className="bg-surface-background/30 p-5 flex-row items-center justify-between border-b border-surface-border">
          <TouchableOpacity 
            onPress={handlePrevMonth}
            className="w-10 h-10 items-center justify-center rounded-xl bg-surface-overlay border border-surface-border hover:border-brand-primary transition-colors"
          >
            <FontAwesome name="chevron-left" size={12} className="text-typography-muted" />
          </TouchableOpacity>
          
          {!isDesktop && (
            <View className="items-center">
              <Text className="text-typography-main font-black text-sm uppercase tracking-widest">{MONTHS[month]}</Text>
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
            className="w-10 h-10 items-center justify-center rounded-xl bg-surface-overlay border border-surface-border hover:border-brand-primary transition-colors"
          >
            <FontAwesome name="chevron-right" size={12} className="text-typography-muted" />
          </TouchableOpacity>
        </View>

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
            onPress={() => onSelect(new Date().toISOString().split('T')[0])}
            className="p-4 border-t border-surface-border items-center"
          >
            <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">Jump to Today</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

