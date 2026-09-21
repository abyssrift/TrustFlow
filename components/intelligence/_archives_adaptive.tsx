import ConfirmModal from '@/components/common/ConfirmModal';
import FilterPanel, { FilterChipGroup, FilterSection } from '@/components/common/FilterPanel';
import MultiViewList, { type MultiViewSelectionKeyEvent } from '@/components/common/MultiViewList';
import Tooltip from '@/components/common/Tooltip';
import { SnapshotDetailModal } from '@/components/intelligence/IntelligenceModals';
import { useAuth } from '@/contexts/AuthContext';
import { useAlert } from '@/contexts/AlertContext';
import { useToast } from '@/contexts/ToastContext';
import { useCollectionSelection } from '@/hooks/useCollectionSelection';
import { useDebounce } from '@/hooks/useDebounce';
import { useThemeColors } from '@/hooks/useThemeColors';
import {
  filterArchives,
  getArchiveCounts,
  getArchiveEmptyState,
  getArchiveIntegrityIssue,
  getArchiveStatus,
  type ArchiveEntityFilter,
  type ArchiveRecord,
  type ArchiveSchema,
  type ArchiveStatusFilter,
} from '@/lib/archivePresentation';
import { pruneSelection } from '@/lib/multiSelection';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

type ArchiveRow = ArchiveRecord & {
  archived_at?: string;
  metadata?: { title?: string; name?: string };
  snapshot?: any;
};

const EMPTY_FILTERS = { entity: 'all' as ArchiveEntityFilter, status: 'all' as ArchiveStatusFilter };
const ENTITY_OPTIONS: { value: ArchiveEntityFilter; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'task', label: 'Tasks' },
  { value: 'project', label: 'Projects' },
];
const STATUS_OPTIONS: { value: ArchiveStatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'archived', label: 'Archived' },
  { value: 'restored', label: 'Restored' },
  { value: 'conflict', label: 'Conflict' },
];

export default function IntelligenceArchivesNative() {
  const colors = useThemeColors();
  const { hasPermission } = useAuth();
  const router = useRouter();
  const { showAlert } = useAlert();
  const { successToast, errorToast } = useToast();
  const [archives, setArchives] = useState<ArchiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 500);
  const [includeCompany, setIncludeCompany] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [activeSchema, setActiveSchema] = useState<ArchiveSchema>({ pipelineIds: new Set(), stageIds: new Set() });
  const [restoreModal, setRestoreModal] = useState<{ visible: boolean; archive?: ArchiveRow }>({ visible: false });
  const [snapshotModal, setSnapshotModal] = useState<{ visible: boolean; data?: any }>({ visible: false });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionActive, setSelectionActive] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const canSelectAndPurge = hasPermission('archive.delete') && hasPermission('archive.view_all');
  const canViewCompany = hasPermission('archive.view_all');
  const canRestore = hasPermission('archive.restore');
  const selection = useCollectionSelection({
    active: (selectionActive || selectedIds.length > 0) && canSelectAndPurge,
    selectedIds,
    onActiveChange: setSelectionActive,
    onSelectedIdsChange: setSelectedIds,
  });

  useEffect(() => { void fetchArchives(); }, [debouncedSearch, includeCompany, canViewCompany]);

  const fetchArchives = async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const { data: archiveData, error } = await supabase.rpc('rpc_get_archives', {
        p_search: debouncedSearch || null,
        p_include_company: canViewCompany && includeCompany,
      });
      if (error) throw error;
      const [pipelineResult, stageResult] = await Promise.all([
        supabase.from('pipelines').select('id'),
        supabase.from('pipeline_stages').select('id'),
      ]);
      const nextArchives = (archiveData || []) as ArchiveRow[];
      setArchives(nextArchives);
      setSelectedIds(previous => pruneSelection(previous, nextArchives.map(archive => archive.id)));
      setActiveSchema({
        pipelineIds: new Set(pipelineResult.data?.map(row => row.id) || []),
        stageIds: new Set(stageResult.data?.map(row => row.id) || []),
      });
      return true;
    } catch (error) {
      console.error(error);
      setFetchError(true);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const counts = useMemo(() => getArchiveCounts(archives, activeSchema), [archives, activeSchema]);
  const visibleArchives = useMemo(() => filterArchives(archives, filters, activeSchema), [archives, filters, activeSchema]);
  const filterCount = Number(filters.entity !== 'all') + Number(filters.status !== 'all');
  const visibleIds = visibleArchives.map(archive => archive.id);
  const emptyState = getArchiveEmptyState({
    serverTotal: archives.length,
    shownCount: visibleArchives.length,
    searchActive: !!debouncedSearch,
    filtersActive: filterCount > 0,
  });

  const changeSelectionByPress = (archive: ArchiveRow, event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    if (!canSelectAndPurge) return;
    if (event.shiftKey) selection.selectRange(visibleIds, archive.id, !!(event.ctrlKey || event.metaKey));
    else selection.toggle(archive.id);
  };

  const handleSelectionKeyDown = (archive: ArchiveRow, event: MultiViewSelectionKeyEvent) => {
    if (!canSelectAndPurge) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault?.();
      if (event.shiftKey) selection.selectRange(visibleIds, archive.id, !!(event.ctrlKey || event.metaKey));
      else selection.toggle(archive.id);
    }
  };

  const handleRestore = async (archive: ArchiveRow) => {
    if (!hasPermission('archive.restore')) {
      errorToast('You no longer have permission to restore archives.', 'Restoration unavailable');
      setRestoreModal({ visible: false });
      return;
    }
    const integrityIssue = getArchiveIntegrityIssue(archive, activeSchema);
    if (archive.restored_at || integrityIssue) {
      errorToast(integrityIssue || 'This archive has already been restored.', 'Restoration unavailable');
      setRestoreModal({ visible: false });
      return;
    }
    try {
      setRestoringId(archive.id);
      const rpc = archive.entity_type === 'project' ? 'rpc_restore_project' : 'rpc_restore_archive';
      const { data: newId, error } = await supabase.rpc(rpc, { p_archive_id: archive.id });
      if (error) throw error;
      await fetchArchives();
      setRestoreModal({ visible: false });
      successToast('Asset has been returned to the active pipeline.', 'Restored');
      if (archive.entity_type === 'project') router.push('/projects');
      else if (newId) router.push(`/task/${newId}`);
    } catch (error: any) {
      errorToast(error?.message || 'Could not restore this snapshot.', 'Restoration failed');
    } finally {
      setRestoringId(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!hasPermission('archive.delete') || !hasPermission('archive.view_all')) {
      showAlert('Delete Unavailable', 'You no longer have permission to permanently delete archives.');
      setDeleteModal(false);
      return;
    }
    const idsToPurge = [...selectedIds];
    if (idsToPurge.length === 0) return;
    try {
      setDeleting(true);
      const { error } = await supabase.rpc('rpc_purge_archives', { p_archive_ids: idsToPurge });
      if (error) throw error;
      const refreshed = await fetchArchives();
      if (refreshed) {
        setDeleteModal(false);
        selection.clear();
        setSelectionActive(false);
      } else {
        showAlert('Delete Succeeded', 'The archives were deleted, but the list could not be refreshed.');
      }
    } catch (error: any) {
      showAlert('Delete Failed', error?.message || 'Could not permanently delete these archives.');
    } finally {
      setDeleting(false);
    }
  };

  const renderIdentity = (archive: ArchiveRow, compact: boolean) => {
    const restored = !!archive.restored_at;
    const issue = getArchiveIntegrityIssue(archive, activeSchema);
    const title = archive.metadata?.title || archive.metadata?.name || 'Untitled';
    const status = getArchiveStatus(archive, activeSchema);
    return (
      <View className="flex-row items-center gap-3">
        <View className={`h-11 w-11 shrink-0 items-center justify-center rounded-xl ${restored ? 'bg-state-success/10' : 'bg-surface-background border border-surface-border'}`}>
          <FontAwesome name={archive.entity_type === 'project' ? 'folder-o' : 'tasks'} size={15} color={restored ? colors.success : colors.primary} />
        </View>
        <View className="flex-1">
          <Text className="text-typography-main text-sm font-black" numberOfLines={1}>{title}</Text>
          <Text className="mt-0.5 text-typography-muted text-xs capitalize">{archive.entity_type} · {status}</Text>
          {issue && <Text className="mt-1 text-state-danger text-xs leading-4">{issue}</Text>}
          {!compact && !!archive.archived_at && (
            <Text className="mt-1 text-typography-muted text-xs">
              Archived {new Date(archive.archived_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </Text>
          )}
        </View>
      </View>
    );
  };

  const renderActions = (archive: ArchiveRow) => {
    const issue = getArchiveIntegrityIssue(archive, activeSchema);
    return (
      <View className="flex-row flex-wrap items-center gap-2">
        <TouchableOpacity
          onPress={(event) => { event.stopPropagation(); setSnapshotModal({ visible: true, data: archive.snapshot }); }}
          className="min-h-11 flex-row items-center justify-center gap-2 rounded-xl border border-surface-border bg-surface-background px-3"
          accessibilityRole="button"
          accessibilityLabel={`Inspect ${archive.metadata?.title || archive.metadata?.name || 'archive'} snapshot`}
        >
          <FontAwesome name="eye" size={12} color={colors.textMuted} />
          <Text className="text-typography-muted text-xs font-bold">Inspect</Text>
        </TouchableOpacity>
        {!archive.restored_at && !issue && canRestore && (
          <TouchableOpacity
            onPress={(event) => { event.stopPropagation(); setRestoreModal({ visible: true, archive }); }}
            className="min-h-11 flex-row items-center justify-center gap-2 rounded-xl border border-brand-primary/20 bg-brand-primary/10 px-3"
            accessibilityRole="button"
            accessibilityLabel={`Restore ${archive.metadata?.title || archive.metadata?.name || 'archive'}`}
          >
            <FontAwesome name="undo" size={12} color={colors.primary} />
            <Text className="text-brand-primary text-xs font-black">Restore</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderCard = (archive: ArchiveRow) => (
    <View className="rounded-2xl border border-surface-border bg-surface-card p-4">
      {renderIdentity(archive, false)}
      <View className="mt-4 border-t border-surface-border pt-3">{renderActions(archive)}</View>
    </View>
  );

  const renderRow = (archive: ArchiveRow) => (
    <View className="flex-row flex-wrap items-center justify-between gap-3 py-1">
      {renderIdentity(archive, true)}
      {renderActions(archive)}
    </View>
  );

  const selectionProps = canSelectAndPurge ? {
    active: selection.active,
    selectedIds: new Set(selection.selectedIds),
    onToggle: (archive: ArchiveRow) => selection.toggle(archive.id),
    onPress: (archive: ArchiveRow, event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => changeSelectionByPress(archive, event),
    onLongPress: (archive: ArchiveRow) => selection.enter(archive.id),
    onKeyDown: (archive: ArchiveRow, event: MultiViewSelectionKeyEvent) => handleSelectionKeyDown(archive, event),
  } : undefined;

  const clearEmptyAction = () => {
    if (emptyState.action === 'clear-search') setSearch('');
    else if (emptyState.action === 'clear-filters') setFilters(EMPTY_FILTERS);
    else router.push('/tasks');
  };

  return (
    <View className="flex-1 bg-surface-background">
      <View className="gap-2 px-4 pt-12 pb-3">
        {/* Archive compact header row 1 */}
        <View className="flex-row items-center gap-2">
          <TouchableOpacity
            onPress={() => router.canGoBack() ? router.back() : router.replace('/intelligence' as any)}
            className="h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-surface-border bg-surface-card"
            accessibilityRole="button"
            accessibilityLabel="Back to Intelligence"
          >
            <FontAwesome name="chevron-left" size={14} color={colors.textMuted} />
          </TouchableOpacity>
          <View className="min-w-0 flex-1">
            <Text className="text-typography-main text-base font-black" numberOfLines={1}>Cold Storage</Text>
          </View>
          {canViewCompany && (
            <View className="flex-[1.5] flex-row rounded-xl border border-surface-border bg-surface-card p-0.5">
              {[{ value: false, label: 'My related archives' }, { value: true, label: 'Company archives' }].map(option => (
                <TouchableOpacity
                  key={String(option.value)}
                  onPress={() => setIncludeCompany(option.value)}
                  className={`min-h-11 min-w-11 flex-1 items-center justify-center rounded-lg px-1 ${includeCompany === option.value ? 'bg-brand-primary/10' : ''}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: includeCompany === option.value }}
                >
                  <Text className={`text-center text-[10px] font-bold leading-3 ${includeCompany === option.value ? 'text-brand-primary' : 'text-typography-muted'}`}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Archive compact header row 2 */}
        <View className="flex-row items-center gap-2">
          <View className="h-11 flex-1 flex-row items-center gap-3 rounded-xl border border-surface-border bg-surface-card px-3">
            <FontAwesome name="search" size={13} color={colors.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search archives..."
              placeholderTextColor={colors.textDim}
              accessibilityLabel="Search archives"
              className="flex-1 text-typography-main text-sm"
            />
            {!!search && (
              <Tooltip label="Clear search">
                <TouchableOpacity onPress={() => setSearch('')} className="h-11 w-11 items-center justify-center" accessibilityLabel="Clear search">
                  <FontAwesome name="times-circle" size={14} color={colors.textMuted} />
                </TouchableOpacity>
              </Tooltip>
            )}
          </View>
          <FilterPanel
            isOpen={filtersOpen}
            onOpenChange={setFiltersOpen}
            activeCount={filterCount}
            maxHeight={260}
            trigger={({ toggle, isOpen }) => (
              <Tooltip label="Filter archives">
                <TouchableOpacity
                  onPress={toggle}
                  className={`relative h-11 w-11 items-center justify-center rounded-xl border ${isOpen || filterCount ? 'border-brand-primary bg-brand-primary/10' : 'border-surface-border bg-surface-card'}`}
                  accessibilityRole="button"
                  accessibilityLabel="Filter archives"
                  accessibilityState={{ expanded: isOpen }}
                >
                  <FontAwesome name="filter" size={14} color={isOpen || filterCount ? colors.primary : colors.textMuted} />
                  {!!filterCount && <View className="absolute -right-1 -top-1 min-w-5 items-center rounded-full bg-brand-primary px-1"><Text className="text-typography-main text-[9px] font-black">{filterCount > 9 ? '9+' : filterCount}</Text></View>}
                </TouchableOpacity>
              </Tooltip>
            )}
          >
            <View className="mx-1 mb-2 rounded-xl border border-surface-border bg-surface-card p-3">
              <View className="mb-3 flex-row items-center justify-between">
                <Text className="text-typography-main text-xs font-black">Filters</Text>
                <TouchableOpacity
                  onPress={() => setFilters(EMPTY_FILTERS)}
                  disabled={filterCount === 0}
                  className="min-h-11 justify-center px-2"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: filterCount === 0 }}
                >
                  <Text className={`text-xs font-bold ${filterCount ? 'text-state-danger' : 'text-typography-muted'}`}>Clear filters</Text>
                </TouchableOpacity>
              </View>
              <FilterSection label="Type">
                <FilterChipGroup>
                  {ENTITY_OPTIONS.map(option => (
                    <TouchableOpacity key={option.value} onPress={() => setFilters(current => ({ ...current, entity: option.value }))} className={`min-h-11 justify-center rounded-xl border px-3 ${filters.entity === option.value ? 'border-brand-primary bg-brand-primary/10' : 'border-surface-border bg-surface-background'}`}>
                      <Text className={`text-xs font-bold ${filters.entity === option.value ? 'text-brand-primary' : 'text-typography-muted'}`}>{option.label}</Text>
                    </TouchableOpacity>
                  ))}
                </FilterChipGroup>
              </FilterSection>
              <FilterSection label="Status">
                <FilterChipGroup>
                  {STATUS_OPTIONS.map(option => (
                    <TouchableOpacity key={option.value} onPress={() => setFilters(current => ({ ...current, status: option.value }))} className={`min-h-11 justify-center rounded-xl border px-3 ${filters.status === option.value ? 'border-brand-primary bg-brand-primary/10' : 'border-surface-border bg-surface-background'}`}>
                      <Text className={`text-xs font-bold ${filters.status === option.value ? 'text-brand-primary' : 'text-typography-muted'}`}>{option.label}</Text>
                    </TouchableOpacity>
                  ))}
                </FilterChipGroup>
              </FilterSection>
            </View>
          </FilterPanel>
          <Tooltip label="Refresh archives">
            <TouchableOpacity onPress={() => void fetchArchives()} className="h-11 w-11 items-center justify-center rounded-xl border border-surface-border bg-surface-card" accessibilityRole="button" accessibilityLabel="Refresh archives">
              <FontAwesome name="refresh" size={14} color={colors.primary} />
            </TouchableOpacity>
          </Tooltip>
        </View>

      </View>

      <View className="min-h-0 flex-1 px-4 pb-3">
        {/* Archive collection context */}
        <View className="mb-2 flex-row flex-wrap items-center justify-between gap-2 px-1">
          <Text className={`${selection.count > 0 ? 'text-[10px]' : 'text-xs'} text-typography-muted font-bold`}>
            {selection.count > 0 ? `${selection.count} selected · ` : ''}Showing {visibleArchives.length} of {counts.total}
          </Text>
          <View className="flex-row flex-wrap items-center gap-1">
            {canSelectAndPurge && visibleArchives.length > 0 && (
              <Tooltip label={selection.count === visibleArchives.length ? 'Deselect visible archives' : 'Select visible archives'}>
                <TouchableOpacity onPress={() => selection.selectAllVisible(visibleIds)} className="min-h-11 justify-center px-2" accessibilityRole="button">
                  <Text className="text-brand-primary text-xs font-bold">{selection.count === visibleArchives.length ? 'Deselect all' : 'Select all'}</Text>
                </TouchableOpacity>
              </Tooltip>
            )}
            {selection.count > 0 && canSelectAndPurge && (
              <>
                <TouchableOpacity onPress={() => { selection.clear(); setSelectionActive(false); }} className="min-h-11 justify-center px-2" accessibilityRole="button">
                  <Text className="text-state-danger text-xs font-bold">Clear selection</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setDeleteModal(true)} className="min-h-11 flex-row items-center gap-2 rounded-xl border border-state-danger bg-state-danger/10 px-3" accessibilityRole="button">
                  <FontAwesome name="trash-o" size={13} color={colors.danger} />
                  <Text className="text-state-danger text-xs font-black">Delete</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
        <MultiViewList
          items={visibleArchives}
          keyExtractor={archive => archive.id}
          storageKey="cold-storage-adaptive"
          defaultMode="list"
          modes={['list', 'details']}
          renderCard={renderCard}
          renderRow={renderRow}
          columns={[
            { key: 'archive', label: 'Archive', flex: 3, render: archive => renderIdentity(archive, false) },
            { key: 'type', label: 'Type', flex: 1, render: archive => <Text className="text-typography-muted text-xs capitalize">{archive.entity_type}</Text> },
            { key: 'status', label: 'Status', flex: 1, render: archive => <Text className="text-typography-muted text-xs capitalize">{getArchiveStatus(archive, activeSchema)}</Text> },
            { key: 'actions', label: 'Actions', flex: 2, render: renderActions },
          ]}
          onItemPress={archive => setSnapshotModal({ visible: true, data: archive.snapshot })}
          selection={selectionProps}
          loading={loading}
          statusBanner={fetchError ? { tone: 'danger', icon: 'exclamation-triangle', title: 'Archives could not be loaded', body: 'Refresh to try again.' } : null}
          emptyState={{
            icon: emptyState.action === 'clear-search' ? 'search' : 'archive',
            title: emptyState.title,
            body: emptyState.body,
            actionLabel: emptyState.actionLabel,
            onAction: clearEmptyAction,
          }}
        />
      </View>

      <ConfirmModal
        visible={restoreModal.visible}
        title={`Restore ${restoreModal.archive?.entity_type === 'project' ? 'Project' : 'Task'}`}
        description={`This will move "${restoreModal.archive?.metadata?.title || 'this item'}" back to the active pipeline.`}
        confirmLabel="Restore"
        variant="primary"
        loading={!!restoringId}
        onConfirm={() => restoreModal.archive && void handleRestore(restoreModal.archive)}
        onCancel={() => setRestoreModal({ visible: false })}
      />
      <ConfirmModal
        visible={deleteModal}
        title="Delete Permanently"
        description={`This will permanently delete ${selection.count} archived item${selection.count === 1 ? '' : 's'} and all associated snapshot data. This cannot be undone.`}
        confirmLabel="Delete Forever"
        variant="danger"
        loading={deleting}
        onConfirm={() => void handleBulkDelete()}
        onCancel={() => setDeleteModal(false)}
      />
      <SnapshotDetailModal visible={snapshotModal.visible} data={snapshotModal.data} onClose={() => setSnapshotModal({ visible: false })} />
    </View>
  );
}
