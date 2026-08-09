import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useRef } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { SHORTCUTS } from '@/components/sidebar/constants';
import { useAuth } from '@/contexts/AuthContext';
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
  const { hasPermission, profile } = useAuth();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const startedRef = useRef(false);
  const wasActiveRef = useRef(false);

  // Mirrors components/Sidebar.web.tsx's `visibleShortcuts` filter exactly —
  // the tour must only show steps for items the user will actually see.
  // Can't filter by checking DOM registration (getTarget(...)?.current)
  // instead: mobile drawer items don't register until the drawer opens,
  // which only happens *during* the tour itself, so at start time zero
  // mobile items are registered and that approach would produce an empty
  // tour on mobile.
  const eligibleSteps = useMemo(
    () =>
      navTourSteps.filter((step) => {
        const s = SHORTCUTS.find((sc) => `nav-${sc.id}` === step.targetId);
        if (!s) return false;
        return (
          s.id === 'dashboard' ||
          s.id === 'tasks' ||
          (isMobile && (s.id === 'search' || s.id === 'deadlines')) ||
          (profile?.is_owner && (s.id === 'team' || s.id === 'pipelines-admin')) ||
          (s.anyPermissions ? s.anyPermissions.some((p) => hasPermission(p)) : false) ||
          (!!s.permissionKey && hasPermission(s.permissionKey)) ||
          (!!s.fallbackPermissionKey && hasPermission(s.fallbackPermissionKey))
        );
      }),
    [hasPermission, profile?.is_owner, isMobile]
  );

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!ready || startedRef.current) return;
    let cancelled = false;
    AsyncStorage.getItem(NAV_TOUR_SEEN_KEY).then((seen) => {
      if (cancelled || seen) return;
      startedRef.current = true;
      startTour(eligibleSteps);
    });
    return () => { cancelled = true; };
  }, [ready, startTour, eligibleSteps]);

  useEffect(() => {
    if (wasActiveRef.current && !active) {
      AsyncStorage.setItem(NAV_TOUR_SEEN_KEY, '1').catch(() => {});
    }
    wasActiveRef.current = active;
  }, [active]);
}
