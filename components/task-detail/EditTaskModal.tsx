import DraggableSheet from '@/components/common/DraggableSheet';
import PremiumCalendarPicker from '@/components/common/PremiumCalendarPicker';
import { useTaskDetail } from '@/contexts/TaskDetailContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

type Props = {
  visible: boolean;
  onClose: () => void;
};

type UserOption = { id: string; full_name: string };

const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'] as const;
const PRIORITY_LABELS: Record<string, string> = { low: 'Low', medium: 'Normal', high: 'High', urgent: 'Urgent' };

export default function EditTaskModal({ visible, onClose }: Props) {
  const colors = useThemeColors();
  const { data, updateTask } = useTaskDetail();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [category, setCategory] = useState('');
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [weight, setWeight] = useState('1');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [managerId, setManagerId] = useState<string | null>(null);

  const [showDueCalendar, setShowDueCalendar] = useState(false);
  const [showStartCalendar, setShowStartCalendar] = useState(false);
  const [showManagerPicker, setShowManagerPicker] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.task && visible) {
      setTitle(data.task.title || '');
      setDescription(data.task.description || '');
      setPriority(data.task.priority || 'medium');
      setCategory(data.task.category || '');
      setDueDate(data.task.due_date ? new Date(data.task.due_date).toISOString().split('T')[0] : null);
      setWeight(data.task.weight?.toString() || '1');
      setIsRecurring(!!data.task.is_recurring);
      setManagerId((data as any).task.manager_id || null);
      const rawStart = (data as any).task.start_date;
      setStartDate(rawStart ? new Date(rawStart).toISOString().split('T')[0] : null);
      const rawHours = (data as any).task.estimated_hours;
      setEstimatedHours(rawHours?.toString() || '');
      setShowDueCalendar(false);
      setShowStartCalendar(false);
      setShowManagerPicker(false);
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

  const selectedManager = users.find(u => u.id === managerId);

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
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

  const formatDate = (d: string | null) =>
    d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;

  return (
    <DraggableSheet
      visible={visible}
      onClose={onClose}
      dimBackdrop
      maxHeight="92%"
      containerClassName="bg-surface-card rounded-t-3xl border-t border-surface-border overflow-hidden"
    >
          {/* Header */}
          <View className="flex-row items-center justify-between px-6 pt-5 pb-4 border-b border-surface-border/50">
            <View>
              <Text className="text-typography-muted text-[9px] font-black uppercase tracking-[0.2em]">Modify Task</Text>
              <Text className="text-typography-main text-xl font-black tracking-tight mt-0.5">Edit Details</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              className="w-9 h-9 items-center justify-center rounded-full bg-surface-background border border-surface-border"
            >
              <FontAwesome name="times" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView
            className="px-6 pt-5"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View className="gap-6 pb-10">

              {error && (
                <View className="bg-state-danger/10 border border-state-danger/30 p-3 rounded-2xl">
                  <Text className="text-state-danger text-sm font-bold">{error}</Text>
                </View>
              )}

              {/* Title */}
              <View>
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em] mb-2">Title</Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Task title"
                  placeholderTextColor={colors.textDim}
                  className="bg-surface-background border border-surface-border text-typography-main px-4 py-3.5 rounded-2xl font-medium text-base"
                />
              </View>

              {/* Category */}
              <View>
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em] mb-2">Category</Text>
                <TextInput
                  value={category}
                  onChangeText={setCategory}
                  placeholder="e.g. Bug, Feature, Research"
                  placeholderTextColor={colors.textDim}
                  className="bg-surface-background border border-surface-border text-typography-main px-4 py-3.5 rounded-2xl font-medium"
                />
              </View>

              {/* Description */}
              <View>
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em] mb-2">Description</Text>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Details about this task..."
                  placeholderTextColor={colors.textDim}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  className="bg-surface-background border border-surface-border text-typography-main px-4 py-3.5 rounded-2xl font-medium"
                  style={{ minHeight: 100 }}
                />
              </View>

              {/* Priority */}
              <View>
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em] mb-3">Priority</Text>
                <View className="flex-row flex-wrap gap-2">
                  {PRIORITY_OPTIONS.map(p => (
                    <TouchableOpacity
                      key={p}
                      onPress={() => setPriority(p)}
                      className={`px-5 py-2.5 rounded-full border ${
                        priority === p ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
                      }`}
                    >
                      <Text className={`font-black text-[10px] uppercase tracking-widest ${
                        priority === p ? 'text-white' : 'text-typography-muted'
                      }`}>
                        {PRIORITY_LABELS[p]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Dates */}
              <View className="flex-row gap-4">
                {/* Due Date */}
                <View className="flex-1">
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em] mb-2">Due Date</Text>
                  <View className="flex-row gap-2">
                    <TouchableOpacity
                      onPress={() => { setShowDueCalendar(v => !v); setShowStartCalendar(false); }}
                      className="flex-1 bg-surface-background border border-surface-border px-3 py-3 rounded-2xl flex-row items-center justify-between"
                    >
                      <Text className={`font-medium text-sm ${dueDate ? 'text-typography-main' : 'text-typography-muted'}`}>
                        {formatDate(dueDate) ?? 'Set date'}
                      </Text>
                      <FontAwesome name="calendar" size={11} color={dueDate ? colors.primary : colors.textMuted} />
                    </TouchableOpacity>
                    {dueDate && (
                      <TouchableOpacity
                        onPress={() => { setDueDate(null); setShowDueCalendar(false); }}
                        className="w-11 h-11 bg-surface-background border border-surface-border rounded-2xl items-center justify-center"
                      >
                        <FontAwesome name="times" size={11} color={colors.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>
                  {showDueCalendar && (
                    <View className="mt-2">
                      <PremiumCalendarPicker
                        selectedDate={dueDate}
                        onSelect={(d) => { setDueDate(d); setShowDueCalendar(false); }}
                        compact
                      />
                    </View>
                  )}
                </View>

                {/* Start Date */}
                <View className="flex-1">
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em] mb-2">Start Date</Text>
                  <View className="flex-row gap-2">
                    <TouchableOpacity
                      onPress={() => { setShowStartCalendar(v => !v); setShowDueCalendar(false); }}
                      className="flex-1 bg-surface-background border border-surface-border px-3 py-3 rounded-2xl flex-row items-center justify-between"
                    >
                      <Text className={`font-medium text-sm ${startDate ? 'text-typography-main' : 'text-typography-muted'}`}>
                        {formatDate(startDate) ?? 'Set date'}
                      </Text>
                      <FontAwesome name="calendar-o" size={11} color={startDate ? colors.primary : colors.textMuted} />
                    </TouchableOpacity>
                    {startDate && (
                      <TouchableOpacity
                        onPress={() => { setStartDate(null); setShowStartCalendar(false); }}
                        className="w-11 h-11 bg-surface-background border border-surface-border rounded-2xl items-center justify-center"
                      >
                        <FontAwesome name="times" size={11} color={colors.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>
                  {showStartCalendar && (
                    <View className="mt-2">
                      <PremiumCalendarPicker
                        selectedDate={startDate}
                        onSelect={(d) => { setStartDate(d); setShowStartCalendar(false); }}
                        compact
                      />
                    </View>
                  )}
                </View>
              </View>

              {/* Weight & Estimated Hours */}
              <View className="flex-row gap-4">
                <View className="flex-1">
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em] mb-2">Weight</Text>
                  <TextInput
                    value={weight}
                    onChangeText={setWeight}
                    keyboardType="numeric"
                    placeholder="1"
                    placeholderTextColor={colors.textDim}
                    className="bg-surface-background border border-surface-border text-typography-main px-4 py-3.5 rounded-2xl font-medium"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em] mb-2">Est. Hours</Text>
                  <TextInput
                    value={estimatedHours}
                    onChangeText={setEstimatedHours}
                    keyboardType="decimal-pad"
                    placeholder="e.g. 4.5"
                    placeholderTextColor={colors.textDim}
                    className="bg-surface-background border border-surface-border text-typography-main px-4 py-3.5 rounded-2xl font-medium"
                  />
                </View>
              </View>

              {/* Manager */}
              <View>
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em] mb-2">Manager</Text>
                <TouchableOpacity
                  onPress={() => setShowManagerPicker(v => !v)}
                  className="bg-surface-background border border-surface-border px-4 py-3.5 rounded-2xl flex-row items-center justify-between"
                >
                  <Text className={`font-medium ${selectedManager ? 'text-typography-main' : 'text-typography-muted'}`}>
                    {selectedManager ? selectedManager.full_name : 'Select manager'}
                  </Text>
                  <FontAwesome name={showManagerPicker ? 'chevron-up' : 'chevron-down'} size={11} color={colors.textMuted} />
                </TouchableOpacity>

                {showManagerPicker && (
                  <View className="mt-2 bg-surface-background border border-surface-border rounded-2xl overflow-hidden" style={{ maxHeight: 200 }}>
                    <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                      <TouchableOpacity
                        onPress={() => { setManagerId(null); setShowManagerPicker(false); }}
                        className={`px-4 py-3 border-b border-surface-border/30 ${!managerId ? 'bg-brand-primary/10' : ''}`}
                      >
                        <Text className={`font-bold text-sm ${!managerId ? 'text-brand-primary' : 'text-typography-muted'}`}>No manager</Text>
                      </TouchableOpacity>
                      {users.map(u => (
                        <TouchableOpacity
                          key={u.id}
                          onPress={() => { setManagerId(u.id); setShowManagerPicker(false); }}
                          className={`px-4 py-3 border-b border-surface-border/30 ${managerId === u.id ? 'bg-brand-primary/10' : ''}`}
                        >
                          <Text className={`font-bold text-sm ${managerId === u.id ? 'text-brand-primary' : 'text-typography-main'}`}>
                            {u.full_name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>

              {/* Recurring */}
              <TouchableOpacity
                onPress={() => setIsRecurring(v => !v)}
                className="flex-row items-center gap-3"
              >
                <View className={`w-5 h-5 rounded items-center justify-center ${
                  isRecurring ? 'bg-brand-primary' : 'bg-surface-background border border-surface-border'
                }`}>
                  {isRecurring && <FontAwesome name="check" size={10} color="white" />}
                </View>
                <View>
                  <Text className="text-typography-main font-bold">Recurring Task</Text>
                  <Text className="text-typography-muted text-xs">This task repeats on a schedule</Text>
                </View>
              </TouchableOpacity>

            </View>
          </ScrollView>

          {/* Footer */}
          <View className="px-6 py-4 border-t border-surface-border/50 flex-row justify-end gap-3 bg-surface-background/50">
            <TouchableOpacity
              onPress={onClose}
              disabled={saving}
              className="px-5 py-3 rounded-2xl border border-surface-border active:opacity-75"
            >
              <Text className="text-typography-main font-bold">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              className="px-7 py-3 rounded-2xl bg-brand-primary flex-row items-center gap-2 active:opacity-75"
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
    </DraggableSheet>
  );
}
