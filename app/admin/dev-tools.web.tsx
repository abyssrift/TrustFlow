import { useAlert } from '@/contexts/AlertContext';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';

export default function DevToolsScreenWeb() {
  const router = useRouter();
  const { showAlert } = useAlert();
  const [loading, setLoading] = useState(false);
  const [seedProgress, setSeedProgress] = useState('');
  const [pipeline, setPipeline] = useState<any>(null);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const { data: pipe } = await supabase.from('pipelines').select('*').eq('is_default', true).limit(1).single();
      setPipeline(pipe);

      const { data: users } = await supabase
        .from('users')
        .select('id, full_name')
        .neq('id', (await supabase.auth.getUser()).data.user?.id || '');
      setTeamMembers(users || []);
    };
    fetchData();
  }, []);

  const logProgress = (msg: string) => {
    console.log(msg);
    setSeedProgress(prev => prev + '\n' + msg);
  };

  const clearTasks = async () => {
    if (!confirm('Clear all tasks? This action cannot be undone.')) return;

    setLoading(true);
    setSeedProgress('Clearing tasks...');
    const { error } = await supabase.from('tasks').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    setLoading(false);

    if (error) {
      logProgress(`❌ Error: ${error.message}`);
      showAlert('Error', error.message);
    } else {
      logProgress('✅ All tasks cleared');
      showAlert('Success', 'Cleared all tasks!');
    }
  };

  const seedQuick = async () => {
    setLoading(true);
    setSeedProgress('Starting quick seed (5 tasks)...');
    try {
      for (let i = 0; i < 5; i++) {
        logProgress(`Creating task ${i + 1}/5...`);
        await supabase.rpc('rpc_create_task', {
          p_title: `Dev Task ${Math.floor(Math.random() * 1000)}`,
          p_description: 'Auto-seeded for quick testing',
          p_priority: 'medium',
          p_pipeline_id: pipeline?.id
        });
      }
      logProgress('✅ Quick seed complete!');
      showAlert('Success', 'Seeded 5 quick tasks!');
    } catch (err: any) {
      logProgress(`❌ Error: ${err.message}`);
      showAlert('Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const seedComprehensive = async () => {
    setLoading(true);
    setSeedProgress('Starting comprehensive seed (30 tasks)...');
    try {
      const TASK_TEMPLATES = [
        { title: 'Review client proposal', description: 'Review and provide feedback on Q2 client deliverables', priority: 'high' },
        { title: 'Update documentation', description: 'Update API documentation with latest endpoints', priority: 'medium' },
        { title: 'Fix critical bug', description: 'Address issue in production affecting users', priority: 'urgent' },
        { title: 'Prepare financial report', description: 'Compile Q1 financial metrics and presentation', priority: 'high' },
        { title: 'Coordinate with marketing', description: 'Schedule meeting to align on messaging', priority: 'medium' },
        { title: 'Code review for backend', description: 'Review pull requests in auth module', priority: 'medium' },
        { title: 'Client support ticket', description: 'Respond to customer inquiry about integration', priority: 'high' },
        { title: 'Infrastructure optimization', description: 'Analyze database performance and optimize queries', priority: 'medium' },
        { title: 'Team onboarding', description: 'Prepare onboarding materials for new team members', priority: 'low' },
        { title: 'Security audit', description: 'Run security vulnerability scan on dependencies', priority: 'high' },
      ];

      let createdCount = 0;
      for (let i = 0; i < 30; i++) {
        const template = TASK_TEMPLATES[i % TASK_TEMPLATES.length];
        logProgress(`Creating task ${i + 1}/30: ${template.title}`);

        const { data: taskId, error } = await supabase.rpc('rpc_create_task', {
          p_title: `${template.title} #${i + 1}`,
          p_description: template.description,
          p_priority: template.priority,
          p_pipeline_id: pipeline?.id
        });

        if (error) {
          logProgress(`⚠️  Failed: ${error.message}`);
          continue;
        }

        // Randomly assign to team members
        if (teamMembers.length > 0 && Math.random() > 0.3) {
          const assignee = teamMembers[Math.floor(Math.random() * teamMembers.length)];
          await supabase.rpc('rpc_assign_task', {
            p_task_id: taskId,
            p_target_user_id: assignee.id,
          });
          logProgress(`   ✓ Assigned to ${assignee.full_name}`);
        }

        createdCount++;
      }

      logProgress(`✅ Comprehensive seed complete! Created ${createdCount} tasks.`);
      showAlert('Success', `Seeded ${createdCount} comprehensive tasks with assignments!`);
    } catch (err: any) {
      logProgress(`❌ Error: ${err.message}`);
      showAlert('Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-1 bg-surface-background flex-row">
        {/* Main Content */}
        <View className="flex-1 border-l border-surface-border">
          {/* Top bar */}
          <View className="bg-surface-card border-b border-surface-border px-8 py-4 flex-row items-center justify-between">
            <Text className="text-typography-main font-black text-lg">Dev Tools</Text>
            <Text className="text-typography-muted text-xs">Seeding & Data Management</Text>
          </View>

          <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 32, paddingBottom: 48 }}>
            {/* Quick Stats */}
            <View className="bg-surface-card rounded-2xl border border-surface-border p-6 mb-6">
              <Text className="text-typography-main font-black text-base mb-4">📊 Current Status</Text>
              <View className="gap-3">
                <View className="flex-row justify-between items-center py-2 border-b border-surface-border">
                  <Text className="text-typography-muted text-sm">Pipeline</Text>
                  <Text className="text-typography-main font-bold text-sm">{pipeline?.id ? '✅ Ready' : '⚠️  Not found'}</Text>
                </View>
                <View className="flex-row justify-between items-center py-2">
                  <Text className="text-typography-muted text-sm">Team Members</Text>
                  <Text className="text-typography-main font-bold text-sm">{teamMembers.length} available</Text>
                </View>
              </View>
            </View>

            {/* Seeding Grid */}
            <Text className="text-typography-main font-black text-base mb-4">🌱 Seeding Options</Text>
            <View className="flex-row gap-4 mb-6 flex-wrap">
              {/* Quick Seed Card */}
              <TouchableOpacity
                onPress={seedQuick}
                disabled={loading}
                className="flex-1 min-w-80 rounded-2xl border-2 border-brand-primary bg-brand-primary/10 p-6 hover:bg-brand-primary/20 transition-colors"
                style={loading ? { opacity: 0.6 } : {}}
              >
                <View className="flex-row items-start justify-between mb-3">
                  <FontAwesome name="bolt" size={20} color="#6366f1" />
                  <Text className="text-brand-primary font-black text-xs">FAST</Text>
                </View>
                <Text className="text-brand-primary font-black text-lg mb-1">Quick Seed</Text>
                <Text className="text-brand-primary font-bold text-sm mb-2">5 Tasks</Text>
                <Text className="text-brand-primary/70 text-xs leading-relaxed">
                  Perfect for rapid UI testing. Creates 5 random tasks instantly.
                </Text>
              </TouchableOpacity>

              {/* Comprehensive Seed Card */}
              <TouchableOpacity
                onPress={seedComprehensive}
                disabled={loading}
                className="flex-1 min-w-80 rounded-2xl border-2 border-blue-500 bg-blue-500/10 p-6 hover:bg-blue-500/20 transition-colors"
                style={loading ? { opacity: 0.6 } : {}}
              >
                <View className="flex-row items-start justify-between mb-3">
                  <FontAwesome name="tasks" size={20} color="#2563eb" />
                  <Text className="text-blue-600 font-black text-xs">RECOMMENDED</Text>
                </View>
                <Text className="text-blue-600 font-black text-lg mb-1">Comprehensive</Text>
                <Text className="text-blue-600 font-bold text-sm mb-2">30 Tasks + Assignments</Text>
                <Text className="text-blue-600/70 text-xs leading-relaxed">
                  Realistic data with worker assignments and varied priorities. Great for UI and basic analytics.
                </Text>
              </TouchableOpacity>

              {/* Full Reporting Seed Card */}
              <TouchableOpacity
                disabled
                className="flex-1 min-w-80 rounded-2xl border-2 border-purple-500 bg-purple-500/10 p-6 opacity-70"
              >
                <View className="flex-row items-start justify-between mb-3">
                  <FontAwesome name="bar-chart" size={20} color="#a855f7" />
                  <Text className="text-purple-600 font-black text-xs">CLI ONLY</Text>
                </View>
                <Text className="text-purple-600 font-black text-lg mb-1">Full Reporting</Text>
                <Text className="text-purple-600 font-bold text-sm mb-2">40 Tasks + Work Simulation</Text>
                <Text className="text-purple-600/70 text-xs leading-relaxed">
                  Complete work simulation with submissions, reviews, and metrics. Run from terminal.
                </Text>
              </TouchableOpacity>

              {/* Clear Tasks Card */}
              <TouchableOpacity
                onPress={clearTasks}
                disabled={loading}
                className="flex-1 min-w-80 rounded-2xl border-2 border-red-500/50 bg-red-500/10 p-6 hover:bg-red-500/20 transition-colors"
                style={loading ? { opacity: 0.6 } : {}}
              >
                <View className="flex-row items-start justify-between mb-3">
                  <FontAwesome name="trash" size={20} color="#dc2626" />
                  <Text className="text-red-600 font-black text-xs">DESTRUCTIVE</Text>
                </View>
                <Text className="text-red-600 font-black text-lg mb-1">Clear All</Text>
                <Text className="text-red-600 font-bold text-sm mb-2">Remove Tasks</Text>
                <Text className="text-red-600/70 text-xs leading-relaxed">
                  Deletes all seeded data. Useful for starting fresh with a clean slate.
                </Text>
              </TouchableOpacity>
            </View>

            {/* Info Sections */}
            <Text className="text-typography-main font-black text-base mb-4">ℹ️ About Seeding</Text>

            <View className="bg-brand-primary/10 border border-brand-primary/20 rounded-2xl p-6 mb-4">
              <Text className="text-brand-primary font-black text-sm mb-2">💡 Choosing the Right Seed</Text>
              <View className="gap-2">
                <Text className="text-brand-primary/80 text-xs leading-relaxed">
                  <Text className="font-bold">Quick:</Text> 5 tasks, 2 seconds. For rapid iteration.
                </Text>
                <Text className="text-brand-primary/80 text-xs leading-relaxed">
                  <Text className="font-bold">Comprehensive:</Text> 30 tasks with assignments, 5-10 seconds. Best for UI testing.
                </Text>
                <Text className="text-brand-primary/80 text-xs leading-relaxed">
                  <Text className="font-bold">Full Reporting:</Text> 40 tasks with complete work history. For reporting tests.
                </Text>
              </View>
            </View>

            <View className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-6 mb-4">
              <Text className="text-amber-600 font-black text-sm mb-3">🖥️ Full Reporting via Terminal</Text>
              <View className="bg-surface-card rounded-lg p-3 mb-3">
                <Text className="text-amber-600 font-mono text-xs">npm run seed:full</Text>
              </View>
              <Text className="text-amber-600/80 text-xs leading-relaxed">
                For the best comprehensive reporting experience, run the full seed from the terminal. It creates worker accounts, complete work history with submissions and reviews, and generates all metrics needed for thorough reporting tests.
              </Text>
            </View>

            <View className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-6">
              <Text className="text-blue-600 font-black text-sm mb-2">📚 Learn More</Text>
              <Text className="text-blue-600/80 text-xs leading-relaxed">
                See <Text className="font-mono">COMPREHENSIVE_SEED_GUIDE.md</Text> for detailed documentation on data characteristics, customization options, and troubleshooting.
              </Text>
            </View>

            {/* Progress Log */}
            {seedProgress && (
              <View className="bg-surface-overlay rounded-2xl border border-surface-border p-6 mt-8">
                <View className="flex-row items-center justify-between mb-4">
                  <Text className="text-typography-main font-black text-base">📋 Progress</Text>
                  {loading && <ActivityIndicator size="small" color="#6366f1" />}
                </View>
                <View className="bg-surface-background rounded-lg p-4 h-80 border border-surface-border">
                  <ScrollView showsVerticalScrollIndicator={false}>
                    <Text className="text-typography-muted text-xs font-mono whitespace-pre-wrap">{seedProgress}</Text>
                  </ScrollView>
                </View>
              </View>
            )}

            {/* Loading State */}
            {loading && (
              <View className="items-center py-12 mt-8">
                <ActivityIndicator size="large" color="#6366f1" />
                <Text className="text-typography-muted text-sm mt-4">Seeding in progress...</Text>
                <Text className="text-typography-dim text-xs mt-1">Check the progress log below for details</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </>
  );
}
