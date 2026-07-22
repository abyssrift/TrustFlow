import { useWindowDimensions } from 'react-native';
import type { CalendarLayoutInput, CalendarLayoutResult, CalendarScale } from './types';

const DESKTOP_BREAKPOINT = 768;

function resolveCompact(scale: CalendarScale | undefined, width: number): boolean {
  if (scale === 'compact') return true;
  if (scale === 'full') return false;
  return width <= DESKTOP_BREAKPOINT;
}

function resolveShowQuickSelect(showQuickSelect: boolean | undefined, resolvedCompact: boolean, width: number): boolean {
  if (showQuickSelect !== undefined) return showQuickSelect;
  if (!resolvedCompact && width > DESKTOP_BREAKPOINT) return true;
  return false;
}

export function useCalendarPickerLayout(input: CalendarLayoutInput): CalendarLayoutResult {
  const { width } = useWindowDimensions();

  const resolvedCompact = resolveCompact(input.scale, width);
  const isDesktop = !resolvedCompact && width > DESKTOP_BREAKPOINT;
  const resolvedShowQuickSelect = resolveShowQuickSelect(input.showQuickSelect, resolvedCompact, width);

  return {
    resolvedCompact,
    resolvedShowQuickSelect,
    isDesktop,
  };
}
