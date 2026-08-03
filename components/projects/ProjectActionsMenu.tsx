import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useCallback, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import Popup from '@/components/common/Popup';
import Tooltip from '@/components/common/Tooltip';
import { EntityHeading } from '@/components/entities/EntityUI';
import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import RollforwardSheet from './RollforwardSheet';
import SaveAsTemplateSheet from './SaveAsTemplateSheet';

/**
 * Phase 8 (#187, plan §14.2 / §17) — "duplicate / rename / archive reachable
 * from where the user is looking, not only from a detail route."
 *
 * Every one of these actions already existed somewhere; none of them were
 * reachable from a list. Rollforward (#185) in particular shipped a whole
 * sheet with NO entry point anywhere in the app — this hook is it. Nothing
 * here invents a write path:
 *   rename   -> `projects.update` (what ProjectFolderModal's save already does)
 *   duplicate-> `rpc_rollforward_project` via RollforwardSheet (plan §13.13:
 *               this product's "duplicate" is "next period's engagement",
 *               and it must compose the template RPCs, never insert rows)
 *   template -> SaveAsTemplateSheet, unchanged
 *   archive  -> `rpc_archive_project`, same RPC useProjectFolderForm calls
 *
 * Mount `overlay` once per screen; render `<ProjectActionsButton>` per row.
 * Rename is deliberately NOT a modal (§14.2 "rename in place") — the hook
 * only holds `renamingId`, and the list renders the inline field itself via
 * `<InlineRename>` so the name is edited where it is read.
 */

export type ActionableProject = { id: string; name: string; color?: string | null };

export function ProjectActionsButton({ onPress, label = 'Project actions' }: { onPress: () => void; label?: string }) {
  const c = useThemeColors();
  return (
    <Tooltip label={label}>
      <TouchableOpacity
        onPress={onPress}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={label}
        className="items-center justify-center rounded-lg border border-surface-border hover:bg-surface-overlay"
        style={{ width: 28, height: 28 }}
      >
        <FontAwesome name="ellipsis-h" size={12} color={c.textMuted} />
      </TouchableOpacity>
    </Tooltip>
  );
}

/** Inline rename field. Enter submits, Escape cancels, blur commits (§14.2 keyboard). */
export function InlineRename({
  initialValue,
  onCommit,
  onCancel,
  style,
}: {
  initialValue: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
  style?: any;
}) {
  const c = useThemeColors();
  const [value, setValue] = useState(initialValue);
  return (
    <TextInput
      value={value}
      onChangeText={setValue}
      autoFocus
      selectTextOnFocus
      returnKeyType="done"
      onSubmitEditing={() => onCommit(value)}
      onBlur={() => onCommit(value)}
      onKeyPress={(e: any) => { if (e.nativeEvent?.key === 'Escape') onCancel(); }}
      accessibilityLabel="Project name"
      className="rounded-lg px-2 text-sm font-bold"
      style={[{ height: 34, color: c.textMain, backgroundColor: c.background, borderWidth: 1, borderColor: c.primary }, style]}
    />
  );
}

function ActionRow({
  icon, label, hint, onPress, disabled, disabledReason, tone,
}: {
  icon: string;
  label: string;
  hint: string;
  onPress: () => void;
  disabled?: boolean;
  disabledReason?: string;
  tone?: 'danger';
}) {
  const c = useThemeColors();
  const tint = tone === 'danger' ? c.danger : c.textMain;
  const row = (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      className="flex-row items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-overlay"
      style={{ minHeight: 44, opacity: disabled ? 0.45 : 1 }}
    >
      <FontAwesome name={icon as any} size={13} color={tone === 'danger' ? c.danger : c.textMuted} style={{ marginTop: 3 }} />
      <View className="flex-1">
        <Text className="text-sm font-bold" style={{ color: tint }}>{label}</Text>
        <Text className="text-typography-muted text-[11px] mt-0.5 leading-4">{disabled ? (disabledReason ?? hint) : hint}</Text>
      </View>
    </TouchableOpacity>
  );
  // §14.2 — a disabled control must always be able to say why.
  return disabled && disabledReason ? <Tooltip label={disabledReason}>{row}</Tooltip> : row;
}

export function useProjectActions({
  onChanged,
  onOpenProject,
  onArchived,
}: {
  /** Fired after a rename / archive / rollforward so the list can refetch. */
  onChanged: () => void;
  /** Omit on the detail route — "Open" is pointless when you are already there. */
  onOpenProject?: (id: string) => void;
  /** Detail route passes navigation here: refetching a project you just archived lands on "not found". */
  onArchived?: () => void;
}) {
  const c = useThemeColors();
  const { hasPermission } = useAuth();
  const { showConfirm } = useAlert();
  const { successToast, errorToast } = useToast();

  const [menuRow, setMenuRow] = useState<ActionableProject | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [rollforwardRow, setRollforwardRow] = useState<ActionableProject | null>(null);
  const [templateRow, setTemplateRow] = useState<ActionableProject | null>(null);

  const canEdit = hasPermission('project.edit');
  const canCreate = hasPermission('project.create');
  const canDelete = hasPermission('project.delete');

  const openMenu = useCallback((row: ActionableProject) => setMenuRow(row), []);
  const closeMenu = useCallback(() => setMenuRow(null), []);
  const cancelRename = useCallback(() => setRenamingId(null), []);

  const commitRename = useCallback(async (row: ActionableProject, nextRaw: string) => {
    const next = nextRaw.trim();
    setRenamingId(null);
    if (!next || next === row.name) return;
    const { error } = await supabase
      .from('projects')
      .update({ name: next, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) {
      // Plan §13.10's rule: name the offender, never surface a constraint name.
      errorToast(
        error.code === '23505'
          ? `Another project is already called "${next}". Pick a different name.`
          : error.message || 'Could not rename this project.',
        'Rename failed',
      );
      return;
    }
    successToast(`Renamed to "${next}".`);
    onChanged();
  }, [errorToast, successToast, onChanged]);

  const archive = useCallback((row: ActionableProject) => {
    showConfirm(
      `Archive "${row.name}"?`,
      'The project and its tasks move to cold storage. They stop appearing in lists, boards and reports, and an owner can restore them later.',
      async () => {
        const { error } = await supabase.rpc('rpc_archive_project', { p_project_id: row.id });
        if (error) {
          errorToast(error.message || 'Could not archive this project.', 'Archive failed');
          return;
        }
        successToast(`"${row.name}" archived.`);
        if (onArchived) onArchived(); else onChanged();
      },
      undefined,
      'Archive',
      'Keep it',
      'destructive',
    );
  }, [showConfirm, errorToast, successToast, onChanged, onArchived]);

  const overlay = (
    <>
      <Popup
        visible={!!menuRow}
        onClose={closeMenu}
        presentation="auto"
        maxWidth={420}
        scrollable={false}
      >
        {!!menuRow && (
          <View className="px-5 pt-5 pb-4">
            <EntityHeading kind="project" title={menuRow.name} color={menuRow.color} size="sm" />
            <View className="h-px bg-surface-border my-4" />
            <View className="gap-0.5">
              {!!onOpenProject && (
                <ActionRow
                  icon="external-link"
                  label="Open project"
                  hint="Its overview, work and files."
                  onPress={() => { const id = menuRow.id; closeMenu(); onOpenProject(id); }}
                />
              )}
              <ActionRow
                icon="pencil"
                label="Rename"
                hint="Edit the name right here in the list."
                disabled={!canEdit}
                disabledReason="You need the “edit projects” permission to rename a project."
                onPress={() => { setRenamingId(menuRow.id); closeMenu(); }}
              />
              <ActionRow
                icon="repeat"
                label="Roll forward to next period"
                hint="Creates next year’s copy — same task structure, new dates. Nothing on this project changes."
                disabled={!canCreate}
                disabledReason="You need the “create projects” permission to roll a project forward."
                onPress={() => { setRollforwardRow(menuRow); closeMenu(); }}
              />
              <ActionRow
                icon="clone"
                label="Save as template"
                hint="Capture this task list so other projects can start from it."
                disabled={!canCreate}
                disabledReason="You need the “create projects” permission to save a template."
                onPress={() => { setTemplateRow(menuRow); closeMenu(); }}
              />
              <View className="h-px bg-surface-border my-2" />
              <ActionRow
                icon="archive"
                label="Archive"
                hint="Moves it and its tasks to cold storage. Reversible by an owner."
                tone="danger"
                disabled={!canDelete}
                disabledReason="You need the “delete projects” permission to archive a project."
                onPress={() => { const row = menuRow; closeMenu(); archive(row); }}
              />
            </View>
          </View>
        )}
      </Popup>

      {!!rollforwardRow && (
        <RollforwardSheet
          visible
          sourceProjectId={rollforwardRow.id}
          sourceProjectName={rollforwardRow.name}
          onClose={() => setRollforwardRow(null)}
          onRolledForward={(res) => {
            successToast(
              `${res.projects_created} project and ${res.tasks_created} tasks created for the next period.`,
              'Rolled forward',
            );
            setRollforwardRow(null);
            onChanged();
          }}
        />
      )}

      <SaveAsTemplateSheet
        visible={!!templateRow}
        projectId={templateRow?.id ?? null}
        projectName={templateRow?.name}
        onClose={() => setTemplateRow(null)}
        onSaved={(t) => successToast(`Template “${t.name}” is ready to use.`, 'Saved as template')}
      />
    </>
  );

  return { openMenu, closeMenu, renamingId, cancelRename, commitRename, overlay, colors: c };
}
