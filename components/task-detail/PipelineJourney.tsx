import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTaskDetail } from '@/contexts/TaskDetailContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { formatRelative } from '@/lib/time';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import CollapsibleCard from './CollapsibleCard';
import PermissionGate from './PermissionGate';

function timeAgo(dateStr: string): string {
  return formatRelative(dateStr);
}

export default function PipelineJourney() {
  const { data, revertStage } = useTaskDetail();
  const { theme: activeTheme } = useTheme();
  const { hasPermission } = useAuth();
  const { showConfirm } = useAlert();
  const colors = useThemeColors();
  const [reverting, setReverting] = React.useState(false);
  if (!data) return null;

  // #22: manager-only one-step-back correction. RPC is the real gate (it
  // re-checks permission and whether a same-pipeline prior stage actually
  // exists) — this just decides whether to show the button at all.
  const canRevert = (data.permissions.is_owner || hasPermission('pipeline.reverse')) && data.stage_history.length > 0;
  const handleRevert = () => {
    showConfirm(
      'Revert Stage',
      'The task will move back to its previous stage. This does not re-run stage automations (spawned sub-tasks, handshakes, reassignment).',
      async () => {
        setReverting(true);
        try {
          await revertStage();
        } catch {
          // revertStage already toasts
        } finally {
          setReverting(false);
        }
      },
      undefined,
      'Revert',
      'Cancel',
      'destructive'
    );
  };

  return (
    <PermissionGate allowed={data.permissions.can_view_history}>
      <CollapsibleCard icon="history" title="Pipeline Journey" defaultCollapsed>
        {/* Stats row */}
        <View className="flex-row gap-3 mb-4">
          <View className="bg-state-success/10 px-2 py-1 rounded-lg border border-state-success/20">
            <Text className="text-state-success text-[10px] font-black">{data.stats.approval_count} ✓ Approved</Text>
          </View>
          <View className="bg-state-warning/10 px-2 py-1 rounded-lg border border-state-warning/20">
            <Text className="text-state-warning text-[10px] font-black">{data.stats.revision_count} ↺ Revisions</Text>
          </View>
          <View className="bg-state-danger/10 px-2 py-1 rounded-lg border border-state-danger/20">
            <Text className="text-state-danger text-[10px] font-black">{data.stats.rejection_count} ✗ Rejected</Text>
          </View>
        </View>

        {/* Timeline */}
        <View className="ml-2">
            {data.stage_history.length === 0 ? (
              <View className="py-4 items-center opacity-40">
                <Text className="text-typography-muted text-xs">No transitions recorded yet</Text>
              </View>
            ) : (
              data.stage_history.map((h, i) => (
                <View key={h.id} className="flex-row mb-0">
                  {/* Timeline dot + line */}
                  <View className="items-center mr-3">
                    <View className={`w-2.5 h-2.5 rounded-full ${h.is_reversal ? 'bg-state-warning' : 'bg-brand-primary'}`} />
                    {i < data.stage_history.length - 1 && (
                      <View className="w-0.5 flex-1 bg-surface-border min-h-[24px]" />
                    )}
                  </View>

                  {/* Content */}
                  <View className="flex-1 pb-4">
                    <View className="flex-row items-center flex-wrap gap-1">
                      <Text className="text-typography-muted text-[10px] font-bold">{h.from_stage_name || 'Start'}</Text>
                      <FontAwesome name="long-arrow-right" size={8} color={colors.muted} />
                      <Text className="text-typography-main text-[10px] font-black">{h.to_stage_name}</Text>
                      {h.is_reversal && (
                        <View className="bg-state-warning/20 px-1 rounded-sm">
                          <Text className="text-state-warning text-[7px] font-black">REVERSAL</Text>
                        </View>
                      )}
                    </View>
                    <Text className="text-typography-dim text-[9px] mt-0.5">
                      {h.transitioned_by?.full_name || 'System'} · {timeAgo(h.transitioned_at)}
                    </Text>
                  </View>
                </View>
              ))
            )}
        </View>

        {/* Total time */}
        <View className="mt-2 pt-2 border-t border-surface-border/30 flex-row justify-between">
          <Text className="text-typography-dim text-[10px] font-bold">Total transitions</Text>
          <Text className="text-typography-main text-[10px] font-black">{data.stats.total_transitions}</Text>
        </View>

        {canRevert && (
          <TouchableOpacity
            onPress={handleRevert}
            disabled={reverting}
            className={`mt-3 flex-row items-center justify-center px-4 py-2 rounded-xl border border-state-warning/40 bg-state-warning/10 ${reverting ? 'opacity-50' : 'active:opacity-80'}`}
          >
            {reverting ? (
              <ActivityIndicator size="small" color={colors.warning} />
            ) : (
              <>
                <FontAwesome name="undo" size={10} color={colors.warning} />
                <Text className="text-state-warning text-[10px] font-black uppercase tracking-wider ml-2">Revert to Previous Stage</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </CollapsibleCard>
    </PermissionGate>
  );
}
