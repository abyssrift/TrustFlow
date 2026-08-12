import ProjectFilesTab from '@/components/projects/ProjectFilesTab';
import ProjectHeader from '@/components/projects/ProjectHeader';
import ProjectOverviewTab from '@/components/projects/ProjectOverviewTab';
import ProjectAssignmentsTab from '@/components/projects/ProjectAssignmentsTab';
import { SkeletonBlock, SkeletonList } from '@/components/Skeleton';
import { EntityEmptyState, SegmentedControl } from '@/components/entities/EntityUI';
import { ProjectDetailProvider, useProjectDetail } from '@/contexts/ProjectDetailContext';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

// #184 -- /projects/[id] route: name/stage/flags header + Overview/Assignments/Files
// tab shell. Tab state lives in the URL (?tab=) via the same
// useLocalSearchParams/router.setParams pattern FileHub already established
// for its ?tab=/?file= deep links (_filehub_desktop.tsx / _filehub_adaptive.tsx)
// -- reload-on-deep-link and back-button behaviour come for free from
// expo-router's own history, exactly like FileHub's.
//
// Deliberately ONE file, not a .tsx/.web.tsx split like app/task/[id].tsx --
// that split exists there because desktop web wants a genuinely different
// arrangement (2-pane sidebar) from native/mobile-web (stacked column). This
// route has no such divergence: the tab bar and each tab's content
// (ProjectOverviewTab's panels use flexBasis 360 + flexWrap) already reflow
// to a single column under a width threshold on every platform, so one
// width-aware component serves both. If a tab's real content (#183/#182/#174)
// later needs a genuinely different desktop arrangement, split then.

type TabKey = 'overview' | 'assignments' | 'files';
// #198: this tab was "Work" until the screen was rebuilt around "who is on
// what". The key is in the URL, so ?tab=work is still accepted below rather
// than silently dropping anyone holding an old link back to Overview.
const LEGACY_TABS: Record<string, TabKey> = { work: 'assignments' };
// Phase 8 (#187): icons on the tabs, and the same `SegmentedControl` the
// projects list uses for its view switch — three separately-outlined
// pill buttons read as three competing actions rather than one control.
const TABS: { value: TabKey; label: string; icon: string }[] = [
  { value: 'overview', label: 'Overview', icon: 'th-large' },
  { value: 'assignments', label: 'Assignments', icon: 'users' },
  { value: 'files', label: 'Files', icon: 'folder-o' },
];

function ProjectDetailContent() {
  const router = useRouter();
  const { loading, notFound } = useProjectDetail();
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  // Restore tab from URL param on mount -- same as FileHub's tab restore effect.
  useEffect(() => {
    const key = tabParam ? (LEGACY_TABS[tabParam] ?? tabParam) : undefined;
    if (key && TABS.some(t => t.value === key)) {
      setActiveTab(key as TabKey);
    }
  }, []);

  const handleTabChange = (key: TabKey) => {
    setActiveTab(key);
    router.setParams({ tab: key });
  };

  if (loading) {
    return (
      <View className="flex-1 bg-surface-background px-4 md:px-8 pt-6">
        <SkeletonBlock height={32} borderRadius={10} style={{ width: '50%', marginBottom: 12 }} />
        <SkeletonBlock height={14} borderRadius={8} style={{ width: '30%', marginBottom: 24 }} />
        <SkeletonList count={4} itemHeight={90} />
      </View>
    );
  }

  // Denial and non-existence are folded into the same branch, on purpose --
  // #186 settled that a distinguishable "you can't see this" discloses that
  // the project exists. No lock icon, no permission copy, same message a
  // genuinely deleted/never-existed id would get.
  if (notFound) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center p-6">
        <EntityEmptyState
          kind="project"
          title="This project isn’t here"
          body="It doesn’t exist, or it has been archived or removed. If you were sent this link, ask whoever sent it to check."
          secondaryLabel="Back to projects"
          // navigate, not back(): the copy above says "if you were sent this
          // link" — someone arriving from a shared URL has NO history, so
          // back() would do nothing at all on the one screen whose entire job
          // is offering a way out.
          onSecondary={() => router.navigate('/projects')}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface-background">
      <ProjectHeader />

      {/* Only 3 short labels, so a plain row fits at 390px without needing a
          horizontal ScrollView. */}
      <View className="px-4 md:px-8 pt-3 pb-3 border-b border-surface-border">
        <SegmentedControl options={TABS} value={activeTab} onChange={handleTabChange} />
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {activeTab === 'overview' && <ProjectOverviewTab />}
        {activeTab === 'assignments' && <ProjectAssignmentsTab />}
        {activeTab === 'files' && <ProjectFilesTab />}
      </ScrollView>
    </View>
  );
}

export default function ProjectDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();

  if (!id) return null;

  return (
    <ProjectDetailProvider projectId={id}>
      <Stack.Screen options={{ headerShown: false }} />
      <ProjectDetailContent />
    </ProjectDetailProvider>
  );
}
