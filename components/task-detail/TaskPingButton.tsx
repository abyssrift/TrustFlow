import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useState } from 'react';
import { ActivityIndicator, TouchableOpacity } from 'react-native';

type PingTask = {
  id: string;
  assignments?: {
    assignee_user_id: string | null;
    user?: { full_name: string } | null;
  }[];
};

type Props = {
  task: PingTask;
  userId: string;
  /** Extra classes for the touch target (e.g. desktop hover states). */
  className?: string;
};

function formatPingedNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} +${names.length - 2} more`;
}

/**
 * Compact icon-only "ping" button for the task card header.
 * Mirrors the assign/archive header buttons so it sits inline with them.
 */
export default function TaskPingButton({ task, userId, className = '' }: Props) {
  const colors = useThemeColors();
  const { hasPermission, profile } = useAuth();
  const { successToast, errorToast, infoToast } = useToast();
  const [pingLoading, setPingLoading] = useState(false);

  const canPing = hasPermission('task.ping') || hasPermission('system.manage') || profile?.is_owner;
  if (!canPing) return null;

  const handlePingTask = async (e?: any) => {
    e?.stopPropagation?.();
    const targets = (task.assignments || []).filter(
      a => a.assignee_user_id !== null && a.assignee_user_id !== userId
    );
    if (targets.length === 0) {
      infoToast('No one was pinged — this task has no other assignees.');
      return;
    }
    setPingLoading(true);
    try {
      const { error } = await supabase.rpc('rpc_ping_task', { p_task_id: task.id });
      if (error) throw error;
      const names = targets.map(a => a.user?.full_name || 'Someone');
      successToast(`Pinged ${formatPingedNames(names)} 📢`);
    } catch (err: any) {
      errorToast(err.message || 'Could not ping task.');
    } finally {
      setPingLoading(false);
    }
  };

  return (
    <TouchableOpacity
      onPress={handlePingTask}
      disabled={pingLoading}
      className={`w-7 h-7 items-center justify-center rounded-xl bg-surface-background border border-surface-border ${pingLoading ? 'opacity-50' : ''} ${className}`}
    >
      {pingLoading ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <FontAwesome name="bell" size={10} color={colors.primary} />
      )}
    </TouchableOpacity>
  );
}
