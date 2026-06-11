import SkeletonBlock, { SkeletonList } from '@/components/Skeleton';
import ActivityLog from '@/components/task-detail/ActivityLog';
import ChildPipelinesPanel from '@/components/task-detail/ChildPipelinesPanel';
import CommentsSection from '@/components/task-detail/CommentsSection';
import EvidencePanel from '@/components/task-detail/EvidencePanel';
import PeoplePanel from '@/components/task-detail/PeoplePanel';
import PipelineJourney from '@/components/task-detail/PipelineJourney';
import StageActions from '@/components/task-detail/StageActions';
import TaskBriefPanel from '@/components/task-detail/TaskBriefPanel';
import TaskHeader from '@/components/task-detail/TaskHeader';
import TaskMetadata from '@/components/task-detail/TaskMetadata';
import TimerPanel from '@/components/task-detail/TimerPanel';
import { TaskDetailProvider, useTaskDetail } from '@/contexts/TaskDetailContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { RefreshControl, ScrollView, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';

function TaskDetailContent() {
  const { data, loading, error, refresh } = useTaskDetail();
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const isDesktop = width > 768;
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  // Loading state
  if (loading) {
    return (
      <View className="flex-1 bg-surface-background px-4 pt-6">
        <SkeletonBlock height={28} borderRadius={10} style={{ width: '60%', marginBottom: 16 }} />
        <SkeletonBlock height={14} borderRadius={8} style={{ width: '40%', marginBottom: 20 }} />

        <ScrollView>
          <View style={{ gap: 12 }}>
            <SkeletonList count={2} itemHeight={120} />
            <SkeletonList count={3} itemHeight={80} />
          </View>
        </ScrollView>
      </View>
    );
  }

  // Permission denied
  if (error === 'ACCESS_DENIED' || (!loading && !data)) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center p-10">
        <View className="bg-state-danger/10 p-6 rounded-full mb-6 border border-state-danger/20">
          <FontAwesome name="lock" size={48} color={colors.danger} />
        </View>
        <Text className="text-typography-main font-black text-2xl mt-4">Access Denied</Text>
        <Text className="text-typography-muted text-center mt-2 leading-6">
          You do not have permission to view this task. You must be assigned, the creator, a manager, or have the{' '}
          <Text className="text-brand-primary font-bold">task.view_detail</Text> permission.
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          className="mt-8 bg-surface-card px-8 py-4 rounded-xl border border-surface-border active:opacity-80"
        >
          <Text className="text-typography-main font-black">Return</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Error state
  if (error) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center p-10">
        <FontAwesome name="exclamation-triangle" size={48} color={colors.warning} />
        <Text className="text-typography-main font-black text-xl mt-4">Something went wrong</Text>
        <Text className="text-typography-muted text-center mt-2">{error}</Text>
        <TouchableOpacity
          onPress={refresh}
          className="mt-6 bg-brand-primary px-6 py-3 rounded-xl"
        >
          <Text className="text-typography-main font-black">Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ═════════════════════════════════════════════════
  // MOBILE LAYOUT (with ergonomic bottom timer)
  // ═════════════════════════════════════════════════
  return (
    <View className="flex-1 bg-surface-background">
      <TaskHeader />
      
      <ScrollView
        className="flex-1 px-4 py-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View className="gap-4 pb-32">
          {/* Priority: what the assignee needs first — brief, the work itself, proofs, discussion */}
          <TaskBriefPanel />
          <StageActions />
          <EvidencePanel />
          <CommentsSection />

          {/* Secondary: collapsed by default to keep the screen calm */}
          <PeoplePanel />
          <ChildPipelinesPanel />
          <PipelineJourney />
          <ActivityLog />
          <TaskMetadata />
        </View>
      </ScrollView>

      {/* Floating Timer Panel for Mobile Ergonomics */}
      <View className="absolute bottom-6 left-0 right-0 px-4">
        <TimerPanel />
      </View>
    </View>
  );
}

export default function TaskDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();

  if (!id) return null;

  return (
    <TaskDetailProvider taskId={id}>
      <Stack.Screen options={{ headerShown: false }} />
      <TaskDetailContent />
    </TaskDetailProvider>
  );
}
