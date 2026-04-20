import React from 'react';
import { View, Text } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useTaskDetail } from '@/contexts/TaskDetailContext';

function MetaRow({ icon, label, value, valueColor }: { icon: string; label: string; value: string; valueColor?: string }) {
  return (
    <View className="flex-row items-center justify-between py-2.5 border-b border-surface-border/30">
      <View className="flex-row items-center">
        <FontAwesome name={icon as any} size={11} color="#64748b" />
        <Text className="text-typography-muted text-xs font-bold ml-2.5 uppercase tracking-wider">{label}</Text>
      </View>
      <Text className={`text-xs font-black ${valueColor || 'text-typography-main'}`}>{value}</Text>
    </View>
  );
}

export default function TaskMetadata() {
  const { data } = useTaskDetail();
  if (!data) return null;

  const { task, pipeline, current_stage, creator, manager, stats } = data;

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && !task.completed_at;

  return (
    <View className="bg-surface-card rounded-2xl border border-surface-border p-4">
      <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em] mb-3">Task Info</Text>

      {/* Description */}
      {task.description && (
        <Text className="text-typography-label text-sm leading-5 mb-4">
          {task.description}
        </Text>
      )}

      <MetaRow icon="code-fork" label="Pipeline" value={pipeline?.name || '—'} />
      <MetaRow
        icon="circle"
        label="Stage"
        value={current_stage?.name || '—'}
        valueColor="text-brand-primary"
      />
      <MetaRow icon="flag" label="Priority" value={task.priority?.toUpperCase() || 'NORMAL'} />
      {task.category && <MetaRow icon="tag" label="Category" value={task.category} />}
      <MetaRow icon="user" label="Created By" value={creator?.full_name || '—'} />
      {manager && <MetaRow icon="briefcase" label="Manager" value={manager.full_name || '—'} />}
      <MetaRow
        icon="calendar"
        label="Due Date"
        value={task.due_date ? `${formatDate(task.due_date)}${isOverdue ? ' ⚠ OVERDUE' : ''}` : 'No due date'}
        valueColor={isOverdue ? 'text-state-danger' : undefined}
      />
      <MetaRow icon="clock-o" label="Created" value={formatDate(task.created_at)} />
      <MetaRow icon="calendar-check-o" label="In Pipeline" value={`${stats.days_in_pipeline} days`} />

      {/* Progress bar */}
      {task.progress > 0 && (
        <View className="mt-3">
          <View className="flex-row justify-between mb-1">
            <Text className="text-typography-muted text-[10px] font-bold uppercase">Progress</Text>
            <Text className="text-brand-primary text-[10px] font-black">{task.progress}%</Text>
          </View>
          <View className="h-1.5 bg-surface-overlay rounded-full overflow-hidden">
            <View style={{ width: `${task.progress}%` }} className="h-full bg-brand-primary rounded-full" />
          </View>
        </View>
      )}
    </View>
  );
}
