import { Role, FileVisibility, FileVisibilityPreset, PipelineDeleteImpact } from '@/contexts/PipelineEditorContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Tooltip from '@/components/common/Tooltip';

type PipelineFormData = {
  id?: string;
  name: string;
  description: string | null;
  visibility_permissions: string[];   // stores role UUIDs
  file_visibility: FileVisibility;
  task_visibility_mode: 'all' | 'assigned_only';
  is_default?: boolean;
  assignment_mode: 'manual' | 'round_robin' | 'smart';
  assignment_pool_type: 'users' | 'teams';
  /** #172 P2 -- whether this pipeline's stages describe tasks or projects. */
  subject_kind: 'task' | 'project';
};

type AssignmentPoolMember = {
  id: string;
  member_user_id: string | null;
  member_team_id: string | null;
  is_withdrawn: boolean;
};

type Props = {
  initialData?: Partial<PipelineFormData>;
  /** Workspace roles available to assign */
  roles: Role[];
  /** @deprecated use roles */
  permissions?: Role[];
  onSubmit: (data: PipelineFormData) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
  loading?: boolean;
  error?: string | null;
  onDelete?: () => Promise<void>;
  onClearError?: () => void;
  /** Current pipeline's round-robin/smart assignment pool */
  assignmentPool?: AssignmentPoolMember[];
  /** Company users/teams available to add to the assignment pool */
  companyUsers?: { id: string; full_name: string }[];
  companyTeams?: { id: string; name: string; color?: string | null }[];
  onSetAssignmentPool?: (memberType: 'user' | 'team', memberIds: string[]) => Promise<boolean>;
  onSetPoolMemberWithdrawn?: (memberType: 'user' | 'team', memberId: string, isWithdrawn: boolean) => Promise<boolean>;
};

export default function PipelineSettingsForm({
  initialData,
  roles: rolesProp,
  permissions,   // backward compat
  onSubmit,
  onCancel,
  submitLabel,
  loading,
  error,
  onDelete,
  onClearError,
  assignmentPool,
  companyUsers,
  companyTeams,
  onSetAssignmentPool,
  onSetPoolMemberWithdrawn,
}: Props) {
  const colors = useThemeColors();
  // Accept either prop name
  const roles = rolesProp ?? permissions ?? [];

  const [name, setName] = useState(initialData?.name || '');
  const originalName = useMemo(() => initialData?.name || '', [initialData?.name]);
  const [desc, setDesc] = useState(initialData?.description || '');
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>(
    initialData?.visibility_permissions || []
  );
  const [taskVisibilityMode, setTaskVisibilityMode] = useState<'all' | 'assigned_only'>(
    initialData?.task_visibility_mode || 'all'
  );
  const initFv = initialData?.file_visibility;
  const [fvPreset, setFvPreset] = useState<FileVisibilityPreset>(initFv?.preset || 'task_members');
  const [fvAssignees, setFvAssignees] = useState<boolean>(initFv?.assignees ?? true);
  const [fvReviewers, setFvReviewers] = useState<boolean>(initFv?.reviewers ?? true);
  const [fvRoleIds, setFvRoleIds] = useState<string[]>(initFv?.roles || []);
  const [fvRoleSearch, setFvRoleSearch] = useState('');
  const [fvCategories, setFvCategories] = useState<{ category: string; policy: FileVisibility }[]>(
    initFv?.categories ? Object.entries(initFv.categories).map(([category, policy]) => ({ category, policy })) : []
  );
  const [isDefault, setIsDefault] = useState(initialData?.is_default || false);
  const [subjectKind, setSubjectKind] = useState<'task' | 'project'>(initialData?.subject_kind || 'task');
  const [assignmentMode, setAssignmentMode] = useState<'manual' | 'round_robin' | 'smart'>(
    initialData?.assignment_mode || 'manual'
  );
  const [assignmentPoolType, setAssignmentPoolType] = useState<'users' | 'teams'>(
    initialData?.assignment_pool_type || 'users'
  );
  const [poolSearchTerm, setPoolSearchTerm] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [impact, setImpact] = useState<PipelineDeleteImpact | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);

  // #196: this used to be its own `from('tasks').count()` — a second, drifted
  // implementation of "what does deleting this cost", which knew nothing about
  // projects and claimed every task would be archived. It now asks the same
  // RPC rpc_delete_pipeline itself calls first, so the warning cannot disagree
  // with what the delete does, and a refusal (running timer, missing
  // permission) surfaces here instead of after Confirm.
  React.useEffect(() => {
    if (!showDeleteConfirm || !initialData?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error: e } = await supabase.rpc('rpc_preview_delete_pipeline', {
        p_pipeline_id: initialData.id,
      });
      if (cancelled) return;
      if (e) { setImpactError(e.message); setImpact(null); }
      else { setImpactError(null); setImpact(data as PipelineDeleteImpact); }
    })();
    return () => { cancelled = true; };
  }, [showDeleteConfirm, initialData?.id]);

  const filteredRoles = useMemo(() => {
    if (!searchTerm) return roles;
    return roles.filter(r =>
      r.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [roles, searchTerm]);

  const toggleRole = (id: string) => {
    setSelectedRoleIds(prev =>
      prev.includes(id) ? prev.filter(k => k !== id) : [...prev, id]
    );
  };

  const toggleFvRole = (id: string) =>
    setFvRoleIds(prev => prev.includes(id) ? prev.filter(k => k !== id) : [...prev, id]);

  const addFvCategory = () =>
    setFvCategories(prev => [...prev, { category: '', policy: { preset: 'task_members' } }]);
  const updateFvCategory = (idx: number, next: { category: string; policy: FileVisibility }) =>
    setFvCategories(prev => prev.map((c, i) => (i === idx ? next : c)));
  const removeFvCategory = (idx: number) =>
    setFvCategories(prev => prev.filter((_, i) => i !== idx));

  const fvFilteredRoles = useMemo(() => {
    if (!fvRoleSearch) return roles;
    return roles.filter(r => r.name.toLowerCase().includes(fvRoleSearch.toLowerCase()));
  }, [roles, fvRoleSearch]);

  const buildFileVisibility = (): FileVisibility => {
    const base: FileVisibility = fvPreset === 'custom'
      ? { preset: 'custom', assignees: fvAssignees, reviewers: fvReviewers, roles: fvRoleIds }
      : { preset: fvPreset };
    const overrides = fvCategories.filter(c => c.category.trim());
    if (overrides.length > 0) {
      base.categories = Object.fromEntries(overrides.map(c => [c.category.trim(), c.policy]));
    }
    return base;
  };

  const handleApply = () => {
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      description: desc,
      visibility_permissions: selectedRoleIds,
      file_visibility: buildFileVisibility(),
      task_visibility_mode: taskVisibilityMode,
      is_default: isDefault,
      assignment_mode: assignmentMode,
      assignment_pool_type: assignmentPoolType,
      subject_kind: subjectKind,
    });
  };

  // Assignment pool: ids currently in the pool for the active pool type, and their withdrawn state.
  const poolMemberIds = useMemo(() => {
    return (assignmentPool || [])
      .map(m => assignmentPoolType === 'users' ? m.member_user_id : m.member_team_id)
      .filter((v): v is string => !!v);
  }, [assignmentPool, assignmentPoolType]);

  const poolWithdrawnMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    (assignmentPool || []).forEach(m => {
      const id = assignmentPoolType === 'users' ? m.member_user_id : m.member_team_id;
      if (id) map[id] = m.is_withdrawn;
    });
    return map;
  }, [assignmentPool, assignmentPoolType]);

  const poolOptions: { id: string; label: string; color?: string | null }[] = useMemo(() => {
    return assignmentPoolType === 'users'
      ? (companyUsers || []).map(u => ({ id: u.id, label: u.full_name }))
      : (companyTeams || []).map(t => ({ id: t.id, label: t.name, color: t.color }));
  }, [assignmentPoolType, companyUsers, companyTeams]);

  const filteredPoolOptions = useMemo(() => {
    if (!poolSearchTerm) return poolOptions;
    return poolOptions.filter(o => o.label.toLowerCase().includes(poolSearchTerm.toLowerCase()));
  }, [poolOptions, poolSearchTerm]);

  const togglePoolMember = (id: string) => {
    const memberType = assignmentPoolType === 'users' ? 'user' : 'team';
    const next = poolMemberIds.includes(id) ? poolMemberIds.filter(i => i !== id) : [...poolMemberIds, id];
    onSetAssignmentPool?.(memberType, next);
  };

  const togglePoolWithdrawn = (id: string) => {
    const memberType = assignmentPoolType === 'users' ? 'user' : 'team';
    onSetPoolMemberWithdrawn?.(memberType, id, !poolWithdrawnMap[id]);
  };

  const handleDelete = async () => {
    if (deleteInput.trim() !== originalName.trim()) return;
    setDeleting(true);
    try {
      await onDelete?.();
      // Only close if successful. If it fails, parent updates 'error' prop
      // and we stay open to show it.
      if (!error) {
        setShowDeleteConfirm(false);
        setDeleteInput('');
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <View className="gap-5">
      {/* Basic Info */}
      <View>
        <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Identity</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Pipeline Name"
          placeholderTextColor={colors.textDim}
          className="bg-surface-background border border-surface-border rounded-xl px-4 py-3 text-typography-main font-bold"
        />
      </View>

      <View>
        <TextInput
          value={desc}
          onChangeText={setDesc}
          placeholder="Description (optional)"
          placeholderTextColor={colors.textDim}
          className="bg-surface-background border border-surface-border rounded-xl px-4 py-3 text-typography-main text-sm"
          multiline
          numberOfLines={2}
        />
      </View>

      {/* Pipeline Type (#172 P2) */}
      <View className="bg-surface-overlay/50 p-4 rounded-2xl border border-surface-border">
        <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-3">This Pipeline Governs</Text>
        <View className="flex-row gap-2">
          <TouchableOpacity
            onPress={() => setSubjectKind('task')}
            className={`flex-1 py-2.5 rounded-xl border items-center flex-row justify-center gap-2 ${
              subjectKind === 'task' ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
            }`}
          >
            <FontAwesome name="check-square-o" size={10} color={subjectKind === 'task' ? colors.textMain : colors.textMuted} />
            <Text className={`text-[10px] font-black uppercase tracking-tighter ${subjectKind === 'task' ? 'text-brand-on-primary' : 'text-typography-muted'}`}>
              Tasks
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setSubjectKind('project')}
            className={`flex-1 py-2.5 rounded-xl border items-center flex-row justify-center gap-2 ${
              subjectKind === 'project' ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
            }`}
          >
            <FontAwesome name="folder-o" size={10} color={subjectKind === 'project' ? colors.textMain : colors.textMuted} />
            <Text className={`text-[10px] font-black uppercase tracking-tighter ${subjectKind === 'project' ? 'text-brand-on-primary' : 'text-typography-muted'}`}>
              Projects
            </Text>
          </TouchableOpacity>
        </View>
        <Text className="text-typography-muted text-[9px] mt-2 ml-1 leading-4 italic">
          {subjectKind === 'task'
            ? 'Stages describe how an individual task moves through work — the default for every pipeline.'
            : 'Stages describe a project’s lifecycle instead, and are set from the project detail view, not by moving a task. Tasks cannot be created on a project pipeline.'}
        </Text>
      </View>

      {/* Visibility Section */}
      <View className="bg-surface-overlay/50 p-4 rounded-2xl border border-surface-border">
        <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-4">Security & Visibility</Text>
        
        {/* Role Picker */}
        <View className="mb-4">
          <View className="flex-row items-center justify-between mb-2 px-1">
            <Text className="text-typography-main font-bold text-xs">Access Roles</Text>
            <Text className="text-typography-muted text-[10px]">
              {selectedRoleIds.length === 0 ? 'All roles (public)' : `${selectedRoleIds.length} selected`}
            </Text>
          </View>

          {/* Search */}
          <View className="relative mb-3">
            <View className="absolute left-3 top-2.5 z-10">
              <FontAwesome name="search" size={10} color={colors.textDim} />
            </View>
            <TextInput
              value={searchTerm}
              onChangeText={setSearchTerm}
              placeholder="Search roles..."
              placeholderTextColor={colors.textDim}
              className="bg-surface-background border border-surface-border rounded-lg pl-8 pr-3 py-2 text-[11px] text-typography-main"
            />
          </View>

          {/* Role Pills */}
          <View className="max-h-40 bg-surface-background rounded-xl border border-surface-border overflow-hidden">
            <ScrollView nestedScrollEnabled className="p-2">
              <View className="flex-row flex-wrap gap-2">
                {filteredRoles.length === 0 ? (
                  <Text className="text-typography-muted text-[10px] italic p-2">No matching roles</Text>
                ) : (
                  filteredRoles.map(role => {
                    const isSelected = selectedRoleIds.includes(role.id);
                    return (
                      <TouchableOpacity
                        key={role.id}
                        onPress={() => toggleRole(role.id)}
                        className={`px-3 py-1.5 rounded-lg border flex-row items-center ${
                          isSelected ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'
                        }`}
                      >
                        {isSelected && <FontAwesome name="check" size={8} color={colors.textMain} style={{ marginRight: 6 }} />}
                        {/* Role colour dot */}
                        {role.color && (
                          <View
                            style={{ backgroundColor: role.color, width: 6, height: 6, borderRadius: 3, marginRight: 5 }}
                          />
                        )}
                        <Text className={`text-[10px] font-bold ${isSelected ? 'text-brand-on-primary' : 'text-typography-main'}`}>
                          {role.name}
                        </Text>
                        {role.is_system && (
                          <View className={`ml-1.5 px-1 rounded ${isSelected ? 'bg-brand-on-primary/20' : 'bg-surface-overlay'}`}>
                            <Text className={`text-[7px] font-black uppercase ${isSelected ? 'text-brand-on-primary' : 'text-typography-muted'}`}>SYS</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            </ScrollView>
          </View>

          {selectedRoleIds.length === 0 && (
            <View className="mt-2 px-1 flex-row items-center">
              <FontAwesome name="globe" size={9} color={colors.info} />
              <Text className="text-state-info text-[9px] ml-1.5 italic">
                No role restriction — all workspace members can access this pipeline.
              </Text>
            </View>
          )}

          {selectedRoleIds.length > 0 && (
            <TouchableOpacity onPress={() => setSelectedRoleIds([])} className="mt-2 self-end px-2 py-1">
              <Text className="text-brand-primary text-[9px] font-black uppercase tracking-tighter">Clear Selection</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Task Visibility Toggle */}
        <View>
          <Text className="text-typography-main font-bold text-xs mb-3 px-1">Task Visibility Mode</Text>
          <View className="flex-row gap-2">
            <TouchableOpacity
              onPress={() => setTaskVisibilityMode('all')}
              className={`flex-1 py-2.5 rounded-xl border items-center flex-row justify-center gap-2 ${
                taskVisibilityMode === 'all' ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
              }`}
            >
              <FontAwesome name="globe" size={10} color={taskVisibilityMode === 'all' ? colors.textMain : colors.textMuted} />
              <Text className={`text-[10px] font-black uppercase tracking-tighter ${taskVisibilityMode === 'all' ? 'text-brand-on-primary' : 'text-typography-muted'}`}>
                All Tasks
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setTaskVisibilityMode('assigned_only')}
              className={`flex-1 py-2.5 rounded-xl border items-center flex-row justify-center gap-2 ${
                taskVisibilityMode === 'assigned_only' ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
              }`}
            >
              <FontAwesome name="user-secret" size={10} color={taskVisibilityMode === 'assigned_only' ? colors.textMain : colors.textMuted} />
              <Text className={`text-[10px] font-black uppercase tracking-tighter ${taskVisibilityMode === 'assigned_only' ? 'text-brand-on-primary' : 'text-typography-muted'}`}>
                Assigned Only
              </Text>
            </TouchableOpacity>
          </View>
          <Text className="text-typography-muted text-[9px] mt-2 ml-1 leading-3 italic">
            {taskVisibilityMode === 'all'
              ? 'Members can see all tasks in this pipeline.'
              : 'Members only see tasks assigned to them or their team.'}
          </Text>
        </View>

        {/* Default Pipeline Toggle */}
        <View className="mt-4 pt-4 border-t border-surface-border">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 mr-4">
              <Text className="text-typography-main font-bold text-xs">Set as Default</Text>
              <Text className="text-typography-muted text-[9px] mt-1 leading-3">
                New members will be directed to this pipeline when they first log in.
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setIsDefault(!isDefault)}
              className={`w-12 h-7 rounded-full flex-row items-center px-1 transition-all ${isDefault ? 'bg-brand-primary justify-end' : 'bg-surface-overlay justify-start'}`}
            >
              <View className="w-5 h-5 rounded-full bg-white shadow-sm" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* File Visibility Section */}
      <View className="bg-surface-overlay/50 p-4 rounded-2xl border border-surface-border">
        <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-1">File Visibility</Text>
        <Text className="text-typography-muted text-[9px] mb-4 leading-3 italic">
          Who can open files attached to tasks in this pipeline (briefs & submissions). The task owner and managers can always see them.
        </Text>

        <View className="flex-row flex-wrap gap-2">
          {([
            { key: 'task_members', label: 'Task Members', icon: 'users' },
            { key: 'submitters_reviewers', label: 'Submitters & Reviewers', icon: 'user-secret' },
            { key: 'company', label: 'Company', icon: 'building' },
            { key: 'custom', label: 'Custom', icon: 'sliders' },
          ] as const).map(opt => (
            <TouchableOpacity
              key={opt.key}
              onPress={() => setFvPreset(opt.key)}
              style={{ flexBasis: '48%', flexGrow: 1 }}
              className={`py-2.5 rounded-xl border items-center flex-row justify-center gap-2 ${
                fvPreset === opt.key ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
              }`}
            >
              <FontAwesome name={opt.icon as any} size={10} color={fvPreset === opt.key ? colors.textMain : colors.textMuted} />
              <Text className={`text-[10px] font-black uppercase tracking-tighter ${fvPreset === opt.key ? 'text-brand-on-primary' : 'text-typography-muted'}`}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text className="text-typography-muted text-[9px] mt-2 ml-1 leading-3 italic">
          {fvPreset === 'task_members'
            ? 'Anyone assigned to the task, plus submission reviewers.'
            : fvPreset === 'submitters_reviewers'
            ? 'Only whoever uploaded the file and submission reviewers.'
            : fvPreset === 'company'
            ? 'Anyone in the company can view this pipeline’s task files.'
            : 'Choose exactly who can view below.'}
        </Text>

        {fvPreset === 'custom' && (
          <View className="mt-4 gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-typography-main font-bold text-xs">Task assignees can view</Text>
              <TouchableOpacity
                onPress={() => setFvAssignees(v => !v)}
                className={`w-12 h-7 rounded-full flex-row items-center px-1 ${fvAssignees ? 'bg-brand-primary justify-end' : 'bg-surface-overlay justify-start'}`}
              >
                <View className="w-5 h-5 rounded-full bg-white shadow-sm" />
              </TouchableOpacity>
            </View>

            <View className="flex-row items-center justify-between">
              <Text className="text-typography-main font-bold text-xs">Submission reviewers can view</Text>
              <TouchableOpacity
                onPress={() => setFvReviewers(v => !v)}
                className={`w-12 h-7 rounded-full flex-row items-center px-1 ${fvReviewers ? 'bg-brand-primary justify-end' : 'bg-surface-overlay justify-start'}`}
              >
                <View className="w-5 h-5 rounded-full bg-white shadow-sm" />
              </TouchableOpacity>
            </View>

            <View>
              <View className="flex-row items-center justify-between mb-2 px-1">
                <Text className="text-typography-main font-bold text-xs">Roles that can view</Text>
                <Text className="text-typography-muted text-[10px]">
                  {fvRoleIds.length === 0 ? 'None' : `${fvRoleIds.length} selected`}
                </Text>
              </View>
              <View className="relative mb-3">
                <View className="absolute left-3 top-2.5 z-10">
                  <FontAwesome name="search" size={10} color={colors.textDim} />
                </View>
                <TextInput
                  value={fvRoleSearch}
                  onChangeText={setFvRoleSearch}
                  placeholder="Search roles..."
                  placeholderTextColor={colors.textDim}
                  className="bg-surface-background border border-surface-border rounded-lg pl-8 pr-3 py-2 text-[11px] text-typography-main"
                />
              </View>
              <View className="max-h-40 bg-surface-background rounded-xl border border-surface-border overflow-hidden">
                <ScrollView nestedScrollEnabled className="p-2">
                  <View className="flex-row flex-wrap gap-2">
                    {fvFilteredRoles.length === 0 ? (
                      <Text className="text-typography-muted text-[10px] italic p-2">No matching roles</Text>
                    ) : (
                      fvFilteredRoles.map(role => {
                        const isSelected = fvRoleIds.includes(role.id);
                        return (
                          <TouchableOpacity
                            key={role.id}
                            onPress={() => toggleFvRole(role.id)}
                            className={`px-3 py-1.5 rounded-lg border flex-row items-center ${
                              isSelected ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'
                            }`}
                          >
                            {isSelected && <FontAwesome name="check" size={8} color={colors.textMain} style={{ marginRight: 6 }} />}
                            {role.color && (
                              <View style={{ backgroundColor: role.color, width: 6, height: 6, borderRadius: 3, marginRight: 5 }} />
                            )}
                            <Text className={`text-[10px] font-bold ${isSelected ? 'text-brand-on-primary' : 'text-typography-main'}`}>
                              {role.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </View>
                </ScrollView>
              </View>
            </View>
          </View>
        )}

        {/* Category overrides */}
        <View className="mt-4 pt-4 border-t border-surface-border">
          <View className="flex-row items-center justify-between mb-1">
            <Text className="text-typography-main font-bold text-xs">Category overrides</Text>
            <TouchableOpacity onPress={addFvCategory} className="flex-row items-center gap-1.5 px-2.5 py-1 rounded-lg bg-brand-primary/10">
              <FontAwesome name="plus" size={9} color={colors.primary} />
              <Text className="text-brand-primary text-[10px] font-black uppercase">Add</Text>
            </TouchableOpacity>
          </View>
          <Text className="text-typography-muted text-[9px] mb-3 leading-3 italic">
            Give tasks of a specific category their own rule. The category must match the task’s category exactly.
          </Text>
          {fvCategories.length === 0 ? (
            <Text className="text-typography-muted text-[9px] italic">No overrides — every task uses the policy above.</Text>
          ) : (
            <View className="gap-2">
              {fvCategories.map((row, idx) => (
                <CategoryOverrideRow
                  key={idx}
                  value={row}
                  roles={roles}
                  colors={colors}
                  onChange={(next) => updateFvCategory(idx, next)}
                  onRemove={() => removeFvCategory(idx)}
                />
              ))}
            </View>
          )}
        </View>
      </View>

      {/* Assignment Section */}
      <View className="bg-surface-overlay/50 p-4 rounded-2xl border border-surface-border">
        <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-4">Task Assignment</Text>

        {/* Mode Selector */}
        <View className="mb-4">
          <Text className="text-typography-main font-bold text-xs mb-3 px-1">Assignment Mode</Text>
          <View className="flex-row gap-2">
            {([
              { key: 'manual', label: 'Manual', icon: 'hand-paper-o' },
              { key: 'round_robin', label: 'Round Robin', icon: 'refresh' },
              { key: 'smart', label: 'Smart', icon: 'magic' },
            ] as const).map(opt => (
              <TouchableOpacity
                key={opt.key}
                onPress={() => setAssignmentMode(opt.key)}
                className={`flex-1 py-2.5 rounded-xl border items-center flex-row justify-center gap-2 ${
                  assignmentMode === opt.key ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
                }`}
              >
                <FontAwesome name={opt.icon as any} size={10} color={assignmentMode === opt.key ? colors.textMain : colors.textMuted} />
                <Text className={`text-[10px] font-black uppercase tracking-tighter ${assignmentMode === opt.key ? 'text-brand-on-primary' : 'text-typography-muted'}`}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text className="text-typography-muted text-[9px] mt-2 ml-1 leading-3 italic">
            {assignmentMode === 'manual'
              ? 'Tasks are assigned by hand. No automatic rotation.'
              : assignmentMode === 'round_robin'
              ? 'Unassigned tasks rotate evenly across the pool below.'
              : 'Favors pool members lacking points but punching above their weight productivity-wise (trailing 30 days). Falls back to whoever is least loaded, then to plain rotation if everyone is tied.'}
          </Text>
        </View>

        {assignmentMode !== 'manual' && (
          <>
            {/* Pool Type Selector */}
            <View className="mb-4">
              <Text className="text-typography-main font-bold text-xs mb-3 px-1">Pool Type</Text>
              <View className="flex-row gap-2">
                <TouchableOpacity
                  onPress={() => setAssignmentPoolType('users')}
                  className={`flex-1 py-2.5 rounded-xl border items-center flex-row justify-center gap-2 ${
                    assignmentPoolType === 'users' ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
                  }`}
                >
                  <FontAwesome name="user" size={10} color={assignmentPoolType === 'users' ? colors.textMain : colors.textMuted} />
                  <Text className={`text-[10px] font-black uppercase tracking-tighter ${assignmentPoolType === 'users' ? 'text-brand-on-primary' : 'text-typography-muted'}`}>
                    Users
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setAssignmentPoolType('teams')}
                  className={`flex-1 py-2.5 rounded-xl border items-center flex-row justify-center gap-2 ${
                    assignmentPoolType === 'teams' ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
                  }`}
                >
                  <FontAwesome name="users" size={10} color={assignmentPoolType === 'teams' ? colors.textMain : colors.textMuted} />
                  <Text className={`text-[10px] font-black uppercase tracking-tighter ${assignmentPoolType === 'teams' ? 'text-brand-on-primary' : 'text-typography-muted'}`}>
                    Teams
                  </Text>
                </TouchableOpacity>
              </View>
              <Text className="text-typography-muted text-[9px] mt-2 ml-1 leading-3 italic">
                {assignmentPoolType === 'teams'
                  ? 'Each turn hands the whole task to one team — the team self-organizes who picks it up.'
                  : 'Each turn hands the task to one individual.'}
              </Text>
            </View>

            {/* Pool Picker */}
            <View>
              <View className="flex-row items-center justify-between mb-2 px-1">
                <Text className="text-typography-main font-bold text-xs">Rotation Pool</Text>
                <Text className="text-typography-muted text-[10px]">
                  {poolMemberIds.length === 0 ? 'Empty — nothing will be assigned' : `${poolMemberIds.length} in pool`}
                </Text>
              </View>

              <View className="relative mb-3">
                <View className="absolute left-3 top-2.5 z-10">
                  <FontAwesome name="search" size={10} color={colors.textDim} />
                </View>
                <TextInput
                  value={poolSearchTerm}
                  onChangeText={setPoolSearchTerm}
                  placeholder={assignmentPoolType === 'users' ? 'Search users...' : 'Search teams...'}
                  placeholderTextColor={colors.textDim}
                  className="bg-surface-background border border-surface-border rounded-lg pl-8 pr-3 py-2 text-[11px] text-typography-main"
                />
              </View>

              <View className="max-h-40 bg-surface-background rounded-xl border border-surface-border overflow-hidden">
                <ScrollView nestedScrollEnabled className="p-2">
                  <View className="flex-row flex-wrap gap-2">
                    {filteredPoolOptions.length === 0 ? (
                      <Text className="text-typography-muted text-[10px] italic p-2">No matches</Text>
                    ) : (
                      filteredPoolOptions.map(opt => {
                        const isSelected = poolMemberIds.includes(opt.id);
                        const isWithdrawn = !!poolWithdrawnMap[opt.id];
                        return (
                          <View
                            key={opt.id}
                            className={`px-3 py-1.5 rounded-lg border flex-row items-center ${
                              isSelected ? (isWithdrawn ? 'bg-surface-card border-surface-border opacity-40' : 'bg-brand-primary border-brand-primary') : 'bg-surface-card border-surface-border'
                            }`}
                          >
                            <TouchableOpacity onPress={() => togglePoolMember(opt.id)} className="flex-row items-center">
                              {isSelected && <FontAwesome name="check" size={8} color={isWithdrawn ? colors.textMuted : colors.textMain} style={{ marginRight: 6 }} />}
                              {opt.color && (
                                <View style={{ backgroundColor: opt.color, width: 6, height: 6, borderRadius: 3, marginRight: 5 }} />
                              )}
                              <Text className={`text-[10px] font-bold ${isSelected && !isWithdrawn ? 'text-brand-on-primary' : 'text-typography-main'}`}>
                                {opt.label}
                              </Text>
                            </TouchableOpacity>
                            {isSelected && (
                              <Tooltip label={isWithdrawn ? 'Restore to pool' : 'Withdraw from pool'}>
                                <TouchableOpacity onPress={() => togglePoolWithdrawn(opt.id)} className="ml-2">
                                  <FontAwesome
                                    name={isWithdrawn ? 'undo' : 'ban'}
                                    size={9}
                                    color={isWithdrawn ? colors.success : (isSelected ? colors.textMain : colors.danger)}
                                  />
                                </TouchableOpacity>
                              </Tooltip>
                            )}
                            {isWithdrawn && (
                              <Text className="text-state-warning text-[7px] font-black uppercase ml-1.5">Withdrawn</Text>
                            )}
                          </View>
                        );
                      })
                    )}
                  </View>
                </ScrollView>
              </View>

              <View className="mt-2 px-1 flex-row items-center">
                <FontAwesome name="info-circle" size={9} color={colors.info} />
                <Text className="text-state-info text-[9px] ml-1.5 italic flex-1">
                  Withdrawing a member keeps them in the pool but skips them until reinstated — use this for leave, not for permanent removal.
                </Text>
              </View>
            </View>
          </>
        )}
      </View>

      {/* Danger Zone */}
      {onDelete && (
        <View className="mt-8 pt-8 border-t border-surface-border">
          <Text className="text-state-danger text-[10px] font-black uppercase tracking-widest mb-4 ml-1">Danger Zone</Text>
          
          <View className="bg-state-danger/5 border border-state-danger/20 p-6 rounded-2xl">
            <View className="flex-row items-center justify-between mb-4">
              <View className="flex-1 mr-4">
                <Text className="text-typography-main font-bold text-sm">Delete Pipeline</Text>
                <Text className="text-typography-muted text-[10px] mt-1 leading-4">
                  Archives this pipeline and its stages, transitions and automations. Tasks that belong to a project are kept — everything else on this board is deleted.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowDeleteConfirm(true)}
                className="bg-state-danger px-4 py-2 rounded-xl active:scale-95 transition-all"
              >
                <Text className="text-brand-on-primary font-black uppercase tracking-widest text-[10px]">Delete</Text>
              </TouchableOpacity>
            </View>

            {showDeleteConfirm && (
              <View className="mt-4 p-4 bg-surface-card rounded-xl border border-state-danger/30">
                {error && (
                  <View className="bg-state-danger/10 border border-state-danger/30 p-3 rounded-lg mb-4 flex-row items-center gap-2">
                    <FontAwesome name="exclamation-circle" size={12} color={colors.danger} />
                    <Text className="text-state-danger text-[10px] font-bold flex-1">{error}</Text>
                  </View>
                )}

                {impactError && (
                  <View className="bg-state-danger/10 border border-state-danger/30 p-3 rounded-lg mb-4 flex-row items-center gap-2">
                    <FontAwesome name="exclamation-circle" size={12} color={colors.danger} />
                    <Text className="text-state-danger text-[10px] font-bold flex-1">{impactError}</Text>
                  </View>
                )}

                {!!impact && impact.tasks_total > 0 && (
                  <View className="bg-state-warning/10 border border-state-warning/30 p-3 rounded-lg mb-4 flex-row items-start gap-2">
                    <FontAwesome name="exclamation-triangle" size={12} color={colors.warning} />
                    <View className="flex-1">
                      <Text className="text-state-warning text-[10px] font-bold">
                        {`This board holds ${impact.tasks_total} task${impact.tasks_total === 1 ? '' : 's'}`}
                        {impact.projects_affected > 0
                          ? ` across ${impact.projects_affected} project${impact.projects_affected === 1 ? '' : 's'}`
                          : ''}
                      </Text>
                      {impact.tasks_detached > 0 && (
                        <Text className="text-typography-muted text-[9px] mt-0.5">
                          {`${impact.tasks_detached} kept on ${impact.projects.map(p => p.name).join(', ')} — detached from any board.`}
                        </Text>
                      )}
                      {impact.tasks_deleted > 0 && (
                        <Text className="text-typography-muted text-[9px] mt-0.5">
                          {`${impact.tasks_deleted} belong to no project and will be deleted. This cannot be undone.`}
                        </Text>
                      )}
                    </View>
                  </View>
                )}
                <Text className="text-typography-main font-bold text-xs mb-3">
                  Please type <Text className="text-state-danger">"{originalName}"</Text> to confirm:
                </Text>
                <TextInput
                  value={deleteInput}
                  onChangeText={setDeleteInput}
                  placeholder="Type pipeline name..."
                  placeholderTextColor={colors.textDim}
                  className="bg-surface-background border border-surface-border rounded-lg px-3 py-2 text-xs text-typography-main mb-3"
                />
                <View className="flex-row gap-2">
                  <TouchableOpacity
                    onPress={() => {
                      setShowDeleteConfirm(false);
                      setDeleteInput('');
                      onClearError?.();
                    }}
                    className="flex-1 bg-surface-background py-2 rounded-lg border border-surface-border items-center"
                  >
                    <Text className="text-typography-muted font-bold text-[10px] uppercase">Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleDelete}
                    disabled={deleteInput.trim() !== originalName.trim() || deleting}
                    className={`flex-1 py-2 rounded-lg items-center ${
                      deleteInput.trim() !== originalName.trim() || deleting ? 'bg-state-danger/30' : 'bg-state-danger'
                    }`}
                  >
                    {deleting ? (
                      <ActivityIndicator size="small" color={colors.textMain} />
                    ) : (
                      <Text className="text-brand-on-primary font-black text-[10px] uppercase">Confirm Delete</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Footer Actions */}
      <View className="flex-row gap-3 pt-4 mb-10">
        <TouchableOpacity
          onPress={onCancel}
          className="flex-1 bg-surface-background py-3 rounded-xl border border-surface-border items-center justify-center h-12"
        >
          <Text className="text-typography-muted font-bold text-[11px] uppercase tracking-wider">Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleApply}
          disabled={!name.trim() || loading}
          className={`flex-1 py-3 rounded-xl items-center justify-center h-12 premium-shadow ${
            !name.trim() || loading ? 'bg-surface-overlay opacity-50' : 'bg-brand-primary'
          }`}
        >
          {loading ? (
            <ActivityIndicator color={colors.textMain} size="small" />
          ) : (
            <Text className="text-brand-on-primary font-black uppercase tracking-wider text-[11px]">{submitLabel}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** One per-category file-visibility override row (category name + its own policy). */
function CategoryOverrideRow({
  value, roles, colors, onChange, onRemove,
}: {
  value: { category: string; policy: FileVisibility };
  roles: Role[];
  colors: ReturnType<typeof useThemeColors>;
  onChange: (next: { category: string; policy: FileVisibility }) => void;
  onRemove: () => void;
}) {
  const { category, policy } = value;
  const preset = policy.preset;

  const setPreset = (p: FileVisibilityPreset) =>
    onChange({ category, policy: p === 'custom'
      ? { preset: 'custom', assignees: policy.assignees ?? true, reviewers: policy.reviewers ?? true, roles: policy.roles ?? [] }
      : { preset: p } });
  const patchPolicy = (patch: Partial<FileVisibility>) =>
    onChange({ category, policy: { ...policy, ...patch } });
  const toggleRole = (id: string) => {
    const cur = policy.roles ?? [];
    patchPolicy({ roles: cur.includes(id) ? cur.filter(r => r !== id) : [...cur, id] });
  };

  return (
    <View className="bg-surface-background rounded-xl border border-surface-border p-3">
      <View className="flex-row items-center gap-2 mb-2">
        <TextInput
          value={category}
          onChangeText={(t) => onChange({ category: t, policy })}
          placeholder="Category name (exact)"
          placeholderTextColor={colors.textDim}
          className="flex-1 bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-[11px] text-typography-main"
        />
        <TouchableOpacity onPress={onRemove} className="w-8 h-8 rounded-lg items-center justify-center border border-surface-border">
          <FontAwesome name="trash-o" size={11} color={colors.danger} />
        </TouchableOpacity>
      </View>

      <View className="flex-row flex-wrap gap-1.5">
        {(['task_members', 'submitters_reviewers', 'company', 'custom'] as const).map(p => (
          <TouchableOpacity
            key={p}
            onPress={() => setPreset(p)}
            className={`px-2.5 py-1 rounded-lg border ${preset === p ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
          >
            <Text className={`text-[9px] font-black uppercase tracking-tighter ${preset === p ? 'text-brand-on-primary' : 'text-typography-muted'}`}>
              {p === 'task_members' ? 'Members' : p === 'submitters_reviewers' ? 'Submitters' : p === 'company' ? 'Company' : 'Custom'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {preset === 'custom' && (
        <View className="mt-2 gap-2">
          <View className="flex-row items-center gap-4">
            <TouchableOpacity onPress={() => patchPolicy({ assignees: !(policy.assignees ?? true) })} className="flex-row items-center gap-1.5">
              <FontAwesome name={(policy.assignees ?? true) ? 'check-square' : 'square-o'} size={12} color={(policy.assignees ?? true) ? colors.primary : colors.textMuted} />
              <Text className="text-typography-main text-[10px]">Assignees</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => patchPolicy({ reviewers: !(policy.reviewers ?? true) })} className="flex-row items-center gap-1.5">
              <FontAwesome name={(policy.reviewers ?? true) ? 'check-square' : 'square-o'} size={12} color={(policy.reviewers ?? true) ? colors.primary : colors.textMuted} />
              <Text className="text-typography-main text-[10px]">Reviewers</Text>
            </TouchableOpacity>
          </View>
          {roles.length > 0 && (
            <View className="flex-row flex-wrap gap-1.5">
              {roles.map(role => {
                const sel = (policy.roles ?? []).includes(role.id);
                return (
                  <TouchableOpacity
                    key={role.id}
                    onPress={() => toggleRole(role.id)}
                    className={`px-2.5 py-1 rounded-lg border flex-row items-center ${sel ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
                  >
                    {sel && <FontAwesome name="check" size={7} color={colors.textMain} style={{ marginRight: 4 }} />}
                    <Text className={`text-[9px] font-bold ${sel ? 'text-brand-on-primary' : 'text-typography-main'}`}>{role.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      )}
    </View>
  );
}
