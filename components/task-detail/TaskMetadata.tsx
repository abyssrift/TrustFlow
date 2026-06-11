import { useTaskDetail } from '@/contexts/TaskDetailContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import EditTaskModal from './EditTaskModal';

function MetaRow({ icon, label, value, valueColor }: { icon: string; label: string; value: string; valueColor?: string }) {
  const colors = useThemeColors();
  const getValueColor = () => {
    if (valueColor === 'text-brand-primary') return colors.primary;
    if (valueColor === 'text-state-danger') return colors.danger;
    if (valueColor === 'text-state-success') return colors.success;
    return colors.textMain;
  };
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.1)' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <FontAwesome name={icon as any} size={11} color={colors.textMuted} />
        <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '700', marginLeft: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
      </View>
      <Text style={{ fontSize: 12, fontWeight: '900', color: getValueColor() }}>{value}</Text>
    </View>
  );
}

export default function TaskMetadata() {
  const { data } = useTaskDetail();
  const colors = useThemeColors();
  const [isEditModalVisible, setIsEditModalVisible] = React.useState(false);

  if (!data) return null;

  const { task, pipeline, current_stage, creator, manager, stats, permissions } = data;

  // Map theme colors to common UI colors
  const themeColors = {
    surfaceCard: colors.card,
    borderMain: colors.border,
    textLabel: colors.textMuted,
    surfaceBackground: colors.background,
    warningLight: 'rgba(251, 191, 36, 0.1)',
    warningBorder: 'rgba(251, 191, 36, 0.3)',
    surfaceOverlay: 'rgba(255, 255, 255, 0.05)',
    borderLight: 'rgba(255, 255, 255, 0.1)',
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && !task.completed_at;

  return (
    <View style={{ backgroundColor: themeColors.surfaceCard, borderRadius: 16, borderWidth: 1, borderColor: themeColors.borderMain, padding: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5 }}>Task Info</Text>
        {permissions.can_edit && (
          <TouchableOpacity
            onPress={() => setIsEditModalVisible(true)}
            style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: themeColors.surfaceBackground, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: themeColors.borderMain }}
          >
            <FontAwesome name="pencil" size={10} color={colors.primary} />
            <Text style={{ color: colors.primary, fontSize: 10, fontWeight: '700', marginLeft: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Edit</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Description */}
      {task.description && (
        <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 16 }}>
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
      <MetaRow icon="balance-scale" label="Weight" value={task.weight?.toString() || '1'} />
      {task.is_recurring && <MetaRow icon="repeat" label="Recurring" value="Yes" valueColor="text-brand-primary" />}
      {task.quarantine_reason && (
        <View style={{ marginTop: 12, padding: 12, backgroundColor: themeColors.warningLight, borderWidth: 1, borderColor: themeColors.warningBorder, borderRadius: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <FontAwesome name="warning" size={10} color={colors.warning} />
            <Text style={{ color: colors.warning, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', marginLeft: 6, letterSpacing: 0.5 }}>Quarantined</Text>
          </View>
          <Text style={{ color: colors.textMain, fontSize: 12, fontWeight: '500', lineHeight: 16, fontStyle: 'italic' }}>
            "{task.quarantine_reason}"
          </Text>
        </View>
      )}

      {/* Progress bar */}
      {task.progress > 0 && (
        <View style={{ marginTop: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' }}>Progress</Text>
            <Text style={{ color: colors.primary, fontSize: 10, fontWeight: '900' }}>{task.progress}%</Text>
          </View>
          <View style={{ height: 6, backgroundColor: themeColors.surfaceOverlay, borderRadius: 999, overflow: 'hidden' }}>
            <View style={{ width: `${task.progress}%`, backgroundColor: colors.primary, height: '100%', borderRadius: 999 }} />
          </View>
        </View>
      )}

      {permissions.can_edit && (
        <EditTaskModal 
          visible={isEditModalVisible} 
          onClose={() => setIsEditModalVisible(false)} 
        />
      )}
    </View>
  );
}
