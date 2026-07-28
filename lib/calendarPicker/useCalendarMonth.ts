import { useCallback, useMemo, useState } from 'react';

export type CalendarDay = number | null;

export function useCalendarMonth(selectedDate: string | null, rangeDate?: string | null) {
  const initialDate = selectedDate ? new Date(selectedDate) : new Date();
  const [viewDate, setViewDate] = useState(new Date(initialDate.getFullYear(), initialDate.getMonth(), 1));

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const getNextMonthDate = useCallback((date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 1), []);
  const getPrevMonthDate = useCallback((date: Date) => new Date(date.getFullYear(), date.getMonth() - 1, 1), []);

  const nextMonthDate = getNextMonthDate(viewDate);
  const yearNext = nextMonthDate.getFullYear();
  const monthNext = nextMonthDate.getMonth();

  const getCalendarDays = useCallback((y: number, m: number): CalendarDay[] => {
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const firstDayOfMonth = new Date(y, m, 1).getDay();
    const days: CalendarDay[] = [];
    for (let i = 0; i < firstDayOfMonth; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  }, []);

  const calendarDays1 = useMemo(() => getCalendarDays(year, month), [year, month, getCalendarDays]);
  const calendarDays2 = useMemo(() => getCalendarDays(yearNext, monthNext), [yearNext, monthNext, getCalendarDays]);

  const handlePrevMonth = useCallback(() => setViewDate(prev => getPrevMonthDate(prev)), [getPrevMonthDate]);
  const handleNextMonth = useCallback(() => setViewDate(prev => getNextMonthDate(prev)), [getNextMonthDate]);

  const isToday = useCallback((day: number, y: number, m: number) => {
    const today = new Date();
    return today.getDate() === day && today.getMonth() === m && today.getFullYear() === y;
  }, []);

  const isSelected = useCallback((day: number, y: number, m: number) => {
    if (!selectedDate) return false;
    const d = new Date(selectedDate);
    return d.getFullYear() === y && d.getMonth() === m && d.getDate() === day;
  }, [selectedDate]);

  const isRangeSelected = useCallback((day: number, y: number, m: number) => {
    if (!rangeDate) return false;
    const d = new Date(rangeDate);
    return d.getFullYear() === y && d.getMonth() === m && d.getDate() === day;
  }, [rangeDate]);

  const rangeBounds = useMemo(() => {
    if (!selectedDate || !rangeDate) return null;
    const a = new Date(selectedDate).getTime();
    const b = new Date(rangeDate).getTime();
    if (a === b) return null;
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }, [selectedDate, rangeDate]);

  const isBetween = useCallback((day: number, y: number, m: number) => {
    if (!rangeBounds) return false;
    const t = new Date(y, m, day).getTime();
    return t > rangeBounds.start && t < rangeBounds.end;
  }, [rangeBounds]);

  const rangeDays = rangeBounds ? Math.round((rangeBounds.end - rangeBounds.start) / 86400000) : null;

  const formatDate = useCallback((day: number, y: number, m: number) => {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }, []);

  return {
    year,
    month,
    yearNext,
    monthNext,
    calendarDays1,
    calendarDays2,
    handlePrevMonth,
    handleNextMonth,
    isToday,
    isSelected,
    isRangeSelected,
    isBetween,
    rangeDays,
    formatDate,
  };
}
