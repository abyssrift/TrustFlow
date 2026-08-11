import { useAuth } from '@/contexts/AuthContext';
import { useProjectDetail } from '@/contexts/ProjectDetailContext';
import { PROJECT_FLAGS, ProjectFlag } from '@/hooks/useProjectLifecycle';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import ProjectFolderModal from './ProjectFolderModal';
import ProjectStagePicker from './ProjectStagePicker';
import Tooltip from '@/components/common/Tooltip';
import { EntityGlyph, EntityTag, HealthBadge, StageChip } from '@/components/entities/EntityUI';
import { InlineRename, ProjectActionsButton, useProjectActions } from './ProjectActionsMenu';

// #184 -- the shared header every /projects/[id] tab sits under: name, stage,
// flags. Stage picking and flag-toggling reuse useProjectLifecycle (#172 P2)
// via ProjectDetailContext (#183), so this header and ProjectOverviewTab
// share one fetch and one piece of state instead of drifting when the
// flags/stage change.
//
// Phase 8 (#187, plan §14.1/§17):
// - The name never renders bare. It sits behind the project glyph and under
//   the "PROJECT" tag, which is the whole point of §17 — the user is told
//   which of the four entities this screen is about.
// - Stage is `StageChip` and health is `HealthBadge` from
//   components/entities/EntityUI.tsx — the same two components the list row
//   and the board card use, so a project reads the same everywhere.
// - Rename happens in place, and roll-forward / save-as-template / archive
//   moved into the shared `useProjectActions` menu, so this header offers two
//   controls instead of a growing row of icon buttons.
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
  const [noteDraft, setNoteDraft] = useState(lifecycle?.flagNote || '');
  const [savingFlags, setSavingFlags] = useState(false);

  useEffect(() => { setNoteDraft(lifecycle?.flagNote || ''); }, [lifecycle?.flagNote]);

  const canEdit = hasPermission('project.edit');
  const activeFlags = lifecycle?.flags ?? [];
  const project = data?.project;

  // Same menu the list row and the board card open — one definition of what
  // you can do to a project (plan §17: reachable from where you are looking).
  // Archiving removes the row this route renders, so "go back" is not a
  // destination — history may point at this very project, or at a Dashboard
  // that no longer lists it. Go to the list, which is where the user's next
  // action is.
  const actions = useProjectActions({ onChanged: refresh, onArchived: () => router.navigate('/projects') });

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

  return (
    <View className="px-4 md:px-8 py-4 md:py-5 border-b" style={{ borderColor: c.border, backgroundColor: c.background }}>
      <View className="flex-row items-start gap-3">
        <Tooltip label="Back to Projects">
          <TouchableOpacity
            // NOT router.back(). This control is labelled "Back to Projects",
            // but back() pops history — so arriving from the Dashboard, a
            // notification, a search result, or a pasted /projects/[id] URL
            // sent the user somewhere that is not the projects list, which is
            // exactly what a user hit. A control that names a destination must
            // go to that destination. `navigate` reuses the existing history
            // entry when the list is already behind us, so the common case
            // still behaves like Back.
            onPress={() => router.navigate('/projects')}
            accessibilityRole="button"
            accessibilityLabel="Back to projects"
            style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}
          >
            <FontAwesome name="chevron-left" size={15} color={c.textMuted} />
          </TouchableOpacity>
        </Tooltip>

        <EntityGlyph kind="project" size={40} style={{ marginTop: 1 }} />

        <View className="flex-1 min-w-0">
          <View className="flex-row items-center gap-2">
            <EntityTag kind="project" />
            {project?.is_featured && (
              <Tooltip label="Featured project">
                <FontAwesome name="star" size={11} color={c.warning} />
              </Tooltip>
            )}
          </View>

          {actions.renamingId === projectId && project ? (
            <View style={{ maxWidth: 420 }} className="mt-1">
              <InlineRename
                initialValue={project.name}
                onCommit={(next) => actions.commitRename({ id: project.id, name: project.name }, next)}
                onCancel={actions.cancelRename}
                style={{ height: 40, fontSize: 18 }}
              />
            </View>
          ) : (
            <Text numberOfLines={2} className="text-xl md:text-2xl font-black tracking-tight" style={{ color: c.textMain }}>
              {project?.name || 'Project'}
            </Text>
          )}

          {!!project?.description && (
            <Text className="text-sm mt-1" style={{ color: c.textMuted }} numberOfLines={2}>{project.description}</Text>
          )}

          {/* State: the same stage chip and health badge as everywhere else. */}
          <View className="flex-row flex-wrap items-center gap-2 mt-2.5">
            <StageChip
              name={lifecycle?.stageName}
              color={lifecycle?.stageColor}
              onPress={() => setStagePickerVisible(true)}
              disabled={!canEdit}
              disabledReason="You need the “edit projects” permission to move this project between stages."
              trailingIcon={canEdit ? 'exchange' : undefined}
            />
            <HealthBadge
              blocked={lifecycle?.blocked}
              blockedReason={lifecycle?.blockedReason}
              flags={lifecycle?.flags}
              daysRemaining={lifecycle?.daysRemaining}
            />
          </View>

          {/* Flags -- fixed set, plan §13.12: blocked / awaiting client / at risk.
              One horizontally-scrolling rail, not a wrapping row: at 390px the
              content column is ~250px wide, so wrapping put each chip on its own
              line and the header ate a third of the viewport before the tabs
              appeared. flexGrow:0 for the same reason every other chip rail in
              this app carries it — RNW stretches a ScrollView inside a column
              and balloons the pills. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, marginTop: 8 }}
            contentContainerStyle={{ gap: 8, alignItems: 'center' }}
          >
            {canEdit && (
              <Text className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: c.textDim }}>Flags</Text>
            )}
            {PROJECT_FLAGS.map(({ key, label }) => {
              const active = activeFlags.includes(key);
              const color = c[FLAG_COLOR[key]];
              if (!active && !canEdit) return null; // read-only viewers only see flags that are actually set
              return (
                <Tooltip key={key} label={active ? `Clear the “${label}” flag` : `Flag this project as ${label.toLowerCase()}`}>
                  <TouchableOpacity
                    disabled={!canEdit || savingFlags}
                    onPress={() => toggleFlag(key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={{
                      minHeight: 30, paddingHorizontal: 10, borderRadius: 999,
                      flexDirection: 'row', alignItems: 'center', gap: 5,
                      borderWidth: 1, borderColor: active ? color + '66' : c.border,
                      backgroundColor: active ? color + '18' : 'transparent',
                    }}
                  >
                    <FontAwesome name={active ? 'flag' : 'flag-o'} size={9} color={active ? color : c.textDim} />
                    <Text className="text-[11px] font-semibold" style={{ color: active ? color : c.textDim }}>{label}</Text>
                  </TouchableOpacity>
                </Tooltip>
              );
            })}
            {savingFlags && <ActivityIndicator size="small" color={c.textMuted} />}
          </ScrollView>

          {activeFlags.length > 0 && canEdit && (
            <TextInput
              value={noteDraft}
              onChangeText={setNoteDraft}
              onBlur={saveNote}
              placeholder="Why is it flagged? Whoever reads this next will thank you."
              placeholderTextColor={c.textDim}
              accessibilityLabel="Flag note"
              className="rounded-xl px-3 mt-2 text-sm"
              style={{ height: 40, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, color: c.textMain, maxWidth: 480 }}
            />
          )}
          {activeFlags.length > 0 && !canEdit && !!lifecycle?.flagNote && (
            <Text className="text-xs mt-2" style={{ color: c.textMuted }}>{lifecycle.flagNote}</Text>
          )}
        </View>

        <View className="flex-row items-center gap-2">
          <Tooltip label={canEdit ? 'Edit name, description, due date and status' : 'You need the “edit projects” permission to change this project'}>
            <TouchableOpacity
              onPress={() => canEdit && setEditVisible(true)}
              disabled={!canEdit}
              accessibilityRole="button"
              accessibilityLabel="Edit project"
              style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.border, opacity: canEdit ? 1 : 0.45 }}
            >
              <FontAwesome name="pencil-square-o" size={14} color={c.textMuted} />
            </TouchableOpacity>
          </Tooltip>
          {!!project && (
            <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <ProjectActionsButton
                onPress={() => actions.openMenu({ id: project.id, name: project.name })}
                label="More project actions"
              />
            </View>
          )}
        </View>
      </View>

      <ProjectStagePicker
        visible={stagePickerVisible}
        currentStageId={lifecycle?.currentStageId ?? null}
        onClose={() => setStagePickerVisible(false)}
        onSelectStage={advanceStage}
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
      {actions.overlay}
    </View>
  );
}
