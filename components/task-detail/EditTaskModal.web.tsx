import PremiumCalendarPicker from '@/components/common/PremiumCalendarPicker';
import { useTaskDetail } from '@/contexts/TaskDetailContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { cssInterop } from 'react-native-css-interop';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

cssInterop(FontAwesome, {
  className: { target: 'style', nativeStyleToProp: { color: true, size: true } },
} as any);

type Props = {
  visible: boolean;
  onClose: () => void;
};

type UserOption = { id: string; full_name: string };
type Tab = 'details' | 'scheduling';

const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'] as const;
const PRIORITY_LABEL: Record<string, string> = { low: 'Low', medium: 'Normal', high: 'High', urgent: 'Urgent' };
const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'text-state-danger', high: 'text-state-warning',
  medium: 'text-brand-primary', low: 'text-typography-dim',
};
const PRIORITY_BG: Record<string, string> = {
  urgent: 'bg-state-danger/15', high: 'bg-state-warning/15',
  medium: 'bg-brand-primary/15', low: 'bg-surface-overlay',
};

const QUICK_DATES = [
  { label: '+3d', days: 3 }, { label: '+1w', days: 7 },
  { label: '+2w', days: 14 }, { label: '+1m', days: 30 },
];

const HOUR_PRESETS = [1, 2, 4, 8, 16, 24];

const VISIBILITY_OPTIONS = [
  { value: null,              label: 'Everyone',      icon: 'globe'       },
  { value: 'assigned_only',  label: 'Assigned Only', icon: 'lock'        },
  { value: 'managers_only',  label: 'Managers Only', icon: 'user-secret' },
] as const;

function quickDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export default function EditTaskModalWeb({ visible, onClose }: Props) {
  const colors = useThemeColors();
  const { data, updateTask } = useTaskDetail();

  const [tab, setTab] = useState<Tab>('details');

  // Form state
  const [title, setTitle]                       = useState('');
  const [description, setDescription]           = useState('');
  const [priority, setPriority]                 = useState('medium');
  const [category, setCategory]                 = useState('');
  const [dueDate, setDueDate]                   = useState<string | null>(null);
  const [startDate, setStartDate]               = useState<string | null>(null);
  const [weight, setWeight]                     = useState('1');
  const [estimatedHours, setEstimatedHours]     = useState('');
  const [isRecurring, setIsRecurring]           = useState(false);
  const [managerId, setManagerId]               = useState<string | null>(null);
  const [visibilityPermission, setVisibility]   = useState<string | null>(null);

  // Overlay state
  const [showDueCal, setShowDueCal]           = useState(false);
  const [showStartCal, setShowStartCal]       = useState(false);
  const [showManagerDrop, setShowManagerDrop] = useState(false);
  const [managerSearch, setManagerSearch]     = useState('');
  const dueBtnRef    = useRef<any>(null);
  const startBtnRef  = useRef<any>(null);
  const managerRef   = useRef<any>(null);
  const [duePos, setDuePos]       = useState({ top: 0, left: 0, width: 0 });
  const [startPos, setStartPos]   = useState({ top: 0, left: 0, width: 0 });
  const [managerPos, setManagerPos] = useState({ top: 0, left: 0, width: 0 });

  const [users, setUsers]   = useState<UserOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const closeAllOverlays = useCallback(() => {
    setShowDueCal(false);
    setShowStartCal(false);
    setShowManagerDrop(false);
  }, []);

  const openOverlay = (
    ref: React.RefObject<any>,
    setPos: (p: { top: number; left: number; width: number }) => void,
    setShow: (v: boolean) => void
  ) => {
    if (ref.current?.getBoundingClientRect) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    }
    setShow(true);
  };

  // Keyboard shortcuts
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeAllOverlays(); onClose(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !saving) handleSave();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible, saving, title]);

  useEffect(() => {
    if (data?.task && visible) {
      setTitle(data.task.title || '');
      setDescription(data.task.description || '');
      setPriority(data.task.priority || 'medium');
      setCategory(data.task.category || '');
      setDueDate(data.task.due_date ? new Date(data.task.due_date).toISOString().split('T')[0] : null);
      setWeight(data.task.weight?.toString() || '1');
      setIsRecurring(!!data.task.is_recurring);
      setVisibility((data.task as any).visibility_permission ?? null);
      setManagerId((data as any).task.manager_id ?? null);
      const rawStart = (data as any).task.start_date;
      setStartDate(rawStart ? new Date(rawStart).toISOString().split('T')[0] : null);
      const rawHours = (data as any).task.estimated_hours;
      setEstimatedHours(rawHours?.toString() || '');
      closeAllOverlays();
      setTab('details');
      setError(null);
    }
  }, [data, visible]);

  useEffect(() => {
    if (visible && users.length === 0) {
      supabase.from('users').select('id, full_name').is('deleted_at', null).order('full_name')
        .then(({ data: u }) => setUsers(u || []));
    }
  }, [visible]);

  if (!data) return null;

  const { task, current_stage, pipeline, creator, manager, stats, permissions } = data;
  const selectedManager = users.find(u => u.id === managerId);
  const dateConflict = !!(startDate && dueDate && startDate > dueDate);
  const filteredUsers = users.filter(u =>
    u.full_name.toLowerCase().includes(managerSearch.toLowerCase())
  );

  const handleSave = async () => {
    if (!title.trim()) { setError('Title is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      const updates: any = {
        title: title.trim(),
        description: description.trim() || null,
        priority,
        category: category.trim() || null,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        start_date: startDate ? new Date(startDate).toISOString() : null,
        weight: parseInt(weight, 10) || 1,
        estimated_hours: estimatedHours ? parseFloat(estimatedHours) : null,
        is_recurring: isRecurring,
        manager_id: managerId || null,
        visibility_permission: visibilityPermission,
      };
      await updateTask(updates);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update task.');
    } finally {
      setSaving(false);
    }
  };

  const fmtDate = (d: string | null) =>
    d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  const StatRow = ({ icon, label, value, accent }: { icon: string; label: string; value: string; accent?: boolean }) => (
    <View className="flex-row items-center justify-between py-2.5 border-b border-surface-border/20">
      <View className="flex-row items-center gap-2.5">
        <FontAwesome name={icon as any} size={10} color={colors.textMuted} />
        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-wider">{label}</Text>
      </View>
      <Text className={`text-[11px] font-black ${accent ? 'text-brand-primary' : 'text-typography-main'}`}>{value}</Text>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View
        className="flex-1 bg-surface-background/70 items-center justify-center p-10"
        style={{ backdropFilter: 'blur(16px)' } as any}
      >
        <View
          className="bg-surface-card w-full max-w-[1100px] rounded-[2.5rem] border border-surface-border overflow-hidden flex-row premium-shadow"
          style={{ height: 720 }}
        >

          {/* ── LEFT PANEL: Current Task Snapshot ── */}
          <View className="w-72 border-r border-surface-border bg-surface-background/40 flex-col">
            <View className="px-7 pt-8 pb-5 border-b border-surface-border/30">
              <View className="flex-row items-center gap-2.5 mb-5">
                <FontAwesome name="pencil-square-o" size={13} color={colors.primary} />
                <Text className="text-typography-muted text-[9px] font-black uppercase tracking-[0.25em]">Modify Task</Text>
              </View>
              <Text className="text-typography-main font-black text-2xl tracking-tight leading-tight" numberOfLines={4}>
                {task.title}
              </Text>
            </View>

            <ScrollView className="flex-1 px-7 py-5" showsVerticalScrollIndicator={false}>
              {/* Stage */}
              {current_stage && (
                <View className="mb-4 p-3 rounded-2xl border border-surface-border/30 bg-surface-card/50">
                  <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-1.5">Current Stage</Text>
                  <View className="flex-row items-center gap-2">
                    <View style={{ backgroundColor: current_stage.color || colors.primary }} className="w-2 h-2 rounded-full" />
                    <Text className="text-typography-main font-black text-sm">{current_stage.name}</Text>
                  </View>
                </View>
              )}

              {/* Priority pill */}
              <View className={`mb-4 px-3 py-2 rounded-xl self-start ${PRIORITY_BG[task.priority] ?? 'bg-surface-overlay'}`}>
                <Text className={`font-black text-[10px] uppercase tracking-widest ${PRIORITY_COLOR[task.priority] ?? 'text-typography-muted'}`}>
                  {PRIORITY_LABEL[task.priority] ?? task.priority}
                </Text>
              </View>

              <View className="mb-2">
                <StatRow icon="code-fork"       label="Pipeline"      value={pipeline?.name || '—'} accent />
                <StatRow icon="user"            label="Creator"       value={creator?.full_name || '—'} />
                <StatRow icon="briefcase"       label="Manager"       value={manager?.full_name || '—'} />
                <StatRow icon="calendar-o"      label="Created"       value={fmtDate(task.created_at)} />
                <StatRow icon="calendar"        label="Due"           value={fmtDate(task.due_date)} />
                <StatRow icon="clock-o"         label="In Pipeline"   value={`${stats.days_in_pipeline}d`} />
                <StatRow icon="balance-scale"   label="Weight"        value={task.weight?.toString() || '1'} />
                {task.is_recurring && <StatRow icon="repeat" label="Recurring" value="Yes" accent />}
              </View>

              {task.description && (
                <View className="mt-3 p-3 bg-surface-overlay/50 rounded-xl">
                  <Text className="text-typography-muted text-[9px] font-black uppercase tracking-wider mb-1.5">Description</Text>
                  <Text className="text-typography-label text-xs leading-4 font-medium" numberOfLines={5}>
                    {task.description}
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>

          {/* ── RIGHT PANEL: Edit Form ── */}
          <View className="flex-1 flex-col">

            {/* Header */}
            <View className="px-10 py-7 border-b border-surface-border flex-row items-center justify-between">
              <View>
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.3em] mb-1">Task Editor</Text>
                <Text className="text-typography-main text-3xl font-black tracking-tighter">Edit Details</Text>
              </View>
              <TouchableOpacity
                onPress={onClose}
                disabled={saving}
                className="w-11 h-11 bg-surface-background rounded-full items-center justify-center border border-surface-border hover:border-brand-primary transition-colors"
              >
                <FontAwesome name="times" size={16} className="text-typography-muted" />
              </TouchableOpacity>
            </View>

            {/* Tabs */}
            <View className="px-10 pt-4 pb-0 flex-row gap-8 border-b border-surface-border/40">
              {(['details', 'scheduling'] as Tab[]).map(t => (
                <TouchableOpacity key={t} onPress={() => setTab(t)}>
                  <Text className={`font-black text-xs uppercase tracking-widest pb-3 border-b-2 transition-all ${tab === t ? 'text-brand-primary border-brand-primary' : 'text-typography-muted border-transparent'}`}>
                    {t === 'details' ? 'Details' : 'Scheduling & Access'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Form Area */}
            <ScrollView className="flex-1 px-10 pt-6" onScrollBeginDrag={closeAllOverlays} showsVerticalScrollIndicator={false}>
              {error && (
                <View className="bg-state-danger/10 border border-state-danger/30 px-4 py-3 rounded-2xl mb-5">
                  <Text className="text-state-danger text-sm font-bold">{error}</Text>
                </View>
              )}

              {tab === 'details' ? (
                <View className="gap-6 pb-8">

                  {/* Title */}
                  <View>
                    <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2.5 ml-1">Title</Text>
                    <TextInput
                      value={title}
                      onChangeText={setTitle}
                      placeholder="Task title"
                      placeholderTextColor={colors.textDim}
                      className={`bg-surface-background border rounded-2xl px-6 py-4 text-typography-main font-black text-lg transition-colors ${!title.trim() ? 'border-state-danger/40' : 'border-surface-border'}`}
                    />
                  </View>

                  {/* Priority + Weight */}
                  <View className="flex-row gap-6">
                    <View className="flex-1">
                      <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2.5 ml-1">Priority Level</Text>
                      <View className="flex-row bg-surface-background border border-surface-border rounded-2xl p-1.5">
                        {PRIORITY_OPTIONS.map(p => (
                          <TouchableOpacity
                            key={p}
                            onPress={() => setPriority(p)}
                            className={`flex-1 py-2.5 items-center rounded-xl transition-all ${priority === p ? 'bg-brand-primary' : 'hover:bg-surface-overlay'}`}
                          >
                            <Text className={`font-black text-[10px] uppercase tracking-widest ${priority === p ? 'text-white' : 'text-typography-muted'}`}>
                              {PRIORITY_LABEL[p]}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                    <View className="w-32">
                      <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2.5 ml-1">Weight</Text>
                      <TextInput
                        value={weight}
                        onChangeText={setWeight}
                        keyboardType="numeric"
                        className="bg-surface-background border border-surface-border rounded-2xl px-5 py-4 text-typography-main font-black text-center text-lg"
                      />
                    </View>
                  </View>

                  {/* Category */}
                  <View>
                    <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2.5 ml-1">Category</Text>
                    <TextInput
                      value={category}
                      onChangeText={setCategory}
                      placeholder="e.g. Bug, Feature, Research"
                      placeholderTextColor={colors.textDim}
                      className="bg-surface-background border border-surface-border rounded-2xl px-6 py-4 text-typography-main font-bold"
                    />
                  </View>

                  {/* Manager */}
                  <View>
                    <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2.5 ml-1">Manager</Text>
                    <TouchableOpacity
                      ref={managerRef}
                      onPress={() => {
                        closeAllOverlays();
                        openOverlay(managerRef, setManagerPos, setShowManagerDrop);
                      }}
                      className={`bg-surface-background border rounded-2xl px-5 py-4 flex-row items-center justify-between transition-all ${showManagerDrop ? 'border-brand-primary' : 'border-surface-border'}`}
                    >
                      <View className="flex-row items-center gap-3">
                        <FontAwesome name="user" size={13} color={selectedManager ? colors.primary : colors.textDim} />
                        <Text className={`font-bold text-sm ${selectedManager ? 'text-typography-main' : 'text-typography-dim'}`}>
                          {selectedManager?.full_name ?? 'No manager assigned'}
                        </Text>
                      </View>
                      <FontAwesome name={showManagerDrop ? 'chevron-up' : 'chevron-down'} size={11} color={colors.textDim} />
                    </TouchableOpacity>
                  </View>

                  {/* Description */}
                  <View>
                    <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2.5 ml-1">Description</Text>
                    <TextInput
                      value={description}
                      onChangeText={setDescription}
                      placeholder="Task details and context..."
                      placeholderTextColor={colors.textDim}
                      multiline
                      numberOfLines={5}
                      textAlignVertical="top"
                      className="bg-surface-background border border-surface-border rounded-2xl px-6 py-4 text-typography-main font-medium"
                      style={{ minHeight: 120 }}
                    />
                  </View>

                  {/* Recurring */}
                  <TouchableOpacity
                    onPress={() => setIsRecurring(v => !v)}
                    className={`flex-row items-center gap-4 p-4 rounded-2xl border transition-all ${isRecurring ? 'border-brand-primary bg-brand-primary/5' : 'border-surface-border bg-surface-background'}`}
                  >
                    <View className={`w-5 h-5 rounded-md items-center justify-center ${isRecurring ? 'bg-brand-primary' : 'bg-surface-overlay border border-surface-border'}`}>
                      {isRecurring && <FontAwesome name="check" size={10} color="white" />}
                    </View>
                    <View>
                      <Text className={`font-black text-sm ${isRecurring ? 'text-brand-primary' : 'text-typography-main'}`}>Recurring Task</Text>
                      <Text className="text-typography-muted text-[10px] font-bold mt-0.5">Task will repeat automatically on a schedule</Text>
                    </View>
                  </TouchableOpacity>

                </View>
              ) : (
                <View className="gap-6 pb-8">

                  {/* Due Date */}
                  <View>
                    <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2.5 ml-1">Due Date</Text>
                    <View className="flex-row gap-3 flex-wrap mb-3">
                      {QUICK_DATES.map(qd => (
                        <TouchableOpacity
                          key={qd.days}
                          onPress={() => setDueDate(quickDate(qd.days))}
                          className="px-3 py-1.5 rounded-xl border border-surface-border bg-surface-background hover:border-brand-primary hover:bg-brand-primary/5 transition-all"
                        >
                          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-wider">{qd.label}</Text>
                        </TouchableOpacity>
                      ))}
                      {dueDate && (
                        <TouchableOpacity
                          onPress={() => setDueDate(null)}
                          className="px-3 py-1.5 rounded-xl border border-state-danger/30 bg-state-danger/5 hover:bg-state-danger/10 transition-all"
                        >
                          <Text className="text-state-danger text-[10px] font-black uppercase tracking-wider">Clear</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <TouchableOpacity
                      ref={dueBtnRef}
                      onPress={() => {
                        closeAllOverlays();
                        openOverlay(dueBtnRef, setDuePos, setShowDueCal);
                      }}
                      className={`bg-surface-background border rounded-2xl px-5 py-4 flex-row items-center justify-between transition-all ${showDueCal ? 'border-brand-primary' : 'border-surface-border'}`}
                    >
                      <View className="flex-row items-center gap-3">
                        <FontAwesome name="calendar" size={13} color={dueDate ? colors.primary : colors.textDim} />
                        <Text className={`font-bold ${dueDate ? 'text-typography-main' : 'text-typography-dim'}`}>
                          {fmtDate(dueDate) !== '—' ? fmtDate(dueDate) : 'Set deadline'}
                        </Text>
                      </View>
                      <FontAwesome name={showDueCal ? 'chevron-up' : 'chevron-down'} size={11} color={colors.textDim} />
                    </TouchableOpacity>
                  </View>

                  {/* Start Date */}
                  <View>
                    <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2.5 ml-1">Start Date</Text>
                    <View className="flex-row gap-3 flex-wrap mb-3">
                      {[{ label: 'Today', days: 0 }, { label: 'Tomorrow', days: 1 }, { label: '+3d', days: 3 }].map(qd => (
                        <TouchableOpacity
                          key={qd.days}
                          onPress={() => setStartDate(quickDate(qd.days))}
                          className="px-3 py-1.5 rounded-xl border border-surface-border bg-surface-background hover:border-brand-primary hover:bg-brand-primary/5 transition-all"
                        >
                          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-wider">{qd.label}</Text>
                        </TouchableOpacity>
                      ))}
                      {startDate && (
                        <TouchableOpacity
                          onPress={() => setStartDate(null)}
                          className="px-3 py-1.5 rounded-xl border border-state-danger/30 bg-state-danger/5 hover:bg-state-danger/10 transition-all"
                        >
                          <Text className="text-state-danger text-[10px] font-black uppercase tracking-wider">Clear</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <TouchableOpacity
                      ref={startBtnRef}
                      onPress={() => {
                        closeAllOverlays();
                        openOverlay(startBtnRef, setStartPos, setShowStartCal);
                      }}
                      className={`bg-surface-background border rounded-2xl px-5 py-4 flex-row items-center justify-between transition-all ${showStartCal ? 'border-brand-primary' : dateConflict ? 'border-state-danger/50' : 'border-surface-border'}`}
                    >
                      <View className="flex-row items-center gap-3">
                        <FontAwesome name="calendar-o" size={13} color={startDate ? colors.primary : colors.textDim} />
                        <Text className={`font-bold ${startDate ? 'text-typography-main' : 'text-typography-dim'}`}>
                          {fmtDate(startDate) !== '—' ? fmtDate(startDate) : 'Set start'}
                        </Text>
                      </View>
                      <FontAwesome name={showStartCal ? 'chevron-up' : 'chevron-down'} size={11} color={colors.textDim} />
                    </TouchableOpacity>
                    {dateConflict && (
                      <Text className="text-state-danger text-[10px] font-black mt-1.5 ml-1">Start date is after due date</Text>
                    )}
                  </View>

                  {/* Estimated Hours */}
                  <View>
                    <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2.5 ml-1">Estimated Hours</Text>
                    <View className="flex-row gap-2 flex-wrap mb-3">
                      {HOUR_PRESETS.map(h => (
                        <TouchableOpacity
                          key={h}
                          onPress={() => setEstimatedHours(h.toString())}
                          className={`px-3 py-1.5 rounded-xl border transition-all ${estimatedHours === h.toString() ? 'bg-brand-primary border-brand-primary' : 'border-surface-border bg-surface-background hover:border-brand-primary/50'}`}
                        >
                          <Text className={`text-[10px] font-black uppercase tracking-wider ${estimatedHours === h.toString() ? 'text-white' : 'text-typography-muted'}`}>{h}h</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TextInput
                      value={estimatedHours}
                      onChangeText={setEstimatedHours}
                      keyboardType="decimal-pad"
                      placeholder="Custom (e.g. 6.5)"
                      placeholderTextColor={colors.textDim}
                      className="bg-surface-background border border-surface-border rounded-2xl px-5 py-4 text-typography-main font-bold"
                    />
                  </View>

                  {/* Visibility */}
                  <View>
                    <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2.5 ml-1">Visibility</Text>
                    <View className="flex-row gap-3">
                      {VISIBILITY_OPTIONS.map(opt => (
                        <TouchableOpacity
                          key={String(opt.value)}
                          onPress={() => setVisibility(opt.value)}
                          className={`flex-1 flex-row items-center gap-2.5 px-4 py-3.5 rounded-2xl border transition-all ${visibilityPermission === opt.value ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-background border-surface-border hover:border-brand-primary/40'}`}
                        >
                          <FontAwesome name={opt.icon as any} size={12} color={visibilityPermission === opt.value ? colors.primary : colors.textDim} />
                          <Text className={`font-black text-[10px] uppercase tracking-wider ${visibilityPermission === opt.value ? 'text-brand-primary' : 'text-typography-muted'}`}>
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                </View>
              )}
            </ScrollView>

            {/* Footer */}
            <View className="px-10 py-5 border-t border-surface-border/50 flex-row items-center justify-between bg-surface-background/30">
              <Text className="text-typography-muted text-[10px] font-bold">
                {saving ? 'Saving changes...' : 'Press Ctrl+↵ to save'}
              </Text>
              <View className="flex-row items-center gap-4">
                <TouchableOpacity
                  onPress={onClose}
                  disabled={saving}
                  className="px-6 py-3 rounded-2xl border border-surface-border hover:border-brand-primary/40 transition-all"
                >
                  <Text className="text-typography-main font-bold">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSave}
                  disabled={saving || !title.trim()}
                  className={`px-8 py-3 rounded-2xl flex-row items-center gap-2.5 transition-all ${!title.trim() ? 'bg-brand-primary/30' : 'bg-brand-primary hover:bg-brand-primary/90'}`}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <>
                      <FontAwesome name="check" size={12} color="white" />
                      <Text className="text-white font-black">Save Changes</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        {/* ── Floating Overlays ── */}

        {/* Due Date Calendar */}
        {showDueCal && (
          <View className="absolute z-50" style={{ top: duePos.top, left: duePos.left }}>
            <PremiumCalendarPicker
              selectedDate={dueDate}
              onSelect={(d) => { setDueDate(d); setShowDueCal(false); }}
              compact
            />
          </View>
        )}

        {/* Start Date Calendar */}
        {showStartCal && (
          <View className="absolute z-50" style={{ top: startPos.top, left: startPos.left }}>
            <PremiumCalendarPicker
              selectedDate={startDate}
              onSelect={(d) => { setStartDate(d); setShowStartCal(false); }}
              compact
            />
          </View>
        )}

        {/* Manager Dropdown */}
        {showManagerDrop && (
          <View
            className="absolute z-50 bg-surface-card border border-surface-border rounded-2xl overflow-hidden premium-shadow"
            style={{ top: managerPos.top, left: managerPos.left, width: Math.max(managerPos.width, 260), maxHeight: 320 }}
          >
            <View className="px-4 pt-3 pb-2 border-b border-surface-border/50">
              <TextInput
                value={managerSearch}
                onChangeText={setManagerSearch}
                placeholder="Search users..."
                placeholderTextColor={colors.textDim}
                className="bg-surface-background border border-surface-border rounded-xl px-3 py-2 text-typography-main text-sm font-medium"
                autoFocus
              />
            </View>
            <ScrollView style={{ maxHeight: 250 }}>
              <TouchableOpacity
                onPress={() => { setManagerId(null); setShowManagerDrop(false); setManagerSearch(''); }}
                className={`px-4 py-3 border-b border-surface-border/20 flex-row items-center gap-3 ${!managerId ? 'bg-brand-primary/5' : 'hover:bg-surface-overlay'}`}
              >
                <FontAwesome name="ban" size={12} color={colors.textMuted} />
                <Text className={`font-bold text-sm ${!managerId ? 'text-brand-primary' : 'text-typography-muted'}`}>No manager</Text>
              </TouchableOpacity>
              {filteredUsers.map(u => (
                <TouchableOpacity
                  key={u.id}
                  onPress={() => { setManagerId(u.id); setShowManagerDrop(false); setManagerSearch(''); }}
                  className={`px-4 py-3 border-b border-surface-border/20 flex-row items-center gap-3 ${managerId === u.id ? 'bg-brand-primary/5' : 'hover:bg-surface-overlay'}`}
                >
                  <View className="w-6 h-6 rounded-full bg-brand-primary/20 items-center justify-center">
                    <Text className="text-brand-primary text-[9px] font-black">{u.full_name.charAt(0)}</Text>
                  </View>
                  <Text className={`font-bold text-sm ${managerId === u.id ? 'text-brand-primary' : 'text-typography-main'}`}>
                    {u.full_name}
                  </Text>
                  {managerId === u.id && <FontAwesome name="check" size={10} color={colors.primary} style={{ marginLeft: 'auto' as any }} />}
                </TouchableOpacity>
              ))}
              {filteredUsers.length === 0 && (
                <View className="py-8 items-center">
                  <Text className="text-typography-muted text-xs font-bold">No users found</Text>
                </View>
              )}
            </ScrollView>
          </View>
        )}
      </View>
    </Modal>
  );
}
