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
import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Popup from '@/components/common/Popup';
import { useAuth } from '@/contexts/AuthContext';
import { useModalDispatch } from '@/contexts/ModalDispatchContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { resultRoute, useGlobalSearch, type ResultType, type SearchResult } from '@/hooks/useGlobalSearch';
import { useRecentSearches } from '@/hooks/useRecentSearches';
import { matchDestinations, type DestinationMatch, type IconName } from '@/components/sidebar/constants';
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
  { token: 'task:', hint: 'Only tasks', icon: 'check-square-o' },
  { token: 'file:', hint: 'Only files', icon: 'file-o' },
  { token: 'report:', hint: 'Only reports', icon: 'bar-chart' },
  { token: 'comment:', hint: 'Only comments', icon: 'comment-o' },
  { token: 'due tomorrow', hint: 'Filter by date', icon: 'calendar-o' },
];

type PaletteItem =
  | { kind: 'action'; run: () => void }
  | { kind: 'page'; dest: DestinationMatch }
  | { kind: 'result'; result: SearchResult };

type CreateAction = {
  id: string;
  label: string;
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  permission: string;
  run: () => void;
};

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
  const { hasPermission, profile } = useAuth();
  const { summon } = useModalDispatch();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);

  const { results, grouped, loading, searchError } = useGlobalSearch(query, { enabled: open, limit: 40 });
  const { recent, push: pushRecent } = useRecentSearches();

  const q = query.trim().toLowerCase();
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
    ];
    return all.filter((a) => hasPermission(a.permission));
  }, [hasPermission, summon]);
  const matchedActions = useMemo(
    () => (q ? createActions.filter((a) => a.label.toLowerCase().includes(q)) : createActions),
    [createActions, q]
  );

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

  // Flat, ordered nav list: create actions, then GO TO rows, then results by
  // group — the render below walks the same order so `sel` lines up on screen.
  //
  // 2D-within-1-D: the CREATE tiles are simply the first `tileCount` entries.
  // ⏎ / `sel` work unchanged; the key handler adds ←/→ that only move inside
  // [0, tileCount) and makes ↑/↓ hop the grid↔list boundary in whole rows.
  const flatItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = matchedActions.map((a) => ({ kind: 'action', run: a.run }));
    for (const d of destMatches) items.push({ kind: 'page', dest: d });
    for (const t of groupRows) for (const r of grouped[t]!.slice(0, PER_GROUP)) items.push({ kind: 'result', result: r });
    return items;
  }, [matchedActions, destMatches, groupRows, grouped]);

  const tileCount = matchedActions.length;
  const tileCols = tileCount === 0 ? 1 : isMobile ? Math.min(2, tileCount) : tileCount;
  // Last tile the selection sat on — ↑ from the first non-tile row returns here.
  const lastTile = useRef(0);
  useEffect(() => {
    if (sel < tileCount) lastTile.current = sel;
  }, [sel, tileCount]);

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

  const seeAll = useCallback(() => {
    const raw = query.trim();
    onClose();
    if (raw) pushRecent(raw);
    router.push(`/search?q=${encodeURIComponent(raw)}` as any);
  }, [query, onClose, pushRecent, router]);

  const activate = useCallback(
    (it: PaletteItem) => {
      if (it.kind === 'action') {
        it.run();
        onClose();
        return;
      }
      onClose();
      if (it.kind === 'page') {
        router.push(it.dest.href as any);
      } else {
        const raw = query.trim();
        if (raw) pushRecent(raw);
        router.push(resultRoute(it.result) as any);
      }
    },
    [onClose, router, query, pushRecent]
  );

  // Arrow / Enter / Escape while open. Web only.
  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;
    const last = () => flatItems.length - 1;
    const onKey = (e: KeyboardEvent) => {
      const inGrid = sel < tileCount;
      if (e.key === 'ArrowRight' && inGrid) {
        e.preventDefault();
        setSel((i) => Math.min(tileCount - 1, i + 1));
      } else if (e.key === 'ArrowLeft' && inGrid) {
        e.preventDefault();
        setSel((i) => Math.max(0, i - 1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((i) => {
          if (i < tileCount) {
            const next = i + tileCols; // next tile row, or out of the grid
            return next < tileCount ? next : Math.min(tileCount, last());
          }
          return Math.min(i + 1, last());
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((i) => {
          if (i === tileCount && tileCount > 0) return Math.min(lastTile.current, tileCount - 1); // list → grid
          if (i < tileCount) return Math.max(0, i - tileCols);
          return Math.max(i - 1, 0);
        });
      } else if (e.key === 'Enter') {
        const it = flatItems[sel];
        if (it) {
          e.preventDefault();
          activate(it);
        } else if (query.trim()) {
          e.preventDefault();
          seeAll();
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, flatItems, sel, tileCount, tileCols, query, activate, seeAll, onClose]);

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
          {/* CREATE — a wrapping tile grid (#342). Walked FIRST in flatItems, so
              rendered first here to keep `idx` aligned with `sel`. */}
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
                const on = i === sel;
                return (
                  <Pressable
                    key={d.id}
                    onHoverIn={() => setSel(i)}
                    onPress={() => activate({ kind: 'page', dest: d })}
                    className="flex-row items-center gap-3 rounded-xl px-3 py-2.5 mx-1"
                    style={on ? { backgroundColor: selBg } : undefined}
                  >
                    <View
                      className="h-7 w-7 items-center justify-center rounded-lg"
                      style={{ backgroundColor: colors.primary + '14' }}
                    >
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
                    {/* Trailing → only on the active row (Cloudflare) — fixed-width
                        slot so selecting a row doesn't shift the label. */}
                    <View className="w-4 items-end">
                      {on && <FontAwesome name="arrow-right" size={11} color={colors.textDim} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          {!q && recent.length > 0 && (
            <View className="mb-1">
              <View className="flex-row items-center gap-1 px-3 pt-3 pb-1.5">
                <Text className="text-[9px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>
                  Recent
                </Text>
              </View>
              {/* ponytail: recent chips refill the box, they aren't nav targets —
                  deliberately not in the arrow-key flat list. */}
              {recent.map((r) => (
                <Pressable
                  key={r}
                  onPress={() => {
                    setQuery(r);
                    setSel(0);
                  }}
                  className="flex-row items-center gap-3 rounded-xl px-3 py-2 mx-1"
                >
                  <FontAwesome name="history" size={13} color={colors.textDim} />
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, color: colors.textMain }}>
                    {r}
                  </Text>
                </Pressable>
              ))}
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

          {/* !!q, not q: a bare falsy `''` renders as a stray text node and
              RNW warns "text node cannot be a child of <View>". */}
          {!!q &&
            (searchError ? (
              <View className="items-center px-3 py-8">
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>Search failed — try again</Text>
              </View>
            ) : loading && results.length === 0 ? (
              <View className="items-center py-8">
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : results.length === 0 && destMatches.length === 0 && matchedActions.length === 0 ? (
              <View className="items-center px-3 py-8">
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>No results for “{query.trim()}”</Text>
              </View>
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
        </ScrollView>

        {/* Pinned hint bar (#342) — Cloudflare keeps this at the bottom; it's a
            lot of the "life" the redesign is after. */}
        <View
          className="flex-row items-center gap-4 px-4 py-2.5"
          style={{ borderTopWidth: 1, borderTopColor: colors.border }}
        >
          <HintKey combo="↑↓" label="navigate" colors={colors} />
          <HintKey combo="⏎" label="select" colors={colors} />
          <HintKey combo="esc" label="close" colors={colors} />
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
}: {
  r: SearchResult;
  selected: boolean;
  selBg: string;
  tintStyle: TextStyle;
  colors: ReturnType<typeof useThemeColors>;
  onHoverIn: () => void;
  onPress: () => void;
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
    </Pressable>
  );
}
