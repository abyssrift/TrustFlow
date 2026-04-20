import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';

type DeadlockedTask = {
  id: string;
  title: string;
  quarantine_reason: {
    child_task_id: string;
    child_terminal_stage_name: string;
    parent_stage_id: string;
    parent_pipeline_id: string;
    occurred_at: string;
  } | null;
};

export default function DeadlockAlert() {
  const [tasks, setTasks] = useState<DeadlockedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveResults, setResolveResults] = useState<Record<string, { success: boolean; reason?: string }>>({});

  const fetchDeadlocked = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('tasks')
      .select('id, title, quarantine_reason')
      .eq('error_state', 'handshake_deadlock')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(20);

    setTasks(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDeadlocked();
  }, [fetchDeadlocked]);

  const handleResolve = async (taskId: string) => {
    setResolvingId(taskId);
    const { data, error } = await supabase.rpc('rpc_resolve_handshake_deadlock', {
      p_parent_task_id: taskId,
    });

    if (error) {
      setResolveResults(prev => ({ ...prev, [taskId]: { success: false, reason: error.message } }));
    } else {
      const result = data as { success: boolean; reason?: string };
      setResolveResults(prev => ({ ...prev, [taskId]: result }));
      if (result.success) {
        // Remove from list on success
        setTasks(prev => prev.filter(t => t.id !== taskId));
      }
    }
    setResolvingId(null);
  };

  if (loading) {
    return (
      <View className="bg-surface-card rounded-2xl border border-surface-border p-4 mb-4 items-center">
        <ActivityIndicator color="#6366f1" size="small" />
      </View>
    );
  }

  if (tasks.length === 0) return null;

  return (
    <View className="mb-6">
      {/* Banner */}
      <View className="bg-state-warning/10 border border-state-warning/40 p-4 rounded-2xl mb-3 flex-row items-start">
        <FontAwesome name="exclamation-triangle" size={16} color="#f59e0b" style={{ marginTop: 2 }} />
        <View className="flex-1 ml-3">
          <Text className="text-state-warning font-black text-sm">
            {tasks.length} Handshake Deadlock{tasks.length !== 1 ? 's' : ''} Detected
          </Text>
          <Text className="text-typography-muted text-xs mt-1">
            These parent tasks are stalled because their child sub-pipeline completed with no outcome route configured.
            Fix the pipeline mapping in the Stages editor, then tap Retry below.
          </Text>
        </View>
      </View>

      {/* Deadlocked Task Cards */}
      {tasks.map(task => {
        const result = resolveResults[task.id];
        const isResolving = resolvingId === task.id;
        const q = task.quarantine_reason;

        return (
          <View
            key={task.id}
            className="bg-surface-card border border-state-warning/30 rounded-2xl p-4 mb-2"
          >
            {/* Task Title */}
            <View className="flex-row items-center mb-2">
              <View className="bg-state-warning/15 p-1.5 rounded-lg mr-3">
                <FontAwesome name="chain-broken" size={12} color="#f59e0b" />
              </View>
              <Text className="text-typography-main font-bold flex-1" numberOfLines={1}>
                {task.title}
              </Text>
            </View>

            {/* Diagnostic Detail */}
            {q && (
              <View className="bg-surface-background rounded-xl p-3 mb-3 border border-surface-border">
                <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2">
                  Diagnostic
                </Text>
                <View className="flex-row justify-between mb-1">
                  <Text className="text-typography-muted text-xs">Child ended at:</Text>
                  <Text className="text-typography-main text-xs font-bold">
                    {q.child_terminal_stage_name || 'Unknown stage'}
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-typography-muted text-xs">Occurred:</Text>
                  <Text className="text-typography-main text-xs font-bold">
                    {q.occurred_at ? new Date(q.occurred_at).toLocaleString() : '—'}
                  </Text>
                </View>
              </View>
            )}

            {/* Resolution Result */}
            {result && !result.success && (
              <View className="bg-state-danger/10 border border-state-danger/30 rounded-xl p-3 mb-3">
                <Text className="text-state-danger text-xs font-bold">{result.reason}</Text>
              </View>
            )}

            {/* Retry Button */}
            <TouchableOpacity
              onPress={() => handleResolve(task.id)}
              disabled={isResolving}
              className="bg-state-warning/15 border border-state-warning/40 rounded-xl py-2.5 items-center flex-row justify-center"
            >
              {isResolving ? (
                <ActivityIndicator color="#f59e0b" size="small" />
              ) : (
                <>
                  <FontAwesome name="refresh" size={11} color="#f59e0b" />
                  <Text className="text-state-warning font-bold text-xs ml-2">
                    Retry Handshake
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        );
      })}

      {/* Refresh link */}
      <TouchableOpacity onPress={fetchDeadlocked} className="items-center mt-1 py-2">
        <Text className="text-typography-muted text-xs">Refresh list</Text>
      </TouchableOpacity>
    </View>
  );
}
