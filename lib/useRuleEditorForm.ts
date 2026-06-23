import { useEffect, useState } from 'react';

import { useAlert } from '@/contexts/AlertContext';
import { supabase } from '@/lib/supabase';
import { NotificationRule } from '@/lib/notificationRuleConstants';

export function useRuleEditorForm({
  visible,
  existing,
  onClose,
  onSaved,
}: {
  visible: boolean;
  existing: NotificationRule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showAlert } = useAlert();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [eventType, setEventType] = useState('task.assigned');
  const [strategies, setStrategies] = useState<string[]>(['assignee']);
  const [conditionsJson, setConditionsJson] = useState('{}');
  const [recipientConfigJson, setRecipientConfigJson] = useState('{}');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (existing) {
      setName(existing.name);
      setDescription(existing.description ?? '');
      setEventType(existing.event_type);
      setStrategies(existing.recipient_strategies ?? []);
      setConditionsJson(JSON.stringify(existing.conditions ?? {}, null, 2));
      setRecipientConfigJson(JSON.stringify(existing.recipient_config ?? {}, null, 2));
    } else {
      setName('');
      setDescription('');
      setEventType('task.assigned');
      setStrategies(['assignee']);
      setConditionsJson('{}');
      setRecipientConfigJson('{}');
    }
  }, [visible, existing]);

  const toggleStrategy = (s: string) => {
    setStrategies((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const parseJson = (raw: string, fallback: any): { ok: true; value: any } | { ok: false; err: string } => {
    const trimmed = raw.trim();
    if (!trimmed) return { ok: true, value: fallback };
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ok: false, err: 'Must be a JSON object' };
      }
      return { ok: true, value: parsed };
    } catch (e: any) {
      return { ok: false, err: e?.message || 'Invalid JSON' };
    }
  };

  const submit = async () => {
    if (!name.trim()) { showAlert('Validation', 'Rule name is required.'); return; }
    if (strategies.length === 0) { showAlert('Validation', 'Select at least one recipient strategy.'); return; }

    const cond = parseJson(conditionsJson, {});
    if (!cond.ok) { showAlert('Validation', `Conditions: ${cond.err}`); return; }
    const cfg = parseJson(recipientConfigJson, {});
    if (!cfg.ok) { showAlert('Validation', `Recipient config: ${cfg.err}`); return; }

    setSaving(true);
    const rpc = existing ? 'rpc_update_notification_rule' : 'rpc_create_notification_rule';
    const params: Record<string, any> = {
      p_name: name.trim(),
      p_description: description.trim() || null,
      p_event_type: eventType,
      p_conditions: cond.value,
      p_recipient_strategies: strategies,
      p_recipient_config: cfg.value,
      p_channels_override: null,
    };
    if (existing) params.p_rule_id = existing.id;

    const { error } = await supabase.rpc(rpc, params);
    setSaving(false);

    if (error) {
      showAlert('Error', error.message || `Failed to ${existing ? 'update' : 'create'} rule.`);
    } else {
      onSaved();
      onClose();
    }
  };

  return {
    name, setName,
    description, setDescription,
    eventType, setEventType,
    strategies, toggleStrategy,
    conditionsJson, setConditionsJson,
    recipientConfigJson, setRecipientConfigJson,
    saving, submit,
  };
}
