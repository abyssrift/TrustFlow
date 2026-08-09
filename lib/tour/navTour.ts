import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { SHORTCUTS } from '@/components/sidebar/constants';
import { useTour } from './TourContext';
import type { TourStep } from './types';

export const NAV_TOUR_SEEN_KEY = 'nav_tour_seen_v1';

/**
 * Draft tour: one step per sidebar shortcut, built mechanically from
 * SHORTCUTS so it can't drift from the real menu. Every step carries
 * `beforeActionId: 'open-mobile-nav'` — on desktop this id is never
 * registered (WebMobileNav isn't mounted) so it's a no-op; on mobile web it
 * opens the drawer the item lives behind before the target is measured. See
 * components/navigation/WebMobileNav.tsx for the registration side.
 *
 * This is explicitly the draft covered in
 * docs/superpowers/specs/2026-08-09-onboarding-nav-tour-design.md — it gets
 * replaced by one tour per finished menu screen later.
 */
export const navTourSteps: TourStep[] = SHORTCUTS.map((s) => ({
  targetId: `nav-${s.id}`,
  title: s.label,
  body: `This is your ${s.label} section.`,
  beforeActionId: 'open-mobile-nav',
}));

/**
 * Starts navTourSteps once, the first time `ready` is true, unless already
 * seen (AsyncStorage flag). Web only. `ready` should reflect "the user has
 * either already completed WelcomeTour, or just did" — see app/_layout.web.tsx.
 */
export function useNavTourAutoStart(ready: boolean) {
  const { active, startTour } = useTour();
  const startedRef = useRef(false);
  const wasActiveRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!ready || startedRef.current) return;
    let cancelled = false;
    AsyncStorage.getItem(NAV_TOUR_SEEN_KEY).then((seen) => {
      if (cancelled || seen) return;
      startedRef.current = true;
      startTour(navTourSteps);
    });
    return () => { cancelled = true; };
  }, [ready, startTour]);

  useEffect(() => {
    if (wasActiveRef.current && !active) {
      AsyncStorage.setItem(NAV_TOUR_SEEN_KEY, '1').catch(() => {});
    }
    wasActiveRef.current = active;
  }, [active]);
}
