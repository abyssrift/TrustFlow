import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';

type Props = {
  selectedDate: string | null; // ISO string (YYYY-MM-DD)
  onSelect: (date: string) => void;
  accentColor?: string;
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function PremiumCalendarPicker({ selectedDate, onSelect, accentColor = 'rgb(var(--brand-primary))' }: Props) {
  const initialDate = selectedDate ? new Date(selectedDate) : new Date();
  const [viewDate, setViewDate] = useState(new Date(initialDate.getFullYear(), initialDate.getMonth(), 1));

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();

  const calendarDays = useMemo(() => {
    const days = [];
    // Padding for first week
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(null);
    }
    // Days of month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i);
    }
    return days;
  }, [year, month]);

  const handlePrevMonth = () => {
    setViewDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setViewDate(new Date(year, month + 1, 1));
  };

  const isToday = (day: number) => {
    const today = new Date();
    return today.getDate() === day && today.getMonth() === month && today.getFullYear() === year;
  };

  const isSelected = (day: number) => {
    if (!selectedDate) return false;
    const d = new Date(selectedDate);
    // Add timezone offset correction if needed, but YYYY-MM-DD is usually handled as UTC or local depending on input
    // Here we assume simple comparison
    const target = new Date(year, month, day);
    return d.getFullYear() === target.getFullYear() && d.getMonth() === target.getMonth() && d.getDate() === target.getDate();
  };

  const formatDate = (day: number) => {
    const d = new Date(year, month, day);
    return d.toISOString().split('T')[0];
  };

  return (
    <View className="premium-shadow" style={{ minWidth: 280, flex: 1 }}>
      <View className="bg-surface-card rounded-3xl border border-surface-border overflow-hidden">
        {/* Header */}
        <View className="bg-surface-background p-5 flex-row items-center justify-between border-b border-surface-border">
          <TouchableOpacity 
            onPress={handlePrevMonth}
            className="w-10 h-10 items-center justify-center rounded-xl bg-surface-overlay border border-surface-border"
          >
            <FontAwesome name="chevron-left" size={12} className="text-typography-muted" />
          </TouchableOpacity>
          
          <View className="items-center">
            <Text className="text-typography-main font-black text-sm uppercase tracking-widest">{MONTHS[month]}</Text>
            <Text className="text-typography-muted text-[10px] font-bold">{year}</Text>
          </View>
  
          <TouchableOpacity 
            onPress={handleNextMonth}
            className="w-10 h-10 items-center justify-center rounded-xl bg-surface-overlay border border-surface-border"
          >
            <FontAwesome name="chevron-right" size={12} className="text-typography-muted" />
          </TouchableOpacity>
        </View>
  
        {/* Grid */}
        <View className="p-4">
          {/* Day Labels */}
          <View className="flex-row mb-4">
            {DAYS.map(d => (
              <View key={d} className="w-[14.285%] items-center">
                <Text className="text-typography-dim text-[10px] font-black uppercase tracking-tighter">{d}</Text>
              </View>
            ))}
          </View>
  
          {/* Calendar Cells */}
          <View className="flex-row flex-wrap">
            {calendarDays.map((day, idx) => (
              <View key={idx} className="w-[14.285%] aspect-square p-1">
                {day !== null ? (
                  <TouchableOpacity
                    onPress={() => onSelect(formatDate(day))}
                    className={`flex-1 items-center justify-center rounded-xl transition-all ${
                      isSelected(day) ? 'bg-brand-primary' : isToday(day) ? 'bg-brand-primary/10 border border-brand-primary/30' : 'hover:bg-surface-overlay'
                    }`}
                  >
                    <Text className={`text-xs font-bold ${isSelected(day) ? 'text-white' : 'text-typography-main'}`}>
                      {day}
                    </Text>
                    {isToday(day) && !isSelected(day) && (
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
  
        {/* Footer */}
        <TouchableOpacity 
          onPress={() => onSelect(new Date().toISOString().split('T')[0])}
          className="p-4 border-t border-surface-border items-center"
        >
          <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">Jump to Today</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
