// Owns the dashboard's widget instances and their persistence (#213, Wave 1).
//
// Extends the config object both dashboard screens already store under
// '@TrustFlow_dashboard_config' — no second storage key, no DB table. Every
// write spreads the previous object, so pipelineIds / successStageIds /
// useAllPipelines / overviewMetrics survive a widget edit and vice versa
// (the same merge discipline the two screens' onSave handlers do by hand today).
//
// All branching logic lives in lib/dashboardWidgets.ts, asserted by
// lib/dashboardWidgets.check.ts. This file is storage + React state only.

import { useAuth } from '@/contexts/AuthContext';
import {
  DASHBOARD_CONFIG_KEY,
  EMPTY_DASHBOARD_CONFIG,
  WIDGET_SEED_VERSION,
  WIDGET_TYPES,
  addInstance,
  appendNewSeeds,
  cycleInstanceSize,
  migrateDashboardConfig,
  moveInstance,
  removeInstance,
  seedDefaultInstances,
  setInstanceConfig,
  visibleInstances,
  type DashboardConfig,
  type WidgetInstance,
  type WidgetType,
} from '@/lib/dashboardWidgets';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useRef, useState } from 'react';

export type DashboardLayout = {
  /** Seeded or stored instances, minus any the viewer may no longer access. */
  instances: WidgetInstance[];
  /** False until AsyncStorage resolved AND permissionsLoaded. Gate the grid on this. */
  hydrated: boolean;
  config: DashboardConfig | null;
  /** Merges + persists arbitrary DashboardConfig fields. Replaces both screens' persistConfig. */
  saveConfig: (patch: Partial<DashboardConfig>) => Promise<void>;
  addWidget: (type: WidgetType) => void;
  removeWidget: (id: string) => void;
  cycleSize: (id: string) => void;
  /** Clamped at both ends, no wrap. */
  move: (id: string, delta: -1 | 1) => void;
  setConfig: (id: string, key: string, value: string) => void;
  /**
   * REPLACES the layout with an already-validated list — a built-in preset or a
   * decoded layout code. Validation and permission filtering belong to
   * lib/dashboardLayoutCodes.ts (`buildLayout`); this only persists.
   */
  applyLayout: (instances: WidgetInstance[]) => void;
  /** Puts back what `applyLayout` replaced. One level, in memory, this session. */
  undoApply: () => void;
  /** True between an applyLayout and its undo (or the next apply). */
  canUndo: boolean;
};

export function useDashboardLayout(): DashboardLayout {
  const { hasPermission, permissionsLoaded } = useAuth();
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [storageResolved, setStorageResolved] = useState(false);

  // AuthContext rebuilds hasPermission every render, so it can never be a
  // useMemo dependency. permissionsLoaded is the value that actually changes
  // the answer.
  const can = (permission: string | null) => permission === null || hasPermission(permission);
  const canRef = useRef(can);
  canRef.current = can;

  // `permissionsLoaded` is false on the first render and every hasPermission
  // call returns false until it flips — seeding in that window produces a
  // dashboard with the four gated widgets stripped out.
  const hydrated = storageResolved && permissionsLoaded;

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(DASHBOARD_CONFIG_KEY)
      .then(raw => {
        if (cancelled || raw === null) return;
        let parsed: unknown = null;
        try { parsed = JSON.parse(raw); } catch { /* half-written blob — start fresh */ }
        const migrated = migrateDashboardConfig(parsed, WIDGET_TYPES);
        if (migrated) setConfig(migrated);
      })
      .catch(e => console.error('Failed to load dashboard config', e))
      .finally(() => { if (!cancelled) setStorageResolved(true); });
    return () => { cancelled = true; };
  }, []);

  const configRef = useRef(config);
  configRef.current = config;

  // Absent `widgets` means "this device has never customized" — seed from the
  // viewer's permissions on every load, and never write that seed back. See
  // seedDefaultInstances' docstring for why persisting it is a one-way door.
  const instances = useMemo(() => {
    if (!hydrated) return [];
    const list = config?.widgets ?? seedDefaultInstances(canRef.current, config);
    // Read-time filter only: an instance hidden by a revoked permission stays
    // in storage, so regaining the permission brings the widget back.
    return visibleInstances(list, canRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, hydrated, permissionsLoaded]);

  const persist = async (next: DashboardConfig) => {
    setConfig(next);
    try {
      await AsyncStorage.setItem(DASHBOARD_CONFIG_KEY, JSON.stringify(next));
    } catch (e) {
      console.error('Failed to persist dashboard config', e);
    }
  };

  const saveConfig = async (patch: Partial<DashboardConfig>) => {
    await persist({ ...(configRef.current ?? EMPTY_DASHBOARD_CONFIG), ...patch });
  };

  /**
   * The one write path for instances, and the moment the seed stops being a
   * seed: the first real edit materializes it into storage.
   *
   * ponytail: mutations run against the FULL stored list, not the filtered one
   * the grid renders, so ids stay meaningful. A widget hidden by a revoked
   * permission therefore still occupies a slot, and moving past it looks like
   * one dead press. Acceptable for a local layout preference; if it ever
   * matters, move by target index computed from `instances` instead of by
   * neighbour swap.
   */
  const mutate = (fn: (list: WidgetInstance[]) => WidgetInstance[]) => {
    if (!hydrated) return;
    const base = configRef.current ?? EMPTY_DASHBOARD_CONFIG;
    const current = base.widgets ?? seedDefaultInstances(canRef.current, base);
    void persist({ ...base, widgets: fn(current), widgetsVersion: 1, widgetsSeedVersion: WIDGET_SEED_VERSION });
  };

  /**
   * Applying a preset or a pasted code is a REAL edit, so it materializes the
   * layout into storage and stamps the seed generation exactly like every other
   * mutation — unlike the seed path, which must never write itself back.
   *
   * The undo snapshot is the two layout fields only, never the whole config: a
   * pipeline-selection save between the apply and the undo must survive being
   * undone. It is a ref plus a boolean rather than persisted state on purpose —
   * one level, this session, gone on reload. Nothing to migrate, nothing stale.
   */
  const undoRef = useRef<{ widgets?: WidgetInstance[]; widgetsSeedVersion?: number } | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  const applyLayout = (next: WidgetInstance[]) => {
    if (!hydrated) return;
    const base = configRef.current ?? EMPTY_DASHBOARD_CONFIG;
    undoRef.current = { widgets: base.widgets, widgetsSeedVersion: base.widgetsSeedVersion };
    setCanUndo(true);
    void persist({ ...base, widgets: next, widgetsVersion: 1, widgetsSeedVersion: WIDGET_SEED_VERSION });
  };

  const undoApply = () => {
    const snapshot = undoRef.current;
    if (!hydrated || !snapshot) return;
    undoRef.current = null;
    setCanUndo(false);

    const restored: DashboardConfig = { ...(configRef.current ?? EMPTY_DASHBOARD_CONFIG) };
    if (snapshot.widgets) {
      restored.widgets = snapshot.widgets;
      restored.widgetsVersion = 1;
      restored.widgetsSeedVersion = snapshot.widgetsSeedVersion ?? WIDGET_SEED_VERSION;
    } else {
      // They had never customized: the honest restore is back to "no stored
      // widgets", which re-seeds from permissions on every load. Deleting the
      // keys is what makes that true — JSON.stringify drops them entirely.
      delete restored.widgets;
      delete restored.widgetsVersion;
      delete restored.widgetsSeedVersion;
    }
    void persist(restored);
  };

  // Additive re-seeding. The first edit materializes the seed into storage and
  // from then on the seed never runs — which used to mean a widget type shipped
  // in a later release could never reach that user, and the trigger for it was
  // as small as flipping the overview chart from Weekly to Monthly. Types
  // introduced above the version stored with the layout are appended once, then
  // the version is stamped. A type the user removed sits at or below their
  // stored version, so it is not a candidate and stays removed.
  useEffect(() => {
    const stored = configRef.current;
    // No stored `widgets` = never customized; that path still seeds fresh on
    // every load and must not be written back (see seedDefaultInstances).
    if (!hydrated || !stored?.widgets) return;
    const seen = stored.widgetsSeedVersion ?? 1;
    if (seen >= WIDGET_SEED_VERSION) return;
    void persist({
      ...stored,
      widgets: appendNewSeeds(stored.widgets, seen, canRef.current),
      widgetsSeedVersion: WIDGET_SEED_VERSION,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, config]);

  return {
    instances,
    hydrated,
    config,
    saveConfig,
    addWidget: type => mutate(list => addInstance(list, type, canRef.current)),
    removeWidget: id => mutate(list => removeInstance(list, id)),
    cycleSize: id => mutate(list => cycleInstanceSize(list, id)),
    move: (id, delta) => mutate(list => moveInstance(list, id, delta)),
    setConfig: (id, key, value) => mutate(list => setInstanceConfig(list, id, key, value)),
    applyLayout,
    undoApply,
    canUndo,
  };
}
