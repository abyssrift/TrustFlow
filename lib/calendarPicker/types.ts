export type CalendarScale = 'compact' | 'full';

export type CalendarPickerProps = {
  selectedDate: string | null;
  onSelect: (date: string) => void;
  accentColor?: string;
  rangeDate?: string | null;
  rangeColor?: string;
  showQuickSelect?: boolean;
  showDaysBetween?: boolean;
  scale?: CalendarScale;
};

export type CalendarLayoutInput = {
  scale?: CalendarScale;
  showQuickSelect?: boolean;
};

export type CalendarLayoutResult = {
  resolvedCompact: boolean;
  resolvedShowQuickSelect: boolean;
  isDesktop: boolean;
};
