import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';

import { EntityGlyph, EntityTag, MetaStat, ProgressMeter, fmtDate } from '@/components/entities/EntityUI';
import PortfolioEditModal from '@/components/portfolios/PortfolioEditModal';
import { useAuth } from '@/contexts/AuthContext';
import { usePortfolios } from '@/hooks/usePortfolios';
import { useThemeColors } from '@/hooks/useThemeColors';

/**
 * The portfolio bar that sits ABOVE the projects screen when it is scoped to
 * one batch (Phase 10, #191).
 *
 * WHY THIS IS NOT A SCREEN. /portfolios/[id] used to be its own hand-built
 * list — a direct select on `projects` rendered as cards, with no search, no
 * stage filter, no board, no timeline, no sorting, no paging. Opening a batch
 * therefore dropped you into a strictly worse version of the screen you
 * already had. The owner's words: "i was hoping the portfolio would just be
 * ABOVE projects, but not a whole different directory / category... portfolios
 * are composed of projects after all". So this component is exactly that —
 * the portfolio's identity and rollup, above the projects screen, which does
 * all the actual work with `p_portfolio_id` set.
 *
 * The numbers come from rpc_portfolios_table, the SAME rollup the grid card
 * you clicked showed, so opening a batch can never disagree with the card that
 * got you here. Nothing here derives a forecast — `projected_end` /
 * `confidence` are read straight off the row (§16.1/§16.2).
 *
 * Path A (unified responsive): one component, `wide` only changes glyph size,
 * type scale and padding. There is no desktop-only affordance to replace.
 */
export default function PortfolioScopeHeader({
  portfolioId,
  onAllProjects,
  onClose,
  actions,
}: {
  portfolioId: string;
  /** The one obvious way back to every project. */
  onAllProjects: () => void;
  /**
   * Modal variant (issue #260): when set, the leading button becomes a Close
   * affordance instead of "All projects". The identity + rollup band below is
   * the same either way — a portfolio presented in the open-portfolio modal
   * must show exactly the numbers the grid card showed.
   */
  onClose?: () => void;
  /** Rendered flush right on the identity row — same row, no extra height. */
  actions?: React.ReactNode;
}) {
  const c = useThemeColors();
  const { width } = useWindowDimensions();
  const { hasPermission } = useAuth();
  const wide = width >= 1024;
  const [editing, setEditing] = useState(false);
  const [coverBroken, setCoverBroken] = useState(false);

  // Mounted only when scoped, so the unscoped projects screen never pays for
  // this fetch. usePortfolios is the same reader the grid uses.
  const { rows, loading, refresh } = usePortfolios('');
  const p = rows.find(r => r.id === portfolioId);
  const canEdit = hasPermission('project.edit');

  useEffect(() => setCoverBroken(false), [p?.cover_url]);

  const pct = p && p.projects_total > 0 ? (p.projects_done / p.projects_total) * 100 : 0;

  return (
    <View style={{ gap: 8 }}>
      {/* flex-wrap: on a narrow phone, back button + glyph + title + the
          action buttons (all fixed-width except the title) don't fit one
          row — wrapping drops actions to their own line instead of crushing
          the title to unreadable width (title's flex:1/minWidth:0 would
          otherwise shrink to make room rather than wrap). */}
      <View className="flex-row flex-wrap items-center" style={{ gap: 12 }}>
        <TouchableOpacity
          onPress={onClose ?? onAllProjects}
          accessibilityRole="button"
          accessibilityLabel={onClose ? 'Close portfolio' : 'All projects'}
          className="bg-surface-card border border-surface-border rounded-xl flex-row items-center justify-center px-3.5 hover:bg-surface-overlay"
          style={{ minHeight: 44, gap: 8 }}
        >
          <FontAwesome name={onClose ? 'times' : 'arrow-left'} size={12} color={c.textMuted} />
          <Text className="text-typography-main text-sm font-semibold">{onClose ? 'Close' : 'All projects'}</Text>
        </TouchableOpacity>

        {p?.cover_url && !coverBroken ? (
          <Image
            source={{ uri: p.cover_url }}
            className="rounded-xl border border-surface-border"
            style={{ width: wide ? 44 : 34, height: wide ? 44 : 34 }}
            resizeMode="cover"
            onError={() => setCoverBroken(true)}
          />
        ) : (
          <EntityGlyph kind="portfolio" size={wide ? 44 : 34} />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <EntityTag kind="portfolio" />
          <View className="flex-row items-center" style={{ gap: 10 }}>
            <Text
              numberOfLines={2}
              className={`${wide ? 'text-2xl' : 'text-xl'} text-typography-main font-black tracking-tight flex-shrink`}
            >
              {p?.name ?? (loading ? 'Loading…' : 'Portfolio')}
            </Text>
            {canEdit && p && (
              <Pressable
                onPress={() => setEditing(true)}
                accessibilityRole="button"
                accessibilityLabel={`Edit portfolio ${p.name}`}
                className="items-center justify-center rounded-full border border-surface-border hover:bg-surface-overlay"
                style={{ width: 44, height: 44, backgroundColor: c.card }}
              >
                <FontAwesome name="pencil" size={13} color={c.textMuted} />
              </Pressable>
            )}
          </View>
        </View>

        {actions && (
          <View className="flex-row items-center flex-shrink-0" style={{ gap: 8 }}>
            {actions}
          </View>
        )}
      </View>

      {loading && !p ? (
        <View className="items-center py-3">
          <ActivityIndicator color={c.primary} />
        </View>
      ) : p ? (
        <View style={{ gap: 6 }}>
          <View className="flex-row flex-wrap items-center" style={{ gap: wide ? 20 : 14 }}>
            <MetaStat label="Finished" value={`${p.projects_done}/${p.projects_total}`} />
            <MetaStat label="Tasks" value={`${p.tasks_done}/${p.tasks_total}`} />
            <MetaStat label="Blocked" value={String(p.projects_blocked)} />
            <MetaStat label="Next due" value={p.next_due ? fmtDate(p.next_due) : '—'} />
            <MetaStat
              label="Projected finish"
              value={p.confidence === 'none' || !p.projected_end ? 'Not enough history' : fmtDate(p.projected_end)}
            />
            {!!p.template_name && <MetaStat label="Template" value={p.template_name} />}
            <View style={{ flex: 1, minWidth: 120 }}>
              <ProgressMeter
                done={p.projects_done}
                total={p.projects_total}
                percent={pct}
                tone={p.projects_blocked > 0 ? c.warning : undefined}
                showCaption={false}
                height={6}
              />
            </View>
          </View>
          {p.confidence === 'low' && !!p.projected_end && (
            <View className="flex-row items-start" style={{ gap: 6 }}>
              <FontAwesome name="info-circle" size={11} color={c.textDim} style={{ marginTop: 2 }} />
              <Text className="text-typography-muted text-[11px] flex-1 leading-4">
                Some projects in this batch don’t have enough history to forecast, so treat this as the earliest it
                could finish rather than a date to plan around.
              </Text>
            </View>
          )}
        </View>
      ) : null}

      <PortfolioEditModal
        visible={editing}
        onClose={() => setEditing(false)}
        onSaved={refresh}
        portfolio={p ? { id: p.id, name: p.name, cover_url: p.cover_url, target_date: p.target_date } : null}
      />
    </View>
  );
}
