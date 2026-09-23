import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { GUIDE_REGISTRY, GuideDefinition, GuideId, GuideProgress, GuideStatus } from '@/lib/contextualGuides';

type PersistedGuideProgress = Omit<GuideProgress, 'status'> & { status: GuideStatus | 'familiar' };
type State = { scope: string | null; rows: Partial<Record<GuideId, PersistedGuideProgress>>; loading: boolean; error: string | null; fallbackActive: boolean };
type RpcResult = { data: unknown; error: { message?: string } | null };

const LOAD_ERROR = 'Cloud guide sync is unavailable. Progress is saved on this device; retry the cloud connection.';
const SAVE_ERROR = 'Cloud guide sync is unavailable. Progress is saved on this device; retry the cloud connection.';
const STORAGE_VERSION = 1;
const STORAGE_PREFIX = '@TrustFlow_guide_progress_v1';

function storageKey(scope: string) {
  const [userId, companyId] = scope.split(':');
  return `${STORAGE_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(companyId)}`;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function parseRows(raw: unknown): PersistedGuideProgress[] {
  const values = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  return values.flatMap((value: any) => {
    if (!value || typeof value !== 'object' || !GUIDE_REGISTRY.some(({ id }) => id === value.guide_id)) return [];
    const definition = GUIDE_REGISTRY.find(({ id }) => id === value.guide_id);
    if (!definition || !Number.isInteger(value.guide_version) || value.guide_version <= 0) return [];
    if (!Number.isInteger(value.current_step) || value.current_step < 0) return [];
    const status = value.status;
    if (!['not_started', 'in_progress', 'done', 'familiar'].includes(status)) return [];
    if (!isTimestamp(value.first_eligible_at) || !isTimestamp(value.updated_at)) return [];
    if (value.acknowledged_at !== null && !isTimestamp(value.acknowledged_at)) return [];
    if (status === 'done' ? !isTimestamp(value.completed_at) : value.completed_at !== null) return [];
    const maxStep = definition.steps.length - 1;
    return [{
      guideId: value.guide_id as GuideId,
      guideVersion: value.guide_version,
      status: status as PersistedGuideProgress['status'],
      currentStep: Math.max(0, Math.min(maxStep, value.current_step)),
      firstEligibleAt: value.first_eligible_at,
      acknowledgedAt: value.acknowledged_at,
      completedAt: value.completed_at,
      updatedAt: value.updated_at,
    }];
  });
}

function rowsById(rows: PersistedGuideProgress[]) {
  return Object.fromEntries(rows.map((row) => [row.guideId, row])) as Partial<Record<GuideId, PersistedGuideProgress>>;
}

function parseLocalRows(raw: string | null, definitions: readonly GuideDefinition[]) {
  if (!raw) return {} as Partial<Record<GuideId, PersistedGuideProgress>>;
  try {
    const payload = JSON.parse(raw);
    if (!payload || payload.version !== STORAGE_VERSION || !payload.rows || typeof payload.rows !== 'object' || Array.isArray(payload.rows)) return {};
    const valid: PersistedGuideProgress[] = [];
    for (const [id, row] of Object.entries(payload.rows) as [GuideId, any][]) {
      const definition = definitions.find((guide) => guide.id === id);
      if (!definition) continue;
      if (!row || row.guideId !== id || row.guideVersion !== definition.version) return {};
      const parsed = parseRows([{
        guide_id: row.guideId, guide_version: row.guideVersion, status: row.status,
        current_step: row.currentStep, first_eligible_at: row.firstEligibleAt,
        acknowledged_at: row.acknowledgedAt, completed_at: row.completedAt, updated_at: row.updatedAt,
      }]);
      if (parsed.length !== 1 || parsed[0].guideVersion !== definition.version) return {};
      valid.push(parsed[0]);
    }
    return rowsById(valid);
  } catch {
    return {};
  }
}

function seedProgress(definitions: readonly GuideDefinition[], existing: Partial<Record<GuideId, PersistedGuideProgress>>) {
  const now = new Date().toISOString();
  const rows: Partial<Record<GuideId, PersistedGuideProgress>> = {};
  for (const definition of definitions) {
    const prior = existing[definition.id];
    rows[definition.id] = prior?.guideVersion === definition.version ? prior : {
      guideId: definition.id, guideVersion: definition.version, status: 'not_started', currentStep: 0,
      firstEligibleAt: now, acknowledgedAt: null, completedAt: null, updatedAt: now,
    };
  }
  return rows;
}

export function useGuideProgress(eligibleDefinitions: readonly GuideDefinition[]) {
  const { user, initialized, profile, permissionsLoaded } = useAuth();
  const userId = user?.id ?? null;
  const companyId = profile?.company_id ?? null;
  const scope = userId && companyId ? `${userId}:${companyId}` : null;
  const ready = !!scope && initialized && !!profile && permissionsLoaded;
  const [state, setState] = useState<State>({ scope: null, rows: {}, loading: false, error: null, fallbackActive: false });
  const [reload, setReload] = useState(0);
  const definitionsKey = eligibleDefinitions.map(({ id, version }) => `${id}:${version}`).join('|');
  const definitions = useMemo(() => eligibleDefinitions.map(({ id, version }) => ({ guide_id: id, guide_version: version })), [definitionsKey]);

  const retry = useCallback(async () => { setReload((value) => value + 1); }, []);

  useEffect(() => {
    let active = true;
    if (!ready || !scope) {
      setState({ scope, rows: {}, loading: false, error: null, fallbackActive: false });
      return () => { active = false; };
    }
    setState((current) => ({ scope, rows: current.scope === scope ? current.rows : {}, loading: true, error: null, fallbackActive: current.scope === scope && current.fallbackActive }));
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('rpc_sync_user_guide_progress', { p_guides: definitions }) as RpcResult;
        if (!active) return;
        if (error) throw new Error(LOAD_ERROR);
        const serverRows = rowsById(parseRows(data));
        setState({ scope, rows: serverRows, loading: false, error: null, fallbackActive: false });
        try { await AsyncStorage.setItem(storageKey(scope), JSON.stringify({ version: STORAGE_VERSION, rows: serverRows })); } catch { /* Server remains authoritative if device caching is unavailable. */ }
      } catch {
        let existing = {} as Partial<Record<GuideId, PersistedGuideProgress>>;
        try {
          existing = parseLocalRows(await AsyncStorage.getItem(storageKey(scope)), eligibleDefinitions);
        } catch { /* Seed from the validated guide definitions if storage cannot be read. */ }
        if (!active) return;
        const rows = seedProgress(eligibleDefinitions, existing);
        setState({ scope, rows, loading: false, error: LOAD_ERROR, fallbackActive: true });
        try { await AsyncStorage.setItem(storageKey(scope), JSON.stringify({ version: STORAGE_VERSION, rows })); } catch { /* Keep in-memory progress available. */ }
      }
    })();
    return () => { active = false; };
  }, [scope, ready, definitions, reload, eligibleDefinitions]);

  const write = useCallback(async (id: GuideId, status: PersistedGuideProgress['status'], step: number, acknowledge: boolean) => {
    const previous = state.scope === scope ? state.rows[id] : undefined;
    if (!scope || !previous) throw new Error(SAVE_ERROR);
    const definition = eligibleDefinitions.find((guide) => guide.id === id);
    if (!definition) throw new Error(SAVE_ERROR);
    const terminalStatus = previous.status === 'done' || previous.status === 'familiar' ? previous.status : status;
    const requestedStep = step;
    const boundedStep = terminalStatus === 'familiar' || terminalStatus === 'not_started'
      ? 0
      : Math.max(0, Math.min(definition.steps.length - 1, Math.trunc(Number.isFinite(requestedStep) ? requestedStep : 0)));
    const args = { p_guide_id: id, p_guide_version: definition.version, p_status: terminalStatus, p_current_step: boundedStep, p_acknowledge: acknowledge };

    const applyLocal = async () => {
      const now = new Date().toISOString();
      const updated: PersistedGuideProgress = {
        ...previous,
        guideVersion: definition.version,
        status: terminalStatus,
        currentStep: boundedStep,
        acknowledgedAt: acknowledge ? previous.acknowledgedAt ?? now : previous.acknowledgedAt,
        completedAt: terminalStatus === 'done' ? previous.completedAt ?? now : null,
        updatedAt: now,
      };
      setState((current) => current.scope === scope ? { ...current, rows: { ...current.rows, [id]: updated }, error: SAVE_ERROR, fallbackActive: true } : current);
      try {
        const currentRows = state.scope === scope ? state.rows : {};
        await AsyncStorage.setItem(storageKey(scope), JSON.stringify({ version: STORAGE_VERSION, rows: { ...currentRows, [id]: updated } }));
      } catch { /* Keep the requested transition in memory even if device storage fails. */ }
      return updated;
    };

    if (state.fallbackActive && state.scope === scope) return applyLocal();
    try {
      const { data, error } = await supabase.rpc('rpc_update_user_guide_progress', args) as RpcResult;
      if (error) throw new Error(SAVE_ERROR);
      const updated = parseRows(data)[0];
      if (!updated) throw new Error(SAVE_ERROR);
      setState((current) => current.scope === scope ? { ...current, rows: { ...current.rows, [id]: updated }, error: null } : current);
      try {
        await AsyncStorage.setItem(storageKey(scope), JSON.stringify({
          version: STORAGE_VERSION,
          rows: { ...(state.scope === scope ? state.rows : {}), [id]: updated },
        }));
      } catch { /* Server remains authoritative if device caching is unavailable. */ }
      return updated;
    } catch {
      return applyLocal();
    }
  }, [scope, eligibleDefinitions, state.scope, state.rows, state.fallbackActive]);

  const start = useCallback((id: GuideId) => {
    const progress = state.scope === scope ? state.rows[id] : undefined;
    return write(id, progress?.status === 'done' ? 'done' : 'in_progress', progress?.currentStep ?? 0, true);
  }, [scope, state.scope, state.rows, write]);
  const saveStep = useCallback((id: GuideId, step: number) => {
    const progress = state.scope === scope ? state.rows[id] : undefined;
    return write(id, progress?.status === 'done' ? 'done' : 'in_progress', step, true);
  }, [scope, state.scope, state.rows, write]);
  const markFamiliar = useCallback((id: GuideId) => write(id, 'familiar', 0, true), [write]);
  const skip = markFamiliar;
  const acknowledge = useCallback((id: GuideId) => {
    const progress = state.scope === scope ? state.rows[id] : undefined;
    if (!progress) return Promise.reject(new Error(SAVE_ERROR));
    return write(id, progress.status, progress.currentStep, true);
  }, [scope, state.scope, state.rows, write]);
  const complete = useCallback((id: GuideId) => {
    const definition = eligibleDefinitions.find((guide) => guide.id === id);
    return write(id, 'done', definition ? definition.steps.length - 1 : 0, true);
  }, [eligibleDefinitions, write]);

  return {
    scope,
    progressById: state.scope === scope && scope ? state.rows : {},
    loading: ready ? (state.scope !== scope || state.loading) : false,
    error: state.scope === scope ? state.error : null,
    fallbackActive: state.scope === scope && !!scope ? state.fallbackActive : false,
    retry,
    start,
    saveStep,
    skip,
    markFamiliar,
    acknowledge,
    complete,
  };
}
