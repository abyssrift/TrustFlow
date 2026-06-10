import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert,
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

export default function AssignmentModal({
  visible,
  taskId,
  pipelineId,
  initialSelectedIds,
  onClose,
  onSave
}: AssignmentModalProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [teams, setTeams] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [counts, setCounts] = useState<{ users: Record<string, number>, teams: Record<string, number> }>({ users: {}, teams: {} });
  
  const [selectedIds, setSelectedIds] = useState(initialSelectedIds);
  const [teamSearch, setTeamSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const colors = useThemeColors();

  const { user: currentUser } = useAuth();

  useEffect(() => {
    if (visible) {
      fetchData();
      setSelectedIds(initialSelectedIds);
    }
  }, [visible, pipelineId, initialSelectedIds]);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // 1. Fetch Teams
      const { data: teamData } = await supabase
        .from('teams')
        .select('id, name')
        .is('deleted_at', null)
        .order('name');
      setTeams(teamData || []);

      // 2. Fetch Users
      const { data: userData } = await supabase
        .from('users')
        .select('id, full_name, email, avatar_url')
        .is('deleted_at', null)
        .order('full_name');
      setUsers(userData || []);

      // 3. Fetch Task Counts
      // Using separate queries for clarity and reliability
      const { data: userCounts } = await supabase.rpc('rpc_get_active_task_counts', { 
        p_pipeline_id: pipelineId,
        p_type: 'user'
      });
      const { data: teamCounts } = await supabase.rpc('rpc_get_active_task_counts', { 
        p_pipeline_id: pipelineId,
        p_type: 'team'
      });

      const userCountMap: Record<string, number> = {};
      userCounts?.forEach((item: any) => userCountMap[item.id] = item.count);

      const teamCountMap: Record<string, number> = {};
      teamCounts?.forEach((item: any) => teamCountMap[item.id] = item.count);

      setCounts({ users: userCountMap, teams: teamCountMap });

    } catch (err) {
      console.error('[AssignmentModal] Fetch Error:', err);
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
      Alert.alert('Assignment Failed', err.message);
    } finally {
      setSaving(false);
    }
  };

  const filteredTeams = useMemo(() => 
    teams.filter(t => t.name.toLowerCase().includes(teamSearch.toLowerCase())),
    [teams, teamSearch]
  );

  const filteredUsers = useMemo(() => 
    users.filter(u => 
      (u.full_name || '').toLowerCase().includes(userSearch.toLowerCase()) ||
      (u.email || '').toLowerCase().includes(userSearch.toLowerCase())
    ),
    [users, userSearch]
  );

  if (!visible) return null;

  return (
    <View className="absolute inset-0 bg-surface-background/40 z-[999] items-center justify-center p-6" style={{ backdropFilter: 'blur(16px)' } as any}>
      <View className="bg-surface-card w-full max-w-4xl rounded-[2.5rem] border border-surface-border overflow-hidden premium-shadow-lg flex-col max-h-[90vh]">
        
        {/* HEADER */}
        <View className="p-8 border-b border-surface-border flex-row items-center justify-between bg-surface-card/80">
          <View>
            <Text className="text-typography-main font-black text-3xl tracking-tight">Assign Task</Text>
            <View className="flex-row items-center mt-1">
              <View className="w-2 h-2 rounded-full bg-brand-primary mr-2" />
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em]">Resource Allocation Protocol</Text>
            </View>
          </View>
          <TouchableOpacity 
            onPress={onClose}
            className="w-12 h-12 bg-surface-background rounded-full items-center justify-center border border-surface-border hover:bg-surface-overlay transition-colors"
          >
            <FontAwesome name="times" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center p-20">
            <ActivityIndicator size="large" color={colors.primary} />
            <Text className="text-typography-muted font-bold mt-4 uppercase tracking-widest text-[10px]">Synchronizing Registry...</Text>
          </View>
        ) : (
          <View className="flex-1 flex-row">
            
            {/* TEAMS SECTION */}
            <View className="flex-1 border-r border-surface-border p-6 flex-col">
              <View className="mb-6">
                <Text className="text-typography-dim text-[10px] font-black uppercase tracking-[0.2em] mb-4 ml-1">Tactical Teams ({filteredTeams.length})</Text>
                <View className="relative">
                  <View className="absolute left-4 top-3.5 z-10">
                    <FontAwesome name="search" size={14} color={colors.textMuted} />
                  </View>
                  <TextInput 
                    placeholder="Search teams..."
                    placeholderTextColor={colors.textDim}
                    value={teamSearch}
                    onChangeText={setTeamSearch}
                    className="bg-surface-background border border-surface-border rounded-xl px-12 py-3.5 text-typography-main font-medium focus:border-brand-primary transition-all"
                  />
                </View>
              </View>

              <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
                <View className="gap-2 pb-4">
                  {filteredTeams.map(t => {
                    const isSelected = selectedIds.teams.includes(t.id);
                    const taskCount = counts.teams[t.id] || 0;
                    return (
                      <TouchableOpacity 
                        key={t.id}
                        onPress={() => {
                          setSelectedIds(prev => ({
                            ...prev,
                            teams: isSelected ? prev.teams.filter(id => id !== t.id) : [...prev.teams, t.id]
                          }));
                        }}
                        className={`flex-row items-center justify-between p-4 rounded-2xl border transition-all ${
                          isSelected 
                            ? 'bg-brand-primary/10 border-brand-primary premium-shadow' 
                            : 'bg-surface-background/50 border-surface-border hover:bg-surface-overlay'
                        }`}
                      >
                        <View className="flex-row items-center flex-1">
                          <View className={`w-10 h-10 rounded-xl items-center justify-center mr-4 ${isSelected ? 'bg-brand-primary text-white' : 'bg-surface-overlay border border-surface-border'}`}>
                            <FontAwesome name="users" size={16} color={isSelected ? 'white' : colors.primary} />
                          </View>
                          <View>
                            <Text className={`font-bold ${isSelected ? 'text-typography-main' : 'text-typography-label'}`}>{t.name}</Text>
                            <View className="flex-row items-center mt-0.5">
                              <Text className="text-[10px] text-typography-muted font-bold uppercase tracking-tight">Active Tasks: </Text>
                              <Text className={`text-[10px] font-black ${taskCount > 3 ? 'text-state-warning' : 'text-state-success'}`}>{taskCount}</Text>
                            </View>
                          </View>
                        </View>
                        {isSelected && (
                          <View className="w-6 h-6 rounded-full bg-brand-primary items-center justify-center shadow-lg shadow-brand-primary/50">
                            <FontAwesome name="check" size={12} color="white" />
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                  {filteredTeams.length === 0 && (
                    <View className="items-center justify-center py-10 opacity-30">
                      <FontAwesome name="users" size={32} color={colors.textMuted} />
                      <Text className="text-typography-muted text-xs font-black uppercase tracking-widest mt-4">No Teams Found</Text>
                    </View>
                  )}
                </View>
              </ScrollView>
            </View>

            {/* INDIVIDUALS SECTION */}
            <View className="flex-1 p-6 flex-col">
              <View className="mb-6">
                <Text className="text-typography-dim text-[10px] font-black uppercase tracking-[0.2em] mb-4 ml-1">Individual Agents ({filteredUsers.length})</Text>
                <View className="relative">
                  <View className="absolute left-4 top-3.5 z-10">
                    <FontAwesome name="search" size={14} color={colors.textMuted} />
                  </View>
                  <TextInput 
                    placeholder="Filter by name or email..."
                    placeholderTextColor={colors.textDim}
                    value={userSearch}
                    onChangeText={setUserSearch}
                    className="bg-surface-background border border-surface-border rounded-xl px-12 py-3.5 text-typography-main font-medium focus:border-brand-primary transition-all"
                  />
                </View>
              </View>

              <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
                <View className="gap-2 pb-4">
                  {filteredUsers.map(u => {
                    const isSelected = selectedIds.users.includes(u.id);
                    const taskCount = counts.users[u.id] || 0;
                    const initials = (u.full_name || u.email || '?').charAt(0).toUpperCase();
                    
                    return (
                      <TouchableOpacity 
                        key={u.id}
                        onPress={() => {
                          setSelectedIds(prev => ({
                            ...prev,
                            users: isSelected ? prev.users.filter(id => id !== u.id) : [...prev.users, u.id]
                          }));
                        }}
                        className={`flex-row items-center justify-between p-4 rounded-2xl border transition-all ${
                          isSelected 
                            ? 'bg-brand-primary/10 border-brand-primary premium-shadow' 
                            : 'bg-surface-background/50 border-surface-border hover:bg-surface-overlay'
                        }`}
                      >
                        <View className="flex-row items-center flex-1">
                          <View className={`w-10 h-10 rounded-full items-center justify-center mr-4 border ${isSelected ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}>
                             <Text className={`font-black text-xs ${isSelected ? 'text-white' : 'text-typography-muted'}`}>{initials}</Text>
                          </View>
                          <View>
                            <Text className={`font-bold ${isSelected ? 'text-typography-main' : 'text-typography-label'}`}>{u.full_name || u.email}</Text>
                            <View className="flex-row items-center mt-0.5">
                              <Text className="text-[10px] text-typography-muted font-bold uppercase tracking-tight">Active Load: </Text>
                              <Text className={`text-[10px] font-black ${taskCount > 5 ? 'text-state-danger' : taskCount > 2 ? 'text-state-warning' : 'text-state-success'}`}>{taskCount} Tasks</Text>
                            </View>
                          </View>
                        </View>
                        {isSelected && (
                          <View className="w-6 h-6 rounded-full bg-brand-primary items-center justify-center shadow-lg shadow-brand-primary/50">
                            <FontAwesome name="check" size={12} color="white" />
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                  {filteredUsers.length === 0 && (
                    <View className="items-center justify-center py-10 opacity-30">
                      <FontAwesome name="user" size={32} color={colors.textMuted} />
                      <Text className="text-typography-muted text-xs font-black uppercase tracking-widest mt-4">No Agents Found</Text>
                    </View>
                  )}
                </View>
              </ScrollView>
            </View>
          </View>
        )}

        {/* FOOTER */}
        <View className="p-8 border-t border-surface-border bg-surface-card/50 flex-row gap-6">
          <TouchableOpacity 
            onPress={onClose}
            className="flex-1 py-4 rounded-xl border border-surface-border items-center hover:bg-surface-overlay transition-colors"
          >
            <Text className="text-typography-muted font-black uppercase tracking-widest text-xs">Abandom Assignment</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={handleSave}
            disabled={saving}
            className="flex-1 bg-brand-primary py-4 rounded-xl items-center premium-shadow active:scale-[0.98] transition-all"
          >
            {saving ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-black uppercase tracking-widest text-xs">Execute & Save Changes</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
