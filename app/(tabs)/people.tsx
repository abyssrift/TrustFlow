import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type TeamMember = {
  id: string;
  full_name: string;
  role: string;
  email?: string;
};

export default function PeopleScreen() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'dark'];

  const fetchMembers = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, role, email')
        .order('full_name', { ascending: true });

      if (error) throw error;
      setMembers(data || []);
    } catch (err: any) {
      console.error('Error fetching members:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchMembers();
  };

  const getRoleColor = (role: string) => {
    switch (role?.toLowerCase()) {
      case 'admin': return '#ef4444';
      case 'manager': return '#f59e0b';
      case 'worker': return '#3b82f6';
      default: return theme.tabIconDefault;
    }
  };

  const renderMemberCard = (member: TeamMember) => {
    return (
      <View key={member.id} className="bg-surface-card p-4 rounded-3xl border border-surface-border mb-3 flex-row items-center premium-shadow">
        <View className="w-12 h-12 rounded-2xl bg-brand-primary/10 items-center justify-center mr-4">
           <Text className="text-brand-primary font-black text-lg">
             {member.full_name?.charAt(0) || '?'}
           </Text>
        </View>
        
        <View className="flex-1">
           <Text className="text-typography-main font-bold text-base">{member.full_name || 'Anonymous'}</Text>
           <Text className="text-typography-muted text-xs">{member.email || 'No email set'}</Text>
        </View>

        <View style={{ borderColor: getRoleColor(member.role) }} className="px-2 py-0.5 rounded-md border">
           <Text style={{ color: getRoleColor(member.role) }} className="text-[9px] font-black uppercase tracking-tighter">
             {member.role || 'Member'}
           </Text>
        </View>
      </View>
    );
  };

  if (loading && !refreshing) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center">
        <ActivityIndicator size="large" color={theme.tint} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface-background">
      <View className="flex-row items-center justify-between px-6 pt-4 pb-4">
        <View>
          <Text className="text-typography-main text-3xl font-black">Team</Text>
          <Text className="text-typography-muted text-xs font-medium">Collaborators and collaborators</Text>
        </View>
        <TouchableOpacity className="bg-brand-primary w-11 h-11 rounded-2xl items-center justify-center premium-shadow">
          <FontAwesome name="user-plus" size={16} color="white" />
        </TouchableOpacity>
      </View>

      <ScrollView 
        className="flex-1 px-6 pt-2"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.tint} />}
      >
        <View className="mb-6 flex-row items-center justify-between bg-surface-overlay/30 p-4 rounded-3xl border border-surface-border">
           <View>
              <Text className="text-typography-main font-bold text-sm">Active Members</Text>
              <Text className="text-typography-muted text-xs">Manage your workforce access</Text>
           </View>
           <View className="bg-brand-primary/20 px-3 py-1 rounded-full">
              <Text className="text-brand-primary font-black text-xs">{members.length}</Text>
           </View>
        </View>

        {members.map(renderMemberCard)}
        <View className="h-10" />
      </ScrollView>
    </View>
  );
}
