import Popup from '@/components/common/Popup';
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

  const bySector = useMemo(() => starterTemplatesBySector(), []);

  const reset = () => { setSelected(null); setError(null); setSaving(false); };
  const handleClose = () => { reset(); onClose(); };

  const handleUse = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('rpc_create_starter_template', {
      p_name: selected.name,
      p_description: selected.description,
      p_color: selected.color,
      p_body: selected.tasks,
    });
    if (err) {
      setSaving(false);
      setError(err.message);
      return;
    }
    onCreated(data);
    reset();
    onClose();
  };

  return (
    <Popup
      visible={visible}
      onClose={handleClose}
      presentation="auto"
      title={selected ? selected.name : 'Starter Templates'}
      footer={selected ? 'single-action' : 'none'}
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
