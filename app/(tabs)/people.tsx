import React, { useEffect, useState } from 'react';
import { 
  View, Text, ScrollView, RefreshControl, 
  TouchableOpacity, ActivityIndicator, Image,
  TextInput, Modal, Pressable
} from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Clipboard from 'expo-clipboard';
import { Alert } from 'react-native';

type TeamMember = {
  id: string;
  full_name: string;
  role: string;
  email?: string;
  avatar_url?: string;
  contribution_points?: number;
  velocity_hours?: number;
  flap_rate?: number;
  tier?: string;
};

export default function PeopleScreen() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedScan, setSelectedScan] = useState<TeamMember | null>(null);
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const { profile } = useAuth();
  
  useEffect(() => {
    if (profile?.company_id) {
      fetchCompanyInfo();
    }
  }, [profile?.company_id]);

  const fetchCompanyInfo = async () => {
    const { data, error } = await supabase
      .from('companies')
      .select('join_code')
      .eq('id', profile.company_id)
      .single();
    
    if (data) {
      setJoinCode(data.join_code);
    }
  };

  const fetchMembers = async (q: string = '') => {
    try {
      const { data, error } = await supabase.rpc('rpc_search_users', { p_query: q });
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
    fetchMembers(searchQuery);
  }, [searchQuery]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchMembers();
  };

  const getRoleColor = (role: string) => {
    switch (role?.toLowerCase()) {
      case 'admin': return 'rgb(var(--state-danger))';
      case 'manager': return 'rgb(var(--state-warning))';
      case 'worker': return 'rgb(var(--brand-primary))';
      default: return 'rgb(var(--typography-muted))';
    }
  };

  const renderMemberCard = (member: TeamMember) => {
    return (
      <TouchableOpacity 
        key={member.id} 
        onPress={() => setSelectedScan(member)}
        className="bg-surface-card p-4 rounded-3xl border border-surface-border mb-3 flex-row items-center premium-shadow"
      >
        <View className="w-12 h-12 rounded-2xl bg-brand-primary/10 items-center justify-center mr-4">
           {member.avatar_url ? (
             <Image source={{ uri: member.avatar_url }} className="w-full h-full rounded-2xl" />
           ) : (
             <Text className="text-brand-primary font-black text-lg">
               {member.full_name?.charAt(0) || '?'}
             </Text>
           )}
        </View>
        
        <View className="flex-1">
           <Text className="text-typography-main font-bold text-base">{member.full_name || 'Anonymous'}</Text>
           <View className="flex-row items-center">
              <Text className="text-typography-muted text-[10px] uppercase font-black tracking-widest">{member.tier || 'Rookie'}</Text>
              <View className="w-1 h-1 rounded-full bg-typography-muted mx-2" />
              <Text className="text-typography-muted text-[10px]">{member.email || 'No email set'}</Text>
           </View>
        </View>

        <View style={{ borderColor: getRoleColor(member.role) }} className="px-2 py-0.5 rounded-md border">
           <Text style={{ color: getRoleColor(member.role) }} className="text-[9px] font-black uppercase tracking-tighter">
             {member.role || 'Member'}
           </Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading && !refreshing) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center">
        <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface-background">
      <View className="px-6 pt-4 pb-4">
        <View className="flex-row items-center justify-between mb-4">
          <View>
            <Text className="text-typography-main text-3xl font-black">Team</Text>
            <Text className="text-typography-muted text-xs font-medium">Performance and Personnel</Text>
          </View>
          <TouchableOpacity className="bg-brand-primary w-11 h-11 rounded-2xl items-center justify-center premium-shadow">
            <FontAwesome name="user-plus" size={16} color="white" />
          </TouchableOpacity>
        </View>

        {joinCode && (
          <TouchableOpacity 
            onPress={() => {
              Clipboard.setStringAsync(joinCode);
              Alert.alert('Copied', 'Join code copied to clipboard');
            }}
            className="mb-4 bg-brand-primary/10 border border-brand-primary/30 rounded-2xl p-4 flex-row items-center justify-between"
          >
            <View>
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Share Join Code</Text>
              <Text className="text-brand-primary font-black text-xl tracking-[0.2em]">{joinCode}</Text>
            </View>
            <View className="bg-brand-primary w-10 h-10 rounded-xl items-center justify-center">
              <FontAwesome name="copy" size={14} color="white" />
            </View>
          </TouchableOpacity>
        )}

        {/* SEARCH BAR */}
        <View className="bg-surface-card border border-surface-border rounded-2xl px-4 flex-row items-center">
           <FontAwesome name="search" size={14} color="rgb(var(--typography-muted))" />
           <TextInput 
             placeholder="Deep scan member..."
             placeholderTextColor="rgb(var(--typography-muted))"
             className="flex-1 h-12 ml-3 text-typography-main font-bold"
             value={searchQuery}
             onChangeText={setSearchQuery}
           />
        </View>
      </View>

      <ScrollView 
        className="flex-1 px-6 pt-2"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="rgb(var(--brand-primary))" />}
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

      {/* DEEP SCAN MODAL */}
      <Modal
        visible={!!selectedScan}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSelectedScan(null)}
      >
        <View className="flex-1 justify-end bg-black/60">
           <Pressable className="flex-1" onPress={() => setSelectedScan(null)} />
           <View className="bg-surface-background rounded-t-[40px] p-8 border-t border-brand-primary/30">
              <View className="w-12 h-1.5 bg-surface-border rounded-full self-center mb-8" />
              
              {selectedScan && (
                <View>
                   <View className="flex-row items-center mb-8">
                      <View className="w-20 h-20 rounded-[30px] bg-brand-primary/10 items-center justify-center mr-6">
                         {selectedScan.avatar_url ? (
                           <Image source={{ uri: selectedScan.avatar_url }} className="w-full h-full rounded-[30px]" />
                         ) : (
                           <Text className="text-brand-primary font-black text-3xl">
                             {selectedScan.full_name?.charAt(0)}
                           </Text>
                         )}
                      </View>
                      <View>
                         <Text className="text-typography-main font-black text-2xl">{selectedScan.full_name}</Text>
                         <Text className="text-brand-primary font-black uppercase tracking-[2px] text-[10px] mt-1">{selectedScan.tier} Personnel</Text>
                         <View className="bg-surface-card border border-surface-border rounded-lg px-2 py-0.5 mt-2 self-start">
                            <Text className="text-typography-muted text-[10px] font-bold">{selectedScan.role}</Text>
                         </View>
                      </View>
                   </View>

                   <View className="flex-row flex-wrap -mx-2">
                      <View className="w-1/2 p-2">
                         <View className="bg-surface-card p-4 rounded-3xl border border-surface-border">
                            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1">Impact</Text>
                            <Text className="text-2xl font-black text-brand-primary">{selectedScan.contribution_points}</Text>
                            <Text className="text-[10px] text-typography-muted font-bold">Lifetime Points</Text>
                         </View>
                      </View>
                      <View className="w-1/2 p-2">
                         <View className="bg-surface-card p-4 rounded-3xl border border-surface-border">
                            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1">Velocity</Text>
                            <Text className="text-2xl font-black text-typography-main">{(selectedScan.velocity_hours || 0).toFixed(1)}h</Text>
                            <Text className="text-[10px] text-typography-muted font-bold">Avg daily work</Text>
                         </View>
                      </View>
                      <View className="w-1/2 p-2">
                         <View className="bg-surface-card p-4 rounded-3xl border border-surface-border">
                            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1">Quality</Text>
                            <Text className={`text-2xl font-black ${(selectedScan.flap_rate || 0) > 1.5 ? 'text-state-danger' : 'text-state-success'}`}>
                               {(selectedScan.flap_rate || 1.0).toFixed(2)}x
                            </Text>
                            <Text className="text-[10px] text-typography-muted font-bold">Attempt:Task Ratio</Text>
                         </View>
                      </View>
                      <View className="w-1/2 p-2">
                         <View className="bg-surface-card p-4 rounded-3xl border border-surface-border">
                            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1">Reliability</Text>
                            <Text className="text-2xl font-black text-typography-main">94%</Text>
                            <Text className="text-[10px] text-typography-muted font-bold">Target consistency</Text>
                         </View>
                      </View>
                   </View>

                   <TouchableOpacity 
                     onPress={() => setSelectedScan(null)}
                     className="bg-brand-primary w-full h-14 rounded-2xl items-center justify-center mt-8 premium-shadow"
                   >
                      <Text className="text-white font-black uppercase tracking-widest">Close Scan</Text>
                   </TouchableOpacity>
                </View>
              )}
           </View>
        </View>
      </Modal>
    </View>
  );
}
