// ====================================================================
// IslandContext — the topbar "dynamic island" registry
// ====================================================================
//
// A single slot in the topbar center can host several unrelated things at
// once — a running work timer, a background file upload, a report being
// generated. Rather than each feature drawing its own floating indicator
// (which is how it grew: a mobile timer pill here, in-modal upload progress
// there), every feature publishes a plain DATA descriptor here and the
// DynamicIsland host renders them uniformly. That keeps theming + the morph
// animation in one place and makes "most-recent wins" ordering trivial.
//
// Publishers are of two kinds:
//   - Mounted components (e.g. the timer bridge) use `useIslandActivity`,
//     which publishes on change and auto-removes on unmount.
//   - Long-lived managers whose work outlives any component (the upload
//     manager) grab `publish` / `update` / `remove` and drive them
//     imperatively by id.
//
// Ordering: the collapsed idle slot shows whichever activity was touched
// most recently (`updatedAt`). Progress ticks deliberately DON'T bump it —
// otherwise a running upload would seize the slot every frame — only starts,
// status changes, and anything needing attention do (see `bump`).
// ====================================================================

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export type IslandAccent = 'primary' | 'success' | 'warning' | 'danger';
export type IslandTone = IslandAccent | 'neutral';
export type IslandKind = 'timer' | 'upload' | 'report';

export type IslandAction = {
  key: string;
  icon: string; // FontAwesome name
  label: string;
  tone?: IslandTone;
  onPress: () => void;
};

// A prompt the activity needs the user to answer from inside the island —
// e.g. an upload hit a filename conflict while running in the background and
// can't fall back to the (now-closed) modal dialog. Answering calls `resolve`.
export type IslandDecision = {
  id: string;
  title: string;
  message: string;
  options: { label: string; value: string; tone?: IslandTone }[];
  resolve: (value: string) => void;
};

export type IslandActivity = {
  id: string;
  kind: IslandKind;
  icon: string; // FontAwesome name shown in the compact pill + expanded row
  accent: IslandAccent;
  // Collapsed idle pill:
  compactLabel: string; // e.g. "02:14:33" or "42%"
  pulse?: boolean; // draw the little pulsing dot (live/active)
  progress?: number | null; // 0..100 → progress ring; null = indeterminate/none
  // Expanded row:
  title: string; // "Uploading 342 files"
  subtitle?: string; // "128 / 342 · ~2m left"
  actions?: IslandAction[];
  decisions?: IslandDecision[]; // pending prompts; presence raises an attention badge
  onPress?: () => void; // tap the row (navigate, open modal, …)
  // Force the panel open (even from collapsed) so the user can't miss this —
  // set on failures and anything else that needs to be read, not just glanced.
  // Rising edge triggers the auto-expand; leave false for routine updates.
  attention?: boolean;
};

// Internal record adds the recency stamp the host sorts by.
type IslandRecord = IslandActivity & { updatedAt: number };

type PublishOpts = {
  // Move this activity to the front of the idle slot. Defaults to true on the
  // FIRST publish of an id and whenever a decision is pending; pass false for
  // pure progress updates so they don't thrash the idle content.
  bump?: boolean;
};

type IslandContextValue = {
  // Sorted most-recent-first; the host shows [0] in the idle slot.
  activities: IslandActivity[];
  publish: (activity: IslandActivity, opts?: PublishOpts) => void;
  update: (id: string, patch: Partial<IslandActivity>, opts?: PublishOpts) => void;
  remove: (id: string) => void;
};

const IslandContext = createContext<IslandContextValue | null>(null);

export function IslandProvider({ children }: { children: React.ReactNode }) {
  const [records, setRecords] = useState<Record<string, IslandRecord>>({});
  // Monotonic clock so two publishes in the same ms still order deterministically.
  const seq = useRef(0);
  const stamp = useCallback(() => {
    seq.current += 1;
    return Date.now() * 1000 + (seq.current % 1000);
  }, []);

  const publish = useCallback((activity: IslandActivity, opts?: PublishOpts) => {
    setRecords(prev => {
      const existing = prev[activity.id];
      const hasDecision = (activity.decisions?.length ?? 0) > 0;
      // Bump on first sight, when explicitly asked, or whenever something needs
      // attention — a conflict prompt should always grab the idle slot.
      const bump = opts?.bump ?? (!existing || hasDecision);
      const updatedAt = bump || !existing ? stamp() : existing.updatedAt;
      return { ...prev, [activity.id]: { ...activity, updatedAt } };
    });
  }, [stamp]);

  const update = useCallback((id: string, patch: Partial<IslandActivity>, opts?: PublishOpts) => {
    setRecords(prev => {
      const existing = prev[id];
      if (!existing) return prev;
      const merged = { ...existing, ...patch };
      const hasDecision = (merged.decisions?.length ?? 0) > 0;
      const bump = opts?.bump ?? hasDecision;
      return { ...prev, [id]: { ...merged, updatedAt: bump ? stamp() : existing.updatedAt } };
    });
  }, [stamp]);

  const remove = useCallback((id: string) => {
    setRecords(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const activities = useMemo(
    () => Object.values(records).sort((a, b) => b.updatedAt - a.updatedAt),
    [records],
  );

  const value = useMemo(
    () => ({ activities, publish, update, remove }),
    [activities, publish, update, remove],
  );

  return <IslandContext.Provider value={value}>{children}</IslandContext.Provider>;
}

// Host-side reader. Returns an empty, inert value if no provider is mounted so
// a stray consumer never crashes (the island is web-desktop-first).
export function useIsland(): IslandContextValue {
  const ctx = useContext(IslandContext);
  if (!ctx) {
    return { activities: [], publish: () => {}, update: () => {}, remove: () => {} };
  }
  return ctx;
}

// Declarative publisher for mounted components: pass a descriptor (or null to
// publish nothing) and it stays in sync, removing itself on unmount. `id` must
// be stable for the lifetime of the thing being represented.
export function useIslandActivity(activity: IslandActivity | null) {
  const { publish, remove } = useIsland();
  const id = activity?.id;
  React.useEffect(() => {
    if (activity) publish(activity);
  }, [publish, activity]);
  React.useEffect(() => {
    return () => { if (id) remove(id); };
  }, [id, remove]);
}
