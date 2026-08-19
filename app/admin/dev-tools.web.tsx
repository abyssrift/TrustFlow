import FileHubDebugPanel from '@/components/admin/FileHubDebugPanel';
import { useIsPlatformAdmin } from '@/components/platform-admin/useControlPlaneData';
import { useAlert } from '@/contexts/AlertContext';
import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';
import { DEFAULT_PING_SOUND } from '@/hooks/useGlobalPingListener';
import { FontAwesome } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';

export default function DevToolsScreenWeb() {
  const router = useRouter();
  const { showAlert } = useAlert();
  const { showToast } = useToast();
  // Screen-level gate -- see dev-tools.tsx (native) for the full rationale.
  // Every destructive RPC here is independently server-gated to
  // _is_platform_admin(); this just keeps a company owner from seeing the
  // screen. Called unconditionally with the other hooks; early-return sits
  // after all hooks, right before the JSX.
  const isPlatformAdmin = useIsPlatformAdmin();
  const [loading, setLoading] = useState(false);
  const [seedProgress, setSeedProgress] = useState('');
  const [pipeline, setPipeline] = useState<any>(null);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [taskCount, setTaskCount] = useState<number | null>(null);

  const refreshTaskCount = async () => {
    const { count } = await supabase.from('tasks').select('id', { count: 'exact', head: true });
    setTaskCount(count ?? 0);
  };

  useEffect(() => {
    const fetchData = async () => {
      const { data: pipe } = await supabase.from('pipelines').select('*').eq('is_default', true).limit(1).single();
      setPipeline(pipe);

      const { data: users } = await supabase
        .from('users')
        .select('id, full_name')
        .neq('id', (await supabase.auth.getUser()).data.user?.id || '');
      setTeamMembers(users || []);

      refreshTaskCount();
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

  // #215: the RPC-backed replacement for clearTasks above. clearTasks runs a
  // raw client .delete() with no company scope; tasks has RLS enabled with no
  // DELETE policy, so that call silently deletes zero rows and reports
  // "Success" regardless. rpc_dev_delete_all_company_tasks is SECURITY
  // DEFINER, scoped to the caller's own company, and gated to company owners.
  // Web gets a type-to-confirm prompt (native gets a double showConfirm).
  const deleteAllCompanyTasks = async () => {
    const count = taskCount ?? 0;
    const typed = window.prompt(
      `This permanently deletes all ${count} task${count === 1 ? '' : 's'} in your company — including comments, attachments, time logs, and history. This cannot be undone.\n\nType DELETE to confirm:`
    );
    if (typed !== 'DELETE') return;

    setLoading(true);
    setSeedProgress('Deleting all company tasks...');
    const { data, error } = await supabase.rpc('rpc_dev_delete_all_company_tasks');
    setLoading(false);

    if (error) {
      logProgress(`❌ Error: ${error.message}`);
      showAlert('Error', error.message);
    } else {
      logProgress(`✅ Deleted ${data} tasks`);
      showAlert('Success', `Deleted ${data} task${data === 1 ? '' : 's'}.`);
      setTaskCount(0);
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

  // Fires the toast + sound 3s after the click returns, so by the time it
  // runs there's no click on the call stack — same shape as a real ping
  // arriving over the websocket. A same-tick test would trivially pass even
  // if the browser is blocking autoplay on the real (gesture-less) path.
  const testPing = async () => {
    const [{ data: sound }, { data: task }] = await Promise.all([
      supabase.from('company_ping_sounds').select('sound_url').maybeSingle(),
      supabase.from('tasks').select('id, title').is('deleted_at', null).limit(1).maybeSingle(),
    ]);

    logProgress(`🔔 Ping test: sound ${sound?.sound_url ? 'configured' : 'using bundled default (no company_ping_sounds row)'}, target task ${task ? `"${task.title}"` : 'MISSING'}`);
    logProgress('Firing in 3s (simulating a real, gesture-less websocket ping)...');

    setTimeout(() => {
      const url = sound?.sound_url ?? DEFAULT_PING_SOUND.uri;
      new Audio(url).play()
        .then(() => logProgress('✅ Sound played'))
        .catch((err: any) => logProgress(`❌ Sound blocked: ${err.name} — ${err.message}`));

      showToast({
        type: 'success',
        title: 'Pinged! (test)',
        message: task ? `You were pinged on "${task.title}"` : 'Test ping — no task found to link to',
        duration: 6000,
        actionLabel: 'View Task',
        onPress: () => router.push((task ? `/task/${task.id}` : '/(tabs)') as any),
      });
      logProgress('Toast shown — tap it, it should open the task.');
    }, 3000);
  };

  if (!isPlatformAdmin) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View className="flex-1 bg-surface-background items-center justify-center p-6 gap-3">
          <FontAwesome name="lock" size={28} className="text-typography-muted" />
          <Text className="text-typography-main font-black text-base">Platform admin only</Text>
          <Text className="text-typography-muted text-xs text-center">This screen is for TrustFlow platform staff, not company admins.</Text>
        </View>
      </>
    );
  }

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
                  <FontAwesome name="trash-o" size={20} color="#dc2626" />
                  <Text className="text-red-600 font-black text-xs">DESTRUCTIVE</Text>
                </View>
                <Text className="text-red-600 font-black text-lg mb-1">Clear All</Text>
                <Text className="text-red-600 font-bold text-sm mb-2">Remove Tasks</Text>
                <Text className="text-red-600/70 text-xs leading-relaxed">
                  Deletes all seeded data. Useful for starting fresh with a clean slate.
                </Text>
              </TouchableOpacity>

              {/* Delete All Tasks for this Company Card — #215 */}
              <TouchableOpacity
                onPress={deleteAllCompanyTasks}
                disabled={loading}
                className="flex-1 min-w-80 rounded-2xl border-2 border-red-600 bg-red-600/15 p-6 hover:bg-red-600/25 transition-colors"
                style={loading ? { opacity: 0.6 } : {}}
              >
                <View className="flex-row items-start justify-between mb-3">
                  <FontAwesome name="exclamation-triangle" size={20} color="#b91c1c" />
                  <Text className="text-red-700 font-black text-xs">OWNER ONLY</Text>
                </View>
                <Text className="text-red-700 font-black text-lg mb-1">Delete All Tasks for this Company</Text>
                <Text className="text-red-700 font-bold text-sm mb-2">{taskCount ?? '…'} tasks currently</Text>
                <Text className="text-red-700/70 text-xs leading-relaxed">
                  Permanently wipes every task, comment, attachment, and time log for your company. Cannot be undone.
                </Text>
              </TouchableOpacity>

              {/* Test Ping Card */}
              <TouchableOpacity
                onPress={testPing}
                className="flex-1 min-w-80 rounded-2xl border-2 border-emerald-500 bg-emerald-500/10 p-6 hover:bg-emerald-500/20 transition-colors"
              >
                <View className="flex-row items-start justify-between mb-3">
                  <FontAwesome name="bell-o" size={20} color="#059669" />
                  <Text className="text-emerald-600 font-black text-xs">3S DELAY</Text>
                </View>
                <Text className="text-emerald-600 font-black text-lg mb-1">Test Ping</Text>
                <Text className="text-emerald-600 font-bold text-sm mb-2">Toast + Sound + Click</Text>
                <Text className="text-emerald-600/70 text-xs leading-relaxed">
                  Fires a simulated ping 3s after you click, so it lands with no gesture on the
                  call stack — same as a real one. Check the log below and try tapping the toast.
                </Text>
              </TouchableOpacity>

              {/* Icon Audit Card */}
              <TouchableOpacity
                onPress={() => router.push('/admin/icon-audit' as any)}
                className="flex-1 min-w-80 rounded-2xl border-2 border-brand-primary bg-brand-primary/10 p-6 hover:bg-brand-primary/20 transition-colors"
              >
                <View className="flex-row items-start justify-between mb-3">
                  <FontAwesome name="sliders" size={20} color="#6366f1" />
                  <Text className="text-brand-primary font-black text-xs">AUDIT</Text>
                </View>
                <Text className="text-brand-primary font-black text-lg mb-1">Icon Audit</Text>
                <Text className="text-brand-primary font-bold text-sm mb-2">Every glyph + location</Text>
                <Text className="text-brand-primary/70 text-xs leading-relaxed">
                  Every FontAwesome glyph used across the app, grouped by icon name with every
                  file:line it appears in. Search, filter duplicates, spot inconsistencies.
                </Text>
              </TouchableOpacity>
            </View>

            <FileHubDebugPanel />

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
