import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator, Alert,
    Dimensions,
    Modal, SafeAreaView,
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';

interface AssignmentModalProps {
  visible: boolean;
  taskId: string;
  pipelineId: string;
  initialSelectedIds: { users: string[]; teams: string[] };
  onClose: () => void;
  onSave: () => void;
}

const { width } = Dimensions.get('window');

export default function AssignmentModal({
  visible,
  taskId,
  pipelineId,
  initialSelectedIds,
  onClose,
  onSave
}: AssignmentModalProps) {
  const colors = useThemeColors();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'teams' | 'users'>('teams');
  const [teams, setTeams] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<Record<string, string[]>>({});
  const [counts, setCounts] = useState<{ users: Record<string, number>, teams: Record<string, number> }>({ users: {}, teams: {} });

  const [selectedIds, setSelectedIds] = useState(initialSelectedIds);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (visible) {
      fetchData();
      setSelectedIds(initialSelectedIds);
      setSearch('');
    }
  }, [visible, pipelineId, initialSelectedIds, profile?.company_id]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const companyId = profile?.company_id;
      if (!companyId) {
        setTeams([]);
        setUsers([]);
        setTeamMembers({});
        setCounts({ users: {}, teams: {} });
        return;
      }

      const { data: teamData } = await supabase.from('teams').select('id, name').is('deleted_at', null).eq('company_id', companyId).order('name');
      setTeams(teamData || []);

      const { data: userData } = await supabase.from('users').select('id, full_name, email, avatar_url').is('deleted_at', null).eq('company_id', companyId).order('full_name');
      setUsers(userData || []);

      // Fetch team members for this company's teams only
      const teamIds = (teamData || []).map((t: any) => t.id);
      const membersByTeam: Record<string, string[]> = {};
      if (teamIds.length > 0) {
        const { data: memberData } = await supabase.from('team_members').select('team_id, user_id').is('removed_at', null).in('team_id', teamIds);
        memberData?.forEach((m: any) => {
          if (!membersByTeam[m.team_id]) membersByTeam[m.team_id] = [];
          membersByTeam[m.team_id].push(m.user_id);
        });
      }
      setTeamMembers(membersByTeam);

      const { data: userCounts } = await supabase.rpc('rpc_get_active_task_counts', { p_pipeline_id: pipelineId, p_type: 'user' });
      const { data: teamCounts } = await supabase.rpc('rpc_get_active_task_counts', { p_pipeline_id: pipelineId, p_type: 'team' });

      const uMap: Record<string, number> = {};
      userCounts?.forEach((i: any) => uMap[i.id] = i.count);
      const tMap: Record<string, number> = {};
      teamCounts?.forEach((i: any) => tMap[i.id] = i.count);

      setCounts({ users: uMap, teams: tMap });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const { error } = await supabase.rpc('rpc_update_task_assignments', {
        p_task_id: taskId,
        p_user_ids: selectedIds.users,
        p_team_ids: selectedIds.teams
      });
      if (error) throw error;
      onSave();
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const filteredItems = useMemo(() => {
    if (activeTab === 'teams') {
      return teams.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));
    }
    return users.filter(u => 
      (u.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (u.email || '').toLowerCase().includes(search.toLowerCase())
    );
  }, [activeTab, teams, users, search]);

  return (
    <Modal visible={visible} animationType="slide" transparent={true}>
      <View className="flex-1 bg-surface-background">
        <SafeAreaView className="flex-1">
          {/* HEADER */}
          <View className="px-6 py-4 border-b border-surface-border flex-row items-center justify-between">
            <View>
              <Text className="text-typography-main font-black text-2xl">Assign Task</Text>
              <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">Protocol Assignment</Text>
            </View>
            <TouchableOpacity onPress={onClose} className="p-2">
              <FontAwesome name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* TABS */}
          <View className="flex-row px-6 py-4 gap-4">
             <TouchableOpacity 
               onPress={() => setActiveTab('teams')}
               className={`flex-1 py-3 rounded-xl items-center border transition-all ${activeTab === 'teams' ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
             >
                <Text className={`font-black text-[10px] uppercase tracking-widest ${activeTab === 'teams' ? 'text-white' : 'text-typography-muted'}`}>Teams</Text>
             </TouchableOpacity>
             <TouchableOpacity 
               onPress={() => setActiveTab('users')}
               className={`flex-1 py-3 rounded-xl items-center border transition-all ${activeTab === 'users' ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
             >
                <Text className={`font-black text-[10px] uppercase tracking-widest ${activeTab === 'users' ? 'text-white' : 'text-typography-muted'}`}>Individuals</Text>
             </TouchableOpacity>
          </View>

          {/* SEARCH */}
          <View className="px-6 mb-4">
             <View className="relative bg-surface-card border border-surface-border rounded-xl">
                <View className="absolute left-4 top-3.5 z-10">
                   <FontAwesome name="search" size={14} color={colors.textMuted} />
                </View>
                <TextInput 
                  placeholder={`Search ${activeTab === 'teams' ? 'teams' : 'agents'}...`}
                  placeholderTextColor={colors.textDim}
                  value={search}
                  onChangeText={setSearch}
                  className="px-12 py-3.5 text-typography-main font-bold"
                />
             </View>
          </View>

          {/* LIST */}
          {loading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
               <View className="pb-20 gap-3">
                  {filteredItems.map(item => {
                    const isSelected = activeTab === 'teams' 
                      ? selectedIds.teams.includes(item.id)
                      : selectedIds.users.includes(item.id);
                    const taskCount = activeTab === 'teams' ? counts.teams[item.id] || 0 : counts.users[item.id] || 0;
                    
                    return (
                      <TouchableOpacity 
                        key={item.id}
                        onPress={() => {
                          if (activeTab === 'teams') {
                            setSelectedIds(prev => {
                              const newTeams = isSelected ? prev.teams.filter(id => id !== item.id) : [...prev.teams, item.id];
                              let newUsers = [...prev.users];
                              // Auto-select/deselect team members
                              const teamUserIds = teamMembers[item.id] || [];
                              if (isSelected) {
                                // Removing team: remove its members if no other selected team has them
                                newUsers = newUsers.filter(uid => {
                                  const remainingTeams = newTeams;
                                  return remainingTeams.some(tid => (teamMembers[tid] || []).includes(uid));
                                });
                              } else {
                                // Adding team: add its members
                                newUsers = [...new Set([...newUsers, ...teamUserIds])];
                              }
                              return { ...prev, teams: newTeams, users: newUsers };
                            });
                          } else {
                            setSelectedIds(prev => ({
                              ...prev,
                              users: isSelected ? prev.users.filter(id => id !== item.id) : [...prev.users, item.id]
                            }));
                          }
                        }}
                        className={`p-4 rounded-2xl border flex-row items-center justify-between ${isSelected ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-card border-surface-border'}`}
                      >
                         <View className="flex-row items-center flex-1">
                            <View className={`w-10 h-10 rounded-full items-center justify-center mr-4 ${isSelected ? 'bg-brand-primary' : 'bg-surface-background'}`}>
                               <FontAwesome name={activeTab === 'teams' ? 'users' : 'user'} size={14} color={isSelected ? '#ffffff' : colors.primary} />
                            </View>
                            <View>
                               <Text className={`font-black text-sm ${isSelected ? 'text-typography-main' : 'text-typography-label'}`}>{item.name || item.full_name || item.email}</Text>
                               <Text className="text-[9px] text-typography-muted font-bold uppercase tracking-tight mt-0.5">Active Tasks: {taskCount}</Text>
                            </View>
                         </View>
                         {isSelected && <FontAwesome name="check-circle" size={20} color={colors.primary} />}
                      </TouchableOpacity>
                    );
                  })}
               </View>
            </ScrollView>
          )}

          {/* FOOTER */}
          <View className="p-6 border-t border-surface-border bg-surface-card flex-row gap-4">
             <TouchableOpacity onPress={onClose} className="flex-1 py-4 items-center bg-surface-background border border-surface-border rounded-xl">
                <Text className="text-typography-muted font-black text-[10px] uppercase tracking-widest">Cancel</Text>
             </TouchableOpacity>
             <TouchableOpacity 
               onPress={handleSave} 
               disabled={saving}
               className="flex-2 bg-brand-primary py-4 items-center rounded-xl shadow-lg shadow-brand-primary/20"
             >
               {saving ? <ActivityIndicator color={colors.textMain} /> : <Text className="text-white font-black text-[10px] uppercase tracking-widest px-8">Save Assignments</Text>}
             </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
