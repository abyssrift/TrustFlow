import { useWindowDimensions } from 'react-native';
import { Platform } from 'react-native';
import { TAB_BAR_HEIGHT, BREAKPOINTS } from '@/lib/layout';

export function useResponsive() {
  const { width, height } = useWindowDimensions();

  const isMobile = width < BREAKPOINTS.tablet;
  const isTablet = width >= BREAKPOINTS.tablet && width < BREAKPOINTS.desktop;
  const isDesktop = width >= BREAKPOINTS.desktop;

  // How much bottom padding scrollable content needs to clear the tab bar.
  // On web large screens the tab bar is hidden, so no padding needed.
  const tabBarPadding = Platform.OS === 'web'
    ? (isMobile ? TAB_BAR_HEIGHT.web : 0)
    : TAB_BAR_HEIGHT.native;

  return { width, height, isMobile, isTablet, isDesktop, tabBarPadding };
}
