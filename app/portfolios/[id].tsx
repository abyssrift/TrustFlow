import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, Text, View, useWindowDimensions } from 'react-native';

import { BackButton } from '@/components/common/BackButton';
import {
  EntityEmptyState,
  EntityGlyph,
  EntityTag,
  MetaStat,
  ProgressMeter,
  ProjectCard,
  fmtDate,
  type ProjectCardRow,
} from '@/components/entities/EntityUI';
import { supabase } from '@/lib/supabase';
import { useThemeColors } from '@/hooks/useThemeColors';
import { usePortfolios } from '@/hooks/usePortfolios';
import { TAB_BAR_HEIGHT } from '@/lib/layout';

/**
 * /portfolios/[id] — what is actually inside one batch (Phase 10, #191).
 *
 * The project list is a DIRECT query on `projects`, not a new SECURITY DEFINER
 * reader. That is deliberate and is not a sixth definition of "who can see a
 * project": projects_select is default-deny since #186, so the rows this
 * returns are exactly the rows the caller is allowed anywhere else. Adding a
 * definer function here would be the thing plan §13.14 exists to prevent.
 *
 * The header numbers come from rpc_portfolios_table — the same rollup the grid
 * card showed — so opening a portfolio can never disagree with the card you
 * clicked to get here.
 */
export default function PortfolioDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useThemeColors();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  const isLargeScreen = width > 768;

  const { rows: portfolios, loading: headerLoading } = usePortfolios('');
  const header = portfolios.find(p => p.id === id);

  const [projects, setProjects] = useState<ProjectCardRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProjects = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data } = await supabase
      .from('projects')
      .select('id, name, color, due_date, owner_id, blocked, blocked_reason, client:client_id(name), stage:current_stage_id(name, color)')
      .eq('portfolio_id', id)
      .is('deleted_at', null)
      .order('name');

    setProjects(
      (data ?? []).map((p: any) => {
        const stage = Array.isArray(p.stage) ? p.stage[0] : p.stage;
        const client = Array.isArray(p.client) ? p.client[0] : p.client;
        return {
          id: p.id,
          name: p.name,
          color: p.color,
          client_name: client?.name ?? null,
          stage_name: stage?.name ?? null,
          stage_color: stage?.color ?? null,
          due_date: p.due_date,
          blocked: p.blocked ?? false,
          blocked_reason: p.blocked_reason ?? null,
        } as ProjectCardRow;
      })
    );
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const pct = header && header.projects_total > 0 ? (header.projects_done / header.projects_total) * 100 : 0;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-1 bg-surface-background">
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            padding: isLargeScreen ? 24 : 16,
            paddingBottom: isWeb ? 48 : TAB_BAR_HEIGHT.native + 24,
          }}
        >
          <View className="w-full" style={{ maxWidth: 1600, alignSelf: 'center' }}>
            <View className="flex-row items-center mb-5" style={{ gap: 12 }}>
              <BackButton />
              <EntityGlyph kind="portfolio" size={isLargeScreen ? 44 : 34} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <EntityTag kind="portfolio" />
                <Text
                  className={`${isLargeScreen ? 'text-2xl' : 'text-xl'} text-typography-main font-black tracking-tight`}
                  numberOfLines={2}
                >
                  {header?.name ?? (headerLoading ? 'Loading…' : 'Portfolio')}
                </Text>
              </View>
            </View>

            {header && (
              <View className="bg-surface-card border border-surface-border rounded-2xl p-4 mb-5" style={{ gap: 12 }}>
                <ProgressMeter
                  done={header.projects_done}
                  total={header.projects_total}
                  percent={pct}
                  tone={header.projects_blocked > 0 ? c.warning : undefined}
                  showCaption={false}
                  height={8}
                />
                <View className="flex-row flex-wrap" style={{ gap: 20 }}>
                  <MetaStat label="Finished" value={`${header.projects_done}/${header.projects_total}`} />
                  <MetaStat label="Tasks" value={`${header.tasks_done}/${header.tasks_total}`} />
                  <MetaStat label="Blocked" value={String(header.projects_blocked)} />
                  <MetaStat label="Next due" value={header.next_due ? fmtDate(header.next_due) : '—'} />
                  <MetaStat
                    label="Projected finish"
                    value={
                      header.confidence === 'none' || !header.projected_end
                        ? 'Not enough history'
                        : fmtDate(header.projected_end)
                    }
                  />
                  {!!header.template_name && <MetaStat label="Template" value={header.template_name} />}
                </View>
                {header.confidence === 'low' && !!header.projected_end && (
                  <View className="flex-row items-center" style={{ gap: 6 }}>
                    <FontAwesome name="info-circle" size={11} color={c.textDim} />
                    <Text className="text-typography-muted text-[11px]">
                      Some projects in this batch don’t have enough history to forecast, so treat this as the earliest
                      it could finish rather than a date to plan around.
                    </Text>
                  </View>
                )}
              </View>
            )}

            {loading ? (
              <View className="items-center py-16">
                <ActivityIndicator color={c.primary} />
              </View>
            ) : projects.length === 0 ? (
              <EntityEmptyState
                kind="project"
                title="Nothing visible in this batch"
                body="This portfolio has no projects you can open. If you expected some, ask an owner to grant you access to them."
              />
            ) : (
              <View className="flex-row flex-wrap" style={{ gap: 12 }}>
                {projects.map(p => (
                  <View
                    key={p.id}
                    style={{ flexGrow: 1, flexBasis: isLargeScreen ? 320 : ('100%' as any), maxWidth: isLargeScreen ? 520 : undefined }}
                  >
                    <ProjectCard row={p} onPress={() => router.push(`/projects/${p.id}` as any)} />
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </>
  );
}
