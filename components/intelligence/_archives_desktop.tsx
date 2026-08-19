import ConfirmModal from '@/components/common/ConfirmModal';
import { EntityEmptyState } from '@/components/entities/EntityUI';
import { SnapshotDetailModal } from '@/components/intelligence/IntelligenceModals';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAlert } from '@/contexts/AlertContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import Tooltip from '@/components/common/Tooltip';

export default function IntelligenceArchives() {
  const colors = useThemeColors();
  const { hasPermission }           = useAuth();
  const router                      = useRouter();
  const { showAlert }               = useAlert();
  const { errorToast }              = useToast();
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
  const [selected, setSelected]           = useState<Set<string>>(new Set());
  const [deleting, setDeleting]           = useState(false);
  const [deleteModal, setDeleteModal]     = useState(false);

  useEffect(() => { fetchArchives(); }, [debouncedSearch]);

  const toggleSelected = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleSelectAll = () =>
    setSelected(prev => prev.size === archives.length ? new Set() : new Set(archives.map(a => a.id)));

  const handleBulkDelete = async () => {
    try {
      setDeleting(true);
      const { error } = await supabase.rpc('rpc_purge_archives', { p_archive_ids: Array.from(selected) });
      if (error) throw error;
      setSelected(new Set());
      setDeleteModal(false);
      await fetchArchives();
    } catch (e: any) {
      showAlert('Delete Failed', e.message);
    } finally { setDeleting(false); }
  };

  const fetchArchives = async () => {
    setLoading(true);
    try {
      const { data: archiveData, error } = await supabase.rpc('rpc_get_archives', { p_search: debouncedSearch || null });
      if (error) throw error;
      setArchives(archiveData || []);
      setSelected(new Set());
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
      errorToast(e.message || 'Could not restore this snapshot.', 'Restoration failed');
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
            <FontAwesome name="search" size={12} color={colors.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search archives..."
              placeholderTextColor={colors.textDim}
              className="flex-1 text-typography-main text-sm font-medium bg-transparent"
            />
            {search.length > 0 && (
              <Tooltip label="Clear search">
                <TouchableOpacity onPress={() => setSearch('')}>
                  <FontAwesome name="times-circle" size={12} color={colors.textMuted} />
                </TouchableOpacity>
              </Tooltip>
            )}
          </View>
          <Tooltip label="Refresh archives">
            <TouchableOpacity onPress={fetchArchives} className="h-10 w-10 items-center justify-center bg-surface-card border border-surface-border rounded-xl shrink-0">
              <FontAwesome name="refresh" size={13} color={colors.primary} />
            </TouchableOpacity>
          </Tooltip>
        </View>
      </View>

      {selected.size > 0 && hasPermission('archive.delete') && (
        <View className="mx-10 mt-5 flex-row items-center justify-between bg-state-danger/10 border border-state-danger/30 rounded-2xl px-6 py-3">
          <Text className="text-state-danger text-xs font-black uppercase tracking-wider">{selected.size} Selected</Text>
          <TouchableOpacity
            onPress={() => setDeleteModal(true)}
            className="bg-state-danger px-4 py-2 rounded-xl flex-row items-center gap-2"
          >
            <FontAwesome name="trash-o" size={11} color="#fff" />
            <Text className="text-white text-[10px] font-black uppercase tracking-widest">Delete Permanently</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : archives.length === 0 ? (
        <View className="flex-1 items-center justify-center px-10">
          <View className="bg-surface-card rounded-[32px] border border-surface-border premium-shadow max-w-[520px] w-full">
            <EntityEmptyState
              icon={search ? 'search' : 'archive'}
              title={search ? 'No Results' : 'Cold Storage is empty'}
              body={
                search
                  ? `No archived items match "${search}".`
                  : 'Tasks and projects you archive land here instead of disappearing — restore one anytime, or delete it permanently once you\'re sure.'
              }
            />
          </View>
        </View>
      ) : (
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 40 }}>
          <View className="bg-surface-card rounded-[32px] border border-surface-border overflow-hidden premium-shadow">
            {/* Table header */}
            <View className="flex-row items-center px-8 py-4 border-b border-surface-border bg-surface-background/50">
              {hasPermission('archive.delete') && (
                <Tooltip label={selected.size === 0 ? 'Select all' : 'Deselect all'}>
                  <TouchableOpacity onPress={toggleSelectAll} className="w-8 items-start">
                    <FontAwesome
                      name={selected.size > 0 && selected.size === archives.length ? 'check-square' : 'square-o'}
                      size={16}
                      color={selected.size > 0 ? colors.primary : colors.textMuted}
                    />
                  </TouchableOpacity>
                </Tooltip>
              )}
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
                  className={`flex-row items-center px-8 py-5 ${i < archives.length - 1 ? 'border-b border-surface-border/50' : ''} ${selected.has(archive.id) ? 'bg-brand-primary/5' : ''}`}
                >
                  {hasPermission('archive.delete') && (
                    <TouchableOpacity onPress={() => toggleSelected(archive.id)} className="w-8 items-start">
                      <FontAwesome
                        name={selected.has(archive.id) ? 'check-square' : 'square-o'}
                        size={16}
                        color={selected.has(archive.id) ? colors.primary : colors.textMuted}
                      />
                    </TouchableOpacity>
                  )}
                  {/* Icon + title */}
                  <View className="flex-[3] flex-row items-center gap-4">
                    <View className={`w-10 h-10 rounded-xl items-center justify-center ${isRestored ? 'bg-state-success/10' : 'bg-surface-background border border-surface-border'}`}>
                      <FontAwesome
                        name={archive.entity_type === 'project' ? 'folder-o' : 'tasks'}
                        size={16}
                        color={isRestored ? colors.success : colors.primary}
                      />
                    </View>
                    <View className="flex-1">
                      <Text className="text-typography-main font-black text-sm" numberOfLines={1}>{title}</Text>
                      {hasIssue && (
                        <View className="flex-row items-center gap-1.5 mt-0.5">
                          <FontAwesome name="exclamation-triangle" size={9} color={colors.danger} />
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
                      <FontAwesome name="eye" size={10} color={colors.textMuted} />
                      <Text className="text-typography-muted text-[10px] font-bold">Snapshot</Text>
                    </TouchableOpacity>
                    {!isRestored && !hasIssue && hasPermission('archive.restore') && (
                      <TouchableOpacity
                        onPress={() => setRestoreModal({ visible: true, archive })}
                        className="bg-brand-primary/10 border border-brand-primary/20 px-3 py-1.5 rounded-lg flex-row items-center gap-1.5"
                      >
                        <FontAwesome name="undo" size={10} color={colors.primary} />
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

      <ConfirmModal
        visible={deleteModal}
        title="Delete Permanently"
        description={`This will permanently delete ${selected.size} archived item${selected.size === 1 ? '' : 's'} and all associated snapshot data. This cannot be undone.`}
        confirmLabel="Delete Forever"
        variant="danger"
        loading={deleting}
        onConfirm={handleBulkDelete}
        onCancel={() => setDeleteModal(false)}
      />

      <SnapshotDetailModal
        visible={snapshotModal.visible}
        data={snapshotModal.data}
        onClose={() => setSnapshotModal({ visible: false })}
      />
    </View>
  );
}
