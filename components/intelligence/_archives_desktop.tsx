import ConfirmModal from '@/components/common/ConfirmModal';
import { SnapshotDetailModal } from '@/components/intelligence/IntelligenceModals';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function IntelligenceArchives() {
  const { hasPermission }           = useAuth();
  const router                      = useRouter();
  const [archives, setArchives]     = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [search, setSearch]         = useState('');
  const debouncedSearch             = useDebounce(search, 500);
  const [activeSchema, setActiveSchema] = useState<{ pipelines: Set<string>; stages: Set<string> }>({
    pipelines: new Set(), stages: new Set(),
  });
  const [restoreModal, setRestoreModal]   = useState<{ visible: boolean; archive?: any }>({ visible: false });
  const [snapshotModal, setSnapshotModal] = useState<{ visible: boolean; data?: any }>({ visible: false });

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
      const isTask  = archive.entity_type === 'task';
      const targetId = isTask ? archive.snapshot?.task?.current_stage_id : archive.snapshot?.project?.pipeline_id;
      const set      = isTask ? activeSchema.stages : activeSchema.pipelines;
      if (targetId && !set.has(targetId)) {
        throw new Error(`Integrity violation: the target ${isTask ? 'stage' : 'pipeline'} no longer exists. Manual remapping required.`);
      }
      const rpc = archive.entity_type === 'project' ? 'rpc_restore_project' : 'rpc_restore_archive';
      const { data: newId, error } = await supabase.rpc(rpc, { p_archive_id: archive.id });
      if (error) throw error;
      await fetchArchives();
      setRestoreModal({ visible: false });
      if (archive.entity_type === 'project') router.push('/projects');
      else router.push(`/task/${newId}`);
    } catch (e: any) {
      console.error(e);
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
    <View className="flex-1 bg-surface-background flex-col">

      {/* ── Header ── */}
      <View className="px-10 pt-8 pb-5 flex-row flex-wrap items-start justify-between gap-4 border-b border-surface-border flex-shrink-0">
        <View className="min-w-0">
          <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[9px] mb-1">Intelligence Hub</Text>
          <Text className="text-typography-main text-4xl font-black tracking-tighter">Cold Storage</Text>
        </View>
        <View className="flex-row flex-wrap items-center justify-end gap-3 max-w-full">
          {/* Search */}
          <View className="flex-row items-center bg-surface-card border border-surface-border rounded-xl px-4 py-2.5 gap-3 w-full max-w-[320px] min-w-[220px]">
            <FontAwesome name="search" size={12} color="var(--color-text-muted)" />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search archives..."
              placeholderTextColor="var(--color-text-dim)"
              className="flex-1 text-typography-main text-sm font-medium outline-none bg-transparent"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <FontAwesome name="times-circle" size={12} color="var(--color-text-muted)" />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity onPress={fetchArchives} className="h-10 w-10 items-center justify-center bg-surface-card border border-surface-border rounded-xl shrink-0">
            <FontAwesome name="refresh" size={13} color="var(--color-primary)" />
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="var(--color-primary)" />
        </View>
      ) : archives.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <View className="bg-surface-card p-12 rounded-[3rem] border border-surface-border items-center max-w-[480px] premium-shadow">
            <View className="w-16 h-16 bg-surface-background rounded-full items-center justify-center mb-5 border border-surface-border">
              <FontAwesome name="archive" size={28} color="var(--color-text-muted)" />
            </View>
            <Text className="text-typography-main text-2xl font-black mb-2 text-center">
              {search ? 'No Results' : 'Empty Archive'}
            </Text>
            <Text className="text-typography-muted text-center text-sm leading-relaxed">
              {search ? `No archived items match "${search}".` : 'Archived tasks and projects will appear here.'}
            </Text>
          </View>
        </View>
      ) : (
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 40 }}>
          <View className="bg-surface-card rounded-[32px] border border-surface-border overflow-hidden premium-shadow">
            {/* Table header */}
            <View className="flex-row items-center px-8 py-4 border-b border-surface-border bg-surface-background/50">
              <Text className="flex-[3] text-typography-muted text-[9px] font-black uppercase tracking-widest">Entity</Text>
              <Text className="flex-1 text-typography-muted text-[9px] font-black uppercase tracking-widest">Type</Text>
              <Text className="flex-1 text-typography-muted text-[9px] font-black uppercase tracking-widest">Archived</Text>
              <Text className="w-24 text-center text-typography-muted text-[9px] font-black uppercase tracking-widest">Status</Text>
              <View className="w-40" />
            </View>

            {archives.map((archive, i) => {
              const hasIssue   = getIntegrityIssue(archive);
              const isRestored = !!archive.restored_at;
              const title      = archive.metadata?.title || archive.metadata?.name || 'Untitled';
              return (
                <View
                  key={archive.id}
                  className={`flex-row items-center px-8 py-5 ${i < archives.length - 1 ? 'border-b border-surface-border/50' : ''}`}
                >
                  {/* Icon + title */}
                  <View className="flex-[3] flex-row items-center gap-4">
                    <View className={`w-10 h-10 rounded-xl items-center justify-center ${isRestored ? 'bg-state-success/10' : 'bg-surface-background border border-surface-border'}`}>
                      <FontAwesome
                        name={archive.entity_type === 'project' ? 'briefcase' : 'tasks'}
                        size={16}
                        color={isRestored ? 'var(--color-success)' : 'var(--color-primary)'}
                      />
                    </View>
                    <View className="flex-1">
                      <Text className="text-typography-main font-black text-sm" numberOfLines={1}>{title}</Text>
                      {hasIssue && (
                        <View className="flex-row items-center gap-1.5 mt-0.5">
                          <FontAwesome name="warning" size={9} color="var(--color-danger)" />
                          <Text className="text-state-danger text-[9px] font-black uppercase">Integrity Issue</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  {/* Type */}
                  <Text className="flex-1 text-typography-muted text-xs font-bold capitalize">{archive.entity_type}</Text>
                  {/* Date */}
                  <Text className="flex-1 text-typography-muted text-xs">
                    {new Date(archive.archived_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                  {/* Status badge */}
                  <View className="w-24 items-center">
                    <View className={`px-3 py-1 rounded-full ${isRestored ? 'bg-state-success/10' : 'bg-surface-background border border-surface-border'}`}>
                      <Text className={`text-[9px] font-black uppercase tracking-widest ${isRestored ? 'text-state-success' : 'text-typography-muted'}`}>
                        {isRestored ? 'Restored' : 'Archived'}
                      </Text>
                    </View>
                  </View>
                  {/* Actions */}
                  <View className="w-40 flex-row items-center justify-end gap-2">
                    <TouchableOpacity
                      onPress={() => setSnapshotModal({ visible: true, data: archive.snapshot })}
                      className="bg-surface-background border border-surface-border px-3 py-1.5 rounded-lg flex-row items-center gap-1.5"
                    >
                      <FontAwesome name="eye" size={10} color="var(--color-text-muted)" />
                      <Text className="text-typography-muted text-[10px] font-bold">Snapshot</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => router.push('/intelligence/ReportGenerator')}
                      className="bg-brand-primary px-5 py-2.5 rounded-xl flex-row items-center gap-2 shrink-0"
                    >
                      <FontAwesome name="magic" size={11} color="white" />
                      <Text className="text-white font-black uppercase tracking-widest text-[10px]">Generate Report</Text>
                    </TouchableOpacity>
                    {!isRestored && !hasIssue && hasPermission('archive.restore') && (
                      <TouchableOpacity
                        onPress={() => setRestoreModal({ visible: true, archive })}
                        className="bg-brand-primary/10 border border-brand-primary/20 px-3 py-1.5 rounded-lg flex-row items-center gap-1.5"
                      >
                        <FontAwesome name="undo" size={10} color="var(--color-primary)" />
                        <Text className="text-brand-primary text-[10px] font-black">Restore</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}

      <ConfirmModal
        visible={restoreModal.visible}
        title={`Restore ${restoreModal.archive?.entity_type === 'project' ? 'Project' : 'Task'}`}
        description={`This will move "${restoreModal.archive?.metadata?.title || 'this item'}" back to the active pipeline. All historical data and attachments will be recovered.`}
        confirmLabel="Restore Data"
        variant="primary"
        loading={!!restoringId}
        onConfirm={() => restoreModal.archive && handleRestore(restoreModal.archive)}
        onCancel={() => setRestoreModal({ visible: false })}
      />

      <SnapshotDetailModal
        visible={snapshotModal.visible}
        data={snapshotModal.data}
        onClose={() => setSnapshotModal({ visible: false })}
      />
    </View>
  );
}
