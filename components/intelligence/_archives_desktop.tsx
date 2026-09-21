import ConfirmModal from '@/components/common/ConfirmModal';
import FilterPanel, { FilterChipGroup, FilterSection } from '@/components/common/FilterPanel';
import MultiViewList from '@/components/common/MultiViewList';
import Tooltip from '@/components/common/Tooltip';
import { FilterChip } from '@/components/entities/EntityUI';
import { SnapshotDetailModal } from '@/components/intelligence/IntelligenceModals';
import IntelligencePageHeader from '@/components/intelligence/IntelligencePageHeader';
import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useCollapsibleHeaderScroll, CollapsibleHeaderProvider } from '@/hooks/useCollapsibleHeader';
import { useCollectionSelection } from '@/hooks/useCollectionSelection';
import { useDebounce } from '@/hooks/useDebounce';
import { useThemeColors } from '@/hooks/useThemeColors';
import {
  filterArchives,
  getArchiveCounts,
  getArchiveEmptyState,
  getArchiveIntegrityIssue,
  type ArchiveEntityFilter,
  type ArchiveStatusFilter,
} from '@/lib/archivePresentation';
import { pruneSelection } from '@/lib/multiSelection';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

const ENTITY_FILTERS: { id: ArchiveEntityFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'task', label: 'Tasks' },
  { id: 'project', label: 'Projects' },
];

const STATUS_FILTERS: { id: ArchiveStatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'archived', label: 'Archived' },
  { id: 'restored', label: 'Restored' },
  { id: 'conflict', label: 'Conflict' },
];

export default function IntelligenceArchives() {
  return (
    <CollapsibleHeaderProvider>
      <IntelligenceArchivesInner />
    </CollapsibleHeaderProvider>
  );
}

function IntelligenceArchivesInner() {
  const colors = useThemeColors();
  const headerScroll = useCollapsibleHeaderScroll();
  const { hasPermission } = useAuth();
  const router = useRouter();
  const { showAlert } = useAlert();
  const { errorToast } = useToast();
  const [archives, setArchives] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 500);
  const [includeCompany, setIncludeCompany] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<{ entity: ArchiveEntityFilter; status: ArchiveStatusFilter }>({
    entity: 'all', status: 'all',
  });
  const [activeSchema, setActiveSchema] = useState<{ pipelineIds: Set<string>; stageIds: Set<string> }>({
    pipelineIds: new Set(), stageIds: new Set(),
  });
  const [restoreModal, setRestoreModal] = useState<{ visible: boolean; archive?: any }>({ visible: false });
  const [snapshotModal, setSnapshotModal] = useState<{ visible: boolean; data?: any }>({ visible: false });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);

  const canViewAll = hasPermission('archive.view_all');
  const canPurge = hasPermission('archive.delete') && canViewAll;
  const selection = useCollectionSelection({
    active: selectedIds.length > 0,
    selectedIds,
    onActiveChange: () => {},
    onSelectedIdsChange: setSelectedIds,
  });
  const filteredArchives = useMemo(
    () => filterArchives(archives, filters, activeSchema),
    [archives, filters, activeSchema],
  );
  const counts = useMemo(() => getArchiveCounts(archives, activeSchema), [archives, activeSchema]);
  const filtersActive = filters.entity !== 'all' || filters.status !== 'all';

  const fetchArchives = async () => {
    setLoading(true);
    try {
      const { data: archiveData, error } = await supabase.rpc('rpc_get_archives', {
        p_search: debouncedSearch || null,
        p_include_company: canViewAll && includeCompany,
      });
      if (error) throw error;
      const [pRes, sRes] = await Promise.all([
        supabase.from('pipelines').select('id'),
        supabase.from('pipeline_stages').select('id'),
      ]);
      const nextArchives = archiveData || [];
      setArchives(nextArchives);
      // Prune only archives confirmed absent from the current server scope/search result.
      setSelectedIds((prev) => pruneSelection(prev, nextArchives.map((archive: any) => archive.id)));
      setActiveSchema({
        pipelineIds: new Set(pRes.data?.map((pipeline) => pipeline.id) || []),
        stageIds: new Set(sRes.data?.map((stage) => stage.id) || []),
      });
      return true;
    } catch (error) {
      console.error(error);
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchArchives(); }, [debouncedSearch, includeCompany, canViewAll]);

  const handleBulkDelete = async () => {
    if (!hasPermission('archive.delete') || !hasPermission('archive.view_all')) {
      showAlert('Unavailable', 'You no longer have permission to purge archives.');
      return;
    }
    const idsToPurge = [...selectedIds];
    if (!idsToPurge.length) return;
    try {
      setDeleting(true);
      const { error } = await supabase.rpc('rpc_purge_archives', { p_archive_ids: idsToPurge });
      if (error) throw error;
      setSelectedIds([]);
      const refreshed = await fetchArchives();
      if (refreshed) setDeleteModal(false);
      else showAlert('Delete Succeeded', 'The archives were deleted, but the list could not be refreshed.');
    } catch (error: any) {
      showAlert('Delete Failed', error.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleRestore = async (archive: any) => {
    if (!hasPermission('archive.restore')) {
      errorToast('You no longer have permission to restore archives.', 'Restoration unavailable');
      return;
    }
    const integrityIssue = getArchiveIntegrityIssue(archive, activeSchema);
    if (archive.restored_at || integrityIssue) {
      errorToast(integrityIssue || 'This archive has already been restored.', 'Restoration unavailable');
      return;
    }
    try {
      setRestoringId(archive.id);
      const rpc = archive.entity_type === 'project' ? 'rpc_restore_project' : 'rpc_restore_archive';
      const { data: newId, error } = await supabase.rpc(rpc, { p_archive_id: archive.id });
      if (error) throw error;
      await fetchArchives();
      setRestoreModal({ visible: false });
      if (archive.entity_type === 'project') router.push('/projects');
      else router.push(`/task/${newId}`);
    } catch (error: any) {
      console.error(error);
      errorToast(error.message || 'Could not restore this snapshot.', 'Restoration failed');
    } finally {
      setRestoringId(null);
    }
  };

  const clearFilters = () => setFilters({ entity: 'all', status: 'all' });
  const emptyState = getArchiveEmptyState({
    serverTotal: archives.length,
    shownCount: filteredArchives.length,
    searchActive: !!debouncedSearch,
    filtersActive,
  });

  const toggleSelection = (archive: any) => selection.toggle(archive.id);
  const selectionProps = canPurge ? {
    active: selectedIds.length > 0,
    selectedIds,
    onToggle: toggleSelection,
    onPress: (archive: any, event: any) => {
      if (event.shiftKey) selection.selectRange(filteredArchives.map((row) => row.id), archive.id, event.ctrlKey || event.metaKey);
      else selection.toggle(archive.id);
    },
    onLongPress: (archive: any) => selection.enter(archive.id),
    onKeyDown: (archive: any, event: any) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault?.();
        if (event.shiftKey) selection.selectRange(filteredArchives.map((row) => row.id), archive.id, event.ctrlKey || event.metaKey);
        else selection.toggle(archive.id);
      }
    },
    renderIndicator: (archive: any, selected: boolean) => (
      <Tooltip label={selected ? 'Deselect archive' : 'Select archive'}>
        <TouchableOpacity
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          onPress={(event: any) => { event.stopPropagation?.(); selection.toggle(archive.id); }}
          className="h-11 w-11 items-center justify-center rounded-lg"
        >
          <FontAwesome name={selected ? 'check-square' : 'square-o'} size={16} color={selected ? colors.primary : colors.textMuted} />
        </TouchableOpacity>
      </Tooltip>
    ),
  } : undefined;

  const openSnapshot = (archive: any) => setSnapshotModal({ visible: true, data: archive.snapshot });
  const titleFor = (archive: any) => archive.metadata?.title || archive.metadata?.name || 'Untitled';
  const issueFor = (archive: any) => getArchiveIntegrityIssue(archive, activeSchema);
  const statusLabel = (archive: any) => archive.restored_at ? 'Restored' : issueFor(archive) ? 'Conflict' : 'Archived';

  return (
    <View className="flex-1 bg-surface-background flex-col">
      <IntelligencePageHeader
        eyebrow="Intelligence Hub"
        title="Cold Storage"
        density="compact"
        right={
          <View className="flex-row items-center gap-3">
            {canViewAll && (
              <Tooltip label="Switch between your related archives and company archives">
                <TouchableOpacity
                  accessibilityRole="switch"
                  accessibilityState={{ checked: includeCompany }}
                  onPress={() => setIncludeCompany((value) => !value)}
                  className="min-h-11 flex-row items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-3"
                >
                  <FontAwesome name={includeCompany ? 'building' : 'user'} size={12} color={colors.primary} />
                  <Text className="text-typography-main text-xs font-bold">{includeCompany ? 'Company archives' : 'My related archives'}</Text>
                </TouchableOpacity>
              </Tooltip>
            )}
            <Tooltip label="Filter archives">
              <TouchableOpacity
                onPress={() => setFiltersOpen((open) => !open)}
                accessibilityRole="button"
                accessibilityLabel="Filter archives"
                accessibilityState={{ expanded: filtersOpen }}
                className={`relative h-14 w-14 items-center justify-center rounded-xl border ${filtersOpen || filtersActive ? 'border-brand-primary bg-brand-primary/10' : 'border-surface-border bg-surface-card'}`}
              >
                <FontAwesome name="filter" size={14} color={filtersOpen || filtersActive ? colors.primary : colors.textMuted} />
                {filtersActive && <View className="absolute -right-1 -top-1 min-h-5 min-w-5 items-center justify-center rounded-full bg-brand-primary px-1"><Text className="text-xs font-black text-typography-main">{(filters.entity !== 'all' ? 1 : 0) + (filters.status !== 'all' ? 1 : 0)}</Text></View>}
              </TouchableOpacity>
            </Tooltip>
            <Tooltip label="Refresh archives">
              <TouchableOpacity onPress={fetchArchives} accessibilityRole="button" className="h-11 w-11 items-center justify-center rounded-xl border border-surface-border bg-surface-card">
                <FontAwesome name="refresh" size={13} color={colors.primary} />
              </TouchableOpacity>
            </Tooltip>
          </View>
        }
      />

      {canPurge && selection.count > 0 && (
        <View className="mx-6 mt-3 flex-row items-center justify-between rounded-2xl border border-state-danger/30 bg-state-danger/10 px-4 py-3">
          <Text className="text-state-danger text-xs font-black uppercase tracking-wider">{selection.count} Selected</Text>
          <TouchableOpacity onPress={() => setDeleteModal(true)} className="min-h-11 flex-row items-center gap-2 rounded-xl bg-state-danger px-4 py-2">
            <FontAwesome name="trash-o" size={13} color={colors.danger} />
            <Text className="text-typography-main text-xs font-black uppercase tracking-widest">Purge</Text>
          </TouchableOpacity>
        </View>
      )}

      <View className="flex-1 min-h-0 px-6 pb-6 pt-4">
        {/* Keep the controlled panel in the full-width collection flow, separate from header actions. */}
        <FilterPanel isOpen={filtersOpen} onOpenChange={setFiltersOpen} trigger={() => null}>
          <View className="mb-3 rounded-2xl border border-surface-border bg-surface-card p-4">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-typography-main text-sm font-black">Archive filters</Text>
              <TouchableOpacity onPress={clearFilters} disabled={!filtersActive} className="min-h-11 justify-center px-3">
                <Text className={`text-xs font-bold ${filtersActive ? 'text-state-danger' : 'text-typography-muted'}`}>Clear Filters</Text>
              </TouchableOpacity>
            </View>
            <FilterSection label="Type">
              <FilterChipGroup>{ENTITY_FILTERS.map((option) => <FilterChip key={option.id} label={option.label} active={filters.entity === option.id} touchTarget onPress={() => setFilters((value) => ({ ...value, entity: option.id }))} />)}</FilterChipGroup>
            </FilterSection>
            <FilterSection label="Status">
              <FilterChipGroup>{STATUS_FILTERS.map((option) => <FilterChip key={option.id} label={option.label} active={filters.status === option.id} touchTarget onPress={() => setFilters((value) => ({ ...value, status: option.id }))} />)}</FilterChipGroup>
            </FilterSection>
          </View>
        </FilterPanel>

        {/* Collection metadata: shown/total, type/status counts, and loading. */}
        <View className="mb-2 flex-row flex-wrap items-center gap-x-3 gap-y-1">
          <Text className="text-typography-muted text-xs font-semibold">Showing {filteredArchives.length} of {archives.length}</Text>
          <Text className="text-typography-muted text-xs">{counts.task} tasks · {counts.project} projects · {counts.conflict} conflicts</Text>
          {loading && <View className="flex-row items-center gap-1.5"><ActivityIndicator size="small" color={colors.primary} /><Text className="text-typography-muted text-xs">Loading</Text></View>}
        </View>

        <MultiViewList
          items={filteredArchives}
          keyExtractor={(archive) => archive.id}
          storageKey="cold-storage-desktop"
          defaultMode="details"
          modes={['details', 'list', 'medium', 'large']}
          search={{ value: search, onChange: setSearch, placeholder: 'Search archives...' }}
          loading={loading}
          selection={selectionProps}
          onItemPress={openSnapshot}
          onScroll={headerScroll.onScroll}
          scrollEventThrottle={headerScroll.scrollEventThrottle}
          emptyState={{
            icon: emptyState.action === 'clear-search' ? 'search' : 'archive',
            title: emptyState.title,
            body: emptyState.body,
            actionLabel: emptyState.actionLabel,
            onAction: emptyState.action === 'clear-search' ? () => setSearch('')
              : emptyState.action === 'clear-filters' ? clearFilters
                : () => router.push('/tasks'),
          }}
          renderCard={(archive) => (
            <View className="min-h-32 rounded-2xl border border-surface-border bg-surface-card p-4">
              <Text className="text-typography-main font-black" numberOfLines={1}>{titleFor(archive)}</Text>
              <Text className="mt-2 text-typography-muted text-xs capitalize">{archive.entity_type} · {statusLabel(archive)}</Text>
              {!!issueFor(archive) && <Text className="mt-2 text-state-danger text-xs">{issueFor(archive)}</Text>}
              <Text className="mt-2 text-typography-muted text-xs">{new Date(archive.archived_at).toLocaleDateString()}</Text>
              {!archive.restored_at && !issueFor(archive) && hasPermission('archive.restore') && (
                <TouchableOpacity onPress={(event: any) => { event.stopPropagation?.(); setRestoreModal({ visible: true, archive }); }} className="mt-3 min-h-11 flex-row items-center gap-2 self-start rounded-lg border border-brand-primary/20 bg-brand-primary/10 px-3">
                  <FontAwesome name="undo" size={12} color={colors.primary} /><Text className="text-brand-primary text-xs font-black">Restore</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          renderRow={(archive) => (
            <View className="flex-row items-center gap-4 py-3">
              <FontAwesome name={archive.entity_type === 'project' ? 'folder-o' : 'tasks'} size={16} color={colors.primary} />
              <View className="flex-1">
                <Text className="text-typography-main font-bold" numberOfLines={1}>{titleFor(archive)}</Text>
                {!!issueFor(archive) && <Text className="mt-1 text-state-danger text-xs">{issueFor(archive)}</Text>}
              </View>
              <Text className="text-typography-muted text-xs">{statusLabel(archive)}</Text>
              {!archive.restored_at && !issueFor(archive) && hasPermission('archive.restore') && (
                <TouchableOpacity onPress={(event: any) => { event.stopPropagation?.(); setRestoreModal({ visible: true, archive }); }} className="min-h-11 flex-row items-center gap-2 rounded-lg border border-brand-primary/20 bg-brand-primary/10 px-3">
                  <FontAwesome name="undo" size={12} color={colors.primary} /><Text className="text-brand-primary text-xs font-black">Restore</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          columns={[
            { key: 'entity', label: 'Entity', flex: 3, render: (archive) => (
              <View className="flex-row items-center gap-3">
                <View className="h-9 w-9 items-center justify-center rounded-xl border border-surface-border bg-surface-background">
                  <FontAwesome name={archive.entity_type === 'project' ? 'folder-o' : 'tasks'} size={14} color={colors.primary} />
                </View>
                <View className="flex-1">
                  <Text className="text-typography-main text-sm font-black" numberOfLines={1}>{titleFor(archive)}</Text>
                  {!!issueFor(archive) && <Text className="mt-1 text-state-danger text-xs">{issueFor(archive)}</Text>}
                </View>
              </View>
            ) },
            { key: 'type', label: 'Type', flex: 1, render: (archive) => <Text className="text-typography-muted text-xs font-bold capitalize">{archive.entity_type}</Text> },
            { key: 'archived', label: 'Archived', flex: 1, render: (archive) => <Text className="text-typography-muted text-xs">{new Date(archive.archived_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</Text> },
            { key: 'status', label: 'Status', flex: 1, render: (archive) => <Text className={`text-xs font-bold ${archive.restored_at ? 'text-state-success' : issueFor(archive) ? 'text-state-danger' : 'text-typography-muted'}`}>{statusLabel(archive)}</Text> },
            { key: 'actions', label: 'Actions', flex: 2, align: 'right', render: (archive) => (
              <View className="flex-row items-center justify-end gap-2">
                <TouchableOpacity onPress={(event: any) => { event.stopPropagation?.(); openSnapshot(archive); }} accessibilityRole="button" className="min-h-11 flex-row items-center gap-2 rounded-lg border border-surface-border bg-surface-background px-3">
                  <FontAwesome name="eye" size={12} color={colors.textMuted} /><Text className="text-typography-muted text-xs font-bold">Snapshot</Text>
                </TouchableOpacity>
                {!archive.restored_at && !issueFor(archive) && hasPermission('archive.restore') && (
                  <TouchableOpacity onPress={(event: any) => { event.stopPropagation?.(); setRestoreModal({ visible: true, archive }); }} accessibilityRole="button" className="min-h-11 flex-row items-center gap-2 rounded-lg border border-brand-primary/20 bg-brand-primary/10 px-3">
                    <FontAwesome name="undo" size={12} color={colors.primary} /><Text className="text-brand-primary text-xs font-black">Restore</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) },
          ]}
        />
      </View>

      <ConfirmModal
        visible={restoreModal.visible}
        title={`Restore ${restoreModal.archive?.entity_type === 'project' ? 'Project' : 'Task'}`}
        description={`This will move "${restoreModal.archive ? titleFor(restoreModal.archive) : 'this item'}" back to the active pipeline. All historical data and attachments will be recovered.`}
        confirmLabel="Restore Data"
        variant="primary"
        loading={!!restoringId}
        onConfirm={() => restoreModal.archive && handleRestore(restoreModal.archive)}
        onCancel={() => setRestoreModal({ visible: false })}
      />
      <ConfirmModal
        visible={deleteModal}
        title="Purge Permanently"
        description={`This will permanently delete ${selection.count} archived item${selection.count === 1 ? '' : 's'} and all associated snapshot data. This cannot be undone.`}
        confirmLabel="Purge Forever"
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
