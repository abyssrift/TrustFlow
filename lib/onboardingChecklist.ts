export const ONBOARDING_CHECKLIST_CATALOG_KEY = 'onboarding_checklist.workspace-ready';

export const ONBOARDING_CHECKLIST_PHASES = [
  { id: 'start', title: 'Start here', order: 0 },
  { id: 'collaborate', title: 'Work together', order: 1 },
  { id: 'grow', title: 'Build on your setup', order: 2 },
] as const;

export type OnboardingChecklistItem = {
  key: string;
  title: string;
  description: string;
  phase?: string;
  order?: number;
  capability?: string;
};

export type OnboardingChecklist = {
  catalogKey: string;
  version: number;
  items: OnboardingChecklistItem[];
};

export type OnboardingChecklistPhase = {
  id: string;
  title: string;
  order: number;
  items: OnboardingChecklistItem[];
};

type CatalogEntry = {
  catalog_key?: unknown;
  version?: unknown;
  payload?: unknown;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function parseOnboardingChecklistCatalogEntry(entry: CatalogEntry): OnboardingChecklist {
  const payload = entry?.payload as { schema_version?: unknown; items?: unknown } | undefined;
  const items = Array.isArray(payload?.items) ? payload.items : null;
  const version = typeof entry?.version === 'number' && Number.isInteger(entry.version) && entry.version > 0
    ? entry.version
    : null;
  const validItems = items?.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const candidate = item as Record<string, unknown>;
    return isNonEmptyString(candidate.key)
      && isNonEmptyString(candidate.title)
      && isNonEmptyString(candidate.description)
      && (candidate.phase === undefined || isNonEmptyString(candidate.phase))
      && (candidate.order === undefined || (typeof candidate.order === 'number' && Number.isFinite(candidate.order)))
      && (candidate.capability === undefined || isNonEmptyString(candidate.capability));
  }) ?? false;
  const keys = items?.map((item) => (item as Record<string, unknown>).key) ?? [];
  const uniqueKeys = new Set(keys).size === keys.length;

  if (
    entry?.catalog_key !== ONBOARDING_CHECKLIST_CATALOG_KEY
    || version === null
    || payload?.schema_version !== 1
    || !items
    || items.length === 0
    || !validItems
    || !uniqueKeys
  ) {
    throw new Error('Invalid onboarding checklist catalog entry');
  }

  return {
    catalogKey: ONBOARDING_CHECKLIST_CATALOG_KEY,
    version,
    items: items.map((item) => {
      const candidate = item as Record<string, unknown>;
      return {
        key: candidate.key as string,
        title: candidate.title as string,
        description: candidate.description as string,
        ...(typeof candidate.phase === 'string' ? { phase: candidate.phase } : {}),
        ...(typeof candidate.order === 'number' ? { order: candidate.order } : {}),
        ...(typeof candidate.capability === 'string' ? { capability: candidate.capability } : {}),
      };
    }),
  };
}

/** Groups published entries by their own phase/order metadata; untagged v1 rows remain in Start here. */
export function deriveOnboardingChecklist(
  catalog: OnboardingChecklist,
  availableCapabilities: ReadonlySet<string> = new Set(),
  _previouslySeenKeys: ReadonlySet<string> = new Set(),
): OnboardingChecklistPhase[] {
  const visibleItems = catalog.items
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .filter(({ item }) => !item.capability || availableCapabilities.has(item.capability));
  const phaseIds = new Set(visibleItems.map(({ item }) => item.phase ?? 'start'));
  return ONBOARDING_CHECKLIST_PHASES
    .filter(({ id }) => phaseIds.has(id))
    .map((phase) => ({
      ...phase,
      items: visibleItems
        .filter(({ item }) => (item.phase ?? 'start') === phase.id)
        .sort((left, right) => (left.item.order ?? left.sourceIndex) - (right.item.order ?? right.sourceIndex) || left.sourceIndex - right.sourceIndex)
        .map(({ item }) => item),
    }));
}

/** Explicit rediscovery baseline: opening a checklist alone cannot make an item new. */
export function getNewChecklistItems(
  phases: readonly OnboardingChecklistPhase[],
  previouslySeenKeys: ReadonlySet<string>,
): OnboardingChecklistItem[] {
  return phases.flatMap(({ items }) => items).filter(({ key }) => !previouslySeenKeys.has(key));
}

export async function loadOnboardingChecklist(
  client: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }> },
): Promise<OnboardingChecklist | null> {
  const { data, error } = await client.rpc('rpc_resolve_published_catalog_entry', {
    p_catalog_key: ONBOARDING_CHECKLIST_CATALOG_KEY,
    p_version: null,
  });
  if (error || !data) return null;

  try {
    return parseOnboardingChecklistCatalogEntry(data as CatalogEntry);
  } catch {
    return null;
  }
}