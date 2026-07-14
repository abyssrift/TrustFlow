// Global search hook: parses the raw query, debounces, calls rpc_global_search,
// and buckets results by type for the dropdown. Used by both the TopBar dropdown
// and the /search results screen.
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useDebounce } from '@/hooks/useDebounce';
import { parseQuery, ParsedQuery, SearchType } from '@/hooks/useSearchQuery';

export type SearchResult = {
  type: SearchType;
  id: string;
  title: string;
  snippet: string | null;
  score: number;
  created_at: string;
  task_id: string | null;
};

export type GroupedResults = Partial<Record<SearchType, SearchResult[]>>;

// route for a result row — mirrors existing nav (router.push(`/task/${id}`)).
export function resultRoute(r: SearchResult): string {
  switch (r.type) {
    case 'task':    return `/task/${r.id}`;
    case 'comment': return r.task_id ? `/task/${r.task_id}` : '/tasks';
    case 'file':    return r.task_id ? `/task/${r.task_id}` : '/filehub';
    case 'report':  return '/intelligence/reports';
  }
}

type Options = {
  types?: SearchType[] | null;   // override/augment the parsed type filter (screen tabs)
  limit?: number;
  enabled?: boolean;             // skip fetching (e.g. dropdown closed)
};

export function useGlobalSearch(raw: string, opts: Options = {}) {
  const { types: typeOverride = null, limit = 40, enabled = true } = opts;
  const parsed: ParsedQuery = useMemo(() => parseQuery(raw), [raw]);
  const debounced = useDebounce(raw, 250);
  const [results, setResults] = useState<SearchResult[]>([]);
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
      })
      .then(({ data, error }) => {
        if (id !== reqId.current) return; // stale response — a newer query won
        setResults(error || !Array.isArray(data) ? [] : (data as SearchResult[]));
        setLoading(false);
      });
  }, [debounced, enabled, limit, JSON.stringify(effectiveTypes)]);

  const grouped = useMemo<GroupedResults>(() => {
    const g: GroupedResults = {};
    for (const r of results) (g[r.type] ??= []).push(r);
    return g;
  }, [results]);

  return { results, grouped, loading, parsed };
}
