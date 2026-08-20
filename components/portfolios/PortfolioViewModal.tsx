import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';

import MultiViewList from '@/components/common/MultiViewList';
import Popup from '@/components/common/Popup';
import { ClientMark, EntityGlyph, HealthBadge, ProgressMeter, StageChip } from '@/components/entities/EntityUI';
import PortfolioScopeHeader from '@/components/portfolios/PortfolioScopeHeader';
import { useDebounce } from '@/hooks/useDebounce';
import { usePortfolioProjects, type PortfolioProjectRow } from '@/hooks/usePortfolioProjects';
import { useThemeColors } from '@/hooks/useThemeColors';
import { ageColor, dueColor, fmtDate, fmtDue } from '@/lib/projectPresentation';
import { formatCompact } from '@/lib/time';

/**
 * Issue #260 — the "open portfolio" flow, rebuilt on the reusable Multi-View
 * Modal component from #249 (`components/common/MultiViewList.tsx`) instead
 * of full-page navigation to /portfolios/[id].
 *
 * ├─ sub-section 1: the portfolio itself (identity + rollup) — the same
 * │   PortfolioScopeHeader the scoped projects screen uses, so a modal-open
 * │   portfolio shows exactly the numbers its grid card showed.
 * └─ sub-section 2: the batch's projects in the shared multi-view list —
 *     large / medium / list / details densities, persisted view-mode
 *     preference, search and empty/status states all owned by MultiViewList.
 *
 * Only the ORDER of presentation changed vs. before — the grid and its cards
 * are untouched. The /portfolios/[id] route stays for deep links; the modal
 * is how a grid card opens from now on.
 *
 * The project rows ride `rpc_projects_table(p_portfolio_id => …)` — the SAME
 * reader /projects uses, so this modal and the projects screen can never
 * disagree about what belongs to a batch.
 *
 * Height contract: Popup `scrollable={false}` + `maxHeight`, with a `flex: 1`
 * root so MultiViewList's internal FlatList does the scrolling — the exact
 * pattern NotificationRules (`components/admin/NotificationRules.tsx`) proved.
 */
export default function PortfolioViewModal({
  portfolioId,
  onClose,
}: {
  portfolioId: string | null;
  onClose: () => void;
}) {
  const c = useThemeColors();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  // Search is controlled — MultiViewList owns the search box UI, this screen
  // owns the state and hands the debounced value to the RPC, which filters
  // server-side (the same split as ProjectsTable's p_search).
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 400);
  const { rows, loading, error, rpcMissing } = usePortfolioProjects(portfolioId, debouncedSearch);

  return (
    <Popup
      visible={!!portfolioId}
      onClose={onClose}
      presentation="auto"
      maxWidth={1000}
      maxHeight="90%"
      dimBackdrop
      scrollable={false}
    >
      {portfolioId && (
        <View className="flex-1">
          <PortfolioScopeHeader portfolioId={portfolioId} onAllProjects={onClose} onClose={onClose} />

          <View className="flex-row items-center justify-between px-5 pt-4 pb-2 border-b border-surface-border">
            <Text className="text-typography-dim text-[10px] font-black uppercase tracking-[0.15em]">
              Projects{search.trim() ? '' : ` · ${rows.length}`}
            </Text>
          </View>

          <MultiViewList
            items={rows}
            keyExtractor={r => r.id}
            renderCard={(row, density) => <PortfolioProjectCard row={row} density={density} />}
            renderRow={row => {
              return (
                <View className="flex-row items-center gap-3">
                  <EntityGlyph kind="project" size={24} color={row.color} />
                  <View className="flex-1 min-w-0">
                    <Text className="text-typography-main font-bold text-sm" numberOfLines={1}>
                      {row.name}
                    </Text>
                    <Text className="text-typography-muted text-[11px]" numberOfLines={1}>
                      {row.client_name ?? 'No client'}
                    </Text>
                  </View>
                  <StageChip size="sm" name={row.stage_name} color={row.stage_color} />
                  {isDesktop && (
                    <Text className="text-xs font-bold w-24 text-right" style={{ color: dueColor(row.days_remaining, c) }}>
                      {fmtDue(row.days_remaining, row.due_date)}
                    </Text>
                  )}
                  {isDesktop && (
                    <View className="w-16 items-end">
                      <Text className="text-typography-main text-xs font-bold">{formatCompact(row.tracked_seconds)}</Text>
                      <Text className="text-typography-dim text-[9px]">{row.estimated_hours != null ? `${row.estimated_hours}h est.` : 'no est.'}</Text>
                    </View>
                  )}
                </View>
              );
            }}
            columns={[
              {
                key: 'project',
                label: 'Project',
                flex: 2.6,
                render: row => (
                  <View className="flex-row items-center gap-2.5">
                    <EntityGlyph kind="project" size={28} color={row.color} />
                    <View className="min-w-0">
                      <Text className="text-typography-main font-bold text-sm" numberOfLines={1}>
                        {row.name}
                      </Text>
                      <ClientMark name={row.client_name} size={16} />
                    </View>
                  </View>
                ),
              },
              {
                key: 'stage',
                label: 'Stage',
                flex: 1.2,
                render: row => <StageChip size="sm" name={row.stage_name} color={row.stage_color} />,
              },
              {
                key: 'age',
                label: 'In stage',
                flex: 0.9,
                render: row => (
                  <Text className="text-sm font-bold" style={{ color: ageColor(row.days_in_current_stage, c) }}>
                    {row.days_in_current_stage == null ? 'Not staged' : `${row.days_in_current_stage}d`}
                  </Text>
                ),
              },
              {
                key: 'due',
                label: 'Due',
                flex: 1.1,
                render: row => (
                  <View>
                    <Text className="text-xs font-bold" style={{ color: dueColor(row.days_remaining, c) }}>
                      {fmtDue(row.days_remaining, row.due_date)}
                    </Text>
                    {!!row.due_date && (
                      <Text className="text-typography-dim text-[10px] mt-0.5">{fmtDate(row.due_date)}</Text>
                    )}
                  </View>
                ),
              },
              {
                key: 'progress',
                label: 'Completion',
                flex: 1.5,
                render: row => (
                  <ProgressMeter
                    done={row.tasks_done}
                    total={row.tasks_total}
                    percent={row.weighted_progress}
                    tone={row.blocked ? c.danger : undefined}
                    height={5}
                  />
                ),
              },
              {
                key: 'health',
                label: 'Health',
                flex: 1,
                render: row => (
                  <HealthBadge
                    blocked={row.blocked}
                    blockedReason={row.blocked_reason}
                    daysRemaining={row.days_remaining}
                    size="sm"
                    showHealthy={false}
                  />
                ),
              },
              {
                key: 'owner',
                label: 'Owner',
                flex: 1.2,
                render: row =>
                  row.owner_name ? (
                    <Text className="text-typography-main text-xs font-semibold" numberOfLines={1}>
                      {row.owner_name}
                    </Text>
                  ) : (
                    <Text className="text-typography-dim text-xs">Nobody yet</Text>
                  ),
              },
              {
                key: 'tracked',
                label: 'Tracked',
                flex: 1,
                align: 'right',
                render: row => (
                  <View className="items-end">
                    <Text className="text-typography-main text-xs font-bold">{formatCompact(row.tracked_seconds)}</Text>
                    <Text className="text-typography-dim text-[10px] mt-0.5">
                      {row.estimated_hours != null ? `of ${row.estimated_hours}h est.` : 'no estimate'}
                    </Text>
                  </View>
                ),
              },
            ]}
            onItemPress={row => {
              onClose();
              router.push(`/projects/${row.id}` as any);
            }}
            storageKey="portfolio-projects"
            search={{ value: search, onChange: setSearch, placeholder: 'Search projects' }}
            loading={loading}
            statusBanner={
              error
                ? {
                    tone: 'danger',
                    title: rpcMissing ? 'Projects can’t load on this environment' : 'Projects couldn’t load',
                    body: rpcMissing
                      ? 'The projects backend hasn’t been deployed here yet. Ask an admin to run the pending migrations.'
                      : error,
                  }
                : null
            }
            emptyState={{
              icon: 'inbox',
              title: search.trim() ? 'No projects match that' : 'No projects in this portfolio yet',
              body: search.trim() ? 'Try a shorter word, or clear the search to see everything.' : undefined,
            }}
            style={{ flex: 1 }}
          />
        </View>
      )}
    </Popup>
  );
}

/**
 * The grid card for MultiViewList's `large` and `medium` densities.
 *
 * Deliberately NOT a touchable: MultiViewList's GridBody wraps renderCard in
 * its own row-level TouchableOpacity (which carries the press + the
 * accessibilityRole), so a card with its own onPress would double-fire and
 * — with accessibilityRole="button" — nest a <button> inside a <button> on
 * web (the exact LogBox error this issue also fixed in PortfolioGrid's cards
 * — see the comment there and ProjectCard in EntityUI.tsx).
 */
function PortfolioProjectCard({
  row,
  density,
}: {
  row: PortfolioProjectRow;
  density: 'large' | 'medium';
}) {
  const c = useThemeColors();

  if (density === 'medium') {
    return (
      <View className="bg-surface-card border border-surface-border rounded-2xl p-3" style={{ gap: 8 }}>
        <View className="flex-row items-center gap-2.5">
          <EntityGlyph kind="project" size={26} color={row.color} />
          <View className="flex-1 min-w-0">
            <Text className="text-typography-main text-sm font-black" numberOfLines={1}>
              {row.name}
            </Text>
            <ClientMark name={row.client_name} size={13} />
          </View>
        </View>
        <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
          <StageChip size="sm" name={row.stage_name} color={row.stage_color} />
          <Text className="text-typography-muted text-[10px]">
            {row.days_in_current_stage == null ? '—' : `${row.days_in_current_stage}d`}
          </Text>
        </View>
        <ProgressMeter
          done={row.tasks_done}
          total={row.tasks_total}
          percent={row.weighted_progress}
          tone={row.blocked ? c.danger : undefined}
          showCaption={false}
          height={4}
        />
      </View>
    );
  }

  return (
    <View className="bg-surface-card border border-surface-border rounded-2xl p-4" style={{ gap: 10 }}>
      <View className="flex-row items-start gap-2.5">
        <EntityGlyph kind="project" size={30} color={row.color} />
        <View className="flex-1 min-w-0">
          <Text className="text-typography-main font-bold text-sm leading-5" numberOfLines={2}>
            {row.name}
          </Text>
          <View className="mt-0.5">
            <ClientMark name={row.client_name} portfolioName={row.portfolio_name} size={15} />
          </View>
        </View>
      </View>

      <View className="flex-row items-center flex-wrap gap-1.5">
        <StageChip size="sm" name={row.stage_name} color={row.stage_color} />
        <Text className="text-[11px] font-semibold" style={{ color: ageColor(row.days_in_current_stage ?? null, c) }}>
          {row.days_in_current_stage == null ? 'Not staged yet' : `${row.days_in_current_stage}d here`}
        </Text>
      </View>

      <ProgressMeter done={row.tasks_done} total={row.tasks_total} percent={row.weighted_progress} tone={row.blocked ? c.danger : undefined} height={6} />

      <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
        <Text className="text-[11px] font-semibold" style={{ color: dueColor(row.days_remaining ?? null, c) }}>
          {fmtDue(row.days_remaining ?? null, row.due_date)}
        </Text>
        {row.owner_name ? (
          <Text className="text-typography-muted text-[11px] font-semibold flex-shrink" numberOfLines={1}>
            <FontAwesome name="user" size={9} color={c.textMuted} />
            {' '}{row.owner_name}
          </Text>
        ) : (
          <Text className="text-typography-dim text-[11px]">Nobody assigned</Text>
        )}
      </View>
    </View>
  );
}