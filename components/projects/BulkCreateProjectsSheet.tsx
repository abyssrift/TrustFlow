import Popup from '@/components/common/Popup';
import StarterTemplatePickerSheet from '@/components/projects/StarterTemplatePickerSheet';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';

// Popup's presentation="auto" resolves sheet-vs-centered itself, but the
// wider containerClassName below must only apply in the centered case (it
// would break the mobile bottom sheet's full-width layout). Mirror Popup's
// own default desktopBreakpoint of 768 so the two never disagree.
function useIsCentered(): boolean {
  const { width } = useWindowDimensions();
  return width >= 768;
}

function randomKey(): string {
  // ponytail: crypto.randomUUID() isn't guaranteed on every RN/web runtime this
  // app ships to — fall back to a timestamp+random string. Only needs to be
  // unique per bulk-create attempt, not cryptographically strong.
  // @ts-ignore
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type Template = { id: string; name: string; body: any[] };

type ParsedLine = { raw: string; name: string; start_date: string | null; external_ref: string | null };

// One line = one project. "Name" doubles as the client name to upsert — the
// issue frames this feature as "paste a list of client names", and the
// textarea format the issue specifies (`Name, 2026-08-01`) has no separate
// client column, so project name and client_ref are the same string here.
// Judgment call: split into a real "Name | Client" column later if a firm's
// project names and client names diverge often enough to need it.
//
// Third optional field: a stable client identifier (issue #171 gap 1 / plan
// §13.3) — e.g. a commercial-registration or file number. When present, the
// client is matched/created on that ref instead of on name, so "Abdallah
// Group" this year and "Abdallah Group LLC" next year resolve to the same
// client instead of silently forking into two. Leave a line's date field
// blank (two commas) to supply a ref with no date.
function parseLines(text: string): ParsedLine[] {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(raw => {
      const [namePart, datePart, refPart] = raw.split(',');
      const name = (namePart || '').trim();
      const dateStr = (datePart || '').trim();
      const external_ref = (refPart || '').trim() || null;
      let start_date: string | null = null;
      if (dateStr) {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) start_date = d.toISOString();
      }
      return { raw, name, start_date, external_ref };
    })
    .filter(p => p.name.length > 0);
}

export default function BulkCreateProjectsSheet({
  visible, onClose, onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated?: (result: { portfolio_id: string; projects_created: number; tasks_created: number }) => void;
}) {
  const c = useThemeColors();
  const isCentered = useIsCentered();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [portfolioName, setPortfolioName] = useState('');
  const [text, setText] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [starterPickerVisible, setStarterPickerVisible] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setIdempotencyKey(randomKey());
    setLoadingTemplates(true);
    supabase
      .from('project_templates')
      .select('id, name, body')
      .order('name', { ascending: true })
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else {
          setTemplates((data || []) as Template[]);
          setTemplateId(prev => prev ?? (data && data[0] ? data[0].id : null));
        }
        setLoadingTemplates(false);
      });
  }, [visible]);

  const selectedTemplate = useMemo(() => templates.find(t => t.id === templateId) || null, [templates, templateId]);
  const parsed = useMemo(() => parseLines(text), [text]);
  const taskCountPerProject = selectedTemplate?.body?.length || 0;

  const handleCreate = async () => {
    if (!templateId) { setError('Pick a template first.'); return; }
    if (parsed.length === 0) { setError('Paste at least one project name.'); return; }

    setCreating(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('rpc_instantiate_template', {
      p_template_id: templateId,
      p_portfolio: {
        name: portfolioName.trim() || null,
        manifest: parsed.map(p => ({ name: p.name, instantiated: true })),
      },
      p_projects: parsed.map(p => ({ name: p.name, client_ref: p.name, client_external_ref: p.external_ref, start_date: p.start_date })),
      p_idempotency_key: idempotencyKey,
    });
    setCreating(false);

    if (err) {
      setError(err.message);
      return;
    }
    onCreated?.(data);
    onClose();
  };

  return (
    <>
    <Popup
      visible={visible}
      onClose={onClose}
      presentation="auto"
      title="Bulk Create Projects"
      footer="single-action"
      primaryAction={{
        label: creating ? 'Creating…' : `Create ${parsed.length || ''} Project${parsed.length === 1 ? '' : 's'}`.trim(),
        onPress: handleCreate,
        variant: creating || parsed.length === 0 || !templateId ? 'disabled' : 'default',
      }}
      dismissible={!creating}
      // Only override width for the centered (desktop) variant — Popup
      // forwards the same containerClassName to DraggableSheet on the sheet
      // path too, so a fixed "centered" width class would wrongly clip the
      // mobile bottom sheet's edge-to-edge layout if applied unconditionally.
      containerClassName={isCentered ? 'w-[90%] max-w-[640px] rounded-3xl overflow-hidden premium-shadow' : undefined}
    >
      {/*
        StarterTemplatePickerSheet is rendered as a return-level sibling below
        (not nested here, not via Popup's `overlays` prop) because this Popup
        uses presentation="auto" — on mobile web it resolves to `sheet`, and
        `overlays` is documented as centered-only (ignored in sheet mode), so
        putting it there would silently vanish on mobile. A plain sibling
        Modal-returning component works identically in both presentations.
      */}
      <View className="px-6 py-5" style={{ gap: 16 }}>
        {/* Template picker */}
        <View>
          <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2">Template</Text>
          {loadingTemplates ? (
            <ActivityIndicator color={c.primary} />
          ) : templates.length === 0 ? (
            <View style={{ gap: 10 }}>
              <Text className="text-typography-muted text-sm">
                No templates yet. Start from a researched starter template below, or open a finished project and use "Save as Template".
              </Text>
              <TouchableOpacity
                onPress={() => setStarterPickerVisible(true)}
                className="self-start px-4 py-2.5 rounded-xl bg-brand-primary flex-row items-center gap-2"
                style={{ minHeight: 44 }}
              >
                <FontAwesome name="magic" size={12} color="white" />
                <Text className="text-white text-xs font-black uppercase tracking-wider">Browse Starter Templates</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {templates.map(t => (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => setTemplateId(t.id)}
                  className={`px-4 py-2 rounded-xl border ${templateId === t.id ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                  style={{ minHeight: 44, justifyContent: 'center' }}
                >
                  <Text className={`text-xs font-black uppercase tracking-wider ${templateId === t.id ? 'text-white' : 'text-typography-muted'}`}>
                    {t.name} · {t.body?.length || 0} tasks
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                onPress={() => setStarterPickerVisible(true)}
                className="px-4 py-2 rounded-xl border border-dashed border-surface-border flex-row items-center gap-1.5"
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <FontAwesome name="plus" size={10} color={c.textMuted} />
                <Text className="text-typography-muted text-xs font-black uppercase tracking-wider">Starter</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Portfolio name (optional) */}
        <View>
          <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2">Batch Name (optional)</Text>
          <TextInput
            value={portfolioName}
            onChangeText={setPortfolioName}
            placeholder="e.g. Office X — 2026 Intake"
            placeholderTextColor={c.textDim}
            className="bg-surface-background border border-surface-border rounded-lg px-4 py-3"
            style={{ color: c.textMain }}
          />
        </View>

        {/* Textarea — one project per line */}
        <View>
          <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2">
            Projects — one per line, optionally "Name, 2026-08-01, ref"
          </Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={'Abdallah Group\nCentro Trading, 2026-08-15, CR-4471\nNorthgate LLC, , NG-002'}
            placeholderTextColor={c.textDim}
            multiline
            numberOfLines={8}
            textAlignVertical="top"
            className="bg-surface-background border border-surface-border rounded-lg px-4 py-3"
            style={{ color: c.textMain, minHeight: 160 }}
          />
        </View>

        {/* Preview */}
        {selectedTemplate && (
          <View className="bg-surface-background border border-surface-border rounded-2xl p-4 flex-row items-center gap-3">
            <FontAwesome name="magic" size={14} color={c.primary} />
            <Text className="text-typography-main text-sm font-bold flex-1">
              {parsed.length === 0
                ? 'Paste project names above to preview what this will create.'
                : `This will create ${parsed.length} project${parsed.length === 1 ? '' : 's'} and ${parsed.length * taskCountPerProject} task${parsed.length * taskCountPerProject === 1 ? '' : 's'}.`}
            </Text>
          </View>
        )}

        {error && <Text className="text-state-danger text-xs font-bold">{error}</Text>}
      </View>
    </Popup>

    <StarterTemplatePickerSheet
      visible={starterPickerVisible}
      onClose={() => setStarterPickerVisible(false)}
      onCreated={(t) => {
        setTemplates(prev => [...prev, t]);
        setTemplateId(t.id);
      }}
    />
    </>
  );
}
