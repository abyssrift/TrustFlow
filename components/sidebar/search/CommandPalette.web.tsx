// Command palette (⌘K / Ctrl+K / Ctrl+F) — web only. A centered floating
// overlay that unifies "Go to" (permissioned app pages + keyword-indexed
// sub-destinations) with global search results (rpc_global_search via
// useGlobalSearch). As of #341 this is also the only search surface: the
// top-bar field just triggers it (seeded via `initialQuery`), and the old
// hover SearchDropdown is retired from the top bar.
//
// #342 redesign — modelled on the Cloudflare dashboard command palette:
//   • CREATE is a wrapping row of chunky accent-tinted tiles, not list rows.
//   • GO TO draws from SHORTCUTS *and* PALETTE_DESTINATIONS (constants.ts) and
//     matches synonyms — "compare" finds Analytics — showing a breadcrumb or an
//     "Also known as:" line depending on what matched.
//   • A pinned footer hint bar (↑↓ / ⏎ / esc) sits below the scroll area.
//   • When the query is empty we also show the scoped-search tips the
//     hooks/useSearchQuery.ts parser already understands (task:, due tomorrow…).
//
// Hotkeys live in Sidebar.web.tsx (the mount point) — the palette can't listen
// for its own open key while unmounted. This component owns the arrow/enter/
// escape nav while open.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions, type TextStyle } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Popup from '@/components/common/Popup';
import { useAuth } from '@/contexts/AuthContext';
import { useModalDispatch } from '@/contexts/ModalDispatchContext';
import { useToast } from '@/contexts/ToastContext';
import { useTheme } from '@/contexts/ThemeContext';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/hooks/useThemeColors';
import { resultRoute, useGlobalSearch, type ResultType, type SearchResult } from '@/hooks/useGlobalSearch';
import { useRecentSearches } from '@/hooks/useRecentSearches';
import { useRecentDestinations } from '@/hooks/useRecentDestinations';
import { fuzzyMatch, matchDestinations, type DestinationMatch, type IconName } from '@/components/sidebar/constants';
import { parseInputMode, PALETTE_COMMANDS, type PaletteCommand, type PaletteCommandCtx } from '@/components/sidebar/palette-commands';
import { ENTITY_META, EntityGlyph, type EntityKind } from '@/components/entities/EntityUI';
import { relTime, TYPE_ICON, TYPE_LABEL } from './SearchResultRow';
import { highlightRuns } from './highlight';

// Containers first, same order as SearchDropdown.web.tsx's GROUP_ORDER.
// ponytail: 2 lines, redefined not imported — export from SearchDropdown when a 3rd consumer shows up.
const GROUP_ORDER: ResultType[] = ['project', 'portfolio', 'task', 'person', 'file', 'report', 'comment'];
const GROUP_LABEL: Record<string, string> = {
  task: 'Tasks', person: 'People', file: 'Files', report: 'Reports', comment: 'Comments',
  project: ENTITY_META.project.plural, portfolio: ENTITY_META.portfolio.plural,
};
// Tighter than #325's 5 — with GO TO synonyms now feeding the same list, 3 per
// group keeps the palette from becoming a wall; "See all" carries the rest.
const PER_GROUP = 3;

// Scoped-search prefixes hooks/useSearchQuery.ts already parses (type: prefixes
// + natural-language dates). Surfaced, not re-implemented — tapping one just
// seeds the input. Not nav targets, so they stay out of the arrow-key list.
const SEARCH_TIPS: { token: string; hint: string; icon: IconName }[] = [
  { token: '>', hint: 'Run a command', icon: 'terminal' },
  { token: 'task:', hint: 'Only tasks', icon: 'check-square-o' },
  { token: 'file:', hint: 'Only files', icon: 'file-o' },
  { token: 'report:', hint: 'Only reports', icon: 'bar-chart' },
  { token: 'comment:', hint: 'Only comments', icon: 'comment-o' },
  { token: 'due tomorrow', hint: 'Filter by date', icon: 'calendar-o' },
];

type PaletteItem =
  | { kind: 'action'; run: () => void }
  | { kind: 'page'; dest: DestinationMatch }
  | { kind: 'result'; result: SearchResult }
  | { kind: 'recent-search'; q: string }
  // #347 — inline quick-create row (always flatItems[0] when present).
  | { kind: 'create-inline'; entity: 'task' | 'project'; title: string };

type CreateAction = {
  id: string;
  label: string;
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  permission: string;
  run: () => void;
};

// #345 — sub-actions for a selected search result (→ / Tab opens the panel).
type PaletteAction = {
  id: string;
  label: string;
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  run: () => void | Promise<void>;
  permission?: string;
};

type ActionCtx = {
  activate: (it: PaletteItem) => void;
  successToast: (msg: string, title?: string) => void;
  errorToast: (msg: string, title?: string) => void;
  backToList: () => void;
};

// The action set for a result row. Same three actions for every result type:
// Open reuses the palette's own `activate` (so recency + recent-search history
// stay consistent), Open-in-new-tab and Copy-link build an absolute URL from
// resultRoute() — web-only surface, so `window` is always there.
//
// #345 follow-up: task-only "Assign to me" / "Mark done" were specced but are
// omitted — no clean standalone RPC exists. `rpc_update_task_assignments` is a
// full-set delete-then-reinsert gated to the task manager only (destructive as a
// one-tap action, and wrong permission model), `rpc_claim_task` only applies to
// single-claimant teams, and marking a task done is a per-pipeline stage-machine
// transition (`rpc_execute_stage_action` / `rpc_advance_stage`) that needs stage
// + transition context a search result row doesn't carry. Add them here behind
// `permission` once a sanctioned "add me / complete" RPC lands.
function resultActions(r: SearchResult, ctx: ActionCtx): PaletteAction[] {
  const url = window.location.origin + resultRoute(r);
  const all: PaletteAction[] = [
    {
      id: 'open',
      label: 'Open',
      icon: 'arrow-right',
      run: () => ctx.activate({ kind: 'result', result: r }),
    },
    {
      id: 'open-new-tab',
      label: 'Open in new tab',
      icon: 'external-link',
      run: () => {
        window.open(url, '_blank');
      },
    },
    {
      id: 'copy-link',
      label: 'Copy link',
      icon: 'link',
      run: async () => {
        try {
          await navigator.clipboard.writeText(url);
          ctx.successToast('Link copied');
        } catch {
          ctx.errorToast('Could not copy link');
        }
        ctx.backToList();
      },
    },
  ];
  return all;
}

// Render ts_headline's <b>…</b> spans as tinted runs — a real highlighter-pen
// swipe (opaque-ish accent behind the text + bold), not just a bolder greyish
// word. Inline styles because theme token color classes go black inside an RN
// <Modal> on web (see Tooltip.tsx).
function renderHighlighted(text: string | null, tintStyle: TextStyle) {
  const runs = highlightRuns(text);
  if (runs.length === 1 && runs[0] === '') return null;
  return runs.map((run, i) => (run ? <Text key={i} style={i % 2 ? tintStyle : undefined}>{run}</Text> : null));
}

// Plain (non-<b>) substring highlighter for GO TO rows: tint the letters the
// user actually typed, in the label or in the "Also known as:" synonym.
// #344: matching is fuzzy now, so a row can match without any contiguous
// substring — in that case indexOf misses and we render plain text rather than
// tint the wrong span. (A per-char subsequence highlighter is a possible
// follow-up; not worth it for the label lengths here.)
function highlightSub(text: string, q: string, tintStyle: TextStyle): React.ReactNode {
  if (!q) return text;
  const at = text.toLowerCase().indexOf(q);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <Text style={tintStyle}>{text.slice(at, at + q.length)}</Text>
      {text.slice(at + q.length)}
    </>
  );
}

// One row for both GO TO (query matches) and RECENT (frequent destinations on
// an empty query) — identical style: icon chip + label + breadcrumb/"Also known
// as" sub-line + trailing → on the active row. `q` is '' for RECENT, so
// highlightSub is a no-op there.
function PageRow({
  d,
  selected,
  q,
  tintStyle,
  selBg,
  colors,
  onHoverIn,
  onPress,
  rowRef,
}: {
  d: DestinationMatch;
  selected: boolean;
  q: string;
  tintStyle: TextStyle;
  selBg: string;
  colors: ReturnType<typeof useThemeColors>;
  onHoverIn: () => void;
  onPress: () => void;
  rowRef: (node: any) => void;
}) {
  return (
    <Pressable
      ref={rowRef}
      onHoverIn={onHoverIn}
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-xl px-3 py-2.5 mx-1"
      style={selected ? { backgroundColor: selBg } : undefined}
    >
      <View className="h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: colors.primary + '14' }}>
        <FontAwesome name={d.icon} size={13} color={colors.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '600', color: colors.textMain }}>
          {highlightSub(d.label, q, tintStyle)}
        </Text>
        {d.matchedKeyword ? (
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>
            Also known as: {highlightSub(d.matchedKeyword, q, tintStyle)}
          </Text>
        ) : d.parentLabel ? (
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>
            {d.parentLabel} › {d.label}
          </Text>
        ) : null}
      </View>
      <View className="w-4 items-end">
        {selected && <FontAwesome name="arrow-right" size={11} color={colors.textDim} />}
      </View>
    </Pressable>
  );
}

function SectionHeader({ label, colors }: { label: string; colors: ReturnType<typeof useThemeColors> }) {
  return (
    <View className="flex-row items-center gap-1 px-3 pt-3 pb-1.5">
      <Text className="text-[9px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>
        {label}
      </Text>
      {/* The "GO TO →" glyph the owner drew — long arrow, not a chevron. */}
      <FontAwesome name="long-arrow-right" size={10} color={colors.textDim} />
    </View>
  );
}

function HintKey({ combo, label, colors }: { combo: string; label: string; colors: ReturnType<typeof useThemeColors> }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <View className="px-1.5 py-0.5 rounded-md" style={{ borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ fontFamily: 'SpaceMono', fontSize: 10, color: colors.textDim }}>{combo}</Text>
      </View>
      <Text style={{ fontSize: 11, color: colors.textMuted }}>{label}</Text>
    </View>
  );
}

export default function CommandPalette({
  open,
  onClose,
  initialQuery,
}: {
  open: boolean;
  onClose: () => void;
  initialQuery?: string;
}) {
  const colors = useThemeColors();
  const router = useRouter();
  const pathname = usePathname();
  const { hasPermission, profile, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const { summon } = useModalDispatch();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  // #345 — result row sub-actions. `actions` mode swaps the scroll body for a
  // per-result action list; `actionTarget` holds the result it's acting on.
  const [mode, setMode] = useState<'list' | 'actions'>('list');
  const [actionTarget, setActionTarget] = useState<SearchResult | null>(null);
  const [actionSel, setActionSel] = useState(0);
  // #346 — command mode (`>` prefix). Its own selection cursor, mirroring
  // #345's separate `actionSel`. Command mode itself isn't stored in `mode`:
  // it's derived from the query (see `input`/`paletteMode` below), so
  // backspacing past the `>` returns to the list with nothing to reset.
  const [cmdSel, setCmdSel] = useState(0);
  const { successToast, errorToast, showToast } = useToast();

  const { results, grouped, loading, searchError } = useGlobalSearch(query, { enabled: open, limit: 40 });
  const { recent, push: pushRecent } = useRecentSearches();
  const { recent: recentDests, record: recordDest } = useRecentDestinations();

  const q = query.trim().toLowerCase();

  // #346/#347 — one parse of the query's leading string decides everything:
  // `>` → command mode, `nt `/`new task:` etc → inline quick-create, else normal.
  const input = useMemo(() => parseInputMode(query), [query]);
  // `mode` (useState) stays 'list' | 'actions'. Command mode is a 3rd *derived*
  // state layered on top — active whenever the query starts with `>`, so it
  // resets itself the moment the `>` is gone. `list` and `actions` reset via
  // the existing `backToList()` effect (open edge + every query change).
  const paletteMode: 'list' | 'actions' | 'commands' =
    input.mode === 'command' ? 'commands' : mode;

  // #346 — permission-gated, then fuzzy-filtered by the text after `>`.
  const commands = useMemo<PaletteCommand[]>(() => {
    const avail = PALETTE_COMMANDS.filter((c) => !c.permission || hasPermission(c.permission));
    const t = input.mode === 'command' ? input.text.toLowerCase() : '';
    if (!t) return avail;
    return avail
      .map((c) => ({ c, m: fuzzyMatch(t, c.label) }))
      .filter((x): x is { c: PaletteCommand; m: { hit: boolean; score: number } } => !!x.m)
      .sort((x, y) => y.m.score - x.m.score)
      .map((x) => x.c);
  }, [hasPermission, input]);

  // #347 — the inline quick-create target, permission-gated. Null unless a
  // create prefix is active with non-empty trailing text and the caller may
  // create that entity.
  const createInline = useMemo<{ entity: 'task' | 'project'; title: string } | null>(() => {
    if (input.mode === 'create-task' && input.text) {
      return hasPermission('task.create') ? { entity: 'task', title: input.text } : null;
    }
    if (input.mode === 'create-project' && input.text) {
      return hasPermission('project.create') ? { entity: 'project', title: input.text } : null;
    }
    return null;
  }, [input, hasPermission]);

  // Highlighter pen, not a whisper: ~0x66 ≈ 40% accent behind the text, bold,
  // rounded so it reads as a marker stroke. 10% (the old 0x1A) was invisible.
  const tintStyle = useMemo<TextStyle>(
    () => ({
      backgroundColor: colors.accent + '66',
      color: colors.textMain,
      fontWeight: '700',
      borderRadius: 3,
    }),
    [colors.accent, colors.textMain]
  );
  // Selected/hover row fill — a light accent wash (#342: accent, not flat grey).
  const selBg = colors.primary + '14';

  // Create/compose actions — the ModalHost-wired types only. Permission keys
  // verified against real gates: task.create + report.view (QuickCreateButton),
  // project.create (_projects_desktop "New Project"), role.manage (RoleBuilder).
  const createActions = useMemo<CreateAction[]>(() => {
    const all: CreateAction[] = [
      { id: 'create-task', label: 'New Task', icon: 'check-square-o', permission: 'task.create', run: () => summon('create-task') },
      { id: 'create-project', label: 'New Project', icon: 'folder-o', permission: 'project.create', run: () => summon('create-project') },
      { id: 'generate-report', label: 'Generate Report', icon: 'bar-chart', permission: 'report.view', run: () => summon('generate-report') },
      { id: 'new-role', label: 'New Role', icon: 'user-plus', permission: 'role.manage', run: () => summon('new-role') },
      { id: 'upload', label: 'Upload File', icon: 'cloud-upload', permission: 'filehub:view', run: () => summon('upload') },
    ];
    return all.filter((a) => hasPermission(a.permission));
  }, [hasPermission, summon]);
  // Fuzzy tile filter — "nwtsk" still finds New Task — best score first.
  const matchedActions = useMemo(() => {
    if (!q) return createActions;
    return createActions
      .map((a) => ({ a, m: fuzzyMatch(q, a.label) }))
      .filter((x): x is { a: CreateAction; m: { hit: boolean; score: number } } => !!x.m)
      .sort((x, y) => y.m.score - x.m.score)
      .map((x) => x.a);
  }, [createActions, q]);

  // GO TO: top-level SHORTCUTS + keyword-indexed sub-destinations, one registry
  // (constants.ts). Empty query → top-level only; otherwise label + synonym
  // matches across both, deduped by href.
  const destMatches = useMemo(
    () => matchDestinations(query, { hasPermission, isOwner: !!profile?.is_owner, isMobile }),
    [query, hasPermission, profile?.is_owner, isMobile]
  );
  const groupRows = useMemo(
    () => (q ? GROUP_ORDER.filter((t) => grouped[t]?.length) : []),
    [q, grouped]
  );

  // RECENT — frequent-first destinations opened from the palette before. Empty
  // query only. Rendered as GO TO rows and reusing the `page` item kind (they
  // route the same way), so they're keyboard-navigable for free.
  const recentDestMatches = useMemo<DestinationMatch[]>(
    () =>
      q
        ? []
        : recentDests.map((d) => ({
            id: d.id,
            label: d.label,
            href: d.href,
            icon: d.icon,
            parentLabel: d.parentLabel,
            topLevel: false,
          })),
    [q, recentDests]
  );
  // RECENT SEARCHES — the query strings from useRecentSearches, now nav targets
  // too (empty query only). ⏎ on one re-runs that search rather than closing.
  const recentSearchNav = useMemo(() => (q ? [] : recent), [q, recent]);

  // Flat, ordered nav list — the render below walks this exact order so `sel`
  // lines up on screen:
  //   recent destinations → CREATE tiles → GO TO → results → recent searches
  //
  // 2D-within-1-D: the CREATE tiles occupy [gridStart, gridStart+tileCount).
  // `gridStart` is only non-zero on an empty query (the recent-destination rows
  // that sit above the grid). The key handler's ←/→ stay inside that band and
  // ↑/↓ hop the grid↔list boundary in whole rows.
  const flatItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];
    // #347 — the inline quick-create row is always first when present.
    if (createInline) items.push({ kind: 'create-inline', entity: createInline.entity, title: createInline.title });
    for (const d of recentDestMatches) items.push({ kind: 'page', dest: d });
    for (const a of matchedActions) items.push({ kind: 'action', run: a.run });
    for (const d of destMatches) items.push({ kind: 'page', dest: d });
    // #347: the result-search block is hidden while an inline-create prefix is
    // active, so keep those rows out of the nav list too or `sel` drifts.
    if (!createInline) for (const t of groupRows) for (const r of grouped[t]!.slice(0, PER_GROUP)) items.push({ kind: 'result', result: r });
    for (const s of recentSearchNav) items.push({ kind: 'recent-search', q: s });
    return items;
  }, [createInline, recentDestMatches, matchedActions, destMatches, groupRows, grouped, recentSearchNav]);

  // Nothing matched a non-empty query (and we're done loading) → offer to create
  // a task named after the query. Same predicate gates the row and the ⏎ handler.
  // #347: suppressed when a create prefix is active — the inline create row
  // (createInline / flatItems[0]) supersedes it so the two never both fire.
  const noHits = results.length === 0 && destMatches.length === 0 && matchedActions.length === 0;
  const showCreateHint =
    !!q && input.mode === 'normal' && !searchError && !(loading && results.length === 0) && noHits;

  const gridStart = (createInline ? 1 : 0) + recentDestMatches.length;
  const tileCount = matchedActions.length;
  const gridEnd = gridStart + tileCount; // first flat index after the tile grid
  const inGrid = (i: number) => i >= gridStart && i < gridEnd;
  // Desktop caps at 4/row: at maxWidth 640 with flexBasis 132 + gap, a 5th tile
  // wraps — so ↑/↓ row-hopping must assume 4, not tileCount.
  const tileCols = tileCount === 0 ? 1 : isMobile ? Math.min(2, tileCount) : Math.min(4, tileCount);
  // Last tile the selection sat on — ↑ from the first non-tile row returns here.
  const lastTile = useRef(gridStart);
  useEffect(() => {
    if (inGrid(sel)) lastTile.current = sel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, gridStart, gridEnd]);

  useEffect(() => {
    if (!open) return;
    // Seed only on the open edge — deps are [open] on purpose: while open, the
    // user's typing owns `query`, so a mid-open `initialQuery` change must not
    // clobber it.
    setQuery(initialQuery ?? '');
    setSel(0);
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    setSel((i) => Math.max(0, Math.min(i, flatItems.length - 1)));
  }, [flatItems.length]);

  // #346 — command cursor back to the top whenever the command filter changes.
  useEffect(() => {
    setCmdSel(0);
  }, [input.mode, input.text]);

  // Keep the selected row visible in the scroll area. Web-only surface, so
  // scrollIntoView on the resolved DOM node is the whole implementation — no
  // measureLayout math, no library. Rebuilt every render (cheap); React nulls
  // stale entries on unmount.
  const rowRefs = useRef(new Map<number, any>());
  const setRowRef = (i: number) => (node: any) => {
    if (node) rowRefs.current.set(i, node);
    else rowRefs.current.delete(i);
  };
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = rowRefs.current.get(sel);
    const dom = node instanceof Element ? node : node?.getDOMNode?.();
    dom?.scrollIntoView?.({ block: 'nearest' });
  }, [sel, flatItems.length]);

  const seeAll = useCallback(() => {
    const raw = query.trim();
    onClose();
    if (raw) pushRecent(raw);
    router.push(`/search?q=${encodeURIComponent(raw)}` as any);
  }, [query, onClose, pushRecent, router]);

  // #347 — create straight from the palette, no modal. Only p_title / p_name is
  // required; every other rpc_create_task / rpc_create_project param defaults
  // server-side (pipeline resolves to the project's or the company default).
  const runInlineCreate = useCallback(
    async (entity: 'task' | 'project', rawTitle: string) => {
      const title = rawTitle.trim();
      if (!title) return;
      try {
        if (entity === 'task') {
          const { data, error } = await supabase.rpc('rpc_create_task', { p_title: title });
          if (error) throw error;
          showToast({
            type: 'success', title: 'Task created', message: `"${title}"`,
            actionLabel: 'Open', onPress: () => router.push(`/task/${data}` as any),
          });
        } else {
          const { data, error } = await supabase.rpc('rpc_create_project', { p_name: title });
          if (error) throw error;
          const id = (data as { id?: string } | null)?.id;
          showToast({
            type: 'success', title: 'Project created', message: `"${title}"`,
            actionLabel: id ? 'Open' : undefined,
            onPress: id ? () => router.push(`/projects/${id}` as any) : undefined,
          });
        }
        onClose();
      } catch (e) {
        errorToast(e instanceof Error ? e.message : `Could not create ${entity}`);
      }
    },
    [showToast, errorToast, onClose, router]
  );

  const activate = useCallback(
    (it: PaletteItem) => {
      if (it.kind === 'action') {
        it.run();
        onClose();
        return;
      }
      if (it.kind === 'create-inline') {
        void runInlineCreate(it.entity, it.title);
        return;
      }
      if (it.kind === 'recent-search') {
        // Re-run the search, don't leave the palette.
        setQuery(it.q);
        setSel(0);
        return;
      }
      onClose();
      if (it.kind === 'page') {
        const d = it.dest;
        recordDest({ id: d.id, label: d.label, href: d.href, icon: d.icon, parentLabel: d.parentLabel, kind: 'page' });
        router.push(d.href as any);
      } else {
        const raw = query.trim();
        if (raw) pushRecent(raw);
        const r = it.result;
        recordDest({
          id: `${r.type}-${r.id}`,
          label: r.title || TYPE_LABEL[r.type] || 'Untitled',
          href: resultRoute(r),
          icon: TYPE_ICON[r.type] ?? 'circle-o',
          parentLabel: GROUP_LABEL[r.type] ?? TYPE_LABEL[r.type],
          kind: 'result',
        });
        router.push(resultRoute(r) as any);
      }
    },
    [onClose, router, query, pushRecent, recordDest, runInlineCreate]
  );

  // #346 — ctx the registry's `run(ctx)` closes over, plus the runner.
  const cmdCtx = useMemo<PaletteCommandCtx>(
    () => ({ theme, setTheme, pathname, signOut, successToast, errorToast, close: onClose }),
    [theme, setTheme, pathname, signOut, successToast, errorToast, onClose]
  );
  const runCommand = useCallback((c: PaletteCommand) => void c.run(cmdCtx), [cmdCtx]);

  // #345 — enter/leave the per-result action panel.
  const backToList = useCallback(() => {
    setMode('list');
    setActionTarget(null);
    setActionSel(0);
  }, []);
  const enterActions = useCallback((r: SearchResult) => {
    setActionTarget(r);
    setActionSel(0);
    setMode('actions');
  }, []);
  const actions = useMemo<PaletteAction[]>(
    () => (actionTarget ? resultActions(actionTarget, { activate, successToast, errorToast, backToList }) : []),
    [actionTarget, activate, successToast, errorToast, backToList]
  );

  // Leave actions mode whenever the palette reopens or the query changes — the
  // captured target would be stale against the new result list.
  useEffect(() => {
    backToList();
  }, [open, query, backToList]);

  // Arrow / Enter / Escape while open. Web only.
  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;
    const last = () => flatItems.length - 1;
    const onKey = (e: KeyboardEvent) => {
      // #346 — command mode owns the keyboard. ↑↓ move, ⏎ runs, Esc clears the
      // `>` (which drops back to the list). Backspacing past the `>` needs no
      // handler — the query change re-derives paletteMode on its own.
      if (paletteMode === 'commands') {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setCmdSel((i) => Math.min(i + 1, commands.length - 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setCmdSel((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const c = commands[cmdSel];
          if (c) runCommand(c);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setQuery('');
          setSel(0);
        }
        return;
      }
      // #345 — action panel owns the keyboard while open. ← / Esc back out to
      // the list (Esc does NOT close the palette here); ↑↓ move; ⏎ runs.
      if (mode === 'actions') {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActionSel((i) => Math.min(i + 1, actions.length - 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActionSel((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          void actions[actionSel]?.run();
        } else if (e.key === 'ArrowLeft' || e.key === 'Escape') {
          e.preventDefault();
          backToList();
        }
        return;
      }
      // → or Tab on a selected result row → open its action panel.
      if (
        (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) &&
        flatItems[sel]?.kind === 'result'
      ) {
        e.preventDefault();
        const it = flatItems[sel];
        if (it.kind === 'result') enterActions(it.result);
        return;
      }
      if (e.key === 'ArrowRight' && inGrid(sel)) {
        e.preventDefault();
        setSel((i) => Math.min(gridEnd - 1, i + 1));
      } else if (e.key === 'ArrowLeft' && inGrid(sel)) {
        e.preventDefault();
        setSel((i) => Math.max(gridStart, i - 1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((i) => {
          if (inGrid(i)) {
            const next = i + tileCols; // next tile row, or out of the grid
            return next < gridEnd ? next : Math.min(gridEnd, last());
          }
          return Math.min(i + 1, last()); // recent rows above the grid, or the list below it
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((i) => {
          // First list row → back to the last tile the cursor sat on.
          if (i === gridEnd && tileCount > 0) {
            return Math.max(gridStart, Math.min(lastTile.current, gridEnd - 1));
          }
          // In the grid: up a tile row, or out the top onto a recent row.
          if (inGrid(i)) return Math.max(0, i - tileCols);
          // Recent rows above, or list below — plain step.
          return Math.max(i - 1, 0);
        });
      } else if (e.key === 'Enter') {
        const it = flatItems[sel];
        if (it) {
          e.preventDefault();
          activate(it);
        } else if (showCreateHint) {
          e.preventDefault();
          // #347: seed the new task's title from query.trim() once create-task
          // accepts a title-seed prop. Blank modal for now — don't block on it.
          summon('create-task');
          onClose();
        } else if (query.trim()) {
          e.preventDefault();
          seeAll();
        }
      } else if (e.key === 'Escape') {
        // First Esc with a query clears it (and stays open); a second closes.
        if (query.trim() !== '') {
          e.preventDefault();
          setQuery('');
          setSel(0);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, flatItems, sel, gridStart, gridEnd, tileCount, tileCols, query, activate, seeAll, onClose, summon, showCreateHint, mode, actions, actionSel, backToList, enterActions, paletteMode, commands, cmdSel, runCommand]);

  const seedTip = useCallback((token: string) => {
    setQuery(token + ' ');
    setSel(0);
    inputRef.current?.focus();
  }, []);

  // running flat index — MUST advance in the same order as flatItems
  let idx = 0;

  return (
    <Popup visible={open} onClose={onClose} presentation="auto" maxWidth={640} scrollable={false} dimBackdrop>
      <View>
        <View
          className="flex-row items-center gap-3 px-4"
          style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
        >
          <FontAwesome name="search" size={14} color={colors.textDim} />
          <TextInput
            ref={inputRef}
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="Search or jump to…"
            placeholderTextColor={colors.textDim}
            returnKeyType="search"
            // Palette auto-focuses and focus-traps this input, so a keyboard user
            // always knows where focus is — the :focus-visible ring earns nothing
            // on this surface. Sanctioned greppable opt-out (ui-consistency.md §Focus).
            className="focus-ring-none"
            style={{ flex: 1, fontSize: 16, color: colors.textMain, paddingVertical: 14 }}
          />
          {/* While open, esc is the useful key — ⌘K already did its job. */}
          <View className="px-1.5 py-0.5 rounded-md" style={{ borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontFamily: 'SpaceMono', fontSize: 10, color: colors.textDim }}>esc</Text>
          </View>
        </View>

        <ScrollView style={{ maxHeight: isMobile ? 360 : 440 }} keyboardShouldPersistTaps="handled">
          {/* #346 — command mode (`>` prefix). Rows styled like GO TO: icon chip
              + label + optional SpaceMono hint on the right. Own `cmdSel` cursor. */}
          {paletteMode === 'commands' && (
            <View className="mb-1">
              <SectionHeader label="Commands" colors={colors} />
              {commands.map((c, i) => {
                const on = i === cmdSel;
                return (
                  <Pressable
                    key={c.id}
                    onHoverIn={() => setCmdSel(i)}
                    onPress={() => runCommand(c)}
                    className="flex-row items-center gap-3 rounded-xl px-3 py-2.5 mx-1"
                    style={on ? { backgroundColor: selBg } : undefined}
                  >
                    <View className="h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: colors.primary + '14' }}>
                      <FontAwesome name={c.icon} size={13} color={colors.primary} />
                    </View>
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '600', color: colors.textMain }}>
                      {c.label}
                    </Text>
                    {c.hint ? (
                      <Text style={{ fontFamily: 'SpaceMono', fontSize: 11, color: colors.textMuted }}>{c.hint}</Text>
                    ) : null}
                    <View className="w-4 items-end">
                      {on && <FontAwesome name="arrow-right" size={11} color={colors.textDim} />}
                    </View>
                  </Pressable>
                );
              })}
              {commands.length === 0 && (
                <View className="items-center px-3 py-8">
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>No matching command</Text>
                </View>
              )}
            </View>
          )}

          {/* #345 — per-result action panel: compact non-interactive target row
              (ResultRow style) + the action list, styled like GO TO rows. Panel
              swap inside the same Popup card — no nested Modal, no popover lib. */}
          {paletteMode === 'actions' && actionTarget && (
            <View className="mb-1">
              <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border }} className="pb-1">
                <ResultRow
                  r={actionTarget}
                  selected={false}
                  selBg={selBg}
                  tintStyle={tintStyle}
                  colors={colors}
                  onHoverIn={() => {}}
                  onPress={() => {}}
                  rowRef={() => {}}
                />
              </View>
              <View className="flex-row items-center gap-1 px-3 pt-3 pb-1.5">
                <Text className="text-[9px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>
                  Actions
                </Text>
              </View>
              {actions.map((a, i) => {
                const on = i === actionSel;
                return (
                  <Pressable
                    key={a.id}
                    onHoverIn={() => setActionSel(i)}
                    onPress={() => void a.run()}
                    className="flex-row items-center gap-3 rounded-xl px-3 py-2.5 mx-1"
                    style={on ? { backgroundColor: selBg } : undefined}
                  >
                    <View className="h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: colors.primary + '14' }}>
                      <FontAwesome name={a.icon} size={13} color={colors.primary} />
                    </View>
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '600', color: colors.textMain }}>
                      {a.label}
                    </Text>
                    <View className="w-4 items-end">
                      {on && <FontAwesome name="arrow-right" size={11} color={colors.textDim} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          {paletteMode === 'list' && (
          <>
          {/* #347 — inline quick-create row. flatItems[0] when present, so it
              renders before everything else to keep `idx` aligned with `sel`. */}
          {(createInline ? [createInline] : []).map((ci) => {
            const i = idx++;
            const on = i === sel;
            return (
              <Pressable
                key="create-inline"
                ref={setRowRef(i)}
                onHoverIn={() => setSel(i)}
                onPress={() => runInlineCreate(ci.entity, ci.title)}
                className="flex-row items-center gap-3 rounded-xl px-3 py-4 mx-1"
                style={on ? { backgroundColor: selBg } : undefined}
              >
                <View className="h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: colors.accent + '1A' }}>
                  <FontAwesome name="plus" size={13} color={colors.accent} />
                </View>
                <Text numberOfLines={2} style={{ flex: 1, fontSize: 13, color: colors.textMain }}>
                  <Text style={{ fontFamily: 'SpaceMono', color: colors.textMuted }}>⏎</Text>
                  {'  '}Create {ci.entity} “{ci.title}”
                </Text>
              </Pressable>
            );
          })}

          {/* RECENT — frequent-first destinations opened from the palette before
              (#343). Empty query only, and walked FIRST in flatItems, so it
              renders first here to keep `idx` aligned with `sel`. */}
          {!q && recentDestMatches.length > 0 && (
            <View className="mb-1">
              <SectionHeader label="Recent" colors={colors} />
              {recentDestMatches.map((d) => {
                const i = idx++;
                return (
                  <PageRow
                    key={`recent-${d.id}`}
                    d={d}
                    selected={i === sel}
                    q=""
                    tintStyle={tintStyle}
                    selBg={selBg}
                    colors={colors}
                    onHoverIn={() => setSel(i)}
                    onPress={() => activate({ kind: 'page', dest: d })}
                    rowRef={setRowRef(i)}
                  />
                );
              })}
            </View>
          )}

          {/* CREATE — a wrapping tile grid (#342). Occupies flatItems
              [gridStart, gridStart+tileCount). */}
          {matchedActions.length > 0 && (
            <View className="mb-1">
              <SectionHeader label="Create" colors={colors} />
              <View className="flex-row flex-wrap gap-2 px-3 pb-1">
                {matchedActions.map((a) => {
                  const i = idx++;
                  const on = i === sel;
                  return (
                    <Pressable
                      key={a.id}
                      ref={setRowRef(i)}
                      onHoverIn={() => setSel(i)}
                      onPress={() => activate({ kind: 'action', run: a.run })}
                      className="items-center justify-center gap-2 rounded-2xl px-3 py-3.5"
                      style={{
                        flexGrow: 1,
                        flexBasis: 132,
                        minWidth: 132,
                        borderWidth: 1,
                        borderColor: on ? colors.accent : 'transparent',
                        backgroundColor: colors.accent + (on ? '2E' : '1A'),
                      }}
                    >
                      <View
                        className="h-9 w-9 items-center justify-center rounded-xl"
                        style={{ backgroundColor: colors.primary + '1A' }}
                      >
                        <FontAwesome name={a.icon} size={18} color={colors.primary} />
                      </View>
                      <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '700', color: colors.textMain }}>
                        {a.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {destMatches.length > 0 && (
            <View className="mb-1">
              <SectionHeader label="Go to" colors={colors} />
              {destMatches.map((d) => {
                const i = idx++;
                return (
                  <PageRow
                    key={d.id}
                    d={d}
                    selected={i === sel}
                    q={q}
                    tintStyle={tintStyle}
                    selBg={selBg}
                    colors={colors}
                    onHoverIn={() => setSel(i)}
                    onPress={() => activate({ kind: 'page', dest: d })}
                    rowRef={setRowRef(i)}
                  />
                );
              })}
            </View>
          )}

          {/* !!q, not q: a bare falsy `''` renders as a stray text node and
              RNW warns "text node cannot be a child of <View>".
              #347: with an inline-create prefix active the create row is the
              answer — don't also spin or render results for "nt fix the bug". */}
          {!!q && !createInline &&
            (searchError ? (
              <View className="items-center px-3 py-8">
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>Search failed — try again</Text>
              </View>
            ) : loading && results.length === 0 ? (
              <View className="items-center py-8">
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : showCreateHint ? (
              // Nothing matched — offer to make it. ⏎ (or a tap) does the same
              // thing the key handler does for this state.
              <Pressable
                onPress={() => {
                  summon('create-task');
                  onClose();
                }}
                className="flex-row items-center gap-3 rounded-xl px-3 py-4 mx-1"
              >
                <View
                  className="h-7 w-7 items-center justify-center rounded-lg"
                  style={{ backgroundColor: colors.accent + '1A' }}
                >
                  <FontAwesome name="plus" size={13} color={colors.accent} />
                </View>
                <Text numberOfLines={2} style={{ flex: 1, fontSize: 13, color: colors.textMain }}>
                  No results — press{' '}
                  <Text style={{ fontFamily: 'SpaceMono', color: colors.textMuted }}>⏎</Text> to create a task
                  called “{query.trim()}”
                </Text>
              </Pressable>
            ) : (
              <>
                {groupRows.map((t) => (
                  <View key={t} className="mb-1">
                    <Text
                      className="text-[9px] font-black uppercase tracking-widest px-3 pt-3 pb-1.5"
                      style={{ color: colors.textMuted }}
                    >
                      {GROUP_LABEL[t]} ({grouped[t]!.length})
                    </Text>
                    {grouped[t]!.slice(0, PER_GROUP).map((r) => {
                      const i = idx++;
                      return (
                        <ResultRow
                          key={`${r.type}-${r.id}`}
                          r={r}
                          selected={i === sel}
                          selBg={selBg}
                          tintStyle={tintStyle}
                          colors={colors}
                          onHoverIn={() => setSel(i)}
                          onPress={() => activate({ kind: 'result', result: r })}
                          onOpenActions={() => { setSel(i); enterActions(r); }}
                          rowRef={setRowRef(i)}
                        />
                      );
                    })}
                  </View>
                ))}
                {results.length > 0 && (
                  <Pressable
                    onPress={seeAll}
                    className="flex-row items-center justify-center gap-2 rounded-xl py-3 mt-1"
                  >
                    <Text style={{ fontSize: 13, fontWeight: '700', color: colors.primary }}>
                      See all {results.length} result{results.length === 1 ? '' : 's'}
                    </Text>
                    <FontAwesome name="arrow-right" size={11} color={colors.primary} />
                  </Pressable>
                )}
              </>
            ))}

          {/* RECENT SEARCHES — the query strings from useRecentSearches. Sit
              below RECENT destinations (#343) and are now keyboard-navigable:
              ⏎ re-runs that search rather than closing. Empty query only. */}
          {!q && recent.length > 0 && (
            <View className="mb-1">
              <View className="flex-row items-center gap-1 px-3 pt-3 pb-1.5">
                <Text className="text-[9px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>
                  Recent searches
                </Text>
              </View>
              {recent.map((r) => {
                const i = idx++;
                const on = i === sel;
                return (
                  <Pressable
                    key={r}
                    ref={setRowRef(i)}
                    onHoverIn={() => setSel(i)}
                    onPress={() => activate({ kind: 'recent-search', q: r })}
                    className="flex-row items-center gap-3 rounded-xl px-3 py-2 mx-1"
                    style={on ? { backgroundColor: selBg } : undefined}
                  >
                    <FontAwesome name="history" size={13} color={colors.textDim} />
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, color: colors.textMain }}>
                      {r}
                    </Text>
                    <View className="w-4 items-end">
                      {on && <FontAwesome name="arrow-right" size={11} color={colors.textDim} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          {!q && (
            <View className="mb-1">
              <View className="flex-row items-center gap-1 px-3 pt-3 pb-1.5">
                <Text className="text-[9px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>
                  Search tips
                </Text>
              </View>
              {SEARCH_TIPS.map((t) => (
                <Pressable
                  key={t.token}
                  onPress={() => seedTip(t.token)}
                  className="flex-row items-center gap-3 rounded-xl px-3 py-2 mx-1"
                >
                  <View
                    className="h-7 w-7 items-center justify-center rounded-lg"
                    style={{ backgroundColor: colors.primary + '14' }}
                  >
                    <FontAwesome name={t.icon} size={12} color={colors.textDim} />
                  </View>
                  <Text style={{ fontFamily: 'SpaceMono', fontSize: 12, color: colors.textMain }}>{t.token}</Text>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: colors.textMuted }}>
                    {t.hint}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          </>
          )}
        </ScrollView>

        {/* Pinned hint bar (#342) — Cloudflare keeps this at the bottom; it's a
            lot of the "life" the redesign is after. In actions mode the model
            changes: ← backs out, ⏎ runs, Esc no longer closes. */}
        <View
          className="flex-row items-center gap-4 px-4 py-2.5"
          style={{ borderTopWidth: 1, borderTopColor: colors.border }}
        >
          {paletteMode === 'commands' ? (
            <>
              <HintKey combo="↑↓" label="navigate" colors={colors} />
              <HintKey combo="⏎" label="run" colors={colors} />
              <HintKey combo="esc" label="exit" colors={colors} />
            </>
          ) : paletteMode === 'actions' ? (
            <>
              <HintKey combo="↑↓" label="navigate" colors={colors} />
              <HintKey combo="⏎" label="run" colors={colors} />
              <HintKey combo="←" label="back" colors={colors} />
            </>
          ) : (
            <>
              <HintKey combo="↑↓" label="navigate" colors={colors} />
              <HintKey combo="⏎" label="select" colors={colors} />
              <HintKey combo="esc" label="close" colors={colors} />
            </>
          )}
        </View>
      </View>
    </Popup>
  );
}

function ResultRow({
  r,
  selected,
  selBg,
  tintStyle,
  colors,
  onHoverIn,
  onPress,
  onOpenActions,
  rowRef,
}: {
  r: SearchResult;
  selected: boolean;
  selBg: string;
  tintStyle: TextStyle;
  colors: ReturnType<typeof useThemeColors>;
  onHoverIn: () => void;
  onPress: () => void;
  // #345 — mouse affordance: opens the sub-action panel for this result. Only
  // shown on the selected row; keyboard users get → / Tab instead.
  onOpenActions?: () => void;
  rowRef: (node: any) => void;
}) {
  const isEntity = r.type === 'project' || r.type === 'portfolio';
  const titleNode = renderHighlighted(r.title, tintStyle);
  const snippetNode = renderHighlighted(r.snippet, tintStyle);
  // ponytail: breadcrumb is just a bare "Task" tag for task-scoped files — a
  // real parent-path breadcrumb needs a backend field and is a #321 follow-up.
  // The snippet line carries the context meanwhile.
  const context = r.type === 'file' && r.task_id ? 'Task' : null;

  return (
    <Pressable
      ref={rowRef}
      onHoverIn={onHoverIn}
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-xl px-3 py-2.5 mx-1"
      style={selected ? { backgroundColor: selBg } : undefined}
    >
      {isEntity ? (
        <EntityGlyph kind={r.type as EntityKind} size={28} style={{ flexShrink: 0 }} />
      ) : (
        <View
          className="h-7 w-7 items-center justify-center rounded-lg"
          style={{ backgroundColor: colors.primary + '14', flexShrink: 0 }}
        >
          <FontAwesome name={TYPE_ICON[r.type] ?? 'circle-o'} size={13} color={colors.primary} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '600', color: colors.textMain }}>
          {titleNode ?? (r.title || TYPE_LABEL[r.type] || '')}
        </Text>
        {(context || snippetNode) && (
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>
            {context ? `${context} · ` : ''}
            {snippetNode}
          </Text>
        )}
      </View>
      <Text style={{ fontSize: 10, color: colors.textMuted, flexShrink: 0 }}>{relTime(r.created_at)}</Text>
      {selected && onOpenActions && (
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            onOpenActions();
          }}
          hitSlop={8}
          className="h-6 w-6 items-center justify-center rounded-md"
          style={{ backgroundColor: colors.primary + '14', flexShrink: 0 }}
        >
          <FontAwesome name="ellipsis-h" size={12} color={colors.textDim} />
        </Pressable>
      )}
    </Pressable>
  );
}
