// Global search hook: parses the raw query, debounces, calls rpc_global_search,
// and buckets results by type for the dropdown. Used by both the TopBar dropdown
// and the /search results screen.
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useDebounce } from '@/hooks/useDebounce';
import { parseQuery, ParsedQuery, SearchType } from '@/hooks/useSearchQuery';

export type ResultType = SearchType | 'archive';

export type SearchResult = {
  type: ResultType;
  id: string;
  title: string;
  snippet: string | null;
  score: number;
  created_at: string;
  task_id: string | null;
};

export type GroupedResults = Partial<Record<ResultType, SearchResult[]>>;

// route for a result row — mirrors existing nav (router.push(`/task/${id}`)).
export function resultRoute(r: SearchResult): string {
  switch (r.type) {
    case 'task':    return `/task/${r.id}`;
    case 'comment': return r.task_id ? `/task/${r.task_id}` : '/tasks';
    case 'file':    return r.task_id ? `/task/${r.task_id}` : '/filehub';
    case 'report':  return '/intelligence/reports';
    case 'person':  return '/people';
    case 'archive': return '/intelligence/archives';
  }
}

type Options = {
  types?: SearchType[] | null;   // override/augment the parsed type filter (screen tabs)
  limit?: number;
  enabled?: boolean;             // skip fetching (e.g. dropdown closed)
  includeArchived?: boolean;     // also search the archives table (gated by caller)
};

// Map an `archives` row (rpc_get_archives) into the shared SearchResult shape.
function archiveToResult(a: any): SearchResult {
  return {
    type: 'archive',
    id: a.id,
    title: a.metadata?.title || `${a.entity_type ?? 'Archived'} item`,
    snippet: a.entity_type ? `Archived ${a.entity_type}` : 'Archived',
    score: 0,
    created_at: a.archived_at,
    task_id: a.entity_type === 'task' ? a.entity_id : null,
  };
}

export function useGlobalSearch(raw: string, opts: Options = {}) {
  const { types: typeOverride = null, limit = 40, enabled = true, includeArchived = false } = opts;
  const parsed: ParsedQuery = useMemo(() => parseQuery(raw), [raw]);
  const debounced = useDebounce(raw, 250);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [archives, setArchives] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  // effective type filter: explicit override wins, else parsed hints.
  const effectiveTypes = typeOverride && typeOverride.length ? typeOverride
    : parsed.types.length ? parsed.types : null;

  useEffect(() => {
    const p = parseQuery(debounced);
    const hasQuery = p.terms !== '' || p.from !== null || p.to !== null;
    if (!enabled || !hasQuery) {
      setResults([]); setLoading(false);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    supabase
      .rpc('rpc_global_search', {
        p_terms: p.terms,
        p_types: effectiveTypes,
        p_from: p.from,
        p_to: p.to,
        p_limit: limit,
        p_date_field: p.field,
      })
      .then(({ data, error }) => {
        if (id !== reqId.current) return; // stale response — a newer query won
        setResults(error || !Array.isArray(data) ? [] : (data as SearchResult[]));
        setLoading(false);
      });
  }, [debounced, enabled, limit, parsed.field, JSON.stringify(effectiveTypes)]);

  // Archives: opt-in, reuses the existing rpc_get_archives (company-scoped).
  useEffect(() => {
    const terms = parseQuery(debounced).terms;
    if (!enabled || !includeArchived || terms === '') { setArchives([]); return; }
    let live = true;
    supabase.rpc('rpc_get_archives', { p_entity_type: null, p_search: terms }).then(({ data, error }) => {
      if (!live) return;
      setArchives(error || !Array.isArray(data) ? [] : data.slice(0, 20).map(archiveToResult));
    });
    return () => { live = false; };
  }, [debounced, enabled, includeArchived]);

  const grouped = useMemo<GroupedResults>(() => {
    const g: GroupedResults = {};
    for (const r of results) (g[r.type] ??= []).push(r);
    return g;
  }, [results]);

  return { results, grouped, archives, loading, parsed };
}
