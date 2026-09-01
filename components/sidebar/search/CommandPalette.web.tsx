// Command palette (⌘K / Ctrl+K / Ctrl+F) — web only. A centered floating
// overlay that unifies "Go to" (permissioned app pages) with global search
// results (rpc_global_search via useGlobalSearch). The top-bar <TextInput> +
// hover SearchDropdown stay as-is; this is an additive hotkey overlay.
//
// Hotkeys live in Sidebar.web.tsx (the mount point) — the palette can't listen
// for its own open key while unmounted. This component owns the arrow/enter/
// escape nav while open.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Popup from '@/components/common/Popup';
import { useAuth } from '@/contexts/AuthContext';
import { useModalDispatch } from '@/contexts/ModalDispatchContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { resultRoute, useGlobalSearch, type ResultType, type SearchResult } from '@/hooks/useGlobalSearch';
import { useRecentSearches } from '@/hooks/useRecentSearches';
import { SHORTCUTS, shortcutVisible, type Shortcut } from '@/components/sidebar/constants';
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
const PER_GROUP = 5;

type PaletteItem =
  | { kind: 'action'; run: () => void }
  | { kind: 'page'; shortcut: Shortcut }
  | { kind: 'result'; result: SearchResult };

type CreateAction = {
  id: string;
  label: string;
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  permission: string;
  run: () => void;
};

// Render ts_headline's <b>…</b> spans as tinted runs. `tintStyle` carries BOTH
// the accent-dim background and an explicit text color — inline because theme
// token color classes go black inside an RN <Modal> on web (see Tooltip.tsx).
function renderHighlighted(text: string | null, tintStyle: { backgroundColor: string; color: string }) {
  const runs = highlightRuns(text);
  if (runs.length === 1 && runs[0] === '') return null;
  return runs.map((run, i) => (run ? <Text key={i} style={i % 2 ? tintStyle : undefined}>{run}</Text> : null));
}

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
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
  // bg-brand-accent-dim === rgba(var(--brand-accent), 0.1); 0x1A ≈ 0.10 alpha.
  const tintStyle = useMemo(
    () => ({ backgroundColor: colors.accent + '1A', color: colors.textMain }),
    [colors.accent, colors.textMain]
  );
  const selBg = colors.primary + '1A';

  // Create/compose actions — only the 3 ModalHost wires today (#325). Permission
  // keys verified against real gates: task.create + report.view
  // (QuickCreateButton.tsx), project.create (_projects_desktop.tsx "New Project").
  const createActions = useMemo<CreateAction[]>(() => {
    const all: CreateAction[] = [
      { id: 'create-task', label: 'New Task', icon: 'check-square-o', permission: 'task.create', run: () => summon('create-task') },
      { id: 'create-project', label: 'New Project', icon: 'folder-o', permission: 'project.create', run: () => summon('create-project') },
      { id: 'generate-report', label: 'Generate Report', icon: 'bar-chart', permission: 'report.view', run: () => summon('generate-report') },
    ];
    return all.filter((a) => hasPermission(a.permission));
  }, [hasPermission, summon]);
  const matchedActions = useMemo(
    () => (q ? createActions.filter((a) => a.label.toLowerCase().includes(q)) : createActions),
    [createActions, q]
  );

  const pages = useMemo(
    () => SHORTCUTS.filter((s) => shortcutVisible(s, { hasPermission, isOwner: !!profile?.is_owner, isMobile })),
    [hasPermission, profile?.is_owner, isMobile]
  );
  const matchedPages = useMemo(
    () => (q ? pages.filter((s) => s.label.toLowerCase().includes(q)) : pages),
    [pages, q]
  );
  const groupRows = useMemo(
    () => (q ? GROUP_ORDER.filter((t) => grouped[t]?.length) : []),
    [q, grouped]
  );

  // Flat, ordered nav list: create actions, then pages, then results group by
  // group — the render below walks the same order so `sel` lines up on screen.
  const flatItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = matchedActions.map((a) => ({ kind: 'action', run: a.run }));
    for (const s of matchedPages) items.push({ kind: 'page', shortcut: s });
    for (const t of groupRows) for (const r of grouped[t]!.slice(0, PER_GROUP)) items.push({ kind: 'result', result: r });
    return items;
  }, [matchedActions, matchedPages, groupRows, grouped]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSel(0);
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
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
        router.push(it.shortcut.href as any);
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((i) => Math.min(i + 1, flatItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((i) => Math.max(i - 1, 0));
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
  }, [open, flatItems, sel, query, activate, seeAll, onClose]);

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
            style={{ flex: 1, fontSize: 16, color: colors.textMain, paddingVertical: 14 }}
          />
          <View className="px-1.5 py-0.5 rounded-md" style={{ borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontFamily: 'SpaceMono', fontSize: 10, color: colors.textDim }}>{'⌘K'}</Text>
          </View>
        </View>

        <ScrollView style={{ maxHeight: isMobile ? 380 : 460 }} keyboardShouldPersistTaps="handled">
          {/* Create/compose actions (#325) — walked FIRST in flatItems, so
              rendered first here to keep `idx` aligned with `sel`. */}
          {matchedActions.length > 0 && (
            <View className="mb-1 pt-2">
              <Text
                className="text-[9px] font-black uppercase tracking-widest px-2 py-1"
                style={{ color: colors.textMuted }}
              >
                Create
              </Text>
              {matchedActions.map((a) => {
                const i = idx++;
                return (
                  <Pressable
                    key={a.id}
                    onHoverIn={() => setSel(i)}
                    onPress={() => activate({ kind: 'action', run: a.run })}
                    className="flex-row items-center gap-3 rounded-xl px-3 py-2 mx-1"
                    style={i === sel ? { backgroundColor: selBg } : undefined}
                  >
                    <View
                      className="h-7 w-7 items-center justify-center rounded-lg"
                      style={{ backgroundColor: colors.primary + '1A' }}
                    >
                      <FontAwesome name={a.icon} size={13} color={colors.primary} />
                    </View>
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '600', color: colors.textMain }}>
                      {a.label}
                    </Text>
                    <FontAwesome name="plus" size={11} color={colors.textDim} />
                  </Pressable>
                );
              })}
            </View>
          )}

          {matchedPages.length > 0 && (
            <View className="mb-1 pt-2">
              <Text
                className="text-[9px] font-black uppercase tracking-widest px-2 py-1"
                style={{ color: colors.textMuted }}
              >
                Go to
              </Text>
              {matchedPages.map((s) => {
                const i = idx++;
                return (
                  <Pressable
                    key={s.id}
                    onHoverIn={() => setSel(i)}
                    onPress={() => activate({ kind: 'page', shortcut: s })}
                    className="flex-row items-center gap-3 rounded-xl px-3 py-2 mx-1"
                    style={i === sel ? { backgroundColor: selBg } : undefined}
                  >
                    <View
                      className="h-7 w-7 items-center justify-center rounded-lg"
                      style={{ backgroundColor: colors.primary + '1A' }}
                    >
                      <FontAwesome name={s.icon} size={13} color={colors.primary} />
                    </View>
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '600', color: colors.textMain }}>
                      {s.label}
                    </Text>
                    <FontAwesome name="arrow-right" size={11} color={colors.textDim} />
                  </Pressable>
                );
              })}
            </View>
          )}

          {!q && recent.length > 0 && (
            <View className="mb-1">
              <Text
                className="text-[9px] font-black uppercase tracking-widest px-2 py-1"
                style={{ color: colors.textMuted }}
              >
                Recent
              </Text>
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

          {q &&
            (searchError ? (
              <View className="items-center px-3 py-8">
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>Search failed — try again</Text>
              </View>
            ) : loading && results.length === 0 ? (
              <View className="items-center py-8">
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : results.length === 0 && matchedPages.length === 0 && matchedActions.length === 0 ? (
              <View className="items-center px-3 py-8">
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>No results for “{query.trim()}”</Text>
              </View>
            ) : (
              <>
                {groupRows.map((t) => (
                  <View key={t} className="mb-1">
                    <Text
                      className="text-[9px] font-black uppercase tracking-widest px-2 py-1"
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
  tintStyle: { backgroundColor: string; color: string };
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
      className="flex-row items-center gap-3 rounded-xl px-3 py-2 mx-1"
      style={selected ? { backgroundColor: selBg } : undefined}
    >
      {isEntity ? (
        <EntityGlyph kind={r.type as EntityKind} size={28} style={{ flexShrink: 0 }} />
      ) : (
        <View
          className="h-7 w-7 items-center justify-center rounded-lg"
          style={{ backgroundColor: colors.primary + '1A', flexShrink: 0 }}
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
