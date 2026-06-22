import { useTaskDetail } from '@/contexts/TaskDetailContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Text, View } from 'react-native';
import CollapsibleCard from './CollapsibleCard';
import UserLink from '@/components/common/UserLink';

function Avatar({ name, size = 32 }: { name: string | null; size?: number }) {
  const initial = (name || '?').charAt(0).toUpperCase();
  return (
    <View style={{ width: size, height: size }} className="rounded-full bg-brand-primary/20 items-center justify-center border border-surface-border">
      <Text className="text-brand-primary font-black" style={{ fontSize: size * 0.35 }}>{initial}</Text>
    </View>
  );
}

export default function PeoplePanel() {
  const { data } = useTaskDetail();
  const colors = useThemeColors();
  if (!data) return null;

  const { assignments, manager, creator } = data;
  const userAssignments = assignments.filter(a => a.user);
  const teamAssignments = assignments.filter(a => a.team);

  return (
    <CollapsibleCard title={`People (${assignments.length})`} defaultCollapsed>
      {/* Manager */}
      {manager && (
        <View className="flex-row items-center mb-3 pb-3 border-b border-surface-border/30">
          <Avatar name={manager.full_name} />
          <View className="ml-3 flex-1">
            <UserLink userId={manager.id} name={manager.full_name} className="text-typography-main text-sm font-bold" />
            <Text className="text-brand-primary text-[9px] font-black uppercase tracking-wider">Manager</Text>
          </View>
           <FontAwesome name="briefcase" size={12} color={colors.primary} />
        </View>
      )}

      {/* Assigned Users */}
      {userAssignments.map(a => (
        <View key={a.id} className="flex-row items-center mb-2.5">
          <Avatar name={a.user?.full_name || null} size={28} />
          <View className="ml-3">
            <UserLink userId={a.user?.id} name={a.user?.full_name} className="text-typography-main text-sm font-bold" />
            <Text className="text-typography-dim text-[9px] font-bold">Assigned</Text>
          </View>
        </View>
      ))}

      {/* Assigned Teams */}
      {teamAssignments.length > 0 && (
        <View className="mt-2 pt-2 border-t border-surface-border/30">
          {teamAssignments.map(a => (
            <View key={a.id} className="flex-row items-center mb-2">
              <View style={{ backgroundColor: a.team?.color || colors.primary }} className="w-3 h-3 rounded-full mr-2.5" />
              <Text className="text-typography-main text-sm font-bold">{a.team?.name}</Text>
              <View className="ml-2 bg-surface-overlay px-1.5 py-0.5 rounded-md">
                <Text className="text-typography-muted text-[8px] font-bold uppercase">Team</Text>
              </View>
            </View>
          ))}
        </View>
      )}

       {assignments.length === 0 && (
         <View className="py-4 items-center opacity-40">
           <FontAwesome name="user-plus" size={20} color={colors.muted} />
           <Text className="text-typography-muted text-xs mt-2">No assignees yet</Text>
         </View>
       )}
    </CollapsibleCard>
  );
}
