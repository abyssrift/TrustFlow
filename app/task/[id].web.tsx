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
import { useTheme } from '@/contexts/ThemeContext';
import { getDangerColor, getPrimaryColor, getWarningColor } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';

function TaskDetailContentWeb() {
  const { data, loading, error, refresh } = useTaskDetail();
  const { theme: activeTheme } = useTheme();
  const router = useRouter();
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center">
        <ActivityIndicator size="large" color={getPrimaryColor(activeTheme)} />
        <Text className="text-typography-muted mt-6 font-black uppercase tracking-widest text-xs">Synchronizing Task Data...</Text>
      </View>
    );
  }

  if (error === 'ACCESS_DENIED' || (!loading && !data)) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center p-20">
        <View className="bg-state-danger/10 p-12 rounded-[40px] mb-8 border border-state-danger/20">
          <FontAwesome name="lock" size={64} color={getDangerColor(activeTheme)} />
        </View>
        <Text className="text-typography-main font-black text-4xl tracking-tighter">Security Clearance Required</Text>
        <Text className="text-typography-muted text-center mt-4 max-w-lg leading-7 font-medium">
          Your current credentials do not grant access to this tactical asset. Ensure you are assigned to this deployment or possess the <Text className="text-brand-primary font-black">task.view_detail</Text> authorization.
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          className="mt-10 bg-brand-primary px-12 py-5 rounded-2xl premium-shadow active:scale-95 transition-transform"
        >
          <Text className="text-white font-black uppercase tracking-widest">Return to Base</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center p-20">
        <View className="bg-state-warning/10 p-10 rounded-full mb-6">
           <FontAwesome name="exclamation-triangle" size={48} color={getWarningColor(activeTheme)} />
        </View>
        <Text className="text-typography-main font-black text-2xl tracking-tight">Telemetry Interrupted</Text>
        <Text className="text-typography-muted text-center mt-2 font-medium">{error}</Text>
        <TouchableOpacity
          onPress={refresh}
          className="mt-8 bg-surface-card px-8 py-4 rounded-xl border border-surface-border"
        >
          <Text className="text-typography-main font-black uppercase tracking-widest text-xs">Retry Uplink</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface-background">
      <TaskHeader />
      <View className="flex-1 flex-row">
        {/* LEFT: Main Operational Area */}
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={getPrimaryColor(activeTheme)} />}
        >
          <View className="p-10 max-w-[1000px] mx-auto w-full gap-8 pb-20">
            <TaskBriefPanel />
            <StageActions />
            <EvidencePanel />
            <CommentsSection />
          </View>
        </ScrollView>

        {/* RIGHT: Strategic Metadata Sidebar */}
        <View className="w-[450px] border-l border-surface-border bg-surface-card/30">
          <ScrollView
            showsVerticalScrollIndicator={false}
            className="p-8 space-y-8"
          >
            <TaskMetadata />
            <TimerPanel />
            <PeoplePanel />
            <ChildPipelinesPanel />
            <PipelineJourney />
            <ActivityLog />
            <View className="h-20" />
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

export default function TaskDetailPageWeb() {
  const { id } = useLocalSearchParams<{ id: string }>();

  if (!id) return null;

  return (
    <TaskDetailProvider taskId={id}>
      <Stack.Screen options={{ headerShown: false }} />
      <TaskDetailContentWeb />
    </TaskDetailProvider>
  );
}
