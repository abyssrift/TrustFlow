import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useState } from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';

import MultiViewList from '@/components/common/MultiViewList';
import Tooltip from '@/components/common/Tooltip';
import { EntityGlyph, EntityTag, ProgressMeter, entityColor, fmtDate } from '@/components/entities/EntityUI';
import PortfolioEditModal from '@/components/portfolios/PortfolioEditModal';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { usePortfolios, type PortfolioRow } from '@/hooks/usePortfolios';

/**
 * The portfolio screen (Phase 10, #191) — since #260 a MultiViewList
 * (`components/common/MultiViewList.tsx`) with the same large / list /
 * details densities the Role & Team registries (#219) and File Hub Channels
 * (#242) use, built on the one reusable list primitive from #249. PortfolioCard
 * is the `large` (grid) render prop; list/detailed are compact rows and a
 * table of the same rollup fields.
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
 *
 * Search is controlled: this screen owns the debounced query, sends it to the
 * RPC (`usePortfolios` → rpc_portfolios_table p_search), and hands MultiViewList
 * an already-filtered `items` — the same contract as ProjectsTable's
 * `sortedRows` / every other adopting surface. The density mode persists per
 * user under AsyncStorage key `multiview:portfolios`.
 */
export default function PortfolioGrid({
  onOpenPortfolio,
  onCreate,
}: {
  onOpenPortfolio?: (id: string) => void;
  onCreate?: () => void;
}) {
  const c = useThemeColors();
  const { hasPermission } = useAuth();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PortfolioRow | null>(null);
  const { rows, loading, error, denied, refresh } = usePortfolios(search);
  const canEdit = hasPermission('project.edit');

  const pctOf = (p: PortfolioRow) => (p.projects_total > 0 ? (p.projects_done / p.projects_total) * 100 : 0);

  return (
    <View className="flex-1">
      <MultiViewList
        items={rows}
        keyExtractor={p => p.id}
        renderCard={p => <PortfolioCard row={p} onEdit={canEdit ? () => setEditing(p) : undefined} />}
        renderRow={p => (
          <View className="flex-row items-center gap-3">
            <PortfolioCover row={p} width={40} height={40} borderRadius={10} glyphSize={18} />
            <View className="flex-1 min-w-0">
              <Text className="text-typography-main font-bold text-sm" numberOfLines={1}>
                {p.name}
              </Text>
              <Text className="text-typography-muted text-[11px]" numberOfLines={1}>
                {p.template_name ? `From “${p.template_name}”` : p.source || 'Created manually'}
              </Text>
            </View>
            <Text className="text-typography-muted text-[11px] font-semibold flex-shrink-0">
              {p.projects_done} of {p.projects_total} done
            </Text>
          </View>
        )}
        columns={[
          {
            key: 'portfolio',
            label: 'Portfolio',
            flex: 2.4,
            render: p => (
              <View className="flex-row items-center gap-2.5">
                <PortfolioCover row={p} width={36} height={36} borderRadius={9} glyphSize={16} />
                <View className="min-w-0">
                  <Text className="text-typography-main font-bold text-sm" numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Text className="text-typography-muted text-[10px]" numberOfLines={1}>
                    {p.template_name ? `From “${p.template_name}”` : p.source || 'Created manually'}
                  </Text>
                </View>
              </View>
            ),
          },
          {
            key: 'finished',
            label: 'Finished',
            flex: 1.1,
            render: p => (
              <View style={{ gap: 4 }}>
                <Text className="text-typography-main text-xs font-bold">
                  {p.projects_done}/{p.projects_total}
                </Text>
                <ProgressMeter
                  done={p.projects_done}
                  total={p.projects_total}
                  percent={pctOf(p)}
                  tone={p.projects_blocked > 0 ? c.warning : undefined}
                  showCaption={false}
                  height={4}
                />
              </View>
            ),
          },
          {
            key: 'tasks',
            label: 'Tasks',
            flex: 1,
            render: p => (
              <Text className="text-typography-muted text-xs">
                {p.tasks_done}/{p.tasks_total}
              </Text>
            ),
          },
          {
            key: 'blocked',
            label: 'Blocked',
            flex: 0.8,
            align: 'center',
            render: p =>
              p.projects_blocked > 0 ? (
                <Text className="text-[11px] font-black" style={{ color: c.danger }}>
                  {p.projects_blocked}
                </Text>
              ) : (
                <Text className="text-typography-dim text-xs">—</Text>
              ),
          },
          {
            key: 'next-due',
            label: 'Next due',
            flex: 1.1,
            render: p => (
              <Text className="text-typography-muted text-xs">{p.next_due ? fmtDate(p.next_due) : '—'}</Text>
            ),
          },
          {
            key: 'projected',
            label: 'Projected',
            flex: 1.3,
            render: p => (
              <Text
                className={`text-xs ${p.confidence === 'none' || !p.projected_end ? 'text-typography-muted' : 'text-typography-main font-bold'}`}
              >
                {p.confidence === 'none' || !p.projected_end ? 'Not enough history' : fmtDate(p.projected_end)}
              </Text>
            ),
          },
        ]}
        onItemPress={p => onOpenPortfolio?.(p.id)}
        storageKey="portfolios"
        modes={['large', 'list', 'details']}
        defaultMode="large"
        maxGridWidth={1160}
        search={{ value: search, onChange: setSearch, placeholder: 'Search portfolios' }}
        loading={loading}
        statusBanner={
          error
            ? denied
              ? {
                  tone: 'warning',
                  icon: 'lock',
                  title: 'No portfolio access',
                  body: 'You don’t have access to portfolios. Ask an admin if you should.',
                }
              : {
                  tone: 'danger',
                  icon: 'exclamation-triangle',
                  title: 'Could not load portfolios',
                  body: 'Check your connection and try again.',
                }
            : null
        }
        emptyState={{
          icon: 'inbox',
          title: search ? 'No portfolios match that' : 'No portfolios yet',
          body: search
            ? 'Nothing here has that name. Clear the search to see them all.'
            : 'A portfolio is one batch of work — everything created together from a spreadsheet or a template. Import a spreadsheet or bulk-create from a template and the batch appears here.',
          actionLabel: onCreate && !search ? 'Add several projects' : undefined,
          onAction: onCreate && !search ? onCreate : undefined,
        }}
        style={{ flex: 1 }}
      />

      <PortfolioEditModal
        visible={!!editing}
        onClose={() => setEditing(null)}
        onSaved={refresh}
        portfolio={editing ? { id: editing.id, name: editing.name, cover_url: editing.cover_url, target_date: editing.target_date } : null}
      />
    </View>
  );
}

/**
 * The one cover: the uploaded picture when there is one (#259), otherwise the
 * derived glyph — see the file header. Rendered at card size in the `large`
 * view, thumbnail size in list/detailed rows.
 */
function PortfolioCover({
  row,
  width,
  height,
  borderRadius,
  glyphSize,
  blockedOverlay,
}: {
  row: PortfolioRow;
  width?: number;
  height?: number;
  borderRadius?: number;
  glyphSize?: number;
  blockedOverlay?: React.ReactNode;
}) {
  const c = useThemeColors();
  const hue = entityColor('portfolio', c);
  const [coverBroken, setCoverBroken] = useState(false);

  useEffect(() => setCoverBroken(false), [row.cover_url]);

  return (
    <View
      className="items-center justify-center overflow-hidden flex-shrink-0"
      style={{ width, height, borderRadius, backgroundColor: hue + '14' }}
    >
      {row.cover_url && !coverBroken ? (
        <Image
          source={{ uri: row.cover_url }}
          className="h-full w-full"
          resizeMode="cover"
          onError={() => setCoverBroken(true)}
        />
      ) : (
        <EntityGlyph kind="portfolio" size={glyphSize} />
      )}
      {blockedOverlay}
    </View>
  );
}

/**
 * The `large` density card. Deliberately NOT a touchable and NO
 * accessibilityRole="button" anywhere inside:
 *
 * - MultiViewList's own row-level TouchableOpacity carries the press (and the
 *   role), so a card with its own onPress fires twice.
 * - react-native-web emits a real <button> element for accessibilityRole="button",
 *   so a role-bearing edit control here would nest a <button> inside the row's
 *   <button> — the exact "<button> cannot contain a nested <button>" LogBox
 *   error this file used to produce as a card + nested edit button. Same
 *   convention as RuleCard in NotificationRules.tsx: inner controls omit the
 *   role and stopPropagation instead.
 */
function PortfolioCard({
  row,
  onEdit,
}: {
  row: PortfolioRow;
  onEdit?: () => void;
}) {
  const c = useThemeColors();

  // The headline number the owner asked for: how much of this batch actually
  // succeeded. projects_done counts a success-TERMINAL stage, the same
  // definition rpc_projects_table and fn_project_projection use — so this bar
  // and the project list can never disagree about what "done" means.
  const pct = row.projects_total > 0 ? (row.projects_done / row.projects_total) * 100 : 0;
  const allDone = row.projects_total > 0 && row.projects_done === row.projects_total;

  return (
    <View className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden">
      <PortfolioCover
        row={row}
        height={128}
        glyphSize={56}
        blockedOverlay={
          row.projects_blocked > 0 ? (
            <View
              className="absolute rounded-lg px-2 flex-row items-center"
              style={{ top: 10, right: 10, minHeight: 24, gap: 5, backgroundColor: c.card, borderWidth: 1, borderColor: c.danger }}
            >
              <FontAwesome name="exclamation-circle" size={10} color={c.danger} />
              <Text className="text-[11px] font-black" style={{ color: c.danger }}>
                {row.projects_blocked} blocked
              </Text>
            </View>
          ) : undefined
        }
      />

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
            <Tooltip label="Edit portfolio">
              <TouchableOpacity
                onPress={(e: any) => { e?.stopPropagation?.(); onEdit(); }}
                accessibilityLabel={`Edit portfolio ${row.name}`}
                className="w-11 h-11 rounded-xl items-center justify-center border border-surface-border flex-shrink-0"
                style={{ backgroundColor: c.card }}
              >
                <FontAwesome name="pencil" size={13} color={c.textMuted} />
              </TouchableOpacity>
            </Tooltip>
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