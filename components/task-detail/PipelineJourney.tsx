import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useTaskDetail } from '@/contexts/TaskDetailContext';
import PermissionGate from './PermissionGate';

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function PipelineJourney() {
  const { data } = useTaskDetail();
  const [expanded, setExpanded] = useState(true);

  if (!data) return null;

  return (
    <PermissionGate allowed={data.permissions.can_view_history}>
      <View className="bg-surface-card rounded-2xl border border-surface-border p-4">
        {/* Header with stats */}
        <TouchableOpacity onPress={() => setExpanded(!expanded)} className="flex-row items-center justify-between mb-3">
          <View className="flex-row items-center">
            <FontAwesome name="history" size={12} color="#6366f1" />
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em] ml-2">
              Pipeline Journey
            </Text>
          </View>
          <FontAwesome name={expanded ? 'chevron-up' : 'chevron-down'} size={10} color="#64748b" />
        </TouchableOpacity>

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
        {expanded && (
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
                      <FontAwesome name="long-arrow-right" size={8} color="#64748b" />
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
        )}

        {/* Total time */}
        <View className="mt-2 pt-2 border-t border-surface-border/30 flex-row justify-between">
          <Text className="text-typography-dim text-[10px] font-bold">Total transitions</Text>
          <Text className="text-typography-main text-[10px] font-black">{data.stats.total_transitions}</Text>
        </View>
      </View>
    </PermissionGate>
  );
}
