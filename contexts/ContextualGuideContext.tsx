import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useGuideProgress } from '@/hooks/useGuideProgress';
import { useResponsive } from '@/hooks/useResponsive';
import { eligibleGuides, eligibleGuidePhases, filterEligibleProgress, getNewGuideIds, getSubtleNewGuideIds, getGuideForRoute, guideRouteMatches, GuideAnchorId, GuideDefinition, GuideId, GuideProgress, GuideRowStatus, clampGuideStep } from '@/lib/contextualGuides';

type ContextGuideProgress = Omit<GuideProgress, 'status'> & { status: GuideRowStatus };

export type GuideAnchorHandle = { measure(): Promise<{ x: number; y: number; width: number; height: number } | null> };
type GuideRect = { x: number; y: number; width: number; height: number };
type GuideContextValue = {
  checklistVisible: boolean;
  openChecklist(): void;
  closeChecklist(): void;
  launchGuide(id: GuideId): Promise<void>;
  launcherGuide: GuideDefinition | null;
  registerAnchor(id: GuideAnchorId, handle: GuideAnchorHandle): () => void;
  remeasureActiveAnchor(): Promise<void>;
  activeGuide: GuideDefinition | null;
  activeStep: number;
  guideDefinitions: readonly GuideDefinition[];
  guidePhases: ReturnType<typeof eligibleGuidePhases>;
  progressById: Partial<Record<GuideId, ContextGuideProgress>>;
  checklistComplete: boolean;
  newGuideIds: GuideId[];
  progressLoading: boolean;
  progressError: string | null;
  fallbackActive: boolean;
  eligibilityLoading: boolean;
  progressRetry(): Promise<void>;
  guideError: string | null;
  activeAnchor: GuideRect | null;
  /** Guide the tour continues into after the active one finishes; null ends at the checklist. */
  followingGuide: GuideDefinition | null;
  /** Guide left mid-way by navigating off its route; the launcher offers to resume it. */
  suspendedGuide: GuideDefinition | null;
  nextStep(): Promise<void>;
  previousStep(): void;
  skipGuide(): Promise<void>;
  completeGuide(id: GuideId): Promise<void>;
  acknowledgeNewGuide(id: GuideId): Promise<void>;
  closeGuide(): void;
};

const GuideContext = createContext<GuideContextValue | null>(null);
const ROUTE_TIMEOUT_MS = 1500;
const ANCHOR_TIMEOUT_MS = 550;

function wait(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }

export function ContextualGuideProvider({ children }: { children: React.ReactNode }) {
  const { user, profile, initialized, permissionsLoaded, hasPermission } = useAuth();
  const { isMobile } = useResponsive();
  const definitions = useMemo(() => eligibleGuides({
    authenticated: !!user, profileReady: initialized && !!profile, accessReady: permissionsLoaded,
    hasPermission, isOwner: !!profile?.is_owner, isMobile,
  }), [user?.id, profile, initialized, permissionsLoaded, hasPermission, isMobile]);
  const eligibleKey = definitions.map(({ id, version }) => `${id}:${version}`).join('|');
  const scope = user?.id && profile?.company_id ? `${user.id}:${profile.company_id}` : null;
  const progress = useGuideProgress(definitions);
  const visibleProgress = useMemo(() => filterEligibleProgress(progress.progressById as Partial<Record<GuideId, GuideProgress>>, definitions) as Partial<Record<GuideId, ContextGuideProgress>>, [progress.progressById, definitions]);
  const scopedProgress = progress.scope === scope ? visibleProgress : {};
  const guidePhases = useMemo(() => eligibleGuidePhases(definitions), [definitions]);
  const checklistComplete = definitions.length > 0 && definitions.every((guide) => {
    const status = scopedProgress[guide.id]?.status;
    return status === 'done' || status === 'familiar';
  });
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useGlobalSearchParams();
  const launcherGuide = useMemo(() => getGuideForRoute(definitions, pathname, searchParams), [definitions, pathname, searchParams]);
  const pathnameRef = useRef(pathname);
  const searchParamsRef = useRef(searchParams);
  const accountRef = useRef(scope);
  const previousEligible = useRef<{ scope: string | null; definitions: readonly GuideDefinition[] }>({ scope: null, definitions: [] });
  const [newGuideCandidates, setNewGuideCandidates] = useState<{ scope: string | null; ids: GuideId[] }>({ scope: null, ids: [] });
  const anchors = useRef(new Map<GuideAnchorId, GuideAnchorHandle>());
  const activeAnchorId = useRef<GuideAnchorId | null>(null);
  const anchorMeasureToken = useRef(0);
  const [checklistVisible, setChecklistVisible] = useState(false);
  const [activeId, setActiveId] = useState<GuideId | null>(null);
  // Guide the user navigated away from mid-way; the launcher offers to resume it.
  const [suspendedId, setSuspendedId] = useState<GuideId | null>(null);
  // Guides skipped this session. Skip writes no progress, so without this the tour's
  // wrap-around would offer them again and Skip could cycle forever.
  const [skippedIds, setSkippedIds] = useState<readonly GuideId[]>([]);
  const [activeScope, setActiveScope] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [activeAnchor, setActiveAnchor] = useState<GuideRect | null>(null);
  const [guideError, setGuideError] = useState<string | null>(null);
  const wasChecklistComplete = useRef(false);
  const launchToken = useRef(0);
  const activeGuide = activeScope === scope ? definitions.find((guide) => guide.id === activeId) ?? null : null;
  const suspendedGuide = definitions.find((guide) => guide.id === suspendedId) ?? null;

  useEffect(() => {
    const previous = previousEligible.current;
    if (previous.scope !== scope) {
      previousEligible.current = { scope, definitions };
      setNewGuideCandidates({ scope, ids: [] });
      return;
    }
    const currentIds = new Set(definitions.map(({ id }) => id));
    const addedCapabilityIds = getNewGuideIds(previous.definitions, definitions)
      .filter((id) => definitions.some((guide) => guide.id === id && guide.scope === 'capability'));
    previousEligible.current = { scope, definitions };
    setNewGuideCandidates((current) => ({
      scope,
      ids: [...new Set([...(current.scope === scope ? current.ids : []).filter((id) => currentIds.has(id)), ...addedCapabilityIds])],
    }));
  }, [scope, eligibleKey]);

  const newGuideDefinitions = useMemo(
    () => newGuideCandidates.scope === scope ? definitions.filter((guide) => newGuideCandidates.ids.includes(guide.id)) : [],
    [newGuideCandidates, definitions, scope],
  );
  const newGuideIds = useMemo(
    () => getSubtleNewGuideIds([], newGuideDefinitions, scopedProgress),
    [newGuideDefinitions, scopedProgress],
  );
  useEffect(() => {
    if (checklistComplete && !wasChecklistComplete.current && checklistVisible) setChecklistVisible(false);
    wasChecklistComplete.current = checklistComplete;
  }, [checklistComplete, checklistVisible]);

  useEffect(() => { pathnameRef.current = pathname; searchParamsRef.current = searchParams; }, [pathname, searchParams]);
  useEffect(() => {
    if (accountRef.current === scope) return;
    accountRef.current = scope;
    launchToken.current++;
    anchorMeasureToken.current++;
    activeAnchorId.current = null;
    setActiveId(null);
    setSuspendedId(null);
    setSkippedIds([]);
    setActiveScope(null);
    setActiveAnchor(null);
    setChecklistVisible(false);
    setGuideError(null);
  }, [scope]);
  useEffect(() => {
    if (activeId && !definitions.some((guide) => guide.id === activeId)) {
      launchToken.current++;
      anchorMeasureToken.current++;
      activeAnchorId.current = null;
      setActiveId(null);
      setActiveAnchor(null);
      setChecklistVisible(true);
      setGuideError('This guide is not currently available.');
    }
  }, [activeId, definitions]);
  useEffect(() => {
    if (!activeGuide) return;
    if (!guideRouteMatches(pathname, activeGuide.route, searchParams)) {
      setSuspendedId(activeGuide.id);
      setActiveId(null);
      setActiveAnchor(null);
      activeAnchorId.current = null;
      anchorMeasureToken.current++;
    }
  }, [pathname, searchParams, activeGuide]);

  const openChecklist = useCallback(() => { setGuideError(null); setChecklistVisible(true); }, []);
  const closeChecklist = useCallback(() => setChecklistVisible(false), []);
  const remeasureActiveAnchor = useCallback(async () => {
    const anchorId = activeAnchorId.current;
    const token = ++anchorMeasureToken.current;
    if (!anchorId) { setActiveAnchor(null); return; }
    setActiveAnchor(null);
    let rect: GuideRect | null = null;
    try { rect = await anchors.current.get(anchorId)?.measure() ?? null; } catch { rect = null; }
    if (token !== anchorMeasureToken.current || activeAnchorId.current !== anchorId) return;
    setActiveAnchor(rect && rect.width > 0 && rect.height > 0 ? rect : null);
  }, []);
  const registerAnchor = useCallback((id: GuideAnchorId, handle: GuideAnchorHandle) => {
    anchors.current.set(id, handle);
    if (activeAnchorId.current === id) void remeasureActiveAnchor();
    return () => {
      if (anchors.current.get(id) === handle) {
        anchors.current.delete(id);
        if (activeAnchorId.current === id) {
          anchorMeasureToken.current++;
          setActiveAnchor(null);
        }
      }
    };
  }, [remeasureActiveAnchor]);

  const launchGuide = useCallback(async (id: GuideId) => {
    const definition = definitions.find((guide) => guide.id === id);
    if (!definition) { setGuideError('This guide is not currently available.'); return; }
    const token = ++launchToken.current;
    setGuideError(null);
    setChecklistVisible(false);
    setActiveId(null);
    setSuspendedId(null);
    setSkippedIds((ids) => ids.filter((skipped) => skipped !== id));
    setActiveScope(null);
    setActiveAnchor(null);
    activeAnchorId.current = null;
    if (!guideRouteMatches(pathnameRef.current, definition.route, searchParamsRef.current)) {
      try { router.push(definition.route as any); }
      catch { setChecklistVisible(true); setGuideError('Guide could not be opened.'); return; }
      const started = Date.now();
      while (token === launchToken.current && !guideRouteMatches(pathnameRef.current, definition.route, searchParamsRef.current) && Date.now() - started < ROUTE_TIMEOUT_MS) await wait(40);
      if (token === launchToken.current && !guideRouteMatches(pathnameRef.current, definition.route, searchParamsRef.current)) {
        setChecklistVisible(true);
        setGuideError('Guide could not be opened.');
        return;
      }
    }
    if (token !== launchToken.current || !definitions.some((guide) => guide.id === id)) return;
    try {
      await progress.start(id);
      if (token !== launchToken.current) return;
      const row = scopedProgress[id];
      const step = row?.status === 'in_progress' ? clampGuideStep(id, row.currentStep) : 0;
      setActiveStep(step);
      setActiveId(id);
      setActiveScope(scope);
      const anchorId = definition.steps[step]?.anchorId;
      activeAnchorId.current = anchorId ?? null;
      if (anchorId) {
        const deadline = Date.now() + ANCHOR_TIMEOUT_MS;
        let rect: GuideRect | null = null;
        do {
          try { rect = await anchors.current.get(anchorId)?.measure() ?? null; } catch { rect = null; }
          if (rect && rect.width > 0 && rect.height > 0) break;
          if (Date.now() < deadline && token === launchToken.current) await wait(80);
        } while (Date.now() < deadline && token === launchToken.current);
        if (token === launchToken.current) setActiveAnchor(rect && rect.width > 0 && rect.height > 0 ? rect : null);
      }
    } catch {
      if (token === launchToken.current) { setChecklistVisible(true); setGuideError('Could not save guide progress. Retry your action.'); }
    }
  }, [definitions, router, progress.start, scopedProgress, scope]);

  // Next unfinished guide in curriculum order, after the active one.
  const followingGuide = useMemo(() => {
    const ordered = guidePhases.flatMap((phase) => phase.guides);
    const start = activeGuide ? ordered.findIndex((guide) => guide.id === activeGuide.id) + 1 : 0;
    const unfinished = (guide: GuideDefinition) => guide.id !== activeGuide?.id && !skippedIds.includes(guide.id)
      && scopedProgress[guide.id]?.status !== 'done' && scopedProgress[guide.id]?.status !== 'familiar';
    return ordered.slice(start).find(unfinished) ?? ordered.slice(0, start).find(unfinished) ?? null;
  }, [guidePhases, activeGuide, scopedProgress, skippedIds]);

  const closeGuide = useCallback(() => {
    launchToken.current++;
    anchorMeasureToken.current++;
    activeAnchorId.current = null;
    setActiveId(null);
    setSuspendedId(null);
    setActiveScope(null);
    setActiveAnchor(null);
    setGuideError(null);
  }, []);
  // Skip leaves progress untouched (start already acknowledged it) and moves the tour on.
  // It must not write 'familiar': the server rejects that from in_progress, which used to
  // drop the whole session into device-only progress.
  const skipGuide = useCallback(async () => {
    if (!activeId) return;
    setSkippedIds((ids) => ids.includes(activeId) ? ids : [...ids, activeId]);
    closeGuide();
    // Same ending as finishing: continue, or land on the checklist instead of vanishing.
    if (followingGuide) await launchGuide(followingGuide.id);
    else setChecklistVisible(true);
  }, [activeId, followingGuide, launchGuide, closeGuide]);
  const completeGuide = useCallback(async (id: GuideId) => {
    try { await progress.complete(id); if (activeId === id) closeGuide(); }
    catch { setGuideError('Could not save guide progress. Retry your action.'); }
  }, [activeId, progress.complete, closeGuide]);
  const acknowledgeNewGuide = useCallback(async (id: GuideId) => {
    try { await progress.acknowledge(id); }
    catch { setGuideError('Could not save guide progress. Retry your action.'); }
  }, [progress.acknowledge]);
  const nextStep = useCallback(async () => {
    if (!activeGuide) return;
    const finalStep = activeStep >= activeGuide.steps.length - 1;
    try {
      if (finalStep) {
        await progress.complete(activeGuide.id);
        closeGuide();
        // Keep the tour going instead of dropping the user on the last page.
        if (followingGuide) await launchGuide(followingGuide.id);
        else setChecklistVisible(true);
      }
      else {
        const next = activeStep + 1;
        await progress.saveStep(activeGuide.id, next);
        setActiveStep(next);
        const anchorId = activeGuide.steps[next]?.anchorId;
        activeAnchorId.current = anchorId ?? null;
        await remeasureActiveAnchor();
      }
    } catch { setGuideError('Could not save guide progress. Retry your action.'); }
  }, [activeGuide, activeStep, followingGuide, launchGuide, progress.complete, progress.saveStep, closeGuide, remeasureActiveAnchor]);
  const previousStep = useCallback(async () => {
    if (!activeGuide || activeStep <= 0) return;
    const previous = activeStep - 1;
    try {
      await progress.saveStep(activeGuide.id, previous);
      setActiveStep(previous);
      const anchorId = activeGuide.steps[previous]?.anchorId;
      activeAnchorId.current = anchorId ?? null;
      await remeasureActiveAnchor();
    } catch { setGuideError('Could not save guide progress. Retry your action.'); }
  }, [activeGuide, activeStep, progress.saveStep, remeasureActiveAnchor]);

  const value: GuideContextValue = {
    checklistVisible, openChecklist, closeChecklist, launchGuide, launcherGuide, registerAnchor, remeasureActiveAnchor,
    activeGuide, activeStep, guideDefinitions: definitions, guidePhases, progressById: scopedProgress,
    checklistComplete, newGuideIds,
    progressLoading: progress.loading, progressError: progress.error, fallbackActive: progress.fallbackActive, progressRetry: progress.retry,
    eligibilityLoading: !!user && (!initialized || !profile || !permissionsLoaded),
    guideError, activeAnchor, followingGuide, suspendedGuide, nextStep, previousStep, skipGuide, closeGuide,
    completeGuide, acknowledgeNewGuide,
  };
  return <GuideContext.Provider value={value}>{children}</GuideContext.Provider>;
}

export function useContextualGuide(): GuideContextValue {
  const context = useContext(GuideContext);
  if (!context) throw new Error('useContextualGuide must be used within ContextualGuideProvider');
  return context;
}
