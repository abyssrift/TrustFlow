import DraggableSheet from '@/components/common/DraggableSheet';
import Popup from '@/components/common/Popup';
import SidebarLayout from '@/components/common/SidebarLayout';
import { useAlert } from '@/contexts/AlertContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { randomId } from '@/lib/randomId';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';

// Issue #177 (Projects Phase 7, plan §4/§8/§10/§13.10) — the template editor.
// Single file, desktop/mobile branched by useWindowDimensions (same shape as
// BulkCreateProjectsSheet.tsx / RoleEditorSheet.web.tsx) rather than a
// separate .web.tsx — there's no desktop-only affordance here that a mobile
// paradigm needs to replace, just a column layout that collapses.
//
// Deliberately NOT built inline here: a live category->board/team mapping +
// rpc_preview_instantiate_template preview. That machinery already exists in
// BulkCreateProjectsSheet.tsx (not mine to touch) and duplicating it would
// immediately drift (two places deciding "what counts as a valid mapping").
// This editor proves schedule legibility a cheaper way instead — the implied
// span from due_offset_days, computed client-side, no RPC needed — and the
// real instantiate-round-trip proof lives in
// supabase/checks/check_rpc_template_editor.sql plus a manual Bulk Create
// pass (see the issue comment / PR notes).
//
// ponytail: reordering task items uses plain up/down buttons, not
// hooks/useWebDnd.ts drag-and-drop. Array order only has to roughly track
// due_offset_days (starterTemplates.check.ts's own invariant) — two buttons
// per row do that with none of cross-browser DnD's surface area. Upgrade to
// real drag if a firm's templates get long enough that this feels slow.

const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'] as const;
type Priority = typeof PRIORITY_OPTIONS[number];
const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', medium: 'Normal', high: 'High', urgent: 'Urgent' };

// Same palette as components/pipeline-editor/StageBuilder.web.tsx — no shared
// color-swatch component exists yet to extend (global-utilities-index.md's
// first rule: reuse before inventing), so this mirrors that file's values
// rather than inventing a second palette.
const COLOR_PALETTE = [
  '#64748b', '#3b82f6', '#6366f1', '#8b5cf6',
  '#ec4899', '#ef4444', '#f59e0b', '#fbbf24',
  '#22c55e', '#14b8a6', '#06b6d4', '#f97316',
];

type TemplateItem = {
  key: string; // client-only React key, stripped before save
  title: string;
  description: string;
  category: string;
  priority: Priority;
  weight: number;
  estimated_hours: number | null;
  due_offset_days: number | null;
};

type SavedTemplate = { id: string; name: string; description: string | null; color: string | null; body: any[] };

function toItem(raw: any): TemplateItem {
  const priority: Priority = PRIORITY_OPTIONS.includes(raw?.priority) ? raw.priority : 'medium';
  const weight = Number.isFinite(raw?.weight) ? Math.min(10, Math.max(1, Math.round(raw.weight))) : 3;
  return {
    key: randomId(),
    title: typeof raw?.title === 'string' ? raw.title : '',
    description: typeof raw?.description === 'string' ? raw.description : '',
    category: typeof raw?.category === 'string' ? raw.category : '',
    priority,
    weight,
    estimated_hours: typeof raw?.estimated_hours === 'number' ? raw.estimated_hours : null,
    due_offset_days: typeof raw?.due_offset_days === 'number' ? raw.due_offset_days : null,
  };
}

function fromItem(it: TemplateItem) {
  return {
    title: it.title.trim(),
    description: it.description.trim() || null,
    category: it.category.trim(),
    priority: it.priority,
    weight: it.weight,
    estimated_hours: it.estimated_hours,
    due_offset_days: it.due_offset_days,
  };
}

function parseNum(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ── Category picker: choose from categories already used in THIS template,
// or add a genuinely new one. The typo-guard §13.10 needs (a category the
// batch-config step can't map is how tasks go missing) starts here — picking
// from a shared list instead of free-typing every row removes the failure
// mode ("Planning" on one row, "Planing" on the next) instead of catching it
// after the fact. ─────────────────────────────────────────────────────────
function CategoryPicker({
  value, categories, onChange, c,
}: {
  value: string;
  categories: string[];
  onChange: (next: string) => void;
  c: ReturnType<typeof useThemeColors>;
}) {
  const [open, setOpen] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  const [draft, setDraft] = useState('');

  const commitNew = () => {
    const trimmed = draft.trim();
    if (trimmed) onChange(trimmed);
    setDraft('');
    setAddingNew(false);
    setOpen(false);
  };

  return (
    <View>
      <TouchableOpacity
        onPress={() => setOpen(v => !v)}
        className="flex-row items-center justify-between px-4 rounded-2xl"
        style={{ minHeight: 44, backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
      >
        <Text className="font-medium text-sm" style={{ color: value ? c.textMain : c.textMuted }} numberOfLines={1}>
          {value || 'Uncategorized'}
        </Text>
        <FontAwesome name={open ? 'chevron-up' : 'chevron-down'} size={11} color={c.textMuted} />
      </TouchableOpacity>

      {open && (
        <View className="mt-2 rounded-2xl overflow-hidden" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
          <TouchableOpacity
            onPress={() => { onChange(''); setOpen(false); }}
            className="px-4 py-2.5"
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text className="text-sm font-medium" style={{ color: value === '' ? c.primary : c.textMuted }}>Uncategorized</Text>
          </TouchableOpacity>
          {categories.map(cat => (
            <TouchableOpacity
              key={cat}
              onPress={() => { onChange(cat); setOpen(false); }}
              className="px-4 py-2.5"
              style={{ minHeight: 44, justifyContent: 'center', borderTopWidth: 1, borderTopColor: c.border + '4D' }}
            >
              <Text className="text-sm font-medium" style={{ color: cat === value ? c.primary : c.textMain }}>{cat}</Text>
            </TouchableOpacity>
          ))}
          <View style={{ borderTopWidth: 1, borderTopColor: c.border + '4D' }}>
            {addingNew ? (
              <View className="flex-row items-center px-3 py-2" style={{ gap: 8 }}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  onSubmitEditing={commitNew}
                  autoFocus
                  placeholder="New category name"
                  placeholderTextColor={c.textDim}
                  className="flex-1 px-3 rounded-xl text-sm"
                  style={{ minHeight: 40, backgroundColor: c.card, color: c.textMain, borderWidth: 1, borderColor: c.primary }}
                />
                <TouchableOpacity onPress={commitNew} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                  <FontAwesome name="check" size={14} color={c.primary} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => setAddingNew(true)}
                className="flex-row items-center px-4 py-2.5"
                style={{ minHeight: 44, gap: 8 }}
              >
                <FontAwesome name="plus" size={11} color={c.primary} />
                <Text className="text-sm font-bold" style={{ color: c.primary }}>New category</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

// ── Schedule legibility (plan §13.9/§13.10): a bare "day offset" number is
// dead on arrival — the same defect that left 194 researched offsets inert
// until #182 gave them an anchor. Shows the implied span (Day 0 -> Day N)
// and a horizontal position marker rather than just the raw integer. ───────
function ScheduleBar({ offset, maxOffset, c }: { offset: number; maxOffset: number; c: ReturnType<typeof useThemeColors> }) {
  const pct = maxOffset > 0 ? Math.min(100, Math.max(0, (offset / maxOffset) * 100)) : 0;
  return (
    <View style={{ paddingVertical: 6 }}>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: c.border, position: 'relative' }}>
        <View style={{ position: 'absolute', left: `${pct}%`, top: -5, width: 16, height: 16, marginLeft: -8, borderRadius: 8, backgroundColor: c.primary, borderWidth: 2, borderColor: c.card }} />
      </View>
      <View className="flex-row justify-between mt-1.5">
        <Text className="text-[10px] font-bold" style={{ color: c.textDim }}>Day 0</Text>
        <Text className="text-[10px] font-bold" style={{ color: c.textDim }}>Day {maxOffset}</Text>
      </View>
    </View>
  );
}

export default function TemplateEditor({
  visible, templateId, onClose, onSaved, onDeleted,
}: {
  visible: boolean;
  /** Existing template to edit, or null to author a brand-new blank one. */
  templateId: string | null;
  onClose: () => void;
  onSaved?: (template: SavedTemplate) => void;
  onDeleted?: (templateId: string) => void;
}) {
  const c = useThemeColors();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;
  const { showConfirm } = useAlert();

  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(COLOR_PALETTE[2]);
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mobilePage, setMobilePage] = useState<'list' | 'item'>('list');

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setError(null);
    setLoading(true);
    setMobilePage('list');

    (async () => {
      const result = templateId
        ? await supabase.from('project_templates').select('id, name, description, color, body').eq('id', templateId).single()
        : await supabase.rpc('rpc_create_project_template', { p_name: 'Untitled Template' }).then(r => ({ data: r.data, error: r.error }));

      if (cancelled) return;
      if (result.error || !result.data) {
        setError(result.error?.message || 'Template not found.');
        setLoading(false);
        return;
      }
      const t = result.data as SavedTemplate;
      setResolvedId(t.id);
      setName(t.name);
      setDescription(t.description || '');
      setColor(t.color || COLOR_PALETTE[2]);
      const mapped = (t.body || []).map(toItem);
      setItems(mapped);
      setSelectedKey(mapped[0]?.key ?? null);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [visible, templateId]);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const it of items) { const v = it.category.trim(); if (v) seen.add(v); }
    return Array.from(seen).sort();
  }, [items]);

  const maxOffset = useMemo(() => items.reduce((m, it) => Math.max(m, it.due_offset_days ?? 0), 0), [items]);

  const selected = items.find(it => it.key === selectedKey) || null;

  function updateSelected(patch: Partial<TemplateItem>) {
    if (!selectedKey) return;
    setItems(prev => prev.map(it => (it.key === selectedKey ? { ...it, ...patch } : it)));
  }

  function addItem() {
    const last = items[items.length - 1];
    const fresh: TemplateItem = {
      key: randomId(),
      title: '',
      description: '',
      category: last?.category ?? '',
      priority: 'medium',
      weight: 3,
      estimated_hours: null,
      due_offset_days: last?.due_offset_days ?? 0,
    };
    setItems(prev => [...prev, fresh]);
    setSelectedKey(fresh.key);
    setMobilePage('item');
  }

  function removeItem(key: string) {
    setItems(prev => {
      const idx = prev.findIndex(it => it.key === key);
      const next = prev.filter(it => it.key !== key);
      if (selectedKey === key) {
        const fallback = next[Math.min(idx, next.length - 1)];
        setSelectedKey(fallback?.key ?? null);
        if (!fallback) setMobilePage('list');
      }
      return next;
    });
  }

  function moveItem(key: string, dir: -1 | 1) {
    setItems(prev => {
      const idx = prev.findIndex(it => it.key === key);
      const swapWith = idx + dir;
      if (idx < 0 || swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return next;
    });
  }

  // Client-side mirror of fn_validate_template_body — surfaces errors while
  // editing, not only after a round trip to the server. The RPC re-validates
  // regardless (it is the trust boundary, this is just faster feedback).
  const validationErrors = useMemo(() => {
    const errs: string[] = [];
    if (!name.trim()) errs.push('Template name is required.');
    items.forEach((it, i) => {
      const label = it.title.trim() || `Task ${i + 1}`;
      if (!it.title.trim()) errs.push(`Task ${i + 1} is missing a title.`);
      if (it.estimated_hours != null && it.estimated_hours < 0) errs.push(`"${label}": estimated hours can't be negative.`);
      if (it.due_offset_days != null && it.due_offset_days < 0) errs.push(`"${label}": due offset can't be negative.`);
    });
    return errs;
  }, [name, items]);

  const canSave = !saving && !loading && validationErrors.length === 0;

  async function handleSave() {
    if (!resolvedId || !canSave) return;
    setSaving(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('rpc_update_project_template', {
      p_template_id: resolvedId,
      p_name: name.trim(),
      p_description: description.trim() || null,
      p_color: color,
      p_body: items.map(fromItem),
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved?.(data as SavedTemplate);
    onClose();
  }

  function handleDelete() {
    if (!resolvedId) return;
    showConfirm(
      'Delete Template',
      `Delete "${name || 'this template'}"? This can't be undone from here.`,
      async () => {
        setDeleting(true);
        const { error: err } = await supabase.rpc('rpc_delete_project_template', { p_template_id: resolvedId });
        setDeleting(false);
        if (err) { setError(err.message); return; }
        onDeleted?.(resolvedId);
        onClose();
      },
      undefined,
      'Delete',
      'Cancel',
      'destructive',
    );
  }

  // ── Shared pieces ──────────────────────────────────────────────────────
  const templateFields = (
    <View style={{ gap: 12 }}>
      <View>
        <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: c.textMuted }}>Template Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. 2026 Statutory Audit"
          placeholderTextColor={c.textDim}
          className="rounded-2xl px-4 font-bold text-sm"
          style={{ minHeight: 44, backgroundColor: c.background, color: c.textMain, borderWidth: 1, borderColor: !name.trim() ? c.danger + '99' : c.border }}
        />
      </View>
      <View>
        <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: c.textMuted }}>Description</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="What this engagement covers"
          placeholderTextColor={c.textDim}
          multiline
          numberOfLines={2}
          textAlignVertical="top"
          className="rounded-2xl px-4 py-3 text-sm"
          style={{ minHeight: 64, backgroundColor: c.background, color: c.textMain, borderWidth: 1, borderColor: c.border }}
        />
      </View>
      <View>
        <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: c.textMuted }}>Color</Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {COLOR_PALETTE.map(sw => (
            <TouchableOpacity
              key={sw}
              onPress={() => setColor(sw)}
              style={{
                width: 30, height: 30, borderRadius: 15, backgroundColor: sw,
                borderWidth: sw === color ? 3 : 0, borderColor: c.card,
                shadowColor: sw === color ? sw : undefined, shadowOpacity: sw === color ? 0.6 : 0, shadowRadius: 4,
              }}
            />
          ))}
        </View>
      </View>
      {items.length > 0 && (
        <View>
          <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-1" style={{ color: c.textMuted }}>Schedule</Text>
          <Text className="text-xs font-bold" style={{ color: c.textMain }}>
            {items.length} task{items.length === 1 ? '' : 's'} · {categories.length} categor{categories.length === 1 ? 'y' : 'ies'} · Day 0 → Day {maxOffset}
          </Text>
        </View>
      )}
      <TouchableOpacity onPress={handleDelete} disabled={deleting} className="flex-row items-center" style={{ gap: 6, minHeight: 32 }}>
        <FontAwesome name="trash-o" size={12} color={c.danger} />
        <Text className="text-xs font-bold" style={{ color: c.danger }}>{deleting ? 'Deleting…' : 'Delete Template'}</Text>
      </TouchableOpacity>
    </View>
  );

  const itemRow = (it: TemplateItem, i: number) => (
    <TouchableOpacity
      key={it.key}
      onPress={() => { setSelectedKey(it.key); setMobilePage('item'); }}
      className="flex-row items-center px-3 rounded-2xl"
      style={{
        minHeight: 44, gap: 6,
        backgroundColor: it.key === selectedKey && isDesktop ? c.primary + '1A' : c.background,
        borderWidth: 1, borderColor: it.key === selectedKey && isDesktop ? c.primary : c.border,
      }}
    >
      <View style={{ flex: 1, paddingVertical: 8 }}>
        <Text className="font-bold text-sm" style={{ color: it.title.trim() ? c.textMain : c.danger }} numberOfLines={1}>
          {it.title.trim() || 'Untitled task'}
        </Text>
        <Text className="text-[10px] mt-0.5" style={{ color: c.textDim }} numberOfLines={1}>
          {it.category || 'Uncategorized'} · Day {it.due_offset_days ?? 0} · {PRIORITY_LABEL[it.priority]}
        </Text>
      </View>
      <TouchableOpacity onPress={() => moveItem(it.key, -1)} disabled={i === 0} style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', opacity: i === 0 ? 0.3 : 1 }}>
        <FontAwesome name="chevron-up" size={11} color={c.textMuted} />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => moveItem(it.key, 1)} disabled={i === items.length - 1} style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', opacity: i === items.length - 1 ? 0.3 : 1 }}>
        <FontAwesome name="chevron-down" size={11} color={c.textMuted} />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => removeItem(it.key)} style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
        <FontAwesome name="trash-o" size={12} color={c.danger} />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const itemList = (
    <View style={{ gap: 8 }}>
      {items.map((it, i) => itemRow(it, i))}
      <TouchableOpacity
        onPress={addItem}
        className="flex-row items-center justify-center rounded-2xl border border-dashed"
        style={{ minHeight: 44, gap: 8, borderColor: c.primary }}
      >
        <FontAwesome name="plus" size={11} color={c.primary} />
        <Text className="text-xs font-black uppercase tracking-wider" style={{ color: c.primary }}>Add Task</Text>
      </TouchableOpacity>
    </View>
  );

  const itemForm = selected ? (
    <View style={{ gap: 20 }}>
      <View>
        <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: c.textMuted }}>Title</Text>
        <TextInput
          value={selected.title}
          onChangeText={t => updateSelected({ title: t })}
          placeholder="Task title"
          placeholderTextColor={c.textDim}
          className="rounded-2xl px-4 font-bold text-base"
          style={{ minHeight: 48, backgroundColor: c.background, color: c.textMain, borderWidth: 1, borderColor: !selected.title.trim() ? c.danger + '99' : c.border }}
        />
      </View>

      <View>
        <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: c.textMuted }}>Description</Text>
        <TextInput
          value={selected.description}
          onChangeText={t => updateSelected({ description: t })}
          placeholder='Done when...'
          placeholderTextColor={c.textDim}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          className="rounded-2xl px-4 py-3 font-medium"
          style={{ minHeight: 88, backgroundColor: c.background, color: c.textMain, borderWidth: 1, borderColor: c.border }}
        />
      </View>

      <View className="flex-row gap-4">
        <View style={{ flex: 1 }}>
          <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: c.textMuted }}>Category</Text>
          <CategoryPicker value={selected.category} categories={categories} onChange={cat => updateSelected({ category: cat })} c={c} />
        </View>
        <View style={{ flex: 1 }}>
          <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: c.textMuted }}>Priority</Text>
          <View className="flex-row flex-wrap gap-2">
            {PRIORITY_OPTIONS.map(p => (
              <TouchableOpacity
                key={p}
                onPress={() => updateSelected({ priority: p })}
                className="px-4 py-2.5 rounded-full"
                style={{ backgroundColor: selected.priority === p ? c.primary : c.background, borderWidth: 1, borderColor: selected.priority === p ? c.primary : c.border }}
              >
                <Text className="font-black text-[10px] uppercase tracking-widest" style={{ color: selected.priority === p ? '#fff' : c.textMuted }}>{PRIORITY_LABEL[p]}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <View className="flex-row gap-4">
        <View style={{ flex: 1 }}>
          <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: c.textMuted }}>Weight ({selected.weight})</Text>
          <View className="flex-row items-center rounded-2xl" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border, minHeight: 44 }}>
            <TouchableOpacity onPress={() => updateSelected({ weight: Math.max(1, selected.weight - 1) })} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <FontAwesome name="minus" size={12} color={c.textMuted} />
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text className="font-black text-sm" style={{ color: c.textMain }}>{selected.weight} / 10</Text>
            </View>
            <TouchableOpacity onPress={() => updateSelected({ weight: Math.min(10, selected.weight + 1) })} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <FontAwesome name="plus" size={12} color={c.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: c.textMuted }}>Est. Hours</Text>
          <TextInput
            value={selected.estimated_hours == null ? '' : String(selected.estimated_hours)}
            onChangeText={t => updateSelected({ estimated_hours: parseNum(t) })}
            keyboardType="decimal-pad"
            placeholder="e.g. 4.5"
            placeholderTextColor={c.textDim}
            className="rounded-2xl px-4 font-medium"
            style={{ minHeight: 44, backgroundColor: c.background, color: c.textMain, borderWidth: 1, borderColor: c.border }}
          />
        </View>
      </View>

      {/* Schedule legibility (plan §13.9/§13.10): a bare offset number is
          exactly what left 194 researched offsets inert until an anchor
          existed to interpret them — show the implied position, not just
          the integer. */}
      <View>
        <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: c.textMuted }}>Due — days from project start</Text>
        <TextInput
          value={selected.due_offset_days == null ? '' : String(selected.due_offset_days)}
          onChangeText={t => updateSelected({ due_offset_days: parseNum(t) })}
          keyboardType="number-pad"
          placeholder="e.g. 12 (leave blank = due day the project starts)"
          placeholderTextColor={c.textDim}
          className="rounded-2xl px-4 font-medium"
          style={{ minHeight: 44, backgroundColor: c.background, color: c.textMain, borderWidth: 1, borderColor: c.border }}
        />
        <ScheduleBar offset={selected.due_offset_days ?? 0} maxOffset={maxOffset} c={c} />
      </View>
    </View>
  ) : (
    <View className="items-center justify-center" style={{ flex: 1, gap: 12, paddingVertical: 40 }}>
      <FontAwesome name="list-alt" size={28} color={c.textDim} />
      <Text className="text-sm font-bold" style={{ color: c.textMuted }}>No tasks yet</Text>
      <TouchableOpacity
        onPress={addItem}
        className="flex-row items-center rounded-2xl px-5"
        style={{ minHeight: 44, gap: 8, backgroundColor: c.primary }}
      >
        <FontAwesome name="plus" size={11} color="#fff" />
        <Text className="text-xs font-black uppercase tracking-wider text-white">Add Task</Text>
      </TouchableOpacity>
    </View>
  );

  const errorBanner = (error || validationErrors.length > 0) && (
    <View className="mx-6 mb-3 p-3 rounded-2xl" style={{ backgroundColor: c.danger + '1A', borderWidth: 1, borderColor: c.danger + '4D' }}>
      {error && <Text className="text-sm font-bold" style={{ color: c.danger }}>{error}</Text>}
      {validationErrors.slice(0, 4).map((e, i) => (
        <Text key={i} className="text-xs font-bold" style={{ color: c.danger }}>{e}</Text>
      ))}
      {validationErrors.length > 4 && <Text className="text-xs font-bold" style={{ color: c.danger }}>…and {validationErrors.length - 4} more.</Text>}
    </View>
  );

  if (loading) {
    return (
      <Popup visible={visible} onClose={onClose} presentation="auto" maxWidth={420} title="Loading Template" footer="none">
        <View className="items-center justify-center py-16"><ActivityIndicator color={c.primary} /></View>
      </Popup>
    );
  }

  // ── Mobile (<768): drill-in — list page (template fields + task rows) and
  // a full-height item page, mirroring RoleEditorSheet.web.tsx / ux-consistency.md §2. ──
  if (!isDesktop) {
    return (
      <DraggableSheet visible={visible} onClose={onClose} dimBackdrop maxHeight="95%" dismissible={!saving} scrollable={false} containerClassName="rounded-t-[2rem] overflow-hidden">
        <View style={{ flex: 1, minHeight: 0 }}>
          {mobilePage === 'list' ? (
            <>
              <View className="flex-row items-center justify-between px-5 pt-3 pb-4">
                <Text className="text-typography-main text-xl font-black tracking-tight">Edit Template</Text>
                <TouchableOpacity onPress={onClose} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
                  <FontAwesome name="times" size={16} color={c.textMain} />
                </TouchableOpacity>
              </View>
              <ScrollView className="px-5" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 20 }}>
                {templateFields}
                <View>
                  <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: c.textMuted }}>Tasks</Text>
                  {itemList}
                </View>
              </ScrollView>
              {errorBanner}
              <View className="flex-row gap-3 px-5 py-4" style={{ borderTopWidth: 1, borderTopColor: c.border }}>
                <TouchableOpacity onPress={onClose} disabled={saving} className="flex-1 py-3.5 rounded-2xl items-center" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
                  <Text className="font-black uppercase tracking-widest text-xs" style={{ color: c.textMuted }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleSave} disabled={!canSave} className="flex-[2] py-3.5 rounded-2xl items-center" style={{ backgroundColor: canSave ? c.primary : c.border }}>
                  <Text className="font-black uppercase tracking-widest text-xs" style={{ color: canSave ? 'white' : c.textMuted }}>{saving ? 'Saving…' : 'Save Template'}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <View className="flex-row items-center px-3 pt-3 pb-3" style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
                <TouchableOpacity onPress={() => setMobilePage('list')} className="w-10 h-10 items-center justify-center rounded-full mr-2" style={{ backgroundColor: c.background }}>
                  <FontAwesome name="chevron-left" size={14} color={c.textMain} />
                </TouchableOpacity>
                <Text className="text-typography-main font-black text-base tracking-tight flex-1" numberOfLines={1}>{selected?.title.trim() || 'Task'}</Text>
              </View>
              <ScrollView className="px-5 pt-4" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
                {itemForm}
              </ScrollView>
            </>
          )}
        </View>
      </DraggableSheet>
    );
  }

  // ── Desktop (>=768): sideMenu (template fields + task list) + main pane
  // (selected task's paired-column form) — same shape as EditTaskModal.web.tsx
  // (sideMenu 288 + paired flex-row gap-6 columns), widened slightly for the
  // reorder/delete row controls. maxWidth 1100 matches that file's own
  // ceiling for the closest existing layout (ux-consistency.md's table). ──
  return (
    <Popup
      visible={visible}
      onClose={onClose}
      presentation="centered"
      title="Edit Template"
      footer="dual-action"
      secondaryAction={{ label: 'Cancel', onPress: onClose }}
      primaryAction={{ label: saving ? 'Saving…' : 'Save Template', onPress: handleSave, variant: canSave ? 'default' : 'disabled' }}
      dismissible={!saving}
      maxWidth={1100}
      containerStyle={{ height: '86%' }}
      sideMenu={
        <SidebarLayout
          width={320}
          header={<View className="px-6 pt-5 pb-4"><Text className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: c.textMuted }}>Template</Text></View>}
        >
          <View style={{ gap: 20 }}>
            {templateFields}
            <View>
              <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: c.textMuted }}>Tasks ({items.length})</Text>
              {itemList}
            </View>
          </View>
        </SidebarLayout>
      }
    >
      <View style={{ flex: 1, minHeight: 0 }}>
        <ScrollView className="px-6 pt-5" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}>
          {itemForm}
        </ScrollView>
        {errorBanner}
      </View>
    </Popup>
  );
}
