import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';

import {
  EntityEmptyState,
  EntityGlyph,
  MetaStat,
  ProgressMeter,
  ProjectCard,
  SectionCard,
  fmtDate,
  type ProjectCardRow,
} from '@/components/entities/EntityUI';
import { ErrorBanner } from '@/components/projects/ProjectsTable';
import { SkeletonList } from '@/components/Skeleton';
import { useThemeColors } from '@/hooks/useThemeColors';
import { usePortfolios, type PortfolioRow } from '@/hooks/usePortfolios';
import { hasProjection, isThinProjection } from '@/lib/projectTimeline';
import { supabase } from '@/lib/supabase';

/**
 * The project/portfolio lens on the Intelligence Overview (Phase 10, #191).
 *
 * It sits BESIDE the pipeline rollup, it does not replace it. The pipeline
 * widgets answer "how is the machine running over the last N days"; this
 * answers "how is this batch of work actually going, right now".
 *
 * ── NO SECOND READER, NO SECOND DEFINITION (§16.1) ─────────────────────────
 * Every number here comes from a reader another surface already uses:
 *   - portfolio rollups  -> rpc_portfolios_table, via usePortfolios(), the
 *     exact hook the /portfolios grid and the portfolio header read. Same
 *     rows, same "done" (a success-terminal stage), same projected end.
 *   - needs-attention    -> rpc_projects_table(p_blocked := TRUE), which is
 *     the SERVER's definition of attention ("blocked OR past its due date and
 *     not finished") and the same call the projects list makes for its
 *     "Needs attention" chip. Ordering is the RPC's own (most days stuck
 *     first) — not re-sorted here, or this screen and the list would disagree
 *     about which project is worst.
 * Nothing on this screen computes a pace, a forecast or a confidence. If a
 * number is wanted that these two do not return, the RPC grows a column.
 *
 * ── WHY IT IS SAFE TO AGGREGATE HERE (#185/#186) ───────────────────────────
 * An Intelligence rollup over many projects is exactly the shape that leaked
 * twice. Both RPCs apply public.fn_project_accessible() once, server-side, and
 * a portfolio with no accessible projects returns NO ROW rather than a row of
 * zeros — so this component cannot out-report the access model no matter what
 * it renders. It deliberately does not sum across portfolios: a cross-batch
 * total would be a number no other surface shows, i.e. a fourth thing that can
 * disagree. See supabase/checks/20260805_intelligence_project_lens_check.sql.
 *
 * ── NO SECOND DATE CONTROL (#139) ──────────────────────────────────────────
 * The shared calendar range picker above filters time-window metrics. These
 * are state-of-now facts (what is blocked, what is late, what is forecast),
 * which a date range does not mean anything for — so the lens adds no control
 * of its own and says out loud that the range does not apply to it.
 *
 * PATH A (unified responsive, ui-consistency.md §3): one component. The two
 * panels sit side by side when there is room and stack when there is not; the
 * cards, numbers and 44px tap targets are identical either way. There is no
 * desktop idiom here that turns hostile on a phone, which is what would
 * justify Path B.
 */

const PORTFOLIO_ROWS = 5;
const ATTENTION_ROWS = 6;

/** Both RPCs raise this shape when the caller lacks project.view. */
const isDenied = (msg?: string | null) => /insufficient permissions/i.test(msg || '');

export default function ProjectLens() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const sideBySide = width >= 900;

  const { rows: portfolios, loading: pfLoading, error: pfError, denied: pfDenied } = usePortfolios();

  const [attention, setAttention] = useState<ProjectCardRow[]>([]);
  const [attLoading, setAttLoading] = useState(true);
  const [attError, setAttError] = useState<string | null>(null);
  const [attDenied, setAttDenied] = useState(false);
  const [rpcMissing, setRpcMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // p_blocked := TRUE is the server's "needs attention", not a blocked-flag
      // filter — see rpc_projects_table's own comment. One extra row is fetched
      // so "there are more" can be honest without a second count query.
      const { data, error } = await supabase.rpc('rpc_projects_table', {
        p_search: null,
        p_stage_id: null,
        p_blocked: true,
        p_limit: ATTENTION_ROWS + 1,
        p_offset: 0,
      });
      if (cancelled) return;
      if (error) {
        setAttDenied(isDenied(error.message));
        setRpcMissing(error.code === 'PGRST202' || /could not find the function|does not exist/i.test(error.message || ''));
        setAttError(error.message);
        setAttention([]);
      } else {
        setAttDenied(false);
        setRpcMissing(false);
        setAttError(null);
        setAttention((data as ProjectCardRow[]) || []);
      }
      setAttLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const moreAttention = attention.length > ATTENTION_ROWS;

  return (
    <View style={{ gap: 12 }}>
      <View className="flex-row items-center flex-wrap gap-x-3 gap-y-1">
        <Text className="text-typography-main font-black text-lg tracking-tight">Work in flight</Text>
        {/* §14.2 — say what this is measured over, or it reads as being filtered
            by the range picker above, which it is not. */}
        <Text className="text-typography-muted text-[11px]">
          As things stand right now — the date range above applies to the pipeline metrics, not to these.
        </Text>
      </View>

      {/* Two panels side by side when there is room, stacked when there is not.
          `flex-1` is applied ONLY in row mode on purpose: a flex-1 child in an
          auto-height column inside a ScrollView collapses to zero height on
          native. */}
      <View className={sideBySide ? 'flex-row items-start' : ''} style={{ gap: 16 }}>
        <View className={sideBySide ? 'flex-1' : ''}>
          <SectionCard
            kind="portfolio"
            title="Batches of work"
            hint="Rolled up over only the projects you can open."
            right={
              <TouchableOpacity
                onPress={() => router.push('/portfolios' as any)}
                accessibilityRole="button"
                accessibilityLabel="Open all portfolios"
                className="px-3 rounded-xl border border-surface-border hover:bg-surface-overlay items-center justify-center"
                style={{ minHeight: 44 }}
              >
                <Text className="text-typography-main text-[11px] font-bold">All portfolios</Text>
              </TouchableOpacity>
            }
          >
            {pfLoading && portfolios.length === 0 ? (
              <SkeletonList count={3} itemHeight={56} />
            ) : pfDenied ? (
              <DeniedNotice
                what="portfolios"
                body="Portfolios roll up projects, and projects are only shown to the people working on them. Ask an admin for access if you need this view."
              />
            ) : pfError ? (
              <Text className="text-state-danger text-xs font-bold">{pfError}</Text>
            ) : portfolios.length === 0 ? (
              <EntityEmptyState
                kind="portfolio"
                compact
                title="No batches to report on"
                body="A portfolio is one batch of work created together — from a spreadsheet import or a template. Once you have one you can open, its progress is summarised here."
              />
            ) : (
              <View style={{ gap: 4 }}>
                {portfolios.slice(0, PORTFOLIO_ROWS).map(p => (
                  <PortfolioLine key={p.id} row={p} onPress={() => router.push(`/portfolios/${p.id}` as any)} />
                ))}
                {portfolios.length > PORTFOLIO_ROWS && (
                  <Text className="text-typography-dim text-[11px] mt-1">
                    {portfolios.length - PORTFOLIO_ROWS} more on the portfolios screen.
                  </Text>
                )}
              </View>
            )}
          </SectionCard>
        </View>

        <View className={sideBySide ? 'flex-1' : ''}>
          <SectionCard
            kind="project"
            title="Needs attention"
            hint="Blocked, or past its due date and not finished — the same filter the projects list uses."
          >
            {attLoading ? (
              <SkeletonList count={2} itemHeight={120} />
            ) : attDenied ? (
              <DeniedNotice
                what="projects"
                body="Projects are shown to the people assigned to them, their owner, and anyone with view-all. Ask an admin if you should be seeing these."
              />
            ) : attError ? (
              <ErrorBanner rpcMissing={rpcMissing} error={attError} />
            ) : attention.length === 0 ? (
              <EntityEmptyState
                kind="project"
                compact
                title="Nothing needs you right now"
                body="No project you can open is blocked or past its due date. This list fills up on its own when one is."
              />
            ) : (
              <View style={{ gap: 10 }}>
                {attention.slice(0, ATTENTION_ROWS).map(r => (
                  <ProjectCard key={r.id} row={r} onPress={() => router.push(`/projects/${r.id}` as any)} showOwner />
                ))}
                {moreAttention && (
                  <TouchableOpacity
                    onPress={() => router.push('/projects' as any)}
                    accessibilityRole="button"
                    className="rounded-xl border border-surface-border hover:bg-surface-overlay items-center justify-center"
                    style={{ minHeight: 44 }}
                  >
                    <Text className="text-brand-primary text-xs font-bold">See the rest in Projects</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </SectionCard>
        </View>
      </View>
    </View>
  );
}

/**
 * One batch, one line. Same vocabulary as the portfolio card (glyph, meter,
 * the same three numbers) at list density — deliberately NOT a second card
 * design, and deliberately not a second set of numbers.
 */
function PortfolioLine({ row, onPress }: { row: PortfolioRow; onPress: () => void }) {
  const c = useThemeColors();
  const pct = row.projects_total > 0 ? (row.projects_done / row.projects_total) * 100 : 0;
  const allDone = row.projects_total > 0 && row.projects_done === row.projects_total;

  // The forecast gate is lib/projectTimeline's, not a local re-test of the
  // confidence string: 'none' means the server refused, and §16.2 says show no
  // date at all rather than a confident wrong one. 'low' is a real forecast but
  // it is drawn muted and labelled rough, never as a fact.
  const proj = { projected_end: row.projected_end, projection_confidence: row.confidence };
  const forecast = hasProjection(proj);
  const thin = isThinProjection(proj);

  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open portfolio ${row.name}`}
      className="rounded-xl px-2 py-2 hover:bg-surface-overlay/40 transition-colors"
      style={{ minHeight: 44, gap: 6 }}
    >
      <View className="flex-row items-center gap-2.5">
        <EntityGlyph kind="portfolio" size={24} />
        <Text numberOfLines={1} className="text-typography-main font-bold text-sm flex-1">{row.name}</Text>
        {row.projects_blocked > 0 && (
          <View className="flex-row items-center gap-1 rounded-full px-2 py-0.5" style={{ backgroundColor: c.danger + '1A' }}>
            <FontAwesome name="exclamation-circle" size={9} color={c.danger} />
            <Text className="text-[10px] font-black" style={{ color: c.danger }}>{row.projects_blocked}</Text>
          </View>
        )}
      </View>

      <ProgressMeter
        percent={pct}
        showCaption={false}
        height={5}
        tone={allDone ? c.success : row.projects_blocked > 0 ? c.warning : undefined}
      />

      <View className="flex-row flex-wrap gap-x-5 gap-y-1">
        <MetaStat label="Finished" value={`${row.projects_done} of ${row.projects_total}`} hint="Projects that reached a success stage" />
        <MetaStat label="Next due" value={row.next_due ? fmtDate(row.next_due) : 'No due date'} />
        <MetaStat
          label="Forecast"
          value={forecast ? fmtDate(row.projected_end) : 'Not enough history'}
          color={forecast ? (thin ? c.warning : undefined) : c.textDim}
          hint={
            forecast
              ? thin
                ? 'A rough estimate — some projects in this batch have thin history. Treat it as a direction, not a date.'
                : 'When the last project in this batch is forecast to finish'
              : 'Too few completed tasks to forecast a finish date'
          }
        />
      </View>
    </TouchableOpacity>
  );
}

/**
 * §14.2 / the brief's fourth rule: denied must not look like empty. An empty
 * state invites you to create something; this one tells you the data exists
 * and you are not on it.
 */
function DeniedNotice({ what, body }: { what: string; body: string }) {
  const c = useThemeColors();
  return (
    <View className="rounded-xl border border-surface-border bg-surface-background p-4 flex-row items-start gap-3">
      <FontAwesome name="lock" size={14} color={c.textMuted} style={{ marginTop: 2 }} />
      <View className="flex-1">
        <Text className="text-typography-main text-xs font-bold">You can’t see {what} here</Text>
        <Text className="text-typography-muted text-[11px] mt-1 leading-4">{body}</Text>
      </View>
    </View>
  );
}
