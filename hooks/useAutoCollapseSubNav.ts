import { usePersistedState } from './usePersistedState';

export const AUTO_COLLAPSE_SUBNAV_KEY = 'sidebar_auto_collapse_subnav';

// Issue #217: the main nav rail auto-collapses to its icon rail while a
// sub-nav page (Intelligence, Corporate, Profile, Pipelines editor) is active,
// so the page's own sub-sidebar isn't sandwiched between two full-width nav
// columns. Default ON; the Appearance tab switch disables it.
export function useAutoCollapseSubNav() {
  return usePersistedState<boolean>(
    AUTO_COLLAPSE_SUBNAV_KEY,
    true,
    (raw): raw is boolean => typeof raw === 'boolean',
  );
}