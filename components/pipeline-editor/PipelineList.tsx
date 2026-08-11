import Popup from '@/components/common/Popup';
import Tooltip from '@/components/common/Tooltip';
import { useAuth } from '@/contexts/AuthContext';
import { Pipeline, PipelineDeleteImpact, usePipelineEditor } from '@/contexts/PipelineEditorContext';
import { usePipelineLimit } from '@/hooks/usePipelineLimit';
import { useThemeColors } from '@/hooks/useThemeColors';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import DeadlockAlert from './DeadlockAlert';
import PipelineSettingsForm from './PipelineSettingsForm';

const STAGE_PRESET_TEMPLATES = [
  { name: 'PENDING', is_initial: true },
  { name: 'IN PROGRESS' },
  { name: 'REVIEW', requires_submission: true },
  { name: 'COMPLETED', is_terminal: true, terminal_type: 'success' },
];

const TRANSITION_PRESETS = [
  { from_position: 1, to_position: 2, label: 'Start Work' },
  { from_position: 2, to_position: 3, label: 'Submit for Review' },
  { from_position: 3, to_position: 4, label: 'Approve' },
  { from_position: 3, to_position: 2, label: 'Request Revision' },
];

export default function PipelineList() {
  const colors = useThemeColors();
  const {
    pipelines, loading, error,
    refreshPipelines, selectPipeline,
    createPipeline, updatePipeline, deletePipeline, previewDeletePipeline, setPipelineSubjectKind,
    roles,
  } = usePipelineEditor();
  const { hasPermission, profile } = useAuth();
  const isAdmin = profile?.system_role === 'admin' || profile?.workspace_role === 'admin' || profile?.workspace_role === 'owner';
  const { atLimit: pipelinesAtLimit, data: pipelineLimit } = usePipelineLimit();

  const [showCreate, setShowCreate] = useState(false);
  const [isQuickCreate, setIsQuickCreate] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<PipelineDeleteImpact | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const canEdit = hasPermission('pipeline.edit');

  useEffect(() => {
    refreshPipelines();
  }, []);

  const handleCreate = async (data: any) => {
    if (!canEdit) return;
    const stagePresets = [
      { ...STAGE_PRESET_TEMPLATES[0], color: colors.textDim },
      { ...STAGE_PRESET_TEMPLATES[1], color: colors.primary },
      { ...STAGE_PRESET_TEMPLATES[2], color: colors.warning },
      { ...STAGE_PRESET_TEMPLATES[3], color: colors.success },
    ];
    const stgs = isQuickCreate
      ? stagePresets.map((s, i) => ({ ...s, position: i + 1, is_initial: s.is_initial || false, is_terminal: s.is_terminal || false, requires_submission: s.requires_submission || false }))
      : [{ name: 'START', color: colors.textDim, position: 1, is_initial: true, is_terminal: false, requires_submission: false }];
    const trans = isQuickCreate ? TRANSITION_PRESETS : [];

    const id = await createPipeline(data.name, data.description, stgs, trans, data.visibility_permissions, data.task_visibility_mode, data.subject_kind);
    if (id) {
      setShowCreate(false);
    }
  };

  // #196: never open the confirm without the damage report. The same RPC the
  // delete calls first, so if it refuses (running timer, no permission) the
  // confirm never opens for a delete that would have failed anyway.
  const askDelete = async (id: string) => {
    if (!canEdit) return;
    setDeleteImpact(null);
    const impact = await previewDeletePipeline(id);
    if (!impact) return;
    setDeleteImpact(impact);
    setConfirmDelete(id);
  };

  const closeConfirm = () => { setConfirmDelete(null); setDeleteImpact(null); };

  const handleDelete = async (id: string) => {
    if (!canEdit) return;
    const ok = await deletePipeline(id);
    if (ok) closeConfirm();
  };

  const handleSaveEdit = async (id: string, data: any) => {
    if (!canEdit) return;
    await updatePipeline(id, data.name, data.description, undefined, data.visibility_permissions, data.task_visibility_mode);
    // rpc_update_pipeline has no subject_kind param -- a separate direct-table
    // write, only issued when it actually changed.
    const current = pipelines.find(p => p.id === id);
    if (data.subject_kind && data.subject_kind !== current?.subject_kind) {
      await setPipelineSubjectKind(id, data.subject_kind);
    }
    setEditingId(null);
  };

  const handleToggleDefault = async (p: Pipeline) => {
    if (!canEdit) return;
    await updatePipeline(p.id, undefined, undefined, !p.is_default);
  };

  return (
    <View className="flex-1">
      {/* Header */}
      <View className="flex-row items-center justify-between mb-6">
        <View>
          <Text className="text-typography-main text-2xl font-black">Pipelines</Text>
          <Text className="text-typography-muted text-sm mt-1">
            {pipelineLimit?.limit != null
              ? `${pipelines.length} / ${pipelineLimit.limit} pipelines`
              : `${pipelines.length} workflow${pipelines.length !== 1 ? 's' : ''} configured`}
          </Text>
        </View>
        {canEdit && (
          <TouchableOpacity
            onPress={() => !pipelinesAtLimit && setShowCreate(true)}
            disabled={pipelinesAtLimit}
            className={`px-5 py-3 rounded-xl ${pipelinesAtLimit ? 'bg-surface-background border border-surface-border' : 'bg-brand-primary active:bg-brand-primary-hover active:scale-95 transition-all'}`}
          >
            <View className="flex-row items-center gap-2">
              <FontAwesome name={pipelinesAtLimit ? 'lock' : 'plus'} size={12} color={pipelinesAtLimit ? colors.textMuted : undefined} className={pipelinesAtLimit ? '' : 'text-brand-on-primary'} />
              <Text className={`font-bold text-sm uppercase tracking-wide ${pipelinesAtLimit ? 'text-typography-muted' : 'text-brand-on-primary'}`}>
                {pipelinesAtLimit ? 'Limit Reached' : 'New Pipeline'}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      </View>

      {/* Error Banner */}
      {error && (
        <View className="bg-state-danger/10 border border-state-danger/30 p-3 rounded-xl mb-4">
          <Text className="text-state-danger text-sm font-bold">{error}</Text>
        </View>
      )}

      <DeadlockAlert />

      {/* Pipeline limit nudge */}
      {pipelinesAtLimit && (
        <View className="flex-row items-center bg-state-warning/10 border border-state-warning/30 rounded-xl px-4 py-3 mb-4 gap-3">
          <FontAwesome name="lock" size={14} color={colors.warning} />
          <View className="flex-1">
            <Text className="text-typography-main text-[12px] font-black">Pipeline limit reached</Text>
            <Text className="text-typography-muted text-[11px] mt-0.5 leading-4">
              You've used all {pipelineLimit?.limit} pipelines on the Free plan.{' '}
              {hasPermission('company.billing') || profile?.is_owner ? 'Upgrade to Pro for unlimited pipelines.' : 'Contact your admin to upgrade.'}
            </Text>
          </View>
        </View>
      )}

      {/* Pipeline Cards */}
      <ScrollView 
        className="flex-1"
        showsVerticalScrollIndicator={Platform.OS === 'web'}
      >
        {loading && pipelines.length === 0 ? (
          <View className="py-20 items-center">
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : pipelines.length === 0 ? (
          <View className="py-20 items-center px-6">
            <View className="bg-surface-card w-full p-8 rounded-[32px] border border-surface-border items-center premium-shadow">
              <View className="w-20 h-20 bg-brand-primary/10 rounded-full items-center justify-center mb-6">
                <FontAwesome name="sitemap" size={32} className="text-brand-primary" />
              </View>
              
              {canEdit ? (
                <>
                  <Text className="text-typography-main text-xl font-black mt-2 text-center">No Pipelines Yet</Text>
                  <Text className="text-typography-muted text-sm mt-3 text-center leading-5">
                    Create your first workflow pipeline to define how tasks move through stages.
                  </Text>
                  <TouchableOpacity
                    onPress={() => setShowCreate(true)}
                    className="bg-brand-primary px-8 py-4 rounded-2xl mt-8 active:scale-95 transition-all"
                  >
                    <Text className="text-brand-on-primary font-black uppercase tracking-widest text-xs">Create First Pipeline</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View className="bg-state-info/10 border border-state-info/20 p-5 rounded-2xl w-full">
                    <View className="flex-row items-start">
                      <FontAwesome name="info-circle" size={16} className="text-state-info" style={{ marginTop: 2 }} />
                      <Text className="text-typography-main text-sm font-bold ml-3 flex-1 leading-5">
                        Either no pipelines exist, or they are hidden due to your permissions. Contact your Admin if this is an error.
                      </Text>
                    </View>
                  </View>
                </>
              )}
            </View>
          </View>
        ) : (
          <>
            {!isAdmin && (
               <View className="bg-surface-overlay/30 px-4 py-2 rounded-lg mb-4 border border-surface-border flex-row items-center">
                  <FontAwesome name="lock" size={10} className="text-typography-muted" />
                  <Text className="text-[10px] text-typography-muted ml-2 italic">
                    Showing only pipelines permitted for your current role.
                  </Text>
               </View>
            )}
            {pipelines.map(p => (
              <View key={p.id} className="mb-3">
                {editingId === p.id ? (
                  <View className="bg-surface-card p-6 rounded-3xl border border-brand-primary/30 premium-shadow">
                    <Text className="text-typography-main font-black text-lg mb-4">Edit Pipeline</Text>
                    <PipelineSettingsForm 
                      initialData={{ ...p, description: p.description ?? undefined }}
                      roles={roles}
                      onSubmit={(data: any) => handleSaveEdit(p.id, data)}
                      onCancel={() => setEditingId(null)}
                      submitLabel="Save Changes"
                      loading={loading}
                    />
                  </View>
                ) : confirmDelete === p.id ? (
                  <View className="bg-surface-card p-6 rounded-3xl border border-state-danger/30 premium-shadow">
                    <Text className="text-typography-main font-black text-lg mb-2">Delete "{p.name}"?</Text>
                    {/* #196: the old copy claimed "existing tasks will remain
                        functional", which was never true — every task on the
                        board was soft-deleted. This says what actually happens,
                        counted by the same RPC that will perform it. */}
                    <Text className="text-typography-muted text-sm mb-2 leading-5">
                      {deleteImpact && deleteImpact.tasks_total > 0
                        ? `This board holds ${deleteImpact.tasks_total} task${deleteImpact.tasks_total === 1 ? '' : 's'}${deleteImpact.projects_affected > 0 ? ` across ${deleteImpact.projects_affected} project${deleteImpact.projects_affected === 1 ? '' : 's'}` : ''}.`
                        : 'This board holds no tasks.'}
                    </Text>
                    {!!deleteImpact && deleteImpact.tasks_detached > 0 && (
                      <Text className="text-typography-muted text-sm mb-2 leading-5">
                        <Text className="text-typography-main font-bold">{deleteImpact.tasks_detached}</Text>
                        {` task${deleteImpact.tasks_detached === 1 ? '' : 's'} belong to ${deleteImpact.projects_affected === 1 ? 'a project' : 'projects'} and will be kept — they stay on `}
                        <Text className="text-typography-main font-bold">
                          {deleteImpact.projects.map(pr => pr.name).join(', ')}
                        </Text>
                        {', off any board.'}
                      </Text>
                    )}
                    {!!deleteImpact && deleteImpact.tasks_deleted > 0 && (
                      <Text className="text-state-danger text-sm mb-2 leading-5">
                        <Text className="font-bold">{deleteImpact.tasks_deleted}</Text>
                        {` task${deleteImpact.tasks_deleted === 1 ? '' : 's'} belong to no project and will be deleted with the board. This cannot be undone.`}
                      </Text>
                    )}
                    <Text className="text-typography-muted text-sm mb-6 leading-5">
                      The pipeline is archived — no new tasks can be created on it.
                    </Text>
                    <View className="flex-row gap-3">
                      <TouchableOpacity
                        onPress={closeConfirm}
                        className="flex-1 bg-surface-background py-3 rounded-xl border border-surface-border items-center justify-center h-12"
                      >
                        <Text className="text-typography-muted font-bold">Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDelete(p.id)}
                        className="flex-1 bg-state-danger py-3 rounded-xl items-center justify-center h-12"
                      >
                        <Text className="text-brand-on-primary font-bold">Confirm Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => selectPipeline(p)}
                    className="bg-surface-card p-6 rounded-[28px] border border-surface-border premium-shadow active:scale-[0.98] transition-transform"
                  >
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1 mr-4">
                        <View className="flex-row items-center mb-1">
                          <Text className="text-typography-main font-bold text-lg">{p.name}</Text>
                          {p.is_default && (
                            <View className="bg-brand-primary/15 px-2 py-0.5 rounded-md ml-2">
                              <Text className="text-brand-primary text-[9px] font-black uppercase">Default</Text>
                            </View>
                          )}
                          {p.subject_kind === 'project' && (
                            <Tooltip label="Stages describe projects, not tasks — tasks cannot be created on this pipeline">
                              <View className="bg-state-info/15 px-2 py-0.5 rounded-md ml-2 flex-row items-center gap-1">
                                <FontAwesome name="folder-o" size={8} className="text-state-info" />
                                <Text className="text-state-info text-[9px] font-black uppercase">Project Pipeline</Text>
                              </View>
                            </Tooltip>
                          )}
                        </View>
                        <Text className="text-typography-muted text-sm" numberOfLines={1}>
                          {p.description || 'No description provided'}
                        </Text>
                        
                        <View className="flex-row items-center mt-3 gap-3">
                           <View className="flex-row items-center">
                              <FontAwesome name="eye" size={10} className="text-typography-muted" />
                              <Text className="text-[10px] text-typography-muted ml-1.5">
                                 {p.visibility_permissions?.length || 0} Roles
                              </Text>
                           </View>
                           <View className="flex-row items-center">
                              <FontAwesome name="lock" size={10} className="text-typography-muted" />
                              <Text className="text-[10px] text-typography-muted ml-1.5 capitalize">
                                 {p.task_visibility_mode === 'assigned_only' ? 'Private Tasks' : 'Public Tasks'}
                              </Text>
                           </View>
                        </View>
                      </View>

                      <View className="flex-row items-center gap-2">
                        {canEdit && (
                          <>
                            <Tooltip label={p.is_default ? 'Unset as default' : 'Set as default'}>
                              <TouchableOpacity
                                onPress={(e: any) => { e.stopPropagation(); handleToggleDefault(p); }}
                                className={`p-2.5 rounded-xl border ${p.is_default ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                              >
                                <FontAwesome name="star" size={12} className={p.is_default ? 'text-brand-on-primary' : 'text-typography-muted'} />
                              </TouchableOpacity>
                            </Tooltip>

                            <Tooltip label="Edit pipeline">
                              <TouchableOpacity
                                onPress={(e: any) => {
                                  e.stopPropagation();
                                  setEditingId(p.id);
                                }}
                                className="p-2.5 rounded-xl border border-surface-border bg-surface-background"
                              >
                                <FontAwesome name="pencil-square-o" size={12} className="text-typography-muted" />
                              </TouchableOpacity>
                            </Tooltip>

                            <Tooltip label="Delete pipeline">
                              <TouchableOpacity
                                onPress={(e: any) => { e.stopPropagation(); askDelete(p.id); }}
                                className="p-2.5 rounded-xl border border-surface-border bg-surface-background"
                              >
                                <FontAwesome name="trash-o" size={12} className="text-typography-muted" />
                              </TouchableOpacity>
                            </Tooltip>
                          </>
                        )}
                        <View className="ml-2">
                          <FontAwesome name="chevron-right" size={12} className="text-typography-muted" />
                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </>
        )}
        <View className="h-20" />
      </ScrollView>

      {/* Create Modal */}
      <Popup
        visible={showCreate}
        onClose={() => { setShowCreate(false); setIsQuickCreate(true); }}
        presentation="auto"
        dismissible={false}
        scrollable={false}
        maxWidth={512}
        containerClassName="w-[92%] rounded-[32px] premium-shadow"
      >
          <View className="p-8">
            <Text className="text-typography-main font-black text-2xl mb-2">New Pipeline</Text>
            <Text className="text-typography-muted text-sm mb-6 leading-5">
              Design a workflow template. You can use our presets to get started faster.
            </Text>

            <ScrollView showsVerticalScrollIndicator={false} className="max-h-[70vh]">
               {/* Quick Create Toggle */}
               <TouchableOpacity
                  onPress={() => setIsQuickCreate(!isQuickCreate)}
                  className={`flex-row items-center p-4 rounded-2xl border mb-6 ${isQuickCreate ? 'bg-brand-primary/5 border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}
               >
                  <View className="flex-1 mr-4">
                     <Text className={`font-bold text-sm ${isQuickCreate ? 'text-brand-primary' : 'text-typography-main'}`}>Quick Setup (Recommended)</Text>
                     <Text className="text-typography-muted text-[11px] mt-1 leading-4">
                        Auto-generate 4 standard stages and basic transitions.
                     </Text>
                  </View>
                  <View className={`w-12 h-7 rounded-full flex-row items-center px-1 ${isQuickCreate ? 'bg-brand-primary justify-end' : 'bg-surface-overlay justify-start'}`}>
                     <View className="w-5 h-5 rounded-full bg-brand-on-primary shadow-sm" />
                  </View>
               </TouchableOpacity>

               <PipelineSettingsForm
                  roles={roles}
                  onSubmit={handleCreate}
                  onCancel={() => { setShowCreate(false); setIsQuickCreate(true); }}
                  submitLabel="Create Pipeline"
                  loading={loading}
                />
            </ScrollView>
          </View>
      </Popup>
    </View>
  );
}
