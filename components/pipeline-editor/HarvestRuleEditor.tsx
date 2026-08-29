import { usePipelineEditor } from '@/contexts/PipelineEditorContext';
import { folderPath } from '@/contexts/FileHubContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Popup from '@/components/common/Popup';
import Tooltip from '@/components/common/Tooltip';
import FolderTreePicker from '@/components/intelligence/FolderTreePicker';
import { resolveNativeColorToken } from './colorCompat';

// Issue #284 -- rule-authoring surface for pointer-based deliverable
// harvesting. Visually borrows AutomationEditor's list/add/edit/delete card
// pattern and its disabled-condition affordance (ck_harvest_rules_condition_type
// only allows 'stage_entry'/'stage_terminal_success' -- 'field_equals' was a
// Phase 0 decision to NOT even add to the backend allowlist, so it is shown
// disabled here the same way idle/due_soon are for automations, rather than
// silently omitted).
const CONDITION_TYPES = [
  { value: 'stage_entry', label: 'Stage Entry', desc: 'The task enters the chosen stage', icon: 'sign-in', color: '#3b82f6', implemented: true },
  { value: 'stage_terminal_success', label: 'Terminal Success', desc: 'The task reaches a successful terminal stage', icon: 'flag-checkered', color: '#22c55e', implemented: true },
  { value: 'field_equals', label: 'Field Equals', desc: 'A task field matches a value', icon: 'equals', color: '#a855f7', implemented: false },
] as const;

export default function HarvestRuleEditor() {
  const colors = useThemeColors();
  const {
    stages, harvestRules, harvestFolders, loading, error,
    createHarvestRule, updateHarvestRule, deleteHarvestRule, backfillHarvestRule,
  } = usePipelineEditor();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [backfillingId, setBackfillingId] = useState<string | null>(null);
  // Issue #284 Phase 5 -- per-rule "N tasks already qualify" backlog hint.
  // Called directly via supabase.rpc rather than a PipelineEditorContext
  // wrapper: it's a display-only value fetched per-card, and routing it
  // through the context's shared `loading` flag (like backfillHarvestRule
  // does) would disable the whole editor's Save button while these fetch.
  const [backlogCounts, setBacklogCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(harvestRules.map(async (r) => {
      const { data, error: e } = await supabase.rpc('rpc_count_harvest_rule_backlog', { p_rule_id: r.id });
      return [r.id, e ? null : (data as number)] as const;
    })).then((results) => {
      if (cancelled) return;
      const next: Record<string, number> = {};
      for (const [id, n] of results) if (n !== null) next[id] = n;
      setBacklogCounts(next);
    });
    return () => { cancelled = true; };
  }, [harvestRules]);

  // Form state
  const [formCondition, setFormCondition] = useState<'stage_entry' | 'stage_terminal_success'>('stage_entry');
  const [formSource, setFormSource] = useState(''); // '' = "any" (stage_terminal_success only)
  const [formUseCustomFolder, setFormUseCustomFolder] = useState(false);
  const [formDestFolderId, setFormDestFolderId] = useState<string | null>(null);

  const resetForm = () => {
    setFormCondition('stage_entry');
    setFormSource('');
    setFormUseCustomFolder(false);
    setFormDestFolderId(null);
    setEditingId(null);
  };

  const openAdd = () => { resetForm(); setShowForm(true); };

  const openEdit = (r: typeof harvestRules[0]) => {
    setFormCondition(r.condition_type);
    setFormSource(r.source_stage_id || '');
    setFormUseCustomFolder(!!r.destination_folder_id);
    setFormDestFolderId(r.destination_folder_id);
    setEditingId(r.id);
    setShowForm(true);
  };

  const stageName = (id: string | null) => id ? (stages.find(s => s.id === id)?.name || '—') : null;
  const stageColor = (id: string) => resolveNativeColorToken(stages.find(s => s.id === id)?.color || colors.textDim, colors);
  const folderLabel = (id: string | null) => {
    if (!id) return "Project's own deliverable folder";
    const f = harvestFolders.find(f => f.id === id);
    return f ? folderPath(harvestFolders as any, f.id) : 'Unknown folder';
  };

  const canSubmit = formCondition !== 'stage_entry' || !!formSource;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const sourceStageId = formCondition === 'stage_entry' ? formSource : (formSource || null);
    const destFolderId = formUseCustomFolder ? formDestFolderId : null;
    if (formUseCustomFolder && !destFolderId) return;

    if (editingId) {
      const existing = harvestRules.find(r => r.id === editingId);
      // rpc_update_harvest_rule COALESCEs every param -- a NULL argument means
      // "leave unchanged", so it cannot clear source_stage_id back to "any" or
      // destination_folder_id back to the dynamic default (documented gap in
      // 20260821_harvest_rule_configurability.sql). Delete + recreate instead
      // of silently no-oping on exactly the edit the user asked for.
      const needsClear = existing && (
        (existing.source_stage_id !== null && sourceStageId === null) ||
        (existing.destination_folder_id !== null && destFolderId === null)
      );
      if (needsClear) {
        const ok = await deleteHarvestRule(editingId);
        if (!ok) return;
        await createHarvestRule({ condition_type: formCondition, source_stage_id: sourceStageId, destination_folder_id: destFolderId });
      } else {
        await updateHarvestRule(editingId, { condition_type: formCondition, source_stage_id: sourceStageId, destination_folder_id: destFolderId });
      }
    } else {
      await createHarvestRule({ condition_type: formCondition, source_stage_id: sourceStageId, destination_folder_id: destFolderId });
    }
    resetForm();
    setShowForm(false);
  };

  const handleToggleActive = async (r: typeof harvestRules[0]) => {
    await updateHarvestRule(r.id, { is_active: !r.is_active });
  };

  const handleDelete = async (id: string) => {
    await deleteHarvestRule(id);
    setConfirmDeleteId(null);
  };

  const handleBackfill = async (id: string) => {
    setBackfillingId(id);
    await backfillHarvestRule(id);
    setBackfillingId(null);
  };

  const conditionInfo = (type: string) => CONDITION_TYPES.find(c => c.value === type) || CONDITION_TYPES[0];

  // stage_entry can target any stage (the original "enters COMPLETED" case
  // included terminal stages); stage_terminal_success only makes sense
  // pinned to a stage that is actually terminal-success, so narrow the list.
  const stageOptions = formCondition === 'stage_entry'
    ? stages
    : stages.filter(s => s.is_terminal && s.terminal_type === 'success');

  return (
    <View className="flex-1 p-8">
      <View className="flex-row items-center justify-between mb-4">
        <View>
          <Text className="text-typography-main text-lg font-black">Harvest Rules</Text>
          <Text className="text-typography-muted text-xs">
            {harvestRules.length} rule{harvestRules.length !== 1 ? 's' : ''} • promotes finished task output into FileHub
          </Text>
        </View>
        {!showForm && (
          <TouchableOpacity
            onPress={openAdd}
            className="bg-brand-primary-dim px-4 py-2 rounded-sm border border-brand-primary/20 active:bg-brand-primary-dim active:scale-95 transition-all"
          >
            <View className="flex-row items-center">
              <FontAwesome name="plus" size={10} color={colors.primary} />
              <Text className="text-brand-primary font-bold text-xs ml-2 uppercase tracking-wide">Add Rule</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>

      {error && (
        <View className="bg-state-danger-dim border border-state-danger/20 p-3 rounded-xl mb-3">
          <Text className="text-state-danger text-sm font-bold">{error}</Text>
        </View>
      )}

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={Platform.OS === 'web'}
        nestedScrollEnabled
      >
        {/* Add/Edit Form */}
        <Popup
          visible={showForm}
          onClose={() => { setShowForm(false); resetForm(); }}
          maxHeight="90%"
          presentation="auto"
          desktopBreakpoint={1024}
          maxWidth={540}
          containerClassName="w-[95%] max-h-[90vh] rounded-3xl overflow-hidden premium-shadow"
        >
          <View className="px-6 py-4 border-b border-surface-border flex-row items-center justify-between">
            <Text className="text-typography-main font-black uppercase tracking-widest text-xs">
              {editingId ? 'Edit Harvest Rule' : 'New Harvest Rule'}
            </Text>
            <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} className="w-8 h-8 items-center justify-center rounded-full" style={{ backgroundColor: colors.background }}>
              <FontAwesome name="times" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <ScrollView className="p-6" style={{ flexShrink: 1 }} nestedScrollEnabled>
            {/* Condition Type */}
            <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-2">Condition</Text>
            <View className="gap-2 mb-4">
              {CONDITION_TYPES.map(ct => (
                <TouchableOpacity
                  key={ct.value}
                  onPress={() => { if (ct.implemented) { setFormCondition(ct.value as any); setFormSource(''); } }}
                  disabled={!ct.implemented}
                  accessibilityState={{ disabled: !ct.implemented }}
                  className={`flex-row items-center p-3 rounded-xl border ${formCondition === ct.value ? 'bg-brand-primary-dim border-brand-primary/30' : 'border-surface-border bg-surface-background'}`}
                >
                  <View className="w-8 h-8 rounded-lg items-center justify-center mr-3" style={{ backgroundColor: ct.color, opacity: 0.2 }}>
                    <FontAwesome name={ct.icon as any} size={14} color={ct.color} />
                  </View>
                  <View className="flex-1">
                    <Text className={`font-bold text-sm ${formCondition === ct.value ? 'text-typography-main' : 'text-typography-muted'}`}>
                      {ct.label}
                    </Text>
                    <Text className="text-typography-dim text-[10px]">
                      {ct.implemented
                        ? ct.desc
                        : `${ct.desc} — not built yet, so this would never fire`}
                    </Text>
                  </View>
                  {ct.implemented ? (
                    <View className={`w-5 h-5 rounded-full border-2 items-center justify-center ${formCondition === ct.value ? 'bg-brand-primary border-brand-primary' : 'border-surface-border'}`}>
                      {formCondition === ct.value && <View className="w-2 h-2 rounded-full bg-white" />}
                    </View>
                  ) : (
                    <View className="px-2 py-0.5 rounded-md border border-surface-border bg-surface-overlay">
                      <Text className="text-typography-dim text-[9px] font-black uppercase tracking-wide">Soon</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {/* Source Stage */}
            <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-2">
              {formCondition === 'stage_entry' ? 'When entering stage' : 'Terminal stage (optional)'}
            </Text>
            <View className="gap-1.5 mb-4">
              {formCondition === 'stage_terminal_success' && (
                <TouchableOpacity
                  onPress={() => setFormSource('')}
                  className={`px-3 py-2 rounded-lg border ${formSource === '' ? 'bg-brand-primary-dim border-brand-primary/30' : 'border-surface-border bg-surface-background'}`}
                >
                  <Text className={`text-xs font-bold ${formSource === '' ? 'text-brand-primary' : 'text-typography-muted'}`}>
                    Any success-terminal stage
                  </Text>
                </TouchableOpacity>
              )}
              {stageOptions.map(s => (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => setFormSource(s.id)}
                  className={`px-3 py-2 rounded-lg border ${formSource === s.id ? 'bg-brand-primary-dim border-brand-primary/30' : 'border-surface-border bg-surface-background'}`}
                >
                  <View className="flex-row items-center">
                    <View className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: s.color || '#6B7280' }} />
                    <Text className={`text-xs font-bold ${formSource === s.id ? 'text-brand-primary' : 'text-typography-muted'}`}>
                      {s.name}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
              {stageOptions.length === 0 && (
                <Text className="text-typography-dim text-[10px]">
                  No terminal-success stages on this pipeline yet.
                </Text>
              )}
            </View>

            {/* Destination */}
            <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-2">Destination</Text>
            <View className="gap-1.5 mb-2">
              <TouchableOpacity
                onPress={() => setFormUseCustomFolder(false)}
                className={`px-3 py-2.5 rounded-lg border ${!formUseCustomFolder ? 'bg-brand-primary-dim border-brand-primary/30' : 'border-surface-border bg-surface-background'}`}
              >
                <Text className={`text-xs font-bold ${!formUseCustomFolder ? 'text-brand-primary' : 'text-typography-muted'}`}>
                  Project's own deliverable folder (default)
                </Text>
                <Text className="text-typography-dim text-[10px] mt-0.5">
                  Resolved per task, from that task's own project.
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setFormUseCustomFolder(true)}
                className={`px-3 py-2.5 rounded-lg border ${formUseCustomFolder ? 'bg-brand-primary-dim border-brand-primary/30' : 'border-surface-border bg-surface-background'}`}
              >
                <Text className={`text-xs font-bold ${formUseCustomFolder ? 'text-brand-primary' : 'text-typography-muted'}`}>
                  A specific FileHub folder
                </Text>
                {formUseCustomFolder && (
                  <Text className="text-typography-dim text-[10px] mt-0.5">
                    {formDestFolderId ? folderLabel(formDestFolderId) : 'Choose a folder below'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
            {formUseCustomFolder && (
              <View className="mb-4">
                <FolderTreePicker
                  folders={harvestFolders as any}
                  selectedId={formDestFolderId}
                  onSelect={setFormDestFolderId}
                  colors={colors}
                  maxHeight={200}
                />
              </View>
            )}
          </ScrollView>
          <View className="p-6 border-t border-surface-border bg-surface-background/50 flex-row gap-3">
            <TouchableOpacity
              onPress={() => { setShowForm(false); resetForm(); }}
              className="flex-1 bg-surface-background py-3 rounded-xl border border-surface-border items-center h-12 justify-center"
            >
              <Text className="text-typography-muted font-bold text-sm">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSubmit}
              className="flex-1 bg-brand-primary py-3 rounded-sm items-center h-12 justify-center"
              disabled={!canSubmit || loading}
            >
              {loading ? (
                <ActivityIndicator color={colors.textMain} size="small" />
              ) : (
                <Text className="text-typography-main font-black text-sm uppercase tracking-wide">
                  {editingId ? 'Save Changes' : 'Create Rule'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </Popup>

        {/* Rule Cards */}
        {harvestRules.map(r => {
          const cInfo = conditionInfo(r.condition_type);
          const srcName = stageName(r.source_stage_id);
          return (
            <View key={r.id}>
              {confirmDeleteId === r.id ? (
                <View className="bg-surface-card p-3 rounded-2xl border border-state-danger/40 mb-3">
                  <Text className="text-typography-main text-sm font-bold mb-2">Delete this harvest rule?</Text>
                  <Text className="text-typography-muted text-xs mb-2">
                    Files it already delivered stay in place — only the rule configuration is removed.
                  </Text>
                  <View className="flex-row gap-3">
                    <TouchableOpacity
                      onPress={() => setConfirmDeleteId(null)}
                      className="flex-1 bg-surface-background py-2 rounded-xl border border-surface-border items-center"
                    >
                      <Text className="text-typography-muted font-bold text-xs">Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleDelete(r.id)}
                      className="flex-1 bg-state-danger py-2 rounded-xl items-center"
                    >
                      <Text className="text-white font-bold text-xs">Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View className={`bg-surface-card p-4 rounded-2xl border mb-3 ${r.is_active ? 'border-surface-border' : 'border-state-warning/30 opacity-60'}`}>
                  <View className="flex-row items-center mb-3">
                    <View className="w-9 h-9 rounded-xl items-center justify-center mr-3" style={{ backgroundColor: cInfo.color + '20' }}>
                      <FontAwesome name={cInfo.icon as any} size={16} color={cInfo.color} />
                    </View>

                    <View className="flex-1">
                      <View className="flex-row items-center gap-2 flex-wrap">
                        <Text className="text-typography-main font-bold text-sm">{cInfo.label}</Text>
                        {!r.is_active && (
                          <View className="bg-state-warning-dim px-1.5 py-0.5 rounded border border-state-warning/20">
                            <Text className="text-state-warning text-[8px] font-black uppercase">Paused</Text>
                          </View>
                        )}
                      </View>
                      <View className="flex-row items-center mt-0.5 flex-wrap">
                        {srcName ? (
                          <>
                            <View className="w-2 h-2 rounded-full mr-1" style={{ backgroundColor: stageColor(r.source_stage_id!) }} />
                            <Text className="text-typography-dim text-[10px] font-bold">{srcName}</Text>
                          </>
                        ) : (
                          <Text className="text-typography-dim text-[10px] font-bold">Any success-terminal stage</Text>
                        )}
                        <FontAwesome name="long-arrow-right" size={8} color={colors.textDim} style={{ marginHorizontal: 4 }} />
                        <FontAwesome name="folder-o" size={9} color={colors.textDim} style={{ marginRight: 4 }} />
                        <Text className="text-typography-dim text-[10px] font-bold flex-shrink" numberOfLines={1}>
                          {folderLabel(r.destination_folder_id)}
                        </Text>
                      </View>
                      {!!backlogCounts[r.id] && (
                        <View className="flex-row items-center mt-1">
                          <View className="bg-brand-primary-dim px-1.5 py-0.5 rounded border border-brand-primary/20">
                            <Text className="text-brand-primary text-[9px] font-black uppercase">
                              {backlogCounts[r.id]} task{backlogCounts[r.id] === 1 ? '' : 's'} already {backlogCounts[r.id] === 1 ? 'qualifies' : 'qualify'}
                            </Text>
                          </View>
                        </View>
                      )}
                    </View>

                    {/* Actions */}
                    <View className="flex-row items-center gap-2">
                      <Tooltip label="Apply this rule to tasks that already qualified before it existed">
                        <TouchableOpacity
                          onPress={() => handleBackfill(r.id)}
                          disabled={backfillingId === r.id}
                          accessibilityLabel="Run backfill"
                          className="p-2 rounded-lg border border-surface-border bg-surface-background"
                        >
                          {backfillingId === r.id ? (
                            <ActivityIndicator size="small" color={colors.textDim} />
                          ) : (
                            <FontAwesome name="refresh" size={10} color={colors.textDim} />
                          )}
                        </TouchableOpacity>
                      </Tooltip>
                      <Tooltip label="Edit rule">
                        <TouchableOpacity
                          onPress={() => openEdit(r)}
                          accessibilityLabel="Edit rule"
                          className="p-2 rounded-lg border border-surface-border bg-surface-background"
                        >
                          <FontAwesome name="pencil" size={10} color={colors.textDim} />
                        </TouchableOpacity>
                      </Tooltip>
                      <Tooltip label={r.is_active ? 'Pause rule' : 'Resume rule'}>
                        <TouchableOpacity
                          onPress={() => handleToggleActive(r)}
                          accessibilityLabel={r.is_active ? 'Pause rule' : 'Resume rule'}
                          className={`w-10 h-6 rounded-full flex-row items-center px-0.5 ${r.is_active ? 'bg-brand-primary justify-end' : 'bg-surface-overlay justify-start'}`}
                        >
                          <View className="w-5 h-5 rounded-full bg-white" />
                        </TouchableOpacity>
                      </Tooltip>
                      <Tooltip label="Delete rule">
                        <TouchableOpacity
                          onPress={() => setConfirmDeleteId(r.id)}
                          accessibilityLabel="Delete rule"
                          className="p-2 rounded-lg border border-surface-border bg-surface-background"
                        >
                          <FontAwesome name="trash-o" size={10} color={colors.textDim} />
                        </TouchableOpacity>
                      </Tooltip>
                    </View>
                  </View>
                </View>
              )}
            </View>
          );
        })}

        {harvestRules.length === 0 && !showForm && (
          <View className="py-16 items-center">
            <FontAwesome name="cloud-download" size={40} color="#1e293b" />
            <Text className="text-typography-muted text-base font-bold mt-4">No Harvest Rules</Text>
            <Text className="text-typography-dim text-sm mt-1 text-center px-8">
              Create rules to promote a finished task's output into a FileHub deliverable folder.
            </Text>
          </View>
        )}
        <View className="h-20" />
      </ScrollView>
    </View>
  );
}
