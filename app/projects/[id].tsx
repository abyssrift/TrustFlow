import ProjectFilesTab from '@/components/projects/ProjectFilesTab';
import ProjectHeader from '@/components/projects/ProjectHeader';
import ProjectOverviewTab from '@/components/projects/ProjectOverviewTab';
import ProjectWorkTab from '@/components/projects/ProjectWorkTab';
import { SkeletonBlock, SkeletonList } from '@/components/Skeleton';
import { ProjectDetailProvider, useProjectDetail } from '@/contexts/ProjectDetailContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

// #184 -- /projects/[id] route: name/stage/flags header + Overview/Work/Files
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

type TabKey = 'overview' | 'work' | 'files';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'work', label: 'Work' },
  { key: 'files', label: 'Files' },
];

function ProjectDetailContent() {
  const colors = useThemeColors();
  const router = useRouter();
  const { loading, notFound } = useProjectDetail();
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  // Restore tab from URL param on mount -- same as FileHub's tab restore effect.
  useEffect(() => {
    if (tabParam && TABS.some(t => t.key === tabParam)) {
      setActiveTab(tabParam as TabKey);
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
      <View className="flex-1 bg-surface-background items-center justify-center p-10">
        <View className="bg-surface-card p-6 rounded-full mb-6 border border-surface-border">
          <FontAwesome name="question-circle-o" size={48} color={colors.textMuted} />
        </View>
        <Text className="text-typography-main font-black text-2xl mt-4">Project not found</Text>
        <Text className="text-typography-muted text-center mt-2 leading-6 max-w-sm">
          This project doesn't exist, or has been removed.
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          className="mt-8 bg-surface-card px-8 py-4 rounded-xl border border-surface-border active:opacity-80"
          style={{ minHeight: 44 }}
        >
          <Text className="text-typography-main font-black">Back to Projects</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface-background">
      <ProjectHeader />

      {/* Tabs -- same visual language as FileHub's tab bar
          (_filehub_desktop.tsx). Only 3 short labels, so a plain flex-row
          fits at 390px without needing a horizontal ScrollView. */}
      <View className="px-4 md:px-8 pt-4 pb-3 flex-row items-center gap-2 border-b border-surface-border">
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => handleTabChange(tab.key)}
            style={{ minHeight: 44 }}
            className={`flex-row items-center gap-2 px-5 rounded-xl border justify-center ${
              activeTab === tab.key
                ? 'bg-brand-primary/10 border-brand-primary/30'
                : 'bg-surface-card border-surface-border hover:bg-surface-overlay'
            }`}
          >
            <Text className={`text-sm font-black ${activeTab === tab.key ? 'text-brand-primary' : 'text-typography-muted'}`}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {activeTab === 'overview' && <ProjectOverviewTab />}
        {activeTab === 'work' && <ProjectWorkTab />}
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
