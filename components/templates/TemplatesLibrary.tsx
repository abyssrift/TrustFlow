import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';

import Tooltip from '@/components/common/Tooltip';
import {
  EntityEmptyState,
  EntityGlyph,
  EntityTag,
  SectionCard,
} from '@/components/entities/EntityUI';
import StarterTemplatePickerSheet from '@/components/projects/StarterTemplatePickerSheet';
import { SkeletonList } from '@/components/Skeleton';
import TemplateEditor from '@/components/templates/TemplateEditor';
import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';

/**
 * The templates library.
 *
 * TemplateEditor (#177) shipped complete — tasks, categories, priorities,
 * weights, estimated hours, due offsets, reordering — but was reachable from
 * exactly two places, both of them CREATION moments: "Save as template" on a
 * project, and "Customize first" on a built-in starter. Once you pressed Save
 * the template became a row nothing could open again. You could author a
 * process; you could not come back and change it.
 *
 * So this screen owns nothing new. It is the list that was missing, wired to
 * the editor that already existed. The only genuinely new behaviour is
 * duplicate, and even that is two existing RPCs in sequence.
 *
 * WHAT EDITING A TEMPLATE DOES NOT DO — the question anyone sensible asks
 * before touching a template a real portfolio came from:
 * rpc_instantiate_template writes `template_body_snapshot` onto the portfolio
 * at instantiation. Projects and tasks are COPIES. Editing a template changes
 * what the NEXT batch is cut from and never reaches back into work already
 * created. That is stated on the screen, not just here, because the fear of
 * breaking last year's engagement is exactly what stops people editing.
 */

type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  body: any[] | null;
  updated_at: string;
};

/** What a body says about the process it describes, without opening it. */
function summarize(body: any[] | null) {
  const items = Array.isArray(body) ? body : [];
  const categories = new Set<string>();
  let minOffset: number | null = null;
  let maxOffset: number | null = null;
  for (const it of items) {
    const cat = typeof it?.category === 'string' ? it.category.trim() : '';
    if (cat) categories.add(cat);
    const off = typeof it?.due_offset_days === 'number' ? it.due_offset_days : null;
    if (off !== null) {
      minOffset = minOffset === null ? off : Math.min(minOffset, off);
      maxOffset = maxOffset === null ? off : Math.max(maxOffset, off);
    }
  }
  return {
    taskCount: items.length,
    categories: [...categories].sort((a, b) => a.localeCompare(b)),
    // The same "implied span" the editor shows, computed the same way, so the
    // list and the editor cannot disagree about how long a process runs.
    spanDays: minOffset === null || maxOffset === null ? null : maxOffset - minOffset,
  };
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TemplatesLibrary() {
  const c = useThemeColors();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { hasPermission, profile } = useAuth();
  const { showConfirm } = useAlert();
  const { successToast, errorToast } = useToast();

  const isDesktop = width >= 768;

  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [starterOpen, setStarterOpen] = useState(false);

  const canCreate = hasPermission('project.create');
  // Mirrors rpc_delete_project_template's own check, so the button is absent
  // rather than present-and-refused.
  const canDelete = hasPermission('project.delete') || !!profile?.is_owner;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Both reads are plain selects: project_templates and portfolios are each
    // company-scoped by their own RLS, so there is nothing here for a
    // SECURITY DEFINER RPC to add (same reasoning as useProjectFields).
    const [tpl, pf] = await Promise.all([
      supabase
        .from('project_templates')
        .select('id, name, description, color, body, updated_at')
        .order('updated_at', { ascending: false }),
      supabase.from('portfolios').select('template_id').not('template_id', 'is', null),
    ]);

    if (tpl.error) {
      setError(tpl.error.message);
      setLoading(false);
      return;
    }
    setRows((tpl.data ?? []) as TemplateRow[]);

    // One grouped read rather than a count per card. A portfolio whose
    // template was deleted still counts here — it is history, and the delete
    // confirmation needs the true number.
    const counts: Record<string, number> = {};
    for (const r of (pf.data ?? []) as { template_id: string | null }[]) {
      if (r.template_id) counts[r.template_id] = (counts[r.template_id] ?? 0) + 1;
    }
    setUsage(counts);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => {
      if (r.name.toLowerCase().includes(q)) return true;
      if ((r.description ?? '').toLowerCase().includes(q)) return true;
      // Searching by the work itself, not only the label — "planning" should
      // find the template that contains planning tasks even if its name is a
      // client's.
      return summarize(r.body).categories.some(cat => cat.toLowerCase().includes(q));
    });
  }, [rows, query]);

  const openNew = () => { setEditingId(null); setEditorOpen(true); };
  const openExisting = (id: string) => { setEditingId(id); setEditorOpen(true); };

  const duplicate = async (row: TemplateRow) => {
    setBusyId(row.id);
    try {
      // No rpc_duplicate_project_template, and there should not be one: create
      // + update is exactly what it would do, and a third writer for templates
      // is a third place for the body's shape to drift.
      const { data: created, error: cErr } = await supabase.rpc('rpc_create_project_template', {
        p_name: `${row.name} (copy)`,
        p_description: row.description,
        p_color: row.color,
      });
      if (cErr) throw cErr;
      const newId = (created as any)?.id as string;
      const { error: uErr } = await supabase.rpc('rpc_update_project_template', {
        p_template_id: newId,
        p_name: `${row.name} (copy)`,
        p_description: row.description,
        p_color: row.color,
        p_body: row.body ?? [],
      });
      if (uErr) throw uErr;
      successToast(`“${row.name}” copied. The copy is yours to change.`, 'Duplicated');
      await load();
      openExisting(newId);
    } catch (e: any) {
      errorToast(e?.message || 'Could not duplicate this template.', 'Duplicate failed');
    } finally {
      setBusyId(null);
    }
  };

  const remove = (row: TemplateRow) => {
    const used = usage[row.id] ?? 0;
    // The reassurance belongs in the confirmation, where the hesitation is.
    const message =
      used > 0
        ? `${used} ${used === 1 ? 'portfolio was' : 'portfolios were'} created from this template. ` +
          'Those projects and tasks are copies and are not touched — each portfolio also kept its own snapshot of ' +
          'the template as it was on the day it ran. You just cannot start anything new from it.'
        : 'Nothing has been created from this template yet. Deleting it removes it from the list you pick from.';

    showConfirm(
      `Delete “${row.name}”?`,
      message,
      async () => {
        setBusyId(row.id);
        const { error: dErr } = await supabase.rpc('rpc_delete_project_template', { p_template_id: row.id });
        setBusyId(null);
        if (dErr) { errorToast(dErr.message, 'Could not delete'); return; }
        successToast(`“${row.name}” deleted.`, 'Deleted');
        load();
      },
      undefined,
      'Delete template',
      'Keep it',
      'destructive',
    );
  };

  const header = (
    <View className="gap-4">
      <View className="flex-row items-start justify-between gap-4 flex-wrap">
        <View className="flex-row items-center gap-3 flex-1 min-w-0">
          <Tooltip label="Back to Projects">
            <TouchableOpacity
              // navigate, not back(): this screen is deep-linkable and is
              // reached from the Projects header, a notification, or a pasted
              // URL. A control naming a destination goes to that destination.
              onPress={() => router.navigate('/projects')}
              accessibilityRole="button"
              accessibilityLabel="Back to projects"
              className="rounded-full items-center justify-center border border-surface-border bg-surface-card"
              style={{ width: 40, height: 40 }}
            >
              <FontAwesome name="chevron-left" size={15} color={c.textMuted} />
            </TouchableOpacity>
          </Tooltip>
          <EntityGlyph kind="template" size={44} />
          <View className="flex-1 min-w-0">
            <EntityTag kind="template" />
            <Text className="text-typography-main text-2xl md:text-3xl font-black tracking-tight">Templates</Text>
            <Text className="text-typography-muted text-sm mt-0.5">
              The task list a project starts from — captured once from real work, reused every year.
            </Text>
          </View>
        </View>

        {canCreate && (
          <View className="flex-row items-center gap-2 flex-shrink-0">
            <Tooltip label="Start from one of the built-in processes">
              <TouchableOpacity
                onPress={() => setStarterOpen(true)}
                accessibilityRole="button"
                className="bg-surface-card border border-surface-border px-4 rounded-xl hover:bg-surface-overlay flex-row items-center gap-2 justify-center"
                style={{ minHeight: 44 }}
              >
                <FontAwesome name="magic" size={13} color={c.textMuted} />
                <Text className="text-typography-main text-sm font-semibold">From a starter</Text>
              </TouchableOpacity>
            </Tooltip>
            <TouchableOpacity
              onPress={openNew}
              accessibilityRole="button"
              className="bg-brand-primary hover:bg-brand-primary-hover px-5 rounded-xl flex-row items-center gap-2 justify-center"
              style={{ minHeight: 44 }}
            >
              <FontAwesome name="plus" size={13} color="white" />
              <Text className="text-white text-sm font-bold">New template</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* The one thing that stops people editing templates is not knowing
          whether it rewrites work already done. Say it once, up front. */}
      {rows.length > 0 && (
        <View className="flex-row items-start gap-2.5 rounded-xl border border-surface-border bg-surface-card px-3 py-2.5">
          <FontAwesome name="info-circle" size={12} color={c.info} style={{ marginTop: 2 }} />
          <Text className="text-typography-muted text-[11px] leading-4 flex-1">
            Editing a template only changes what the <Text className="text-typography-main font-bold">next</Text> batch is
            built from. Projects and tasks already created are copies — they are never rewritten.
          </Text>
        </View>
      )}

      {rows.length > 3 && (
        <View className="flex-row items-center gap-2 rounded-xl border border-surface-border bg-surface-background px-3">
          <FontAwesome name="search" size={12} color={c.textDim} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search templates by name, description or the categories inside them"
            placeholderTextColor={c.textDim}
            accessibilityLabel="Search templates"
            className="flex-1 text-typography-main text-sm bg-transparent"
            style={{ height: 44 }}
          />
          {!!query && (
            <TouchableOpacity onPress={() => setQuery('')} accessibilityLabel="Clear search">
              <FontAwesome name="times-circle" size={13} color={c.textDim} />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );

  let content: React.ReactNode;
  if (loading) {
    content = <SkeletonList count={3} itemHeight={132} />;
  } else if (error) {
    content = (
      <SectionCard title="Could not load templates" icon="exclamation-triangle" accent={c.danger}>
        <Text className="text-typography-muted text-xs mb-3">{error}</Text>
        <TouchableOpacity
          onPress={load}
          className="self-start px-5 rounded-xl bg-brand-primary hover:bg-brand-primary-hover justify-center"
          style={{ minHeight: 44 }}
        >
          <Text className="text-white text-xs font-bold">Try again</Text>
        </TouchableOpacity>
      </SectionCard>
    );
  } else if (rows.length === 0) {
    content = (
      <EntityEmptyState
        kind="template"
        title="No templates yet"
        body="A template is a process you run more than once — an audit, an onboarding, a filing season. Build one here, or open a project you have already finished and save it as a template."
        actionLabel={canCreate ? 'New template' : undefined}
        onAction={canCreate ? openNew : undefined}
        secondaryLabel={canCreate ? 'Start from a built-in process' : undefined}
        onSecondary={canCreate ? () => setStarterOpen(true) : undefined}
      />
    );
  } else if (visible.length === 0) {
    content = (
      <EntityEmptyState
        kind="template"
        compact
        title="Nothing matches that"
        body={`No template's name, description or categories contain “${query.trim()}”.`}
        secondaryLabel="Clear the search"
        onSecondary={() => setQuery('')}
      />
    );
  } else {
    content = (
      <View className={isDesktop ? 'flex-row flex-wrap' : ''} style={{ gap: 16 }}>
        {visible.map(row => (
          <TemplateCard
            key={row.id}
            row={row}
            usedBy={usage[row.id] ?? 0}
            busy={busyId === row.id}
            canEdit={canCreate}
            canDelete={canDelete}
            wide={isDesktop}
            onOpen={() => openExisting(row.id)}
            onDuplicate={() => duplicate(row)}
            onDelete={() => remove(row)}
          />
        ))}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface-background">
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: isDesktop ? 32 : 16, paddingBottom: 64 }}
      >
        <View className="max-w-[1600px] mx-auto w-full gap-4">
          {header}
          {content}
        </View>
      </ScrollView>

      <TemplateEditor
        visible={editorOpen}
        templateId={editingId}
        onClose={() => setEditorOpen(false)}
        onSaved={() => load()}
        onDeleted={() => load()}
      />

      {/* Same picker the Bulk Create flow uses. It materializes the starter as
          a real row and routes into the editor itself, so from here we only
          have to refresh once it is done. */}
      <StarterTemplatePickerSheet
        visible={starterOpen}
        onClose={() => setStarterOpen(false)}
        onCreated={() => load()}
      />
    </View>
  );
}

// ── one template ───────────────────────────────────────────────────────────

function TemplateCard({
  row,
  usedBy,
  busy,
  canEdit,
  canDelete,
  wide,
  onOpen,
  onDuplicate,
  onDelete,
}: {
  row: TemplateRow;
  usedBy: number;
  busy: boolean;
  canEdit: boolean;
  canDelete: boolean;
  wide: boolean;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const c = useThemeColors();
  const { taskCount, categories, spanDays } = useMemo(() => summarize(row.body), [row.body]);
  const accent = row.color || c.accent;

  return (
    <View
      className="bg-surface-card border rounded-2xl p-4 md:p-5 gap-3"
      style={{
        borderColor: accent + '55',
        // Matches the entity vocabulary's "blueprint" shape: a template is a
        // pattern, not an instance, and the dashed edge is how every other
        // template glyph in the app says so.
        borderStyle: 'dashed',
        flexBasis: wide ? 380 : undefined,
        flexGrow: wide ? 1 : undefined,
        maxWidth: wide ? 560 : undefined,
      }}
    >
      <View className="flex-row items-start gap-3">
        <EntityGlyph kind="template" size={38} color={accent} />
        <View className="flex-1 min-w-0">
          <EntityTag kind="template" />
          <Text numberOfLines={1} className="text-typography-main text-base font-black tracking-tight">
            {row.name}
          </Text>
          {!!row.description && (
            <Text numberOfLines={2} className="text-typography-muted text-xs mt-0.5 leading-4">
              {row.description}
            </Text>
          )}
        </View>
      </View>

      <View className="flex-row items-center flex-wrap gap-x-4 gap-y-1">
        <Stat icon="check" label={`${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}`} c={c} />
        <Stat
          icon="tags"
          label={`${categories.length} ${categories.length === 1 ? 'category' : 'categories'}`}
          c={c}
        />
        {spanDays !== null && <Stat icon="calendar-o" label={`${spanDays} day span`} c={c} />}
      </View>

      {categories.length > 0 && (
        <View className="flex-row flex-wrap gap-1.5">
          {categories.slice(0, 4).map(cat => (
            <View key={cat} className="rounded-full border border-surface-border px-2 py-0.5">
              <Text className="text-typography-muted text-[10px] font-bold">{cat}</Text>
            </View>
          ))}
          {categories.length > 4 && (
            <Text className="text-typography-dim text-[10px] font-bold self-center">
              +{categories.length - 4} more
            </Text>
          )}
        </View>
      )}

      <View className="flex-row items-center justify-between gap-2 pt-1 border-t border-surface-border">
        <Text className="text-typography-dim text-[10px] flex-1 min-w-0" numberOfLines={1}>
          {usedBy > 0
            ? `Used by ${usedBy} ${usedBy === 1 ? 'portfolio' : 'portfolios'} · edited ${fmtWhen(row.updated_at)}`
            : `Never used yet · edited ${fmtWhen(row.updated_at)}`}
        </Text>

        <View className="flex-row items-center gap-1.5">
          {canEdit && (
            <Tooltip label="Make a copy to change without touching this one">
              <TouchableOpacity
                onPress={onDuplicate}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Duplicate ${row.name}`}
                className="items-center justify-center rounded-xl border border-surface-border hover:bg-surface-overlay"
                style={{ width: 40, height: 40, opacity: busy ? 0.5 : 1 }}
              >
                <FontAwesome name="copy" size={13} color={c.textMuted} />
              </TouchableOpacity>
            </Tooltip>
          )}
          {canDelete && (
            <Tooltip label="Delete this template">
              <TouchableOpacity
                onPress={onDelete}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${row.name}`}
                className="items-center justify-center rounded-xl border border-surface-border hover:bg-state-danger/10"
                style={{ width: 40, height: 40, opacity: busy ? 0.5 : 1 }}
              >
                <FontAwesome name="trash-o" size={14} color={c.textMuted} />
              </TouchableOpacity>
            </Tooltip>
          )}
          <TouchableOpacity
            onPress={onOpen}
            accessibilityRole="button"
            className="px-4 rounded-xl border border-surface-border hover:bg-surface-overlay flex-row items-center justify-center gap-2"
            style={{ minHeight: 40 }}
          >
            <FontAwesome name={canEdit ? 'pencil-square-o' : 'eye'} size={12} color={c.textMuted} />
            <Text className="text-typography-main text-xs font-bold">{canEdit ? 'Edit' : 'View'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function Stat({ icon, label, c }: { icon: string; label: string; c: ReturnType<typeof useThemeColors> }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <FontAwesome name={icon as any} size={10} color={c.textDim} />
      <Text className="text-typography-muted text-[11px] font-semibold">{label}</Text>
    </View>
  );
}
