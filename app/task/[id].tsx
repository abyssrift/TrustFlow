import React from 'react';
import { View, Text, ScrollView, RefreshControl, ActivityIndicator, TouchableOpacity, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { TaskDetailProvider, useTaskDetail } from '@/contexts/TaskDetailContext';
import TaskHeader from '@/components/task-detail/TaskHeader';
import TimerPanel from '@/components/task-detail/TimerPanel';
import TaskMetadata from '@/components/task-detail/TaskMetadata';
import PeoplePanel from '@/components/task-detail/PeoplePanel';
import StageActions from '@/components/task-detail/StageActions';
import ChildPipelinesPanel from '@/components/task-detail/ChildPipelinesPanel';
import PipelineJourney from '@/components/task-detail/PipelineJourney';
import CommentsSection from '@/components/task-detail/CommentsSection';
import ActivityLog from '@/components/task-detail/ActivityLog';

function TaskDetailContent() {
  const { data, loading, error, refresh } = useTaskDetail();
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
      <View className="flex-1 bg-surface-background items-center justify-center">
        <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
        <Text className="text-typography-muted mt-4 font-bold">Loading task details...</Text>
      </View>
    );
  }

  // Permission denied
  if (error === 'ACCESS_DENIED' || (!loading && !data)) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center p-10">
        <View className="bg-state-danger/10 p-6 rounded-full mb-6 border border-state-danger/20">
          <FontAwesome name="lock" size={48} color="rgb(var(--state-danger))" />
        </View>
        <Text className="text-typography-main font-black text-2xl mt-4">Access Denied</Text>
        <Text className="text-typography-muted text-center mt-2 leading-6">
          You do not have permission to view this task. You must be assigned, the creator, a manager, or have the{' '}
          <Text className="text-brand-primary font-bold">tasks.view_all</Text> permission.
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
        <FontAwesome name="exclamation-triangle" size={48} color="rgb(var(--state-warning))" />
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
  // MOBILE LAYOUT (single column stacked)
  // ═════════════════════════════════════════════════
  return (
    <View className="flex-1 bg-surface-background">
      <TaskHeader />
      <TimerPanel />
      <ScrollView
        className="flex-1 px-4 py-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="rgb(var(--brand-primary))" />}
      >
        <View className="gap-4 pb-10">
          <TaskMetadata />
          <PeoplePanel />
          <ChildPipelinesPanel />
          <StageActions />
          <PipelineJourney />
          <CommentsSection />
          <ActivityLog />
        </View>
      </ScrollView>
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
