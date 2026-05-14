import { useAlert } from '@/contexts/AlertContext';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, SafeAreaView, ScrollView, StatusBar, Text, TouchableOpacity, View } from 'react-native';

export default function DevToolsScreen() {
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
    Alert.alert('Clear All Tasks?', 'This will delete all tasks. Continue?', [
      { text: 'Cancel', onPress: () => {} },
      {
        text: 'Clear',
        onPress: async () => {
          setLoading(true);
          setSeedProgress('Clearing tasks...');
          const { error } = await supabase.from('tasks').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          setLoading(false);
          if (error) {
            showAlert('Error', error.message);
          } else {
            showAlert('Success', 'Cleared all tasks!');
            setSeedProgress('✅ All tasks cleared');
          }
        }
      }
    ]);
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

  const seedFull = async () => {
    Alert.alert(
      'Full Reporting Seed',
      'This will create 40 tasks with complete work simulation.\n\nExpected time: 30-60 seconds\n\nRun from terminal: npm run seed:full',
      [
        { text: 'Cancel', onPress: () => {} },
        {
          text: 'Learn More',
          onPress: () => {
            logProgress('\n📖 Full Seed Guide:\n');
            logProgress('For complete work simulation with:');
            logProgress('- 8 worker accounts');
            logProgress('- 40 diverse tasks');
            logProgress('- Work sessions and submissions');
            logProgress('- Task completions and reviews');
            logProgress('\nRun in terminal:');
            logProgress('  npm run seed:full');
            logProgress('\nOr check COMPREHENSIVE_SEED_GUIDE.md');
          }
        }
      ]
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-surface-background" style={Platform.OS === 'android' ? { paddingTop: StatusBar.currentHeight } : {}}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View className="bg-surface-card border-b border-surface-border px-4 py-4">
          <View className="flex-row items-center justify-between mb-2">
            <View className="flex-row items-center gap-3 flex-1">
              <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 items-center justify-center">
                <FontAwesome name="chevron-left" size={18} color="#64748b" />
              </TouchableOpacity>
              <View>
                <Text className="text-typography-main font-black text-lg">Dev Tools</Text>
                <Text className="text-typography-muted text-xs">Seeding & Data Management</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Content */}
        <View className="p-6 pb-12">
          {/* Quick Stats */}
          <View className="bg-surface-card rounded-2xl border border-surface-border p-4 mb-6">
            <Text className="text-typography-main font-bold text-sm mb-3">📊 Current Status</Text>
            <View className="gap-2">
              <View className="flex-row justify-between">
                <Text className="text-typography-muted text-xs">Pipeline</Text>
                <Text className="text-typography-main font-bold text-xs">{pipeline?.id ? '✓ Ready' : '⚠ Not found'}</Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-typography-muted text-xs">Team Members</Text>
                <Text className="text-typography-main font-bold text-xs">{teamMembers.length} available</Text>
              </View>
            </View>
          </View>

          {/* Seeding Options */}
          <View className="mb-6">
            <Text className="text-typography-main font-black text-sm mb-3">🌱 Seeding Options</Text>

            {/* Quick Seed */}
            <TouchableOpacity
              onPress={seedQuick}
              disabled={loading}
              className={`rounded-xl border-2 border-brand-primary bg-brand-primary/10 p-4 mb-3 ${loading ? 'opacity-60' : ''}`}
            >
              <View className="flex-row items-start justify-between">
                <View className="flex-1">
                  <Text className="text-brand-primary font-bold">Quick Seed (5 Tasks)</Text>
                  <Text className="text-brand-primary/70 text-xs mt-1">Fast population for UI testing. ~2 seconds.</Text>
                </View>
                <FontAwesome name="chevron-right" size={12} color="#6366f1" />
              </View>
            </TouchableOpacity>

            {/* Comprehensive Seed */}
            <TouchableOpacity
              onPress={seedComprehensive}
              disabled={loading}
              className={`rounded-xl border-2 border-blue-500 bg-blue-500/10 p-4 mb-3 ${loading ? 'opacity-60' : ''}`}
            >
              <View className="flex-row items-start justify-between">
                <View className="flex-1">
                  <Text className="text-blue-600 font-bold">Comprehensive Seed (30 Tasks)</Text>
                  <Text className="text-blue-600/70 text-xs mt-1">Realistic data with assignments. ~5-10 seconds. Best for UI testing.</Text>
                </View>
                <FontAwesome name="chevron-right" size={12} color="#2563eb" />
              </View>
            </TouchableOpacity>

            {/* Full Reporting Seed */}
            <TouchableOpacity
              onPress={seedFull}
              disabled={loading}
              className="rounded-xl border-2 border-purple-500 bg-purple-500/10 p-4 mb-3"
            >
              <View className="flex-row items-start justify-between">
                <View className="flex-1">
                  <Text className="text-purple-600 font-bold">Full Reporting Seed (40 Tasks + Work)</Text>
                  <Text className="text-purple-600/70 text-xs mt-1">Complete work simulation with completions & reviews. ~30-60 seconds. Use CLI for this.</Text>
                </View>
                <FontAwesome name="chevron-right" size={12} color="#a855f7" />
              </View>
            </TouchableOpacity>

            {/* Clear Tasks */}
            <TouchableOpacity
              onPress={clearTasks}
              disabled={loading}
              className={`rounded-xl border-2 border-red-500/50 bg-red-500/10 p-4 ${loading ? 'opacity-60' : ''}`}
            >
              <View className="flex-row items-start justify-between">
                <View className="flex-1">
                  <Text className="text-red-600 font-bold">Clear All Tasks</Text>
                  <Text className="text-red-600/70 text-xs mt-1">Remove all seeded data. Useful for fresh starts.</Text>
                </View>
                <FontAwesome name="chevron-right" size={12} color="#dc2626" />
              </View>
            </TouchableOpacity>
          </View>

          {/* Info Sections */}
          <View className="mb-6">
            <Text className="text-typography-main font-black text-sm mb-3">ℹ️ About Seeding</Text>

            <View className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 mb-3">
              <Text className="text-blue-600 font-bold text-xs mb-1">Quick vs Comprehensive vs Full</Text>
              <Text className="text-blue-600/80 text-xs">
                Quick: Simple tasks for rapid UI testing.{'\n\n'}
                Comprehensive: Realistic data with worker assignments and varied priorities.{'\n\n'}
                Full: Complete work simulation with submissions, reviews, and time tracking for comprehensive reporting tests.
              </Text>
            </View>

            <View className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
              <Text className="text-amber-600 font-bold text-xs mb-1">Full Seed via Terminal</Text>
              <Text className="text-amber-600/80 text-xs font-mono mb-2">npm run seed:full</Text>
              <Text className="text-amber-600/80 text-xs">
                For the best reporting experience, run the full seed from the terminal. Creates workers, complete work history, and all reporting metrics.
              </Text>
            </View>
          </View>

          {/* Progress Log */}
          {seedProgress && (
            <View className="bg-surface-overlay rounded-xl border border-surface-border p-4 mb-6">
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-typography-main font-bold text-sm">📋 Progress</Text>
                {loading && <ActivityIndicator size="small" color="#6366f1" />}
              </View>
              <ScrollView className="h-48 bg-surface-background rounded-lg p-3">
                <Text className="text-typography-muted text-xs font-mono whitespace-pre-wrap">{seedProgress}</Text>
              </ScrollView>
            </View>
          )}

          {/* Loading State */}
          {loading && (
            <View className="items-center py-6">
              <ActivityIndicator size="large" color="#6366f1" />
              <Text className="text-typography-muted text-xs mt-3">Seeding in progress...</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
