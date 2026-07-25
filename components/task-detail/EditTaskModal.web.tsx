import DraggableSheet from '@/components/common/DraggableSheet';
import Popup from '@/components/common/Popup';
import PremiumCalendarPicker from '@/components/common/PremiumCalendarPicker';
import UserLink from '@/components/common/UserLink';
import { useTaskDetail } from '@/contexts/TaskDetailContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import { useCalendarPosition } from '@/lib/calendarPicker';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { cssInterop } from 'react-native-css-interop';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

cssInterop(FontAwesome, {
  className: { target: 'style', nativeStyleToProp: { color: true, size: true } },
} as any);

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Opens the sheet on a given field's tab already visible (e.g. from a card quick-action). */
  focusField?: 'due_date' | null;
};

type UserOption = { id: string; full_name: string };
type Tab = 'details' | 'scheduling';

const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'] as const;
const PRIORITY_LABEL: Record<string, string> = { low: 'Low', medium: 'Normal', high: 'High', urgent: 'Urgent' };
// Colors (not classNames) — this renders inside a <Modal> subtree, so theme tokens
// must be resolved via useThemeColors() rather than CSS-variable-backed classNames.
function priorityTextColor(colors: ReturnType<typeof useThemeColors>, p: string): string {
  return ({ urgent: colors.danger, high: colors.warning, medium: colors.primary, low: colors.textDim } as Record<string, string>)[p] ?? colors.textMuted;
}
function priorityBgColor(colors: ReturnType<typeof useThemeColors>, p: string): string {
  return ({ urgent: colors.danger + '26', high: colors.warning + '26', medium: colors.primary + '26', low: colors.border + '40' } as Record<string, string>)[p] ?? (colors.border + '40');
}

const QUICK_DATES = [
  { label: '+3d', days: 3 }, { label: '+1w', days: 7 },
  { label: '+2w', days: 14 }, { label: '+1m', days: 30 },
];

const HOUR_PRESETS = [1, 2, 4, 8, 16, 24];

function quickDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export default function EditTaskModalWeb({ visible, onClose, focusField }: Props) {
  const colors = useThemeColors();
  const { width: winWidth } = useWindowDimensions();
  const isNarrow = winWidth < 768;
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

  // Overlay state
  const [showDueCal, setShowDueCal]           = useState(false);
  const [showStartCal, setShowStartCal]       = useState(false);
  const [showManagerDrop, setShowManagerDrop] = useState(false);
  const [managerSearch, setManagerSearch]     = useState('');
  const managerRef   = useRef<any>(null);
  const [managerPos, setManagerPos] = useState({ top: 0, left: 0, width: 0 });

  const [users, setUsers]   = useState<UserOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // Mobile-only overlay state — kept separate from the desktop dropdown/calendar
  // state above (which relies on getBoundingClientRect positioning tied to
  // desktop-only ref elements) so the two layouts can't cross-contaminate.
  const [mobileActiveDateField, setMobileActiveDateField] = useState<'due' | 'start' | null>(null);
  const [showMobileManagerPicker, setShowMobileManagerPicker] = useState(false);

  const dueCalPos = useCalendarPosition({ calendarWidth: 332 });
  const startCalPos = useCalendarPosition({ calendarWidth: 332 });

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
      setManagerId((data as any).task.manager_id ?? null);
      const rawStart = (data as any).task.start_date;
      setStartDate(rawStart ? new Date(rawStart).toISOString().split('T')[0] : null);
      const rawHours = (data as any).task.estimated_hours;
      setEstimatedHours(rawHours?.toString() || '');
      closeAllOverlays();
      setMobileActiveDateField(focusField === 'due_date' ? 'due' : null);
      setShowMobileManagerPicker(false);
      setTab(focusField === 'due_date' ? 'scheduling' : 'details');
      setError(null);
    }
  }, [data, visible, focusField]);

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

  const StatRow = ({ icon, label, value, valueNode, accent }: { icon: string; label: string; value: string; valueNode?: React.ReactNode; accent?: boolean }) => (
    <View className="flex-row items-center justify-between py-2.5" style={{ borderBottomWidth: 1, borderColor: colors.border + '33' }}>
      <View className="flex-row items-center gap-2.5">
        <FontAwesome name={icon as any} size={10} color={colors.textMuted} />
        <Text className="text-[10px] font-black uppercase tracking-wider" style={{ color: colors.textMuted }}>{label}</Text>
      </View>
      {valueNode ?? <Text className="text-[11px] font-black" style={{ color: accent ? colors.primary : colors.textMain }}>{value}</Text>}
    </View>
  );

  // ─── Mobile-web layout (narrow viewports) ───────────────────────────────────
  // Mirrors native's EditTaskModal.tsx (single-scroll DraggableSheet, no tabs,
  // shared inline calendar toggled per-field) instead of the desktop two-pane
  // tabbed layout below — desktop has full field parity with native already, so
  // nothing is being dropped here, just reflowed.
  if (isNarrow) {
    return (
      <DraggableSheet
        visible={visible}
        onClose={onClose}
        dimBackdrop
        maxHeight="92%"
        containerClassName="rounded-t-3xl overflow-hidden"
        containerStyle={{ backgroundColor: colors.card, borderTopWidth: 1, borderColor: colors.border }}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-6 pt-5 pb-4" style={{ borderBottomWidth: 1, borderColor: colors.border + '80' }}>
          <View className="flex-1 mr-4">
            <Text className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: colors.textMuted }}>Modify Task</Text>
            <Text className="text-xl font-black tracking-tight mt-0.5" style={{ color: colors.textMain }} numberOfLines={2}>Edit Details</Text>
          </View>
          <TouchableOpacity onPress={onClose} className="w-9 h-9 items-center justify-center rounded-full" style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}>
            <FontAwesome name="times" size={14} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <ScrollView className="px-6 pt-5" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View className="gap-6 pb-10">
            {error && (
              <View className="p-3 rounded-2xl" style={{ backgroundColor: colors.danger + '1A', borderWidth: 1, borderColor: colors.danger + '4D' }}>
                <Text className="text-sm font-bold" style={{ color: colors.danger }}>{error}</Text>
              </View>
            )}

            {/* Title */}
            <View>
              <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: colors.textMuted }}>Title</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Task title"
                placeholderTextColor={colors.textDim}
                className="rounded-2xl px-4 py-3.5 font-medium text-base"
                style={{ backgroundColor: colors.background, color: colors.textMain, borderWidth: 1, borderColor: !title.trim() ? colors.danger + '66' : colors.border }}
              />
            </View>

            {/* Category */}
            <View>
              <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: colors.textMuted }}>Category</Text>
              <TextInput
                value={category}
                onChangeText={setCategory}
                placeholder="e.g. Bug, Feature, Research"
                placeholderTextColor={colors.textDim}
                className="rounded-2xl px-4 py-3.5 font-medium"
                style={{ backgroundColor: colors.background, color: colors.textMain, borderWidth: 1, borderColor: colors.border }}
              />
            </View>

            {/* Description */}
            <View>
              <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: colors.textMuted }}>Description</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Details about this task..."
                placeholderTextColor={colors.textDim}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                className="rounded-2xl px-4 py-3.5 font-medium"
                style={{ minHeight: 100, backgroundColor: colors.background, color: colors.textMain, borderWidth: 1, borderColor: colors.border }}
              />
            </View>

            {/* Priority */}
            <View>
              <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-3" style={{ color: colors.textMuted }}>Priority</Text>
              <View className="flex-row flex-wrap gap-2">
                {PRIORITY_OPTIONS.map(p => (
                  <TouchableOpacity
                    key={p}
                    onPress={() => setPriority(p)}
                    className="px-5 py-2.5 rounded-full"
                    style={{ backgroundColor: priority === p ? colors.primary : colors.background, borderWidth: 1, borderColor: priority === p ? colors.primary : colors.border }}
                  >
                    <Text className="font-black text-[10px] uppercase tracking-widest" style={{ color: priority === p ? '#fff' : colors.textMuted }}>{PRIORITY_LABEL[p]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Dates — one shared inline calendar, colored per field */}
            <View>
              <View className="flex-row gap-4">
                <View className="flex-1">
                  <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: colors.textMuted }}>Due Date</Text>
                  <View className="flex-row gap-2">
                    <TouchableOpacity
                      onPress={() => setMobileActiveDateField(f => f === 'due' ? null : 'due')}
                      className="flex-1 px-3 py-3 rounded-2xl flex-row items-center justify-between"
                      style={{ backgroundColor: mobileActiveDateField === 'due' ? colors.primary + '14' : colors.background, borderWidth: 1, borderColor: mobileActiveDateField === 'due' ? colors.primary : colors.border }}
                    >
                      <Text className="font-medium text-sm" style={{ color: dueDate ? colors.textMain : colors.textMuted }}>{fmtDate(dueDate) !== '—' ? fmtDate(dueDate) : 'Set date'}</Text>
                      <FontAwesome name="calendar" size={11} color={dueDate ? colors.primary : colors.textMuted} />
                    </TouchableOpacity>
                    {dueDate && (
                      <TouchableOpacity
                        onPress={() => { setDueDate(null); if (mobileActiveDateField === 'due') setMobileActiveDateField(null); }}
                        className="w-11 h-11 rounded-2xl items-center justify-center"
                        style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}
                      >
                        <FontAwesome name="times" size={11} color={colors.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                <View className="flex-1">
                  <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: colors.textMuted }}>Start Date</Text>
                  <View className="flex-row gap-2">
                    <TouchableOpacity
                      onPress={() => setMobileActiveDateField(f => f === 'start' ? null : 'start')}
                      className="flex-1 px-3 py-3 rounded-2xl flex-row items-center justify-between"
                      style={{ backgroundColor: mobileActiveDateField === 'start' ? colors.secondary + '14' : colors.background, borderWidth: 1, borderColor: mobileActiveDateField === 'start' ? colors.secondary : colors.border }}
                    >
                      <Text className="font-medium text-sm" style={{ color: startDate ? colors.textMain : colors.textMuted }}>{fmtDate(startDate) !== '—' ? fmtDate(startDate) : 'Set date'}</Text>
                      <FontAwesome name="calendar-o" size={11} color={startDate ? colors.secondary : colors.textMuted} />
                    </TouchableOpacity>
                    {startDate && (
                      <TouchableOpacity
                        onPress={() => { setStartDate(null); if (mobileActiveDateField === 'start') setMobileActiveDateField(null); }}
                        className="w-11 h-11 rounded-2xl items-center justify-center"
                        style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}
                      >
                        <FontAwesome name="times" size={11} color={colors.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>

              {dateConflict && (
                <Text className="text-[10px] font-black mt-2 ml-1" style={{ color: colors.danger }}>Start date is after due date</Text>
              )}

              {mobileActiveDateField && (
                <View className="mt-3">
                  <PremiumCalendarPicker
                    selectedDate={mobileActiveDateField === 'due' ? dueDate : startDate}
                    onSelect={(d) => mobileActiveDateField === 'due' ? setDueDate(d) : setStartDate(d)}
                    accentColor={mobileActiveDateField === 'due' ? colors.primary : colors.secondary}
                    rangeDate={mobileActiveDateField === 'due' ? startDate : dueDate}
                    rangeColor={mobileActiveDateField === 'due' ? colors.secondary : colors.primary}
                    scale="compact"
                    showDaysBetween
                  />
                </View>
              )}
            </View>

            {/* Weight & Estimated Hours */}
            <View className="flex-row gap-4">
              <View className="flex-1">
                <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: colors.textMuted }}>Weight</Text>
                <TextInput
                  value={weight}
                  onChangeText={setWeight}
                  keyboardType="numeric"
                  placeholder="1"
                  placeholderTextColor={colors.textDim}
                  className="rounded-2xl px-4 py-3.5 font-medium"
                  style={{ backgroundColor: colors.background, color: colors.textMain, borderWidth: 1, borderColor: colors.border }}
                />
              </View>
              <View className="flex-1">
                <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: colors.textMuted }}>Est. Hours</Text>
                <TextInput
                  value={estimatedHours}
                  onChangeText={setEstimatedHours}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 4.5"
                  placeholderTextColor={colors.textDim}
                  className="rounded-2xl px-4 py-3.5 font-medium"
                  style={{ backgroundColor: colors.background, color: colors.textMain, borderWidth: 1, borderColor: colors.border }}
                />
              </View>
            </View>

            {/* Manager */}
            <View>
              <Text className="text-[10px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: colors.textMuted }}>Manager</Text>
              <TouchableOpacity
                onPress={() => setShowMobileManagerPicker(v => !v)}
                className="rounded-2xl px-4 py-3.5 flex-row items-center justify-between"
                style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}
              >
                <Text className="font-medium" style={{ color: selectedManager ? colors.textMain : colors.textMuted }}>
                  {selectedManager ? selectedManager.full_name : 'Select manager'}
                </Text>
                <FontAwesome name={showMobileManagerPicker ? 'chevron-up' : 'chevron-down'} size={11} color={colors.textMuted} />
              </TouchableOpacity>

              {showMobileManagerPicker && (
                <View className="mt-2 rounded-2xl overflow-hidden" style={{ maxHeight: 200, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}>
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                    <TouchableOpacity
                      onPress={() => { setManagerId(null); setShowMobileManagerPicker(false); }}
                      className="px-4 py-3"
                      style={{ borderBottomWidth: 1, borderColor: colors.border + '4D', backgroundColor: !managerId ? colors.primary + '1A' : undefined }}
                    >
                      <Text className="font-bold text-sm" style={{ color: !managerId ? colors.primary : colors.textMuted }}>No manager</Text>
                    </TouchableOpacity>
                    {users.map(u => (
                      <TouchableOpacity
                        key={u.id}
                        onPress={() => { setManagerId(u.id); setShowMobileManagerPicker(false); }}
                        className="px-4 py-3"
                        style={{ borderBottomWidth: 1, borderColor: colors.border + '4D', backgroundColor: managerId === u.id ? colors.primary + '1A' : undefined }}
                      >
                        <Text className="font-bold text-sm" style={{ color: managerId === u.id ? colors.primary : colors.textMain }}>{u.full_name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            {/* Recurring */}
            <TouchableOpacity onPress={() => setIsRecurring(v => !v)} className="flex-row items-center gap-3">
              <View className="w-5 h-5 rounded items-center justify-center" style={{ backgroundColor: isRecurring ? colors.primary : undefined, borderWidth: isRecurring ? 0 : 1, borderColor: colors.border }}>
                {isRecurring && <FontAwesome name="check" size={10} color="white" />}
              </View>
              <View>
                <Text className="font-bold" style={{ color: colors.textMain }}>Recurring Task</Text>
                <Text className="text-xs" style={{ color: colors.textMuted }}>This task repeats on a schedule</Text>
              </View>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Footer */}
        <View className="px-6 py-4 flex-row justify-end gap-3" style={{ borderTopWidth: 1, borderColor: colors.border + '80', backgroundColor: colors.background + '80' }}>
          <TouchableOpacity onPress={onClose} disabled={saving} className="px-5 py-3 rounded-2xl" style={{ borderWidth: 1, borderColor: colors.border }}>
            <Text className="font-bold" style={{ color: colors.textMain }}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSave}
            disabled={saving || !title.trim()}
            className="px-7 py-3 rounded-2xl flex-row items-center gap-2"
            style={{ backgroundColor: !title.trim() ? colors.primary + '4D' : colors.primary }}
          >
            {saving ? <ActivityIndicator size="small" color="white" /> : (
              <>
                <FontAwesome name="check" size={12} color="white" />
                <Text className="text-white font-black">Save Changes</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </DraggableSheet>
    );
  }

  const sideMenuContent = (
    <View className="w-72 flex-col" style={{ backgroundColor: colors.background + '66' }}>
      <View className="px-7 pt-8 pb-5" style={{ borderBottomWidth: 1, borderColor: colors.border + '4D' }}>
        <View className="flex-row items-center gap-2.5 mb-5">
          <FontAwesome name="pencil-square-o" size={13} color={colors.primary} />
          <Text className="text-[9px] font-black uppercase tracking-[0.25em]" style={{ color: colors.textMuted }}>Modify Task</Text>
        </View>
        <Text className="font-black text-2xl tracking-tight leading-tight" style={{ color: colors.textMain }} numberOfLines={4}>
          {task.title}
        </Text>
      </View>

      <ScrollView className="flex-1 px-7 py-5" showsVerticalScrollIndicator={false}>
        {/* Stage */}
        {current_stage && (
          <View className="mb-4 p-3 rounded-2xl" style={{ borderWidth: 1, borderColor: colors.border + '4D', backgroundColor: colors.card + '80' }}>
            <Text className="text-[9px] font-black uppercase tracking-widest mb-1.5" style={{ color: colors.textMuted }}>Current Stage</Text>
            <View className="flex-row items-center gap-2">
              <View style={{ backgroundColor: current_stage.color || colors.primary }} className="w-2 h-2 rounded-full" />
              <Text className="font-black text-sm" style={{ color: colors.textMain }}>{current_stage.name}</Text>
            </View>
          </View>
        )}

        {/* Priority pill */}
        <View className="mb-4 px-3 py-2 rounded-xl self-start" style={{ backgroundColor: priorityBgColor(colors, task.priority) }}>
          <Text className="font-black text-[10px] uppercase tracking-widest" style={{ color: priorityTextColor(colors, task.priority) }}>
            {PRIORITY_LABEL[task.priority] ?? task.priority}
          </Text>
        </View>

        <View className="mb-2">
          <StatRow icon="code-fork"       label="Pipeline"      value={pipeline?.name || '—'} accent />
          <StatRow icon="user"            label="Creator"       value={creator?.full_name || '—'} valueNode={creator?.id ? <UserLink userId={creator.id} name={creator.full_name} className="text-[11px] font-black" style={{ color: colors.textMain }} /> : undefined} />
          <StatRow icon="briefcase"       label="Manager"       value={manager?.full_name || '—'} valueNode={manager?.id ? <UserLink userId={manager.id} name={manager.full_name} className="text-[11px] font-black" style={{ color: colors.textMain }} /> : undefined} />
          <StatRow icon="calendar-o"      label="Created"       value={fmtDate(task.created_at)} />
          <StatRow icon="calendar"        label="Due"           value={fmtDate(task.due_date)} />
          <StatRow icon="clock-o"         label="In Pipeline"   value={`${stats.days_in_pipeline}d`} />
          <StatRow icon="balance-scale"   label="Weight"        value={task.weight?.toString() || '1'} />
          {task.is_recurring && <StatRow icon="repeat" label="Recurring" value="Yes" accent />}
        </View>

        {task.description && (
          <View className="mt-3 p-3 rounded-xl" style={{ backgroundColor: colors.border + '20' }}>
            <Text className="text-[9px] font-black uppercase tracking-wider mb-1.5" style={{ color: colors.textMuted }}>Description</Text>
            <Text className="text-xs leading-4 font-medium" style={{ color: colors.textMuted }} numberOfLines={5}>
              {task.description}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );

  return (
    <Popup
      visible={visible}
      onClose={onClose}
      presentation="centered"
      backdropBlur
      dismissible={false}
      maxWidth={1100}
      containerClassName="rounded-[2.5rem] overflow-hidden premium-shadow"
      containerStyle={{ height: 720 }}
      sideMenu={sideMenuContent}
      overlays={(
        <>
          {/* Backdrop for overlays */}
          {(showDueCal || showStartCal) && (
            <TouchableOpacity
              onPress={closeAllOverlays}
              className="absolute inset-0 z-40"
              style={{ backgroundColor: 'transparent' }}
            />
          )}

          {/* Due Date Calendar */}
          {showDueCal && (
            <View style={dueCalPos.style as any}>
              <PremiumCalendarPicker
                selectedDate={dueDate}
                onSelect={(d) => setDueDate(d)}
                accentColor={colors.primary}
                rangeDate={startDate}
                rangeColor={colors.secondary}
                scale="compact"
                showDaysBetween
              />
            </View>
          )}

          {/* Start Date Calendar */}
          {showStartCal && (
            <View style={startCalPos.style as any}>
              <PremiumCalendarPicker
                selectedDate={startDate}
                onSelect={(d) => setStartDate(d)}
                accentColor={colors.secondary}
                rangeDate={dueDate}
                rangeColor={colors.primary}
                scale="compact"
                showDaysBetween
              />
            </View>
          )}

          {/* Manager Dropdown */}
          {showManagerDrop && (
            <View
              className="absolute z-50 rounded-2xl overflow-hidden premium-shadow"
              style={{ top: managerPos.top, left: managerPos.left, width: Math.max(managerPos.width, 260), maxHeight: 320, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
            >
              <View className="px-4 pt-3 pb-2" style={{ borderBottomWidth: 1, borderColor: colors.border + '80' }}>
                <TextInput
                  value={managerSearch}
                  onChangeText={setManagerSearch}
                  placeholder="Search users..."
                  placeholderTextColor={colors.textDim}
                  className="rounded-xl px-3 py-2 text-sm font-medium"
                  style={{ backgroundColor: colors.background, color: colors.textMain, borderWidth: 1, borderColor: colors.border }}
                  autoFocus
                />
              </View>
              <ScrollView style={{ maxHeight: 250 }}>
                <TouchableOpacity
                  onPress={() => { setManagerId(null); setShowManagerDrop(false); setManagerSearch(''); }}
                  className={`px-4 py-3 flex-row items-center gap-3 ${!managerId ? '' : 'hover:bg-surface-overlay'}`}
                  style={{ borderBottomWidth: 1, borderColor: colors.border + '33', backgroundColor: !managerId ? colors.primary + '0D' : undefined }}
                >
                  <FontAwesome name="ban" size={12} color={colors.textMuted} />
                  <Text className="font-bold text-sm" style={{ color: !managerId ? colors.primary : colors.textMuted }}>No manager</Text>
                </TouchableOpacity>
                {filteredUsers.map(u => (
                  <TouchableOpacity
                    key={u.id}
                    onPress={() => { setManagerId(u.id); setShowManagerDrop(false); setManagerSearch(''); }}
                    className={`px-4 py-3 flex-row items-center gap-3 ${managerId === u.id ? '' : 'hover:bg-surface-overlay'}`}
                    style={{ borderBottomWidth: 1, borderColor: colors.border + '33', backgroundColor: managerId === u.id ? colors.primary + '0D' : undefined }}
                  >
                    <View className="w-6 h-6 rounded-full items-center justify-center" style={{ backgroundColor: colors.primary + '33' }}>
                      <Text className="text-[9px] font-black" style={{ color: colors.primary }}>{u.full_name.charAt(0)}</Text>
                    </View>
                    <Text className="font-bold text-sm" style={{ color: managerId === u.id ? colors.primary : colors.textMain }}>
                      {u.full_name}
                    </Text>
                    {managerId === u.id && <FontAwesome name="check" size={10} color={colors.primary} style={{ marginLeft: 'auto' as any }} />}
                  </TouchableOpacity>
                ))}
                {filteredUsers.length === 0 && (
                  <View className="py-8 items-center">
                    <Text className="text-xs font-bold" style={{ color: colors.textMuted }}>No users found</Text>
                  </View>
                )}
              </ScrollView>
            </View>
          )}
        </>
      )}
    >
          {/* ── RIGHT PANEL: Edit Form ── */}
          <View className="flex-1 flex-col">

            {/* Header */}
            <View className={isNarrow ? 'px-5 py-5 flex-row items-center justify-between' : 'px-10 py-7 flex-row items-center justify-between'} style={{ borderBottomWidth: 1, borderColor: colors.border }}>
              <View className="flex-1 mr-4">
                <Text className="text-[10px] font-black uppercase tracking-[0.3em] mb-1" style={{ color: colors.textMuted }}>Task Editor</Text>
                {isNarrow ? (
                  <Text className="text-lg font-black tracking-tight" style={{ color: colors.textMain }} numberOfLines={2}>{task.title}</Text>
                ) : (
                  <Text className="text-3xl font-black tracking-tighter" style={{ color: colors.textMain }}>Edit Details</Text>
                )}
              </View>
              <TouchableOpacity
                onPress={onClose}
                disabled={saving}
                className={isNarrow ? 'w-8 h-8 rounded-full items-center justify-center' : 'w-11 h-11 rounded-full items-center justify-center hover:border-brand-primary transition-colors'}
                style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}
              >
                <FontAwesome name="times" size={isNarrow ? 13 : 16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Tabs */}
            <View className={isNarrow ? 'px-5 pt-3 pb-0 flex-row gap-6' : 'px-10 pt-4 pb-0 flex-row gap-8'} style={{ borderBottomWidth: 1, borderColor: colors.border + '66' }}>
              {(['details', 'scheduling'] as Tab[]).map(t => (
                <TouchableOpacity key={t} onPress={() => setTab(t)}>
                  <Text
                    className="font-black text-xs uppercase tracking-widest pb-3 transition-all"
                    style={{ color: tab === t ? colors.primary : colors.textMuted, borderBottomWidth: 2, borderBottomColor: tab === t ? colors.primary : 'transparent' }}
                  >
                    {t === 'details' ? 'Details' : 'Scheduling & Access'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Form Area */}
            <ScrollView className={isNarrow ? 'flex-1 px-5 pt-5' : 'flex-1 px-10 pt-6'} onScrollBeginDrag={closeAllOverlays} showsVerticalScrollIndicator={false}>
              {error && (
                <View className="px-4 py-3 rounded-2xl mb-5" style={{ backgroundColor: colors.danger + '1A', borderWidth: 1, borderColor: colors.danger + '4D' }}>
                  <Text className="text-sm font-bold" style={{ color: colors.danger }}>{error}</Text>
                </View>
              )}

              {tab === 'details' ? (
                <View className="gap-6 pb-8">

                  {/* Title */}
                  <View>
                    <Text className="text-[10px] font-black uppercase tracking-widest mb-2.5 ml-1" style={{ color: colors.textMuted }}>Title</Text>
                    <TextInput
                      value={title}
                      onChangeText={setTitle}
                      placeholder="Task title"
                      placeholderTextColor={colors.textDim}
                      className="rounded-2xl px-6 py-4 font-black text-lg transition-colors"
                      style={{ backgroundColor: colors.background, color: colors.textMain, borderWidth: 1, borderColor: !title.trim() ? colors.danger + '66' : colors.border }}
                    />
                  </View>

                  {/* Priority + Weight */}
                  <View className="flex-row gap-6">
                    <View className="flex-1">
                      <Text className="text-[10px] font-black uppercase tracking-widest mb-2.5 ml-1" style={{ color: colors.textMuted }}>Priority Level</Text>
                      <View className="flex-row rounded-2xl p-1.5" style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}>
                        {PRIORITY_OPTIONS.map(p => (
                          <TouchableOpacity
                            key={p}
                            onPress={() => setPriority(p)}
                            className={`flex-1 py-2.5 items-center rounded-xl transition-all ${priority === p ? '' : 'hover:bg-surface-overlay'}`}
                            style={{ backgroundColor: priority === p ? colors.primary : undefined }}
                          >
                            <Text className="font-black text-[10px] uppercase tracking-widest" style={{ color: priority === p ? '#fff' : colors.textMuted }}>
                              {PRIORITY_LABEL[p]}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                    <View className="w-32">
                      <Text className="text-[10px] font-black uppercase tracking-widest mb-2.5 ml-1" style={{ color: colors.textMuted }}>Weight</Text>
                      <TextInput
                        value={weight}
                        onChangeText={setWeight}
                        keyboardType="numeric"
                        className="rounded-2xl px-5 py-4 font-black text-center text-lg"
                        style={{ backgroundColor: colors.background, color: colors.textMain, borderWidth: 1, borderColor: colors.border }}
                      />
                    </View>
                  </View>

                  {/* Category */}
                  <View>
                    <Text className="text-[10px] font-black uppercase tracking-widest mb-2.5 ml-1" style={{ color: colors.textMuted }}>Category</Text>
                    <TextInput
                      value={category}
                      onChangeText={setCategory}
                      placeholder="e.g. Bug, Feature, Research"
                      placeholderTextColor={colors.textDim}
                      className="rounded-2xl px-6 py-4 font-bold"
                      style={{ backgroundColor: colors.background, color: colors.textMain, borderWidth: 1, borderColor: colors.border }}
                    />
                  </View>

                  {/* Manager */}
                  <View>
                    <Text className="text-[10px] font-black uppercase tracking-widest mb-2.5 ml-1" style={{ color: colors.textMuted }}>Manager</Text>
                    <TouchableOpacity
                      ref={managerRef}
                      onPress={() => {
                        closeAllOverlays();
                        openOverlay(managerRef, setManagerPos, setShowManagerDrop);
                      }}
                      className="rounded-2xl px-5 py-4 flex-row items-center justify-between transition-all"
                      style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: showManagerDrop ? colors.primary : colors.border }}
                    >
                      <View className="flex-row items-center gap-3">
                        <FontAwesome name="user" size={13} color={selectedManager ? colors.primary : colors.textDim} />
                        <Text className="font-bold text-sm" style={{ color: selectedManager ? colors.textMain : colors.textDim }}>
                          {selectedManager?.full_name ?? 'No manager assigned'}
                        </Text>
                      </View>
                      <FontAwesome name={showManagerDrop ? 'chevron-up' : 'chevron-down'} size={11} color={colors.textDim} />
                    </TouchableOpacity>
                  </View>

                  {/* Description */}
                  <View>
                    <Text className="text-[10px] font-black uppercase tracking-widest mb-2.5 ml-1" style={{ color: colors.textMuted }}>Description</Text>
                    <TextInput
                      value={description}
                      onChangeText={setDescription}
                      placeholder="Task details and context..."
                      placeholderTextColor={colors.textDim}
                      multiline
                      numberOfLines={5}
                      textAlignVertical="top"
                      className="rounded-2xl px-6 py-4 font-medium"
                      style={{ minHeight: 120, backgroundColor: colors.background, color: colors.textMain, borderWidth: 1, borderColor: colors.border }}
                    />
                  </View>

                  {/* Recurring */}
                  <TouchableOpacity
                    onPress={() => setIsRecurring(v => !v)}
                    className="flex-row items-center gap-4 p-4 rounded-2xl border transition-all"
                    style={{ borderColor: isRecurring ? colors.primary : colors.border, backgroundColor: isRecurring ? colors.primary + '0D' : colors.background }}
                  >
                    <View className="w-5 h-5 rounded-md items-center justify-center" style={{ backgroundColor: isRecurring ? colors.primary : colors.border + '40', borderWidth: isRecurring ? 0 : 1, borderColor: colors.border }}>
                      {isRecurring && <FontAwesome name="check" size={10} color="white" />}
                    </View>
                    <View>
                      <Text className="font-black text-sm" style={{ color: isRecurring ? colors.primary : colors.textMain }}>Recurring Task</Text>
                      <Text className="text-[10px] font-bold mt-0.5" style={{ color: colors.textMuted }}>Task will repeat automatically on a schedule</Text>
                    </View>
                  </TouchableOpacity>

                </View>
              ) : (
                <View className="gap-6 pb-8">

                  {/* Start Date */}
                  <View>
                    <Text className="text-[10px] font-black uppercase tracking-widest mb-2.5 ml-1" style={{ color: colors.textMuted }}>Start Date</Text>
                    <View className="flex-row gap-3 flex-wrap mb-3">
                      {[{ label: 'Today', days: 0 }, { label: 'Tomorrow', days: 1 }, { label: '+3d', days: 3 }].map(qd => (
                        <TouchableOpacity
                          key={qd.days}
                          onPress={() => setStartDate(quickDate(qd.days))}
                          className="px-3 py-1.5 rounded-xl hover:border-brand-primary hover:bg-brand-primary/5 transition-all"
                          style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}
                        >
                          <Text className="text-[10px] font-black uppercase tracking-wider" style={{ color: colors.textMuted }}>{qd.label}</Text>
                        </TouchableOpacity>
                      ))}
                      {startDate && (
                        <TouchableOpacity
                          onPress={() => setStartDate(null)}
                          className="px-3 py-1.5 rounded-xl hover:bg-state-danger/10 transition-all"
                          style={{ backgroundColor: colors.danger + '0D', borderWidth: 1, borderColor: colors.danger + '4D' }}
                        >
                          <Text className="text-[10px] font-black uppercase tracking-wider" style={{ color: colors.danger }}>Clear</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <TouchableOpacity
                      ref={startCalPos.triggerRef}
                      onPress={() => {
                        if (showStartCal) { closeAllOverlays(); return; }
                        closeAllOverlays();
                        startCalPos.measure();
                        setShowStartCal(true);
                      }}
                      className="rounded-2xl px-5 py-4 flex-row items-center justify-between transition-all"
                      style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: showStartCal ? colors.primary : dateConflict ? colors.danger + '80' : colors.border }}
                    >
                      <View className="flex-row items-center gap-3">
                        <FontAwesome name="calendar-o" size={13} color={startDate ? colors.primary : colors.textDim} />
                        <Text className="font-bold" style={{ color: startDate ? colors.textMain : colors.textDim }}>
                          {fmtDate(startDate) !== '—' ? fmtDate(startDate) : 'Set start'}
                        </Text>
                      </View>
                      <FontAwesome name={showStartCal ? 'chevron-up' : 'chevron-down'} size={11} color={colors.textDim} />
                    </TouchableOpacity>
                    {dateConflict && (
                      <Text className="text-[10px] font-black mt-1.5 ml-1" style={{ color: colors.danger }}>Start date is after due date</Text>
                    )}
                  </View>

                  {/* Due Date */}
                  <View>
                    <Text className="text-[10px] font-black uppercase tracking-widest mb-2.5 ml-1" style={{ color: colors.textMuted }}>Due Date</Text>
                    <View className="flex-row gap-3 flex-wrap mb-3">
                      {QUICK_DATES.map(qd => (
                        <TouchableOpacity
                          key={qd.days}
                          onPress={() => setDueDate(quickDate(qd.days))}
                          className="px-3 py-1.5 rounded-xl hover:border-brand-primary hover:bg-brand-primary/5 transition-all"
                          style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}
                        >
                          <Text className="text-[10px] font-black uppercase tracking-wider" style={{ color: colors.textMuted }}>{qd.label}</Text>
                        </TouchableOpacity>
                      ))}
                      {dueDate && (
                        <TouchableOpacity
                          onPress={() => setDueDate(null)}
                          className="px-3 py-1.5 rounded-xl hover:bg-state-danger/10 transition-all"
                          style={{ backgroundColor: colors.danger + '0D', borderWidth: 1, borderColor: colors.danger + '4D' }}
                        >
                          <Text className="text-[10px] font-black uppercase tracking-wider" style={{ color: colors.danger }}>Clear</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <TouchableOpacity
                      ref={dueCalPos.triggerRef}
                      onPress={() => {
                        if (showDueCal) { closeAllOverlays(); return; }
                        closeAllOverlays();
                        dueCalPos.measure();
                        setShowDueCal(true);
                      }}
                      className="rounded-2xl px-5 py-4 flex-row items-center justify-between transition-all"
                      style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: showDueCal ? colors.primary : colors.border }}
                    >
                      <View className="flex-row items-center gap-3">
                        <FontAwesome name="calendar" size={13} color={dueDate ? colors.primary : colors.textDim} />
                        <Text className="font-bold" style={{ color: dueDate ? colors.textMain : colors.textDim }}>
                          {fmtDate(dueDate) !== '—' ? fmtDate(dueDate) : 'Set deadline'}
                        </Text>
                      </View>
                      <FontAwesome name={showDueCal ? 'chevron-up' : 'chevron-down'} size={11} color={colors.textDim} />
                    </TouchableOpacity>
                  </View>

                  {/* Estimated Hours */}
                  <View>
                    <Text className="text-[10px] font-black uppercase tracking-widest mb-2.5 ml-1" style={{ color: colors.textMuted }}>Estimated Hours</Text>
                    <View className="flex-row gap-2 flex-wrap mb-3">
                      {HOUR_PRESETS.map(h => (
                        <TouchableOpacity
                          key={h}
                          onPress={() => setEstimatedHours(h.toString())}
                          className={`px-3 py-1.5 rounded-xl border transition-all ${estimatedHours === h.toString() ? '' : 'hover:border-brand-primary/50'}`}
                          style={{ backgroundColor: estimatedHours === h.toString() ? colors.primary : colors.background, borderColor: estimatedHours === h.toString() ? colors.primary : colors.border }}
                        >
                          <Text className="text-[10px] font-black uppercase tracking-wider" style={{ color: estimatedHours === h.toString() ? '#fff' : colors.textMuted }}>{h}h</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TextInput
                      value={estimatedHours}
                      onChangeText={setEstimatedHours}
                      keyboardType="decimal-pad"
                      placeholder="Custom (e.g. 6.5)"
                      placeholderTextColor={colors.textDim}
                      className="rounded-2xl px-5 py-4 font-bold"
                      style={{ backgroundColor: colors.background, color: colors.textMain, borderWidth: 1, borderColor: colors.border }}
                    />
                  </View>

                </View>
              )}
            </ScrollView>

            {/* Footer */}
            <View className={isNarrow ? 'px-5 py-4 flex-row items-center justify-between' : 'px-10 py-5 flex-row items-center justify-between'} style={{ borderTopWidth: 1, borderColor: colors.border + '80', backgroundColor: colors.background + '4D' }}>
              {!isNarrow && (
                <Text className="text-[10px] font-bold" style={{ color: colors.textMuted }}>
                  {saving ? 'Saving changes...' : 'Press Ctrl+↵ to save'}
                </Text>
              )}
              <View className={isNarrow ? 'flex-1 flex-row items-center gap-3' : 'flex-row items-center gap-4'}>
                <TouchableOpacity
                  onPress={onClose}
                  disabled={saving}
                  className={isNarrow ? 'flex-1 px-4 py-3 rounded-2xl items-center hover:border-brand-primary/40 transition-all' : 'px-6 py-3 rounded-2xl hover:border-brand-primary/40 transition-all'}
                  style={{ borderWidth: 1, borderColor: colors.border }}
                >
                  <Text className="font-bold" style={{ color: colors.textMain }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSave}
                  disabled={saving || !title.trim()}
                  className={isNarrow ? 'flex-1 px-4 py-3 rounded-2xl flex-row items-center justify-center gap-2.5 transition-all hover:bg-brand-primary/90' : 'px-8 py-3 rounded-2xl flex-row items-center gap-2.5 transition-all hover:bg-brand-primary/90'}
                  style={{ backgroundColor: !title.trim() ? colors.primary + '4D' : colors.primary }}
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
    </Popup>
  );
}
