import { Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Platform, View } from 'react-native';

import ProjectsAdaptive from '@/components/tabs/_projects_adaptive';
import ProjectsWeb from '@/components/tabs/_projects_web';

/**
 * /portfolios/[id] — Phase 10 (#191). A portfolio is a FILTER over projects.
 *
 * WHAT THIS USED TO BE, AND WHY IT ISN'T ANY MORE. This route rendered its own
 * hand-built list: a direct `supabase.from('projects')` select mapped into
 * ProjectCards. No search, no stage filter, no sorting, no paging, no board,
 * no timeline, no row actions. Opening a batch dropped you into a strictly
 * worse version of the screen you'd just left. The owner:
 *
 *   "i was hoping the portfolio would just be ABOVE projects, but not a whole
 *    different directory / category. I really LOVE the projects screen, but i
 *    dont like how it just shows you every random project in the company...
 *    too much separation just confuses the user. portfolios are composed of
 *    projects after all"
 *
 * So this file is now a ROUTE, not a screen. It renders the projects screen —
 * the same component /(tabs)/projects renders — with `portfolioId` set, which
 * flows into `rpc_projects_table(p_portfolio_id => ...)` for all three views.
 * The rollup header survived (PortfolioScopeHeader); the duplicated list did
 * not. There is no second projects screen to keep in sync.
 *
 * ROUTE SHAPE — why a path segment, not `/(tabs)/projects?portfolio=<id>`:
 * this path already existed, is already what PortfolioGrid links to, is
 * already linkable and refresh-stable, and needs no param plumbing through the
 * tab layout. A query param would have meant BOTH: a param on the tab route
 * *and* something rendered at /portfolios/[id] anyway.
 *
 * Platform split mirrors app/(tabs)/projects.tsx exactly rather than importing
 * it — a route file importing another route file is how you accidentally
 * register a screen twice.
 */
export default function PortfolioScopedProjectsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-1 bg-surface-background">
        {Platform.OS === 'web' ? (
          <ProjectsWeb portfolioId={id} />
        ) : (
          <ProjectsAdaptive portfolioId={id} />
        )}
      </View>
    </>
  );
}
