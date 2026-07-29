import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { CalendarScale } from './types';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type MonthGridProps = {
  days: (number | null)[];
  year: number;
  month: number;
  accentColor: string;
  rangeColor: string;
  scale: CalendarScale;
  onSelect: (day: number) => void;
  isToday: (day: number) => boolean;
  isSelected: (day: number) => boolean;
  isRangeSelected: (day: number) => boolean;
  isBetween: (day: number) => boolean;
};

export function MonthGrid({ days, year, month, accentColor, rangeColor, scale, onSelect, isToday, isSelected, isRangeSelected, isBetween }: MonthGridProps) {
  const resolvedCompact = scale === 'compact';

  return (
    <View className={resolvedCompact ? 'p-2' : 'p-4'}>
      <View className={`items-center ${resolvedCompact ? 'mb-2' : 'mb-6'}`}>
        <Text className={`text-typography-main font-black uppercase tracking-[0.2em] ${resolvedCompact ? 'text-xs' : 'text-sm'}`}>
          {MONTHS[month]}
        </Text>
        <Text className="text-typography-muted text-[10px] font-bold mt-1 opacity-60">{year}</Text>
      </View>

      <View className={`flex-row ${resolvedCompact ? 'mb-2' : 'mb-4'}`}>
        {DAYS.map(d => (
          <View key={d} style={{ width: '14.2857%' }} className="items-center">
            <Text className="text-typography-dim text-[9px] font-black uppercase tracking-widest">{d.charAt(0)}</Text>
          </View>
        ))}
      </View>

      <View className="flex-row flex-wrap">
        {days.map((day, idx) => (
          <View key={idx} style={{ width: '14.2857%', aspectRatio: 1, maxHeight: resolvedCompact ? 26 : undefined }} className={resolvedCompact ? 'p-0.5' : 'p-1'}>
            {day !== null ? (() => {
              const selected = isSelected(day);
              const rangeSelected = isRangeSelected(day);
              const between = isBetween(day);
              return (
                <TouchableOpacity
                  onPress={() => onSelect(day)}
                  className={`flex-1 items-center justify-center rounded-xl transition-all duration-200 ${
                    selected || rangeSelected
                      ? ''
                      : between
                        ? ''
                        : isToday(day)
                          ? 'bg-brand-primary/10 border border-brand-primary/30'
                          : 'hover:bg-surface-overlay'
                  }`}
                  style={
                    selected
                      ? { backgroundColor: accentColor }
                      : rangeSelected
                        ? { backgroundColor: rangeColor }
                        : between
                          ? { backgroundColor: `${accentColor}1a` }
                          : undefined
                  }
                >
                  <Text className={`${resolvedCompact ? 'text-[11px]' : 'text-xs'} font-bold ${selected || rangeSelected ? 'text-white' : 'text-typography-main'}`}>
                    {day}
                  </Text>
                  {isToday(day) && !selected && !rangeSelected && (
                    <View className="absolute bottom-1 w-1 h-1 rounded-full" style={{ backgroundColor: accentColor }} />
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
}
