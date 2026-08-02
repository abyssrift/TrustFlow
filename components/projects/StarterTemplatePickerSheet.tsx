import Popup from '@/components/common/Popup';
import TemplateEditor from '@/components/templates/TemplateEditor';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import { starterTemplatesBySector, StarterTemplate } from '@/lib/starterTemplates';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

// Path A (unified responsive component, ui-style-guide.md §4.1): a two-step
// browse -> preview -> use drill-in reads the same way at any width — there
// is no desktop-only affordance (hover mega-menu, wide table) that a mobile
// paradigm would need to replace. One Popup + one `selected` state instead
// of separate desktop/mobile components (contrast BulkCreateProjectsSheet's
// own centered-vs-sheet width tweak, which stays cosmetic, not structural).

const PREVIEW_MAX_HEIGHT = 480;

function TemplateCard({ template, onPress }: { template: StarterTemplate; onPress: () => void }) {
  const c = useThemeColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      className="bg-surface-background border border-surface-border rounded-2xl px-4 py-3 flex-row items-center justify-between"
      style={{ minHeight: 44 }}
    >
      <View className="flex-1 pr-3">
        <Text className="text-typography-main font-black text-sm">{template.name}</Text>
        <Text className="text-typography-muted text-xs mt-0.5" numberOfLines={2}>{template.description}</Text>
        <Text className="text-typography-dim text-[10px] font-bold uppercase mt-1">{template.tasks.length} tasks</Text>
      </View>
      <FontAwesome name="chevron-right" size={12} color={c.textMuted} />
    </TouchableOpacity>
  );
}

export default function StarterTemplatePickerSheet({
  visible, onClose, onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (template: { id: string; name: string; body: any[] }) => void;
}) {
  const c = useThemeColors();
  const [selected, setSelected] = useState<StarterTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Issue #177 — "Customize First" materializes the same starter row as "Use
  // This Template" (same RPC), then routes into the editor before handing
  // back to the caller, instead of using the researched offsets/categories
  // sight-unseen.
  const [editingId, setEditingId] = useState<string | null>(null);
  // TemplateEditor always fires onClose LAST regardless of path (cancel,
  // after onSaved, or after onDeleted) — so onSaved/onDeleted below only
  // record the outcome, and the single onClose handler is what actually
  // reports to this sheet's own caller. See SaveAsTemplateSheet.tsx for the
  // identical pattern and why acting inside onSaved/onDeleted directly
  // double-fires onCreated.
  const editorResultRef = React.useRef<{ id: string; name: string; body: any[] } | 'deleted' | null>(null);

  const bySector = useMemo(() => starterTemplatesBySector(), []);

  const reset = () => { setSelected(null); setError(null); setSaving(false); setEditingId(null); editorResultRef.current = null; };
  const handleClose = () => { reset(); onClose(); };

  const materialize = async (): Promise<{ id: string; name: string; body: any[] } | null> => {
    if (!selected) return null;
    setSaving(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('rpc_create_starter_template', {
      p_name: selected.name,
      p_description: selected.description,
      p_color: selected.color,
      p_body: selected.tasks,
    });
    setSaving(false);
    if (err) {
      setError(err.message);
      return null;
    }
    return data;
  };

  const handleUse = async () => {
    const data = await materialize();
    if (!data) return;
    onCreated(data);
    reset();
    onClose();
  };

  const handleCustomize = async () => {
    const data = await materialize();
    if (!data) return;
    setEditingId(data.id);
  };

  if (editingId) {
    const capturedName = selected?.name ?? '';
    const capturedBody = selected?.tasks ?? [];
    return (
      <TemplateEditor
        visible={visible}
        templateId={editingId}
        onSaved={(t) => { editorResultRef.current = { id: t.id, name: t.name, body: t.body }; }}
        onDeleted={() => { editorResultRef.current = 'deleted'; }}
        onClose={() => {
          const result = editorResultRef.current;
          // Cancel-without-saving still leaves the materialized starter row
          // in place (rpc_create_starter_template already committed it
          // before the editor opened) — report it as-materialized. Deleted
          // is the one path that must not report a template back.
          if (result !== 'deleted') onCreated(result ?? { id: editingId, name: capturedName, body: capturedBody });
          reset();
          onClose();
        }}
      />
    );
  }

  return (
    <Popup
      maxWidth={420}
      visible={visible}
      onClose={handleClose}
      presentation="auto"
      title={selected ? selected.name : 'Starter Templates'}
      footer={selected ? 'dual-action' : 'none'}
      secondaryAction={selected ? { label: 'Customize First', onPress: handleCustomize } : undefined}
      primaryAction={selected ? {
        label: saving ? 'Adding…' : 'Use This Template',
        onPress: handleUse,
        variant: saving ? 'disabled' : 'default',
      } : undefined}
      dismissible={!saving}
      containerClassName="w-[92%] max-w-[560px] rounded-3xl overflow-hidden premium-shadow"
    >
      {!selected ? (
        <ScrollView className="px-6 py-5" style={{ maxHeight: PREVIEW_MAX_HEIGHT }}>
          <Text className="text-typography-muted text-sm mb-4">
            Researched starting points across common project types. Pick one to add it as an editable template for your company — nothing is created until you confirm.
          </Text>
          {bySector.map(([sector, templates]) => (
            <View key={sector} className="mb-5">
              <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2">{sector}</Text>
              <View style={{ gap: 8 }}>
                {templates.map(t => (
                  <TemplateCard key={t.id} template={t} onPress={() => setSelected(t)} />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      ) : (
        <ScrollView className="px-6 py-5" style={{ maxHeight: PREVIEW_MAX_HEIGHT }}>
          <TouchableOpacity
            onPress={() => setSelected(null)}
            className="flex-row items-center mb-4"
            style={{ minHeight: 44 }}
          >
            <FontAwesome name="chevron-left" size={12} color={c.primary} />
            <Text className="text-brand-primary text-xs font-black uppercase tracking-widest ml-2">All Templates</Text>
          </TouchableOpacity>

          <Text className="text-typography-muted text-sm mb-4">{selected.description}</Text>

          <View style={{ gap: 8 }}>
            {selected.tasks.map((task, i) => (
              <View key={i} className="bg-surface-background border border-surface-border rounded-xl px-4 py-3">
                <View className="flex-row items-start justify-between mb-1">
                  <Text className="text-typography-main font-bold text-sm flex-1 pr-2">{task.title}</Text>
                  <Text className="text-typography-dim text-[10px] font-black uppercase">{task.category}</Text>
                </View>
                <Text className="text-typography-muted text-xs">{task.description}</Text>
                <Text className="text-typography-dim text-[10px] mt-1 font-bold uppercase">
                  {task.estimated_hours}h · {task.priority}{task.due_offset_days != null ? ` · day ${task.due_offset_days}` : ''}
                </Text>
              </View>
            ))}
          </View>

          {error && <Text className="text-state-danger text-xs font-bold mt-3">{error}</Text>}
        </ScrollView>
      )}
    </Popup>
  );
}
