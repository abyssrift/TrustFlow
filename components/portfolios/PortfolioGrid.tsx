import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';

import {
  EntityEmptyState,
  EntityGlyph,
  EntityTag,
  ProgressMeter,
  entityColor,
  fmtDate,
} from '@/components/entities/EntityUI';
import Tooltip from '@/components/common/Tooltip';
import PortfolioEditModal from '@/components/portfolios/PortfolioEditModal';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { usePortfolios, type PortfolioRow } from '@/hooks/usePortfolios';

/**
 * The portfolio screen (Phase 10, #191) — a grid of big cards, six to a
 * desktop screen, each showing how much of its work has actually succeeded.
 *
 * PATH A (unified responsive), per ui-style-guide.md §3. A card grid collapses
 * from three columns to one without changing paradigm: the card, its cover,
 * its numbers and its tap target are identical at 1400px and at 390px, only
 * the column count moves. There is no desktop idiom here that becomes hostile
 * on mobile — which is what would justify Path B — so a second component would
 * be two things to keep in sync for no behavioural gain.
 *
 * ── ABOUT THE "BIG PICTURE" ────────────────────────────────────────────────
 * `portfolios` has no colour or icon column — checked, there are none — but
 * since issue #259 it CAN carry a picture (portfolios.cover_url, stored in the
 * `portfolio-covers` bucket). When a portfolio has one, the cover is the image
 * and the card needs nothing else; when it does not, the cover is DERIVED from
 * the portfolio's own entity hue, tinted, carrying the portfolio glyph. That
 * means every portfolio ever created has a cover that cannot look broken —
 * there is no missing-image case, even for the six batches made by imports
 * months ago — and a picture, when someone adds one, just wins.
 *
 * Colours are inline from useThemeColors rather than token classes because the
 * hue is computed at runtime — the same sanctioned exception Tooltip and
 * EntityGlyph already use. No raw Tailwind colours appear anywhere.
 */
export default function PortfolioGrid({
  onOpenPortfolio,
  onCreate,
}: {
  onOpenPortfolio?: (id: string) => void;
  onCreate?: () => void;
}) {
  const c = useThemeColors();
  const { width } = useWindowDimensions();
  const { hasPermission } = useAuth();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PortfolioRow | null>(null);
  const { rows, loading, error, denied, refresh } = usePortfolios(search);
  const canEdit = hasPermission('project.edit');

  // Three across on a wide screen puts six cards in view without scrolling,
  // which is the density asked for. Two on tablets, one on phones — below
  // ~520px a two-up card is too narrow to read its own numbers.
  const columns = width >= 1100 ? 3 : width >= 640 ? 2 : 1;

  const content = useMemo(() => {
    if (loading && rows.length === 0) {
      return (
        <View className="items-center py-16">
          <ActivityIndicator color={c.primary} />
        </View>
      );
    }

    if (error) {
      return (
        <View className="bg-surface-card border border-surface-border rounded-2xl p-6 items-center" style={{ gap: 10 }}>
          {/* Denied is not a failure to retry — a "Try again" button on it just
              fails again and reads as a bug rather than an access rule. */}
          <FontAwesome name={denied ? 'lock' : 'exclamation-triangle'} size={22} color={denied ? c.textMuted : c.danger} />
          <Text className="text-typography-main text-sm font-bold text-center">{error}</Text>
          {!denied && (
            <TouchableOpacity
              onPress={refresh}
              accessibilityRole="button"
              className="bg-brand-primary hover:bg-brand-primary-hover active:bg-brand-primary-active px-4 rounded-xl items-center justify-center"
              style={{ minHeight: 44 }}
            >
              <Text className="text-white text-sm font-bold">Try again</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }

    if (rows.length === 0) {
      return (
        <EntityEmptyState
          kind="portfolio"
          title={search ? 'No portfolios match that' : undefined}
          body={
            search
              ? 'Nothing here has that name. Clear the search to see them all.'
              : 'A portfolio is one batch of work — everything created together from a spreadsheet or a template. Import a spreadsheet or bulk-create from a template and the batch appears here.'
          }
          actionLabel={onCreate && !search ? 'Add several projects' : undefined}
          onAction={onCreate && !search ? onCreate : undefined}
        />
      );
    }

    return (
      <View className="flex-row flex-wrap" style={{ gap: 16 }}>
        {rows.map(p => (
          <PortfolioCard
            key={p.id}
            row={p}
            columns={columns}
            onPress={onOpenPortfolio ? () => onOpenPortfolio(p.id) : undefined}
            onEdit={canEdit ? () => setEditing(p) : undefined}
          />
        ))}
      </View>
    );
  }, [loading, rows, error, search, columns, c, refresh, onCreate, onOpenPortfolio, canEdit]);

  return (
    <View style={{ gap: 16 }}>
      <View
        className="bg-surface-card border border-surface-border rounded-lg flex-row items-center px-3"
        style={{ minHeight: 44, maxWidth: 420 }}
      >
        <FontAwesome name="search" size={13} color={c.textDim} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search portfolios"
          placeholderTextColor={c.textDim}
          className="flex-1 ml-2 text-typography-main"
          style={{ fontSize: 14, paddingVertical: 10 }}
        />
        {search.length > 0 && (
          <Tooltip label="Clear search">
            <TouchableOpacity
              onPress={() => setSearch('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              className="items-center justify-center"
              style={{ width: 44, height: 44 }}
            >
              <FontAwesome name="times-circle" size={14} color={c.textMuted} />
            </TouchableOpacity>
          </Tooltip>
        )}
      </View>
      {content}
      <PortfolioEditModal
        visible={!!editing}
        onClose={() => setEditing(null)}
        onSaved={refresh}
        portfolio={editing ? { id: editing.id, name: editing.name, cover_url: editing.cover_url, target_date: editing.target_date } : null}
      />
    </View>
  );
}

function PortfolioCard({
  row,
  columns,
  onPress,
  onEdit,
}: {
  row: PortfolioRow;
  columns: number;
  onPress?: () => void;
  onEdit?: () => void;
}) {
  const c = useThemeColors();
  const hue = entityColor('portfolio', c);

  // The headline number the owner asked for: how much of this batch actually
  // succeeded. projects_done counts a success-TERMINAL stage, the same
  // definition rpc_projects_table and fn_project_projection use — so this bar
  // and the project list can never disagree about what "done" means.
  const pct = row.projects_total > 0 ? (row.projects_done / row.projects_total) * 100 : 0;
  const allDone = row.projects_total > 0 && row.projects_done === row.projects_total;

  // flexBasis, not width: a wrapped row with gap needs the gap subtracted from
  // each basis or the last card in a row wraps to its own line.
  const basis = columns === 1 ? '100%' : `${100 / columns}%`;

  return (
    <View style={{ flexGrow: 1, flexBasis: columns === 1 ? ('100%' as any) : 0, minWidth: columns === 1 ? undefined : 280, maxWidth: columns === 1 ? undefined : 520 }}>
      <TouchableOpacity
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole="button"
        accessibilityLabel={`Open portfolio ${row.name}`}
        className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden"
        activeOpacity={0.85}
      >
          {/* The cover. The uploaded picture when there is one (#259),
              otherwise the derived glyph — see the file header. */}
          <View
            className="items-center justify-center"
            style={{ height: 128, backgroundColor: hue + '14', borderBottomWidth: 1, borderBottomColor: c.border }}
          >
            {row.cover_url ? (
              <Image source={{ uri: row.cover_url }} className="h-full w-full" resizeMode="cover" />
            ) : (
              <EntityGlyph kind="portfolio" size={56} />
            )}
            {row.projects_blocked > 0 && (
              <View
                className="absolute rounded-lg px-2 flex-row items-center"
                style={{ top: 10, right: 10, minHeight: 24, gap: 5, backgroundColor: c.card, borderWidth: 1, borderColor: c.danger }}
              >
                <FontAwesome name="exclamation-circle" size={10} color={c.danger} />
                <Text className="text-[11px] font-black" style={{ color: c.danger }}>
                  {row.projects_blocked} blocked
                </Text>
              </View>
            )}
          </View>

        <View className="p-4" style={{ gap: 10 }}>
          <View className="flex-row items-center" style={{ gap: 10 }}>
            <View className="flex-1">
              <EntityTag kind="portfolio" />
              <Text className="text-typography-main text-base font-black tracking-tight" numberOfLines={1}>
                {row.name}
              </Text>
              <Text className="text-typography-muted text-[11px] mt-0.5" numberOfLines={1}>
                {row.template_name ? `From “${row.template_name}”` : row.source || 'Created manually'}
              </Text>
            </View>

            {onEdit && (
              <TouchableOpacity
                onPress={(e: any) => { e?.stopPropagation?.(); onEdit(); }}
                accessibilityRole="button"
                accessibilityLabel={`Edit portfolio ${row.name}`}
                className="w-8 h-8 rounded-lg items-center justify-center border border-surface-border flex-shrink-0"
                style={{ backgroundColor: c.card }}
              >
                <FontAwesome name="pencil" size={13} color={c.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          <ProgressMeter
            done={row.projects_done}
            total={row.projects_total}
            percent={pct}
            tone={allDone ? c.success : row.projects_blocked > 0 ? c.warning : undefined}
            showCaption={false}
            height={8}
          />
          <Text className="text-typography-muted text-[11px]">
            {row.projects_done} of {row.projects_total} project{row.projects_total === 1 ? '' : 's'} finished
            {row.tasks_total > 0 ? ` · ${row.tasks_done}/${row.tasks_total} tasks` : ''}
          </Text>

          <View className="flex-row flex-wrap" style={{ gap: 12 }}>
            <CardStat
              icon="calendar-o"
              label="Next due"
              value={row.next_due ? fmtDate(row.next_due) : '—'}
              c={c}
            />
            <CardStat
              icon="flag-checkered"
              label="Projected"
              // §16.2: no confident wrong dates. 'none' means the server
              // refused to forecast, and the card says so rather than showing
              // a blank that reads as missing data.
              value={
                row.confidence === 'none' || !row.projected_end
                  ? 'Not enough history'
                  : fmtDate(row.projected_end)
              }
              muted={row.confidence !== 'ok'}
              c={c}
            />
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
}

function CardStat({
  icon,
  label,
  value,
  muted,
  c,
}: {
  icon: string;
  label: string;
  value: string;
  muted?: boolean;
  c: ReturnType<typeof useThemeColors>;
}) {
  return (
    <View style={{ gap: 2, minWidth: 110 }}>
      <View className="flex-row items-center" style={{ gap: 5 }}>
        <FontAwesome name={icon as any} size={10} color={c.textDim} />
        <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest">{label}</Text>
      </View>
      <Text
        className={`text-[12px] font-bold ${muted ? 'text-typography-muted' : 'text-typography-main'}`}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}
