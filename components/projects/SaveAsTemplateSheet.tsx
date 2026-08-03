import Popup from '@/components/common/Popup';
import { EntityGlyph, EntityTag } from '@/components/entities/EntityUI';
import TemplateEditor from '@/components/templates/TemplateEditor';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import React, { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

export default function SaveAsTemplateSheet({
  visible, projectId, projectName, onClose, onSaved,
}: {
  visible: boolean;
  projectId: string | null;
  projectName?: string | null;
  onClose: () => void;
  onSaved?: (template: { id: string; name: string }) => void;
}) {
  const c = useThemeColors();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Issue #177 — after capture, hand straight into the editor so the author
  // can fix categories / offsets on the template that was JUST snapshotted,
  // instead of only discovering problems later at Bulk Create. The captured
  // row already exists either way (rpc_create_template_from_project already
  // committed it) — this only decides whether the sheet closes immediately
  // or pauses on a review step first.
  const [editingId, setEditingId] = useState<string | null>(null);
  // TemplateEditor always fires onClose LAST regardless of path (plain
  // cancel, after onSaved, or after onDeleted) — so onSaved/onDeleted here
  // only record what happened, and the one onClose handler below is what
  // actually reports to this sheet's own caller and closes it. Avoids the
  // double-report bug of also acting inside onSaved/onDeleted directly.
  const editorResultRef = React.useRef<{ id: string; name: string } | 'deleted' | null>(null);

  useEffect(() => {
    if (visible) {
      setName(projectName ? `${projectName} Template` : '');
      setError(null);
      setEditingId(null);
      editorResultRef.current = null;
    }
  }, [visible, projectName]);

  const handleSave = async () => {
    if (!projectId || !name.trim()) {
      setError('Template name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('rpc_create_template_from_project', {
      p_project_id: projectId,
      p_name: name.trim(),
    });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setEditingId(data.id);
  };

  if (editingId) {
    return (
      <TemplateEditor
        visible={visible}
        templateId={editingId}
        onSaved={(t) => { editorResultRef.current = { id: t.id, name: t.name }; }}
        onDeleted={() => { editorResultRef.current = 'deleted'; }}
        onClose={() => {
          const result = editorResultRef.current;
          // Cancel-without-saving still leaves the captured row in place
          // (rpc_create_template_from_project already committed it before
          // the editor ever opened) — report it as-captured. Deleted is the
          // one path that must not report a template back; it no longer exists.
          if (result !== 'deleted') onSaved?.(result ?? { id: editingId, name });
          onClose();
        }}
      />
    );
  }

  return (
    <Popup
      maxWidth={420}
      visible={visible}
      onClose={onClose}
      presentation="auto"
      title="Save as a template"
      footer="single-action"
      primaryAction={{ label: saving ? 'Saving…' : 'Save template', onPress: handleSave, variant: saving || !name.trim() ? 'disabled' : 'default' }}
      dismissible={!saving}
    >
      <View className="px-6 py-5">
        {/* §17: a template is one of the entities users mix up with a project.
            Show it, name it, and say what it is for. */}
        <View className="flex-row items-start gap-3 mb-4">
          <EntityGlyph kind="template" size={34} />
          <View className="flex-1">
            <EntityTag kind="template" />
            <Text className="text-typography-muted text-xs mt-1 leading-5">
              Takes a snapshot of this project’s tasks — title, category, priority, weight, estimated hours and how far
              each due date sits from the start — so future projects can begin from the same list. Subtasks aren’t captured,
              and nothing about this project changes.
            </Text>
          </View>
        </View>
        <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2">Template Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. 2026 Statutory Audit"
          placeholderTextColor={c.textDim}
          accessibilityLabel="Template name"
          className="bg-surface-background border border-surface-border rounded-lg px-4 py-3 text-typography-main"
          style={{ color: c.textMain }}
          autoFocus
        />
        {!name.trim() && !error && (
          <Text className="text-typography-dim text-[11px] mt-2">Give the template a name to save it.</Text>
        )}
        {error && <Text className="text-state-danger text-xs font-bold mt-3">{error}</Text>}
      </View>
    </Popup>
  );
}
