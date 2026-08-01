import { useAuth } from '@/contexts/AuthContext';
import { useProjectDetail } from '@/contexts/ProjectDetailContext';
import { PROJECT_FLAGS, ProjectFlag } from '@/hooks/useProjectLifecycle';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import ProjectFolderModal from './ProjectFolderModal';
import ProjectStagePicker from './ProjectStagePicker';
import SaveAsTemplateSheet from './SaveAsTemplateSheet';
import Tooltip from '@/components/common/Tooltip';

// #184 -- the shared header every /projects/[id] tab sits under: name, stage,
// flags. Stage picking and flag-toggling reuse useProjectLifecycle (#172 P2),
// previously only consumed by the two Popup-based dashboards this issue
// retires -- see that hook's file header. Edit / Save-as-template reuse
// ProjectFolderModal and SaveAsTemplateSheet unchanged, same components the
// retired popups used.
//
// #183 -- useProjectLifecycle itself is now called once inside
// ProjectDetailContext, not here. This header and ProjectOverviewTab both
// need it (stage/blocked for the header's chips, stage/blocked/due-date for
// the Overview tab's answer line); two separate hook instances meant
// toggling a flag here left Overview showing stale state until an unrelated
// remount. Reading it off useProjectDetail() keeps both in sync for free.
//
// Styled with inline useThemeColors values (not className tokens) -- flag
// colors are data-driven (per-flag color, active/inactive), which className
// can't express without a combinatorial set of static classes, and this
// header also hosts ProjectFolderModal/ProjectStagePicker, both RN Modal-
// based Popups where token classes are known to go black on web (see
// Tooltip.tsx for the same sanctioned exception).

const FLAG_COLOR: Record<ProjectFlag, keyof ReturnType<typeof useThemeColors>> = {
  blocked: 'danger',
  awaiting_client: 'warning',
  at_risk: 'accent',
};

export default function ProjectHeader() {
  const c = useThemeColors();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const { projectId, data, refresh, lifecycle, advanceStage, setFlags } = useProjectDetail();

  const [stagePickerVisible, setStagePickerVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [saveTemplateVisible, setSaveTemplateVisible] = useState(false);
  const [noteDraft, setNoteDraft] = useState(lifecycle?.flagNote || '');
  const [savingFlags, setSavingFlags] = useState(false);

  useEffect(() => { setNoteDraft(lifecycle?.flagNote || ''); }, [lifecycle?.flagNote]);

  const canEdit = hasPermission('project.edit');
  const canCreateTemplate = hasPermission('project.create');
  const activeFlags = lifecycle?.flags ?? [];

  const toggleFlag = async (flag: ProjectFlag) => {
    if (!canEdit) return;
    const next = activeFlags.includes(flag) ? activeFlags.filter(f => f !== flag) : [...activeFlags, flag];
    setSavingFlags(true);
    await setFlags(next, noteDraft);
    setSavingFlags(false);
  };

  const saveNote = async () => {
    if (!canEdit || activeFlags.length === 0) return;
    if (noteDraft.trim() === (lifecycle?.flagNote || '')) return;
    await setFlags(activeFlags, noteDraft);
  };

  const project = data?.project;

  return (
    <View className="px-4 md:px-8 py-4 md:py-6 border-b" style={{ borderColor: c.border, backgroundColor: c.background }}>
      <View className="flex-row items-start gap-3">
        <Tooltip label="Back to Projects">
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}
          >
            <FontAwesome name="chevron-left" size={16} color={c.textMuted} />
          </TouchableOpacity>
        </Tooltip>

        <View className="flex-1">
          <Text className="font-black uppercase tracking-[0.3em] text-[9px] mb-1" style={{ color: c.primary }}>Project</Text>
          <View className="flex-row flex-wrap items-center gap-3">
            {project?.is_featured && <FontAwesome name="star" size={16} color={c.warning} />}
            <Text numberOfLines={1} className="text-2xl md:text-3xl font-black tracking-tight" style={{ color: c.textMain, maxWidth: '100%' }}>
              {project?.name || 'Project'}
            </Text>

            {/* Stage chip */}
            <TouchableOpacity
              disabled={!canEdit}
              onPress={() => setStagePickerVisible(true)}
              style={{ minHeight: 32, paddingHorizontal: 12, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}
            >
              {lifecycle?.stageName ? (
                <>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: lifecycle.stageColor ?? c.primary }} />
                  <Text className="text-xs font-black" style={{ color: c.textMain }} numberOfLines={1}>{lifecycle.stageName}</Text>
                </>
              ) : (
                <Text className="text-xs font-bold" style={{ color: c.textDim }}>No stage</Text>
              )}
              {canEdit && <FontAwesome name="exchange" size={10} color={c.textMuted} />}
            </TouchableOpacity>
          </View>

          {!!project?.description && (
            <Text className="text-sm mt-2" style={{ color: c.textMuted }} numberOfLines={2}>{project.description}</Text>
          )}

          {/* Flags -- fixed set, plan §13.12: blocked / awaiting client / at risk */}
          <View className="flex-row flex-wrap items-center gap-2 mt-3">
            {PROJECT_FLAGS.map(({ key, label }) => {
              const active = activeFlags.includes(key);
              const color = c[FLAG_COLOR[key]];
              if (!active && !canEdit) return null; // read-only viewers only see flags that are actually set
              return (
                <TouchableOpacity
                  key={key}
                  disabled={!canEdit || savingFlags}
                  onPress={() => toggleFlag(key)}
                  style={{
                    minHeight: 32, paddingHorizontal: 12, borderRadius: 999,
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    borderWidth: 1, borderColor: active ? color + '66' : c.border,
                    backgroundColor: active ? color + '18' : 'transparent',
                  }}
                >
                  <FontAwesome name={active ? 'flag' : 'flag-o'} size={10} color={active ? color : c.textDim} />
                  <Text className="text-[11px] font-black uppercase tracking-wider" style={{ color: active ? color : c.textDim }}>{label}</Text>
                </TouchableOpacity>
              );
            })}
            {savingFlags && <ActivityIndicator size="small" color={c.textMuted} />}
          </View>

          {activeFlags.length > 0 && canEdit && (
            <TextInput
              value={noteDraft}
              onChangeText={setNoteDraft}
              onBlur={saveNote}
              placeholder="Note (optional) — why this project is flagged"
              placeholderTextColor={c.textDim}
              className="rounded-xl px-3 mt-2 text-sm"
              style={{ height: 40, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, color: c.textMain, maxWidth: 480 }}
            />
          )}
          {activeFlags.length > 0 && !canEdit && !!lifecycle?.flagNote && (
            <Text className="text-xs mt-2" style={{ color: c.textMuted }}>{lifecycle.flagNote}</Text>
          )}
        </View>

        <View className="flex-row items-center gap-2">
          {canCreateTemplate && (
            <Tooltip label="Save as template">
              <TouchableOpacity
                onPress={() => setSaveTemplateVisible(true)}
                style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}
              >
                <FontAwesome name="save" size={14} color={c.textMuted} />
              </TouchableOpacity>
            </Tooltip>
          )}
          {canEdit && (
            <Tooltip label="Edit project">
              <TouchableOpacity
                onPress={() => setEditVisible(true)}
                style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}
              >
                <FontAwesome name="pencil" size={14} color={c.textMuted} />
              </TouchableOpacity>
            </Tooltip>
          )}
        </View>
      </View>

      <ProjectStagePicker
        visible={stagePickerVisible}
        currentStageId={lifecycle?.currentStageId ?? null}
        onClose={() => setStagePickerVisible(false)}
        onSelectStage={advanceStage}
      />
      <SaveAsTemplateSheet
        visible={saveTemplateVisible}
        projectId={projectId}
        projectName={project?.name}
        onClose={() => setSaveTemplateVisible(false)}
      />
      {project && (
        <ProjectFolderModal
          visible={editVisible}
          onClose={() => setEditVisible(false)}
          onSuccess={() => { setEditVisible(false); refresh(); }}
          project={{
            id: project.id,
            name: project.name,
            description: project.description ?? '',
            expiry_date: project.expiry_date,
            status: project.status as 'active' | 'closed' | 'archived',
          }}
        />
      )}
    </View>
  );
}
