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

export default function PeopleScreenWeb() {
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
        className="w-[calc(25%-15px)] bg-surface-card p-6 rounded-[32px] border border-surface-border mb-5 premium-shadow hover:border-brand-primary transition-all group"
      >
        <View className="items-center mb-6">
           <View className="w-24 h-24 rounded-[32px] bg-brand-primary/10 items-center justify-center mb-4 group-hover:scale-105 transition-transform">
              {member.avatar_url ? (
                <Image source={{ uri: member.avatar_url }} className="w-full h-full rounded-[32px]" />
              ) : (
                <Text className="text-brand-primary font-black text-4xl">
                  {member.full_name?.charAt(0) || '?'}
                </Text>
              )}
           </View>
           <Text className="text-typography-main font-black text-xl text-center" numberOfLines={1}>{member.full_name || 'Anonymous'}</Text>
           <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mt-2">{member.tier || 'Personnel'}</Text>
        </View>
        
        <View className="flex-row items-center justify-between pt-6 border-t border-surface-border/50">
           <View className="flex-row items-center">
              <View style={{ backgroundColor: getRoleColor(member.role) }} className="w-2 h-2 rounded-full mr-2" />
              <Text style={{ color: getRoleColor(member.role) }} className="text-[10px] font-black uppercase tracking-tighter">
                {member.role || 'Member'}
              </Text>
           </View>
           <FontAwesome name="chevron-right" size={10} className="text-typography-dim" />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View className="flex-1 bg-surface-background p-10">
      <View className="max-w-[1600px] mx-auto w-full">
        {/* Header */}
        <View className="flex-row items-center justify-between mb-12">
          <View>
            <Text className="text-typography-main text-5xl font-black tracking-tighter">Team</Text>
            <Text className="text-typography-muted text-lg mt-2 font-medium">Manage team members, roles, and performance</Text>
          </View>
          
          <View className="flex-row items-center gap-6">
            {joinCode && (
              <View className="bg-surface-card border border-surface-border rounded-2xl px-6 flex-row items-center h-14 premium-shadow mr-2">
                <View>
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-0.5">Join Code</Text>
                  <Text className="text-brand-primary font-black text-lg tracking-[0.2em]">{joinCode}</Text>
                </View>
                <TouchableOpacity 
                  onPress={() => Clipboard.setStringAsync(joinCode)}
                  className="ml-6 w-10 h-10 bg-brand-primary/10 rounded-xl items-center justify-center hover:bg-brand-primary/20 transition-colors"
                >
                  <FontAwesome name="copy" size={14} color="rgb(var(--brand-primary))" />
                </TouchableOpacity>
              </View>
            )}

            <View className="bg-surface-card border border-surface-border rounded-2xl px-6 flex-row items-center h-14 premium-shadow w-[400px]">
               <FontAwesome name="search" size={16} className="text-typography-dim" />
               <TextInput 
                 placeholder="Search team members..."
                 placeholderTextColor="rgb(var(--typography-muted))"
                 className="flex-1 ml-4 text-typography-main font-bold outline-none"
                 value={searchQuery}
                 onChangeText={setSearchQuery}
               />
            </View>
            
            <TouchableOpacity className="bg-brand-primary px-8 py-4 rounded-2xl premium-shadow flex-row items-center active:scale-95 transition-transform">
              <FontAwesome name="user-plus" size={14} color="white" className="mr-3" />
              <Text className="text-white font-black uppercase tracking-widest text-xs">Add Member</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <View className="py-40 items-center justify-center">
            <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
          </View>
        ) : (
          <ScrollView 
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="rgb(var(--brand-primary))" />}
          >
            <View className="flex-row flex-wrap gap-5">
              {members.length === 0 ? (
                <View className="w-full items-center justify-center py-40 bg-surface-card/50 rounded-[48px] border border-dashed border-surface-border">
                   <FontAwesome name="users" size={48} className="text-typography-dim mb-6" />
                   <Text className="text-typography-main text-2xl font-black">No matching records found</Text>
                   <Text className="text-typography-muted mt-2">The search query did not yield any team records.</Text>
                </View>
              ) : (
                members.map(renderMemberCard)
              )}
            </View>
            <View className="h-20" />
          </ScrollView>
        )}
      </View>

      {/* DEEP SCAN MODAL */}
      <Modal
        visible={!!selectedScan}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setSelectedScan(null)}
      >
        <View className="flex-1 bg-black/70 items-center justify-center p-10">
           <Pressable className="absolute inset-0" onPress={() => setSelectedScan(null)} />
           <View className="bg-surface-card w-full max-w-4xl rounded-[48px] border border-surface-border premium-shadow overflow-hidden flex-row">
              {selectedScan && (
                <>
                  <View className="w-1/3 bg-surface-background p-10 border-r border-surface-border items-center">
                     <View className="w-48 h-48 rounded-[48px] bg-brand-primary/10 items-center justify-center mb-8 border border-brand-primary/20">
                        {selectedScan.avatar_url ? (
                          <Image source={{ uri: selectedScan.avatar_url }} className="w-full h-full rounded-[48px]" />
                        ) : (
                          <Text className="text-brand-primary font-black text-6xl">
                            {selectedScan.full_name?.charAt(0)}
                          </Text>
                        )}
                     </View>
                     <Text className="text-typography-main font-black text-2xl text-center mb-2">{selectedScan.full_name}</Text>
                     <View className="bg-brand-primary/10 px-4 py-1.5 rounded-full border border-brand-primary/30 mb-6">
                        <Text className="text-brand-primary font-black uppercase tracking-widest text-[10px]">{selectedScan.tier || 'UNRANKED'} USER</Text>
                     </View>
                     <Text className="text-typography-muted text-sm font-medium mb-10">{selectedScan.email}</Text>
                     
                     <TouchableOpacity 
                       onPress={() => setSelectedScan(null)}
                       className="bg-brand-primary w-full py-5 rounded-2xl items-center premium-shadow"
                     >
                        <Text className="text-white font-black uppercase tracking-widest text-xs">Close</Text>
                     </TouchableOpacity>
                  </View>

                  <View className="flex-1 p-12">
                     <Text className="text-typography-main font-black text-3xl tracking-tight mb-10">Member Intelligence</Text>
                     
                     <View className="flex-row flex-wrap -mx-3">
                        <MetricBox label="Impact" val={selectedScan.contribution_points} desc="Cumulative contribution points" />
                        <MetricBox label="Velocity" val={`${(selectedScan.velocity_hours || 0).toFixed(1)}h`} desc="Average daily engagement" />
                        <MetricBox label="Quality" val={`${(selectedScan.flap_rate || 1.0).toFixed(2)}x`} desc="Success to attempt ratio" danger={(selectedScan.flap_rate || 0) > 1.5} />
                        <MetricBox label="Reliability" val="94.2%" desc="Target consistency" />
                     </View>

                     <View className="mt-12 p-8 bg-surface-background rounded-3xl border border-surface-border">
                        <Text className="text-typography-main font-black uppercase tracking-widest text-[10px] mb-6">Access Authorization</Text>
                        <View className="flex-row items-center justify-between mb-4 pb-4 border-b border-surface-border/50">
                           <Text className="text-typography-muted font-bold">Role</Text>
                           <Text className="text-typography-main font-black uppercase">{selectedScan.role}</Text>
                        </View>
                        <View className="flex-row items-center justify-between">
                           <Text className="text-typography-muted font-bold">Permission Tier</Text>
                           <Text className="text-brand-primary font-black uppercase tracking-widest">{selectedScan.tier || 'STANDARD'}</Text>
                        </View>
                     </View>
                  </View>
                </>
              )}
           </View>
        </View>
      </Modal>
    </View>
  );
}

const MetricBox = ({ label, val, desc, danger = false }: any) => (
  <View className="w-1/2 p-3">
    <View className="bg-surface-background p-6 rounded-[32px] border border-surface-border h-full">
      <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-3">{label}</Text>
      <Text className={`text-4xl font-black mb-2 ${danger ? 'text-state-danger' : 'text-brand-primary'}`}>{val}</Text>
      <Text className="text-typography-muted text-[10px] font-medium leading-relaxed">{desc}</Text>
    </View>
  </View>
);
