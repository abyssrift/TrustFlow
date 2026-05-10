import ConfirmModal from '@/components/common/ConfirmModal';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function IntelligenceArchivesNative() {
  const { hasPermission } = useAuth();
  const router = useRouter();
  const [archives, setArchives] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 500);
  const [activeSchema, setActiveSchema] = useState<{ pipelines: Set<string>; stages: Set<string> }>({
    pipelines: new Set(), stages: new Set(),
  });
  const [restoreModal, setRestoreModal] = useState<{ visible: boolean; archive?: any }>({ visible: false });

  useEffect(() => { fetchArchives(); }, [debouncedSearch]);

  const fetchArchives = async () => {
    setLoading(true);
    try {
      const { data: archiveData, error } = await supabase.rpc('rpc_get_archives', { p_search: debouncedSearch || null });
      if (error) throw error;
      setArchives(archiveData || []);
      const [pRes, sRes] = await Promise.all([
        supabase.from('pipelines').select('id'),
        supabase.from('pipeline_stages').select('id'),
      ]);
      setActiveSchema({
        pipelines: new Set(pRes.data?.map(p => p.id) || []),
        stages:    new Set(sRes.data?.map(s => s.id) || []),
      });
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleRestore = async (archive: any) => {
    try {
      setRestoringId(archive.id);
      const isTask   = archive.entity_type === 'task';
      const targetId = isTask ? archive.snapshot?.task?.current_stage_id : archive.snapshot?.project?.pipeline_id;
      const set      = isTask ? activeSchema.stages : activeSchema.pipelines;
      if (targetId && !set.has(targetId)) {
        throw new Error(`Integrity violation: the target ${isTask ? 'stage' : 'pipeline'} no longer exists.`);
      }
      const rpc = archive.entity_type === 'project' ? 'rpc_restore_project' : 'rpc_restore_archive';
      const { data: newId, error } = await supabase.rpc(rpc, { p_archive_id: archive.id });
      if (error) throw error;
      await fetchArchives();
      setRestoreModal({ visible: false });
      Alert.alert('Restored', 'Asset has been returned to the active pipeline.');
    } catch (e: any) {
      Alert.alert('Restoration Failed', e.message);
    } finally { setRestoringId(null); }
  };

  const getIntegrityIssue = (archive: any) => {
    const pid = archive.snapshot?.project?.pipeline_id ?? archive.snapshot?.pipeline_id;
    const sid = archive.snapshot?.task?.current_stage_id;
    if (archive.entity_type === 'project' && pid && !activeSchema.pipelines.has(pid)) return true;
    if (archive.entity_type === 'task' && sid && !activeSchema.stages.has(sid)) return true;
    return false;
  };

  return (
    <View className="flex-1 bg-surface-background">
      <View className="px-6 pt-14 pb-4">
        <Text className="text-brand-primary font-black uppercase tracking-[4px] text-[10px] mb-1">Intelligence Hub</Text>
        <Text className="text-typography-main text-3xl font-black">Cold Storage</Text>
      </View>

      <View className="px-6 mb-4 flex-row flex-wrap items-center gap-3">
        <View className="flex-1 flex-row items-center bg-surface-card border border-surface-border rounded-2xl px-4 py-3 gap-3">
          <FontAwesome name="search" size={12} color="rgb(var(--text-muted))" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search archives..."
            placeholderTextColor="rgb(var(--text-dim))"
            className="flex-1 text-typography-main text-sm"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <FontAwesome name="times-circle" size={12} color="rgb(var(--text-muted))" />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity onPress={fetchArchives} className="w-11 h-11 items-center justify-center bg-surface-card border border-surface-border rounded-2xl">
          <FontAwesome name="refresh" size={13} color="rgb(var(--brand-primary))" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
        </View>
      ) : archives.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <View className="bg-surface-card p-10 rounded-[2.5rem] border border-surface-border items-center w-full">
            <FontAwesome name="archive" size={32} color="rgb(var(--text-muted))" />
            <Text className="text-typography-main text-xl font-black mt-4 mb-2">
              {search ? 'No Results' : 'Empty Archive'}
            </Text>
            <Text className="text-typography-muted text-center text-sm leading-relaxed">
              {search ? `No archived items match "${search}".` : 'Archived tasks and projects will appear here.'}
            </Text>
          </View>
        </View>
      ) : (
        <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
          {archives.map((archive) => {
            const hasIssue   = getIntegrityIssue(archive);
            const isRestored = !!archive.restored_at;
            const title      = archive.metadata?.title || archive.metadata?.name || 'Untitled';
            return (
              <View key={archive.id} className="bg-surface-card border border-surface-border rounded-2xl p-5 mb-3 flex-row items-center">
                <View className={`w-11 h-11 rounded-xl items-center justify-center mr-4 ${isRestored ? 'bg-state-success/10' : 'bg-surface-background border border-surface-border'}`}>
                  <FontAwesome
                    name={archive.entity_type === 'project' ? 'briefcase' : 'tasks'}
                    size={16}
                    color={isRestored ? 'rgb(var(--state-success))' : 'rgb(var(--brand-primary))'}
                  />
                </View>
                <View className="flex-1 mr-3">
                  <Text className="text-typography-main font-black text-sm" numberOfLines={1}>{title}</Text>
                  <View className="flex-row items-center gap-2 mt-0.5">
                    <Text className="text-typography-muted text-[10px] capitalize">{archive.entity_type}</Text>
                    <Text className="text-typography-dim text-[10px]">·</Text>
                    <Text className="text-typography-muted text-[10px]">
                      {new Date(archive.archived_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </Text>
                    {isRestored && <View className="bg-state-success/10 px-1.5 py-0.5 rounded"><Text className="text-state-success text-[8px] font-black uppercase">Restored</Text></View>}
                    {hasIssue && <View className="bg-state-danger/10 px-1.5 py-0.5 rounded flex-row items-center gap-1"><FontAwesome name="warning" size={7} color="rgb(var(--state-danger))" /><Text className="text-state-danger text-[8px] font-black uppercase">Issue</Text></View>}
                  </View>
                </View>
                {!isRestored && !hasIssue && hasPermission('archive.restore') && (
                  <TouchableOpacity
                    onPress={() => setRestoreModal({ visible: true, archive })}
                    className="bg-brand-primary/10 border border-brand-primary/20 px-3 py-2 rounded-xl"
                  >
                    <Text className="text-brand-primary text-[10px] font-black">Restore</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
          <View className="h-10" />
        </ScrollView>
      )}

      <ConfirmModal
        visible={restoreModal.visible}
        title={`Restore ${restoreModal.archive?.entity_type === 'project' ? 'Project' : 'Task'}`}
        description={`This will move "${restoreModal.archive?.metadata?.title || 'this item'}" back to the active pipeline.`}
        confirmLabel="Restore"
        variant="primary"
        loading={!!restoringId}
        onConfirm={() => restoreModal.archive && handleRestore(restoreModal.archive)}
        onCancel={() => setRestoreModal({ visible: false })}
      />
    </View>
  );
}
