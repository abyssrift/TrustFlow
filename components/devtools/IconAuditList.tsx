import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useMemo, useState } from 'react';
import { Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ICON_AUDIT, ICON_AUDIT_META, type IconAuditKind } from '@/lib/devtools/icon-audit-data';
import { FA4_GLYPHS } from '@/lib/devtools/icon-glyphs';
import { iconFunction } from '@/lib/devtools/iconFunctions';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useToast } from '@/contexts/ToastContext';
import { saveBytes } from '@/lib/fileTransfer';
import { applyIconChanges, DEFAULT_APPLY_ENDPOINT, pingIconServer } from '@/lib/devtools/iconApply';
import { usePersistedState } from '@/hooks/usePersistedState';
import * as Clipboard from 'expo-clipboard';
import { FilterChipGroup, FilterSection } from '@/components/common/FilterPanel';
import SlideDownPanel from '@/components/common/SlideDownPanel';
import Tooltip from '@/components/common/Tooltip';

type ViewMode = 'icon' | 'place' | 'function';
type SortBy = 'usage' | 'alpha';

type FlatUsage = {
  key: string;
  icon: string;
  file: string;
  line: number;
  kind: IconAuditKind;
  snippet: string;
};

function kindLabel(kind: IconAuditKind) {
  switch (kind) {
    case 'attribute': return 'name="..."';
    case 'metadata': return 'icon: ...';
    default: return 'dynamic';
  }
}

function kindTone(kind: IconAuditKind, c: any) {
  switch (kind) {
    case 'attribute': return c.primary;
    case 'metadata': return c.info;
    default: return c.warning;
  }
}

// ── Pickable glyphs: everything FA4 has, excluding aliases we never want to
//    hand-assign (close == remove == times duplicates). ─────────────────────
const PICKABLE = FA4_GLYPHS.filter(
  (g) => !['remove', 'close', 'asterisk'].includes(g)
);

export default function IconAuditList() {
  const c = useThemeColors();
  const { successToast, errorToast, infoToast, warningToast } = useToast();
  const isDesktop = Platform.OS === 'web' && typeof window !== 'undefined' && window.innerWidth > 1100;

  const [view, setView] = useState<ViewMode>('icon');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('usage');
  const [onlyDuplicates, setOnlyDuplicates] = useState(false);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [kindFilter, setKindFilter] = useState<'all' | IconAuditKind>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [changed, setChanged] = useState<Record<string, string>>({});
  const [picker, setPicker] = useState<{ usage: FlatUsage } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [applyEndpoint, setApplyEndpoint] = usePersistedState<string>(
    'icon-audit.apply-endpoint',
    DEFAULT_APPLY_ENDPOINT,
    (raw): raw is string => typeof raw === 'string' && /^https?:\/\//.test(raw),
  );

  // Flatten everything once, with a stable per-usage key.
  const flat = useMemo<FlatUsage[]>(() => {
    const out: FlatUsage[] = [];
    for (const entry of ICON_AUDIT) {
      entry.usages.forEach((u, i) => {
        out.push({
          key: `${entry.icon}|${u.file}|${u.line}|${u.kind}|${i}`,
          icon: entry.icon,
          file: u.file,
          line: u.line,
          kind: u.kind,
          snippet: u.snippet,
        });
      });
    }
    return out;
  }, []);

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return flat.filter((u) => {
      if (onlyChanged && !changed[u.key]) return false;
      if (kindFilter !== 'all' && u.kind !== kindFilter) return false;
      if (onlyDuplicates && flat.filter((x) => x.icon === u.icon).length < 2) return false;
      if (!q) return true;
      return (
        u.icon.toLowerCase().includes(q) ||
        u.file.toLowerCase().includes(q) ||
        u.snippet.toLowerCase().includes(q) ||
        iconFunction(u.icon).toLowerCase().includes(q)
      );
    });
  }, [flat, query, onlyDuplicates, onlyChanged, kindFilter, changed]);

  // ── Grouping by the active view ───────────────────────────────────────────
  const groups = useMemo(() => {
    type G = { id: string; label: string; sub?: string; icon?: string; usages: FlatUsage[] };
    const map = new Map<string, G>();
    for (const u of filtered) {
      let id: string;
      let label: string;
      let sub: string | undefined;
      let icon: string | undefined;
      if (view === 'icon') {
        id = `icon:${u.icon}`;
        label = u.icon;
        icon = u.icon;
      } else if (view === 'place') {
        id = `place:${u.file}`;
        label = u.file;
      } else {
        id = `fn:${iconFunction(u.icon)}`;
        label = iconFunction(u.icon);
      }
      const g = map.get(id) ?? { id, label, sub, icon, usages: [] };
      g.usages.push(u);
      map.set(id, g);
    }
    const arr = [...map.values()];
    if (sortBy === 'usage') arr.sort((a, b) => b.usages.length - a.usages.length || a.label.localeCompare(b.label));
    else arr.sort((a, b) => a.label.localeCompare(b.label));
    return arr;
  }, [filtered, view, sortBy]);

  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const applyChange = (usage: FlatUsage, newIcon: string) => {
    setChanged((prev) => {
      const next = { ...prev };
      if (newIcon === usage.icon) delete next[usage.key];
      else next[usage.key] = newIcon;
      return next;
    });
  };

  const clearChange = (usage: FlatUsage) => {
    setChanged((prev) => {
      const next = { ...prev };
      delete next[usage.key];
      return next;
    });
  };

  const resetAll = () => {
    setChanged({});
    infoToast('All icon changes cleared.');
  };

  const exportJson = async () => {
    const entries = Object.entries(changed);
    if (entries.length === 0) {
      infoToast('No icon changes to export yet.');
      return;
    }
    const usageByKey = new Map(flat.map((u) => [u.key, u]));
    const changes = entries.map(([key, to]) => {
      const u = usageByKey.get(key)!;
      return {
        file: u.file,
        line: u.line,
        kind: u.kind,
        from: u.icon,
        to,
        snippet: u.snippet,
      };
    });

    // ── Build the AI prompt (this is the export). ────────────────────────────
    const kindGuide: Record<string, string> = {
      attribute:
        'the glyph is the value of the `name` attribute on a `<FontAwesome />` element — change `name="..."` to the new glyph.',
      metadata:
        'the glyph is the value of an `icon` key in a metadata / config map — change that value to the new glyph.',
      dynamic:
        'the glyph is resolved from a variable at runtime — update the glyph the expression evaluates to (the constant/mapping it reads), keeping the expression logic intact.',
    };

    const list = changes
      .map((ch, i) => {
        const note =
          ch.kind === 'dynamic'
            ? ` (dynamic — the glyph on this line is resolved from a variable; update what it resolves to)`
            : '';
        return (
          `${i + 1}. \`${ch.file}:${ch.line}\`${note}\n` +
          `   - Change: \`${ch.from}\`  →  \`${ch.to}\`` +
          (ch.snippet ? `\n   - Context: \`${ch.snippet}\`` : '')
        );
      })
      .join('\n');

    const prompt = [
      `# Icon change request — TrustFlow`,
      ``,
      `## How to update the list`,
      `The icon audit list lives in \`lib/devtools/icon-audit-data.ts\` (and \`.json\`) and is a`,
      `GENERATED file — never edit it by hand. When you are done applying every change below,`,
      `update the list by running:`,
      ``,
      `    node scripts/generate-icon-audit.mjs`,
      ``,
      `That regenerates \`lib/devtools/icon-audit-data.ts\` + \`lib/devtools/icon-audit-data.json\``,
      `from the source tree (re-scans usages, re-counts icons / files / dynamic entries).`,
      `After regenerating, confirm the list now reports the new glyphs at the changed locations`,
      `and that no other usage was affected. Also keep \`lib/devtools/iconFunctions.ts\` (the`,
      `curated icon → function map) and \`lib/icons.ts\` (the canonical registry) in sync with`,
      `any new glyphs that appear.`,
      ``,
      `## Task`,
      `Apply exactly these FontAwesome 4 glyph changes in the TrustFlow codebase`,
      `(\`@expo/vector-icons\`). Edit only the glyph referenced in each listed location — do`,
      `not touch anything else on the line or in the file. How to recognise the glyph on each`,
      `line:`,
      ``,
      `- name="..." (attribute): ${kindGuide.attribute}`,
      `- icon: ... (metadata): ${kindGuide.metadata}`,
      `- dynamic: ${kindGuide.dynamic}`,
      ``,
      `## Changes (${changes.length})`,
      ``,
      list,
      ``,
      `After applying all changes, update the list (see "How to update the list" above).`,
    ].join('\n');

    setExporting(true);
    try {
      const bytes = new TextEncoder().encode(prompt);
      const date = new Date().toISOString().slice(0, 10);
      const saved = await saveBytes(`icon-changes-${date}.md`, bytes, 'text/markdown');
      if (saved) {
        successToast(
          Platform.OS === 'web' ? `Exported ${changes.length} icon changes as a prompt.` : `Exported ${changes.length} icon changes to ${saved}`,
          'Icon changes exported'
        );
      } else {
        errorToast('Could not save the icon-changes file.');
      }
    } catch (e: any) {
      console.error('[IconAudit] export failed', e);
      errorToast(e?.message || 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  const applyToCode = async () => {
    const entries = Object.entries(changed);
    if (entries.length === 0) {
      infoToast('No icon changes to apply yet.');
      return;
    }
    const usageByKey = new Map(flat.map((u) => [u.key, u]));
    const changes = entries.map(([key, to]) => {
      const u = usageByKey.get(key)!;
      return { file: u.file, line: u.line, kind: u.kind, from: u.icon, to, snippet: u.snippet };
    });

    setApplying(true);
    try {
      const reachable = await pingIconServer(applyEndpoint);
      if (!reachable) {
        errorToast('Apply server not running. Start it with: node scripts/apply-icon-changes.mjs --serve');
        return;
      }
      const result = await applyIconChanges(changes, applyEndpoint);
      if (result.ok) {
        const msg =
          `${result.applied} applied, ${result.alreadyApplied} already applied` +
          (result.failed > 0 ? `, ${result.failed} failed` : '');
        if (result.failed > 0) {
          warningToast(msg, 'Icon changes applied with failures');
        } else {
          successToast(result.regenerated ? `${msg} · list updated.` : msg, 'Icon changes applied to code');
        }
        // The apply server regenerated the audit data on disk — reload the page
        // (web) so the static ICON_AUDIT import reflects the fresh list.
        if (Platform.OS === 'web' && result.failed === 0 && typeof window !== 'undefined') {
          setTimeout(() => window.location.reload(), 900);
        }
      } else {
        errorToast(result.error || 'Apply server returned an error.');
      }
    } catch (e: any) {
      console.error('[IconAudit] apply failed', e);
      errorToast(e?.message || 'Apply failed — is the apply server running?');
    } finally {
      setApplying(false);
    }
  };

  const changedCount = Object.keys(changed).length;
  const activeFilterCount =
    (kindFilter !== 'all' ? 1 : 0) + (onlyDuplicates ? 1 : 0) + (onlyChanged ? 1 : 0);

  const clearFilters = () => {
    setKindFilter('all');
    setOnlyDuplicates(false);
    setOnlyChanged(false);
    infoToast('Filters cleared.');
  };

  return (
    <View className="flex-1">
      {/* How to update the list — always visible at the top */}
      <View className="mb-5 rounded-2xl border p-5" style={{ backgroundColor: c.info + '0D', borderColor: c.info + '44' }}>
        <View className="flex-row items-center gap-2 mb-2">
          <FontAwesome name="refresh" size={13} color={c.info} />
          <Text className="text-typography-main font-black text-sm uppercase tracking-widest" style={{ color: c.info }}>
            How to update the list
          </Text>
        </View>
        <Text className="text-typography-muted text-xs leading-relaxed mb-2">
          The icon audit list lives in <Text className="font-mono" style={{ color: c.textMain }}>lib/devtools/icon-audit-data.ts</Text> (+ <Text className="font-mono" style={{ color: c.textMain }}>.json</Text>) and is a GENERATED file — never edit it by hand. To refresh it after applying icon changes, run:
        </Text>
        <View className="mb-3">
          <CopyCommand command="node scripts/generate-icon-audit.mjs" />
        </View>
        <Text className="text-typography-muted text-xs leading-relaxed mb-2">
          To apply icon changes straight to code from this page, run the local apply server (the <Text className="font-mono" style={{ color: c.textMain }}>Apply to code</Text> button talks to it):
        </Text>
        <CopyCommand command="node scripts/apply-icon-changes.mjs --serve" />
        <Text className="text-typography-muted text-xs leading-relaxed mt-3">
          The generator re-scans the source (usages, icons, files, dynamic entries). Also keep the curated map <Text className="font-mono" style={{ color: c.textMain }}>lib/devtools/iconFunctions.ts</Text> and the canonical registry <Text className="font-mono" style={{ color: c.textMain }}>lib/icons.ts</Text> in sync with any glyph changes.
        </Text>
      </View>

      {/* Stats bar */}
      <View className="flex-row flex-wrap gap-3 mb-5">
        <StatChip label="Icons" value={String(ICON_AUDIT_META.totalIcons)} tone={c.primary} />
        <StatChip label="Total usages" value={String(ICON_AUDIT_META.totalUsages)} tone={c.info} />
        <StatChip label="Dynamic (unresolved)" value={String(ICON_AUDIT_META.dynamicUsages)} tone={c.warning} />
        <StatChip label="Files scanned" value={String(ICON_AUDIT_META.filesScanned)} tone={c.success} />
        <StatChip label="Pending changes" value={String(changedCount)} tone={changedCount ? c.danger : c.textMuted} />
      </View>

      {/* View switcher */}
      <View className="flex-row gap-2 mb-4">
        {(
          [
            ['icon', 'By icon'],
            ['place', 'By place'],
            ['function', 'By function'],
          ] as [ViewMode, string][]
        ).map(([mode, label]) => {
          const active = view === mode;
          return (
            <TouchableOpacity
              key={mode}
              onPress={() => setView(mode)}
              className={`px-4 py-2.5 rounded-xl border ${active ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-card border-surface-border'}`}
              accessibilityRole="button"
            >
              <Text className={`text-xs font-bold uppercase tracking-widest ${active ? 'text-brand-primary' : 'text-typography-muted'}`}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Controls */}
      <View className="flex-row items-center gap-2 mb-3 flex-wrap">
        <View className="flex-row items-center bg-surface-background border border-surface-border rounded-xl px-3 gap-2 flex-1 min-w-56">
          <FontAwesome name="search" size={12} color={c.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search icon name, file, or function..."
            placeholderTextColor={c.textDim}
            accessibilityLabel="Search icons"
            className="flex-1 py-2.5 text-typography-main text-sm bg-transparent"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
              <FontAwesome name="times-circle" size={12} color={c.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        <View className="flex-none">
          <Tooltip label={`${showFilters ? 'Hide' : 'Show'} filters`}>
            <TouchableOpacity
              onPress={() => setShowFilters((v) => !v)}
              className={`relative h-10 w-10 items-center justify-center border rounded-xl transition-colors ${showFilters || activeFilterCount > 0 ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-card border-surface-border'}`}
              accessibilityRole="button"
              accessibilityLabel="Filters"
            >
              <FontAwesome name="filter" size={12} color={showFilters || activeFilterCount > 0 ? c.primary : c.textMuted} />
              {activeFilterCount > 0 && (
                <View className="absolute -top-1.5 -right-1.5 bg-brand-primary rounded-full min-w-[16px] h-[16px] px-1 items-center justify-center border-2 border-surface-card">
                  <Text className="text-white text-[8px] font-black">{activeFilterCount > 9 ? '9+' : activeFilterCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          </Tooltip>
        </View>
      </View>

      {/* Filter panel — standardized slide-down (issue #208, .agents/ui-consistency) */}
      <SlideDownPanel isOpen={showFilters} maxHeight={360}>
        <View className="mb-4 bg-surface-card border border-surface-border rounded-2xl p-5 premium-shadow">
          <View className="flex-row items-center justify-between mb-4">
            <View className="flex-row items-center gap-2">
              <FontAwesome name="filter" size={13} color={c.primary} />
              <Text className="text-typography-main font-black text-sm uppercase tracking-widest">Filters</Text>
            </View>
            <Tooltip label={activeFilterCount > 0 ? 'Clear all filters' : 'No active filters'}>
              <TouchableOpacity
                onPress={clearFilters}
                disabled={activeFilterCount === 0}
                className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-xl border"
                style={{
                  borderColor: activeFilterCount > 0 ? c.danger : c.border,
                  backgroundColor: activeFilterCount > 0 ? c.danger + '0F' : undefined,
                  opacity: activeFilterCount > 0 ? 1 : 0.4,
                }}
                accessibilityRole="button"
              >
                <FontAwesome name="times" size={10} color={activeFilterCount > 0 ? c.danger : c.textMuted} />
                <Text className="text-[10px] font-black uppercase tracking-wider" style={{ color: activeFilterCount > 0 ? c.danger : c.textMuted }}>
                  Clear Filters
                </Text>
              </TouchableOpacity>
            </Tooltip>
          </View>

          <FilterSection label="Sort By">
            <FilterChipGroup>
              {(
                [
                  ['usage', 'Usage count'],
                  ['alpha', 'Alphabetical'],
                ] as [SortBy, string][]
              ).map(([value, label]) => {
                const active = sortBy === value;
                return (
                  <TouchableOpacity
                    key={value}
                    onPress={() => setSortBy(value)}
                    className={`px-3 py-2 rounded-xl border flex-row items-center gap-2 ${active ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-card border-surface-border'}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                  >
                    <FontAwesome name={active ? 'dot-circle-o' : 'circle-o'} size={12} color={active ? c.primary : c.textMuted} />
                    <Text className={`text-[10px] font-bold uppercase tracking-wider ${active ? 'text-brand-primary' : 'text-typography-muted'}`}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </FilterChipGroup>
          </FilterSection>

          <FilterSection label="Kind">
            <FilterChipGroup>
              {(
                [
                  ['all', 'All kinds'],
                  ['attribute', 'name="..."'],
                  ['metadata', 'icon: ...'],
                  ['dynamic', 'dynamic'],
                ] as ['all' | IconAuditKind, string][]
              ).map(([k, label]) => {
                const active = kindFilter === k;
                return (
                  <TouchableOpacity
                    key={k}
                    onPress={() => setKindFilter(k)}
                    className={`px-3 py-2 rounded-xl border ${active ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-card border-surface-border'}`}
                    accessibilityRole="button"
                  >
                    <Text className={`text-[10px] font-bold uppercase tracking-wider ${active ? 'text-brand-primary' : 'text-typography-muted'}`}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </FilterChipGroup>
          </FilterSection>

          <FilterSection label="Show only">
            <FilterChipGroup>
              <TouchableOpacity
                onPress={() => setOnlyChanged((v) => !v)}
                className={`px-3 py-2 rounded-xl border flex-row items-center gap-2 ${onlyChanged ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-card border-surface-border'}`}
                accessibilityRole="button"
              >
                <Text className={`text-[10px] font-bold uppercase tracking-wider ${onlyChanged ? 'text-brand-primary' : 'text-typography-muted'}`}>
                  Changed ({changedCount})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setOnlyDuplicates((v) => !v)}
                className={`px-3 py-2 rounded-xl border ${onlyDuplicates ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-card border-surface-border'}`}
                accessibilityRole="button"
              >
                <Text className={`text-[10px] font-bold uppercase tracking-wider ${onlyDuplicates ? 'text-brand-primary' : 'text-typography-muted'}`}>
                  Duplicates
                </Text>
              </TouchableOpacity>
            </FilterChipGroup>
          </FilterSection>
        </View>
      </SlideDownPanel>

      {/* Result count */}
      <Text className="text-typography-muted text-[11px] mb-3">
        Showing {filtered.length} usage{filtered.length === 1 ? '' : 's'} across {groups.length} {view === 'icon' ? 'icons' : view === 'place' ? 'files' : 'functions'}
      </Text>

      {/* Grouped list */}
      <View className="gap-2 pb-8">
        {groups.map((g) => {
          const isOpen = !!expanded[g.id];
          const groupChanged = g.usages.filter((u) => changed[u.key]).length;
          return (
            <View key={g.id} className="rounded-xl border border-surface-border overflow-hidden" style={{ backgroundColor: c.card }}>
              <TouchableOpacity onPress={() => toggle(g.id)} className="flex-row items-center gap-3 p-3">
                {view === 'icon' && (
                  <View className="w-10 h-10 items-center justify-center rounded-lg" style={{ backgroundColor: c.background }}>
                    <FontAwesome name={g.icon as any} size={16} color={c.primary} />
                  </View>
                )}
                {view === 'place' && (
                  <View className="w-10 h-10 items-center justify-center rounded-lg" style={{ backgroundColor: c.background }}>
                    <FontAwesome name="file-o" size={16} color={c.info} />
                  </View>
                )}
                {view === 'function' && (
                  <View className="w-10 h-10 items-center justify-center rounded-lg" style={{ backgroundColor: c.background }}>
                    <FontAwesome name="tags" size={16} color={c.info} />
                  </View>
                )}
                <View className="flex-1">
                  <Text className="text-typography-main font-mono text-sm font-bold" numberOfLines={1}>
                    {g.label}
                  </Text>
                  <Text className="text-typography-muted text-[11px] mt-0.5">
                    {g.usages.length} usage{g.usages.length === 1 ? '' : 's'}
                    {groupChanged ? ` · ${groupChanged} changed` : ''}
                  </Text>
                </View>
                <FontAwesome name={isOpen ? 'chevron-up' : 'chevron-down'} size={11} color={c.textDim} />
              </TouchableOpacity>

              {isOpen && (
                <View className="border-t border-surface-border" style={{ backgroundColor: c.background + '80' }}>
                  {g.usages.map((u) => {
                    const newIcon = changed[u.key];
                    const resolved = newIcon || u.icon;
                    return (
                      <View
                        key={u.key}
                        className={isDesktop ? 'flex-row items-center gap-2 px-3 py-2' : 'px-3 py-2'}
                        style={{ borderTopWidth: 1, borderTopColor: c.border + '40' }}
                      >
                        <View className="flex-row items-center gap-2 flex-1 min-w-0">
                          <FontAwesome name={resolved as any} size={14} color={c.primary} />
                          <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: kindTone(u.kind, c) + '1A' }}>
                            <Text className="text-[9px] font-bold uppercase tracking-wider" style={{ color: kindTone(u.kind, c) }}>
                              {kindLabel(u.kind)}
                            </Text>
                          </View>
                          <View className="flex-1 min-w-0">
                            <Text className="text-typography-main font-mono text-xs">
                              {u.file}:{u.line}
                            </Text>
                            <Text className="text-typography-dim text-[11px] mt-0.5" numberOfLines={2}>
                              {u.snippet}
                            </Text>
                          </View>
                        </View>
                        {newIcon ? (
                          <View className="flex-row items-center gap-1.5">
                            <Text className="text-[10px] font-mono" style={{ color: c.textDim }}>{u.icon}</Text>
                            <FontAwesome name="arrow-right" size={10} color={c.textDim} />
                            <Text className="text-[10px] font-mono" style={{ color: c.success }}>{newIcon}</Text>
                            <TouchableOpacity onPress={() => clearChange(u)} hitSlop={8} accessibilityLabel="Revert icon change">
                              <FontAwesome name="undo" size={12} color={c.textMuted} />
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <TouchableOpacity
                            onPress={() => setPicker({ usage: u })}
                            className="px-3 py-1.5 rounded-lg border border-surface-border bg-surface-card"
                            accessibilityRole="button"
                            accessibilityLabel={`Change icon ${u.icon}`}
                          >
                            <Text className="text-[10px] font-bold uppercase tracking-widest" style={{ color: c.primary }}>
                              Change
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}
      </View>

      {groups.length === 0 && (
        <View className="items-center py-12">
          <FontAwesome name="search" size={24} color={c.textDim} />
          <Text className="text-typography-muted text-sm mt-3">No icons match “{query}”</Text>
        </View>
      )}

      {/* Export / apply bar — pinned at the very end of the list */}
      <View className="mt-4 border-t border-surface-border pt-4 pb-2">
        <Text className="text-typography-muted text-[11px] mb-3">
          {changedCount} icon change{changedCount === 1 ? '' : 's'} ready. Apply them to code directly (local server), or export an AI prompt that tells an agent exactly what to change (and how to refresh the audit list).
        </Text>
        <View className="flex-row gap-3 flex-wrap items-center">
          <TouchableOpacity
            onPress={applyToCode}
            disabled={applying || changedCount === 0}
            className="px-5 py-3 rounded-xl bg-brand-primary flex-row items-center gap-2"
            style={{ opacity: changedCount === 0 ? 0.5 : 1 }}
            accessibilityRole="button"
          >
            <FontAwesome name="bolt" size={13} color="#fff" />
            <Text className="text-white font-black text-xs uppercase tracking-widest">
              {applying ? 'Applying…' : 'Apply to code'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={exportJson}
            disabled={exporting || changedCount === 0}
            className="px-5 py-3 rounded-xl border border-surface-border bg-surface-card flex-row items-center gap-2"
            style={{ opacity: changedCount === 0 ? 0.5 : 1 }}
            accessibilityRole="button"
          >
            <FontAwesome name="download" size={13} color={c.textMuted} />
            <Text className="text-typography-muted font-black text-xs uppercase tracking-widest">
              {exporting ? 'Exporting…' : 'Export changes (AI prompt)'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={resetAll}
            disabled={changedCount === 0}
            className="px-5 py-3 rounded-xl border border-surface-border bg-surface-card flex-row items-center gap-2"
            style={{ opacity: changedCount === 0 ? 0.5 : 1 }}
            accessibilityRole="button"
          >
            <FontAwesome name="undo" size={13} color={c.textMuted} />
            <Text className="text-typography-muted font-black text-xs uppercase tracking-widest">Reset all</Text>
          </TouchableOpacity>
        </View>
        <View className="flex-row items-center gap-2 mt-3 flex-wrap">
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Apply server</Text>
          <View className="flex-row items-center bg-surface-background border border-surface-border rounded-xl px-3 gap-2 flex-1 min-w-56 max-w-sm">
            <FontAwesome name="server" size={12} color={c.textMuted} />
            <TextInput
              value={applyEndpoint}
              onChangeText={setApplyEndpoint}
              placeholder={DEFAULT_APPLY_ENDPOINT}
              placeholderTextColor={c.textDim}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Apply server endpoint"
              className="flex-1 py-2 text-typography-main text-xs font-mono bg-transparent"
            />
          </View>
          <Text className="text-typography-muted text-[10px] flex-1 min-w-48">
            Start it with <Text className="font-mono" style={{ color: c.textMain }}>node scripts/apply-icon-changes.mjs --serve</Text>
          </Text>
        </View>
      </View>

      <IconPicker
        visible={picker !== null}
        current={picker?.usage.icon}
        usage={picker?.usage ?? null}
        onSelect={(icon) => {
          if (picker) applyChange(picker.usage, icon);
        }}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}

function StatChip({ label, value, tone }: { label: string; value: string; tone: string }) {
  const c = useThemeColors();
  return (
    <View className="rounded-xl border border-surface-border px-4 py-3" style={{ backgroundColor: c.card }}>
      <Text className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: tone }}>
        {label}
      </Text>
      <Text className="text-typography-main font-black text-lg">{value}</Text>
    </View>
  );
}

// ── Command row with one-tap copy ────────────────────────────────────────────
function CopyCommand({ command }: { command: string }) {
  const c = useThemeColors();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await Clipboard.setStringAsync(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <View className="rounded-xl border border-surface-border overflow-hidden" style={{ backgroundColor: c.card }}>
      <View className="flex-row items-center px-4 py-2.5 gap-2">
        <Text className="font-mono text-xs flex-1" style={{ color: c.textMain }} numberOfLines={1}>
          {command}
        </Text>
        <TouchableOpacity
          onPress={copy}
          hitSlop={8}
          accessibilityLabel={`Copy command ${command}`}
          className="w-8 h-8 items-center justify-center rounded-lg"
          style={{ backgroundColor: c.background }}
        >
          <FontAwesome name={copied ? 'check' : 'copy'} size={11} color={copied ? c.success : c.primary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Icon picker modal ───────────────────────────────────────────────────────
function IconPicker({
  visible,
  current,
  usage,
  onSelect,
  onClose,
}: {
  visible: boolean;
  current?: string;
  usage: FlatUsage | null;
  onSelect: (icon: string) => void;
  onClose: () => void;
}) {
  const c = useThemeColors();
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return PICKABLE;
    return PICKABLE.filter((g) => g.toLowerCase().includes(query));
  }, [q]);

  if (!visible || !usage) return null;

  return (
    <View style={Platform.OS === 'web' ? (styles.webOverlay as any) : styles.nativeOverlay}>
      <View className="w-full max-w-3xl rounded-2xl overflow-hidden" style={{ backgroundColor: c.card, borderWidth: 1, borderColor: c.border, maxHeight: '88%' }}>
        {/* Header */}
        <View className="flex-row items-center justify-between px-5 py-4" style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
          <View className="flex-1 mr-3">
            <Text className="text-typography-main font-black text-sm">Pick an icon</Text>
            <Text className="text-typography-muted text-[11px] mt-0.5">
              Replacing <Text className="font-mono" style={{ color: c.primary }}>{usage.icon}</Text> at {usage.file}:{usage.line}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} className="w-8 h-8 items-center justify-center rounded-full" style={{ backgroundColor: c.background }} accessibilityLabel="Close picker">
            <FontAwesome name="times" size={13} color={c.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View className="px-5 py-3" style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
          <View className="flex-row items-center bg-surface-background border border-surface-border rounded-xl px-3 gap-2">
            <FontAwesome name="search" size={12} color={c.textMuted} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Filter glyphs…"
              placeholderTextColor={c.textDim}
              autoFocus={Platform.OS === 'web'}
              className="flex-1 py-2.5 text-typography-main text-sm bg-transparent"
            />
            {q.length > 0 && (
              <TouchableOpacity onPress={() => setQ('')} hitSlop={8}>
                <FontAwesome name="times-circle" size={12} color={c.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Glyph grid */}
        <ScrollView className="px-5 py-4" showsVerticalScrollIndicator style={{ maxHeight: '70%' }}>
          <View className="flex-row flex-wrap gap-2">
            {filtered.map((g) => {
              const active = g === current;
              const selected = g === usage.icon;
              return (
                <TouchableOpacity
                  key={g}
                  onPress={() => {
                    onSelect(g);
                    onClose();
                  }}
                  className="items-center justify-center rounded-lg border"
                  style={{
                    width: 62,
                    height: 56,
                    backgroundColor: active ? c.primary + '1A' : c.background,
                    borderColor: active ? c.primary : selected ? c.info : c.border,
                    borderWidth: active || selected ? 1.5 : 1,
                  }}
                  accessibilityLabel={`Select icon ${g}`}
                >
                  <FontAwesome name={g as any} size={18} color={active ? c.primary : c.textMain} />
                </TouchableOpacity>
              );
            })}
          </View>
          {filtered.length === 0 && (
            <View className="items-center py-10">
              <FontAwesome name="search" size={20} color={c.textDim} />
              <Text className="text-typography-muted text-xs mt-2">No glyphs match “{q}”</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = {
  webOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    zIndex: 9999,
  },
  nativeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    zIndex: 9999,
  },
};
