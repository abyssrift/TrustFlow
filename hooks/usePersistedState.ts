import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A useState that remembers, for small UI preferences — which view you had
 * open, which filter you left on. AsyncStorage so it works on web and native
 * from one call site.
 *
 * There were already six hand-rolled versions of this loop (useNavBarPosition,
 * useBoardPicker, useRecentSearches, ...) each re-implementing "read once on
 * mount, write on change". This is the seventh case, so it gets the shared one
 * instead. Existing six deliberately left alone — rewriting working code was
 * not the ask.
 *
 * `isValid` is required, not optional: what comes back from storage is a
 * string written by an older build of the app. A view mode that was removed,
 * a renamed key, a half-written value — each would otherwise restore a state
 * the UI can no longer render. Validate, or fall back to the default.
 */
export function usePersistedState<T>(
  storageKey: string,
  fallback: T,
  isValid: (raw: unknown) => raw is T,
) {
  const [value, setValue] = useState<T>(fallback);
  // Until the read resolves, `value` is the fallback rather than the stored
  // one. Writing during that window would persist the fallback over the real
  // preference, so writes are held until the first read completes.
  const hydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(storageKey)
      .then(raw => {
        if (cancelled || raw === null) return;
        let parsed: unknown = raw;
        try { parsed = JSON.parse(raw); } catch { /* plain string, use as-is */ }
        if (isValid(parsed)) setValue(parsed);
      })
      .catch(() => { /* storage unavailable (private mode, quota) — keep the fallback */ })
      .finally(() => { if (!cancelled) hydrated.current = true; });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const set = useCallback((next: T) => {
    setValue(next);
    if (!hydrated.current) return;
    AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => {});
  }, [storageKey]);

  return [value, set] as const;
}
