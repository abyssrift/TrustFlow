import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, Modal, ScrollView, Platform } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useTaskDetail } from '@/contexts/TaskDetailContext';
import { Picker } from '@react-native-picker/picker';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function EditTaskModal({ visible, onClose }: Props) {
  const { data, updateTask } = useTaskDetail();
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [category, setCategory] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [weight, setWeight] = useState('1');
  const [isRecurring, setIsRecurring] = useState(false);
  
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.task && visible) {
      setTitle(data.task.title || '');
      setDescription(data.task.description || '');
      setPriority(data.task.priority || 'medium');
      setCategory(data.task.category || '');
      // Simplistic date format parsing for input if exists
      setDueDate(data.task.due_date ? new Date(data.task.due_date).toISOString().split('T')[0] : '');
      setWeight(data.task.weight?.toString() || '1');
      setIsRecurring(!!data.task.is_recurring);
      setError(null);
    }
  }, [data, visible]);

  if (!data) return null;

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
        weight: parseInt(weight, 10) || 1,
        is_recurring: isRecurring,
      };
      
      await updateTask(updates);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update task.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View className="flex-1 bg-black/60 justify-center items-center p-4 sm:p-8">
        <View className="bg-surface-card w-full max-w-lg rounded-3xl overflow-hidden border border-surface-border">
          {/* Header */}
          <View className="flex-row items-center justify-between p-5 border-b border-surface-border/50">
            <Text className="text-typography-main text-lg font-black">Edit Task</Text>
            <TouchableOpacity onPress={onClose} className="p-2 rounded-full bg-surface-background">
              <FontAwesome name="times" size={16} color="rgb(var(--text-muted))" />
            </TouchableOpacity>
          </View>
          
          <ScrollView className="p-6 max-h-[60vh]">
            {error && (
              <View className="bg-state-danger/10 border border-state-danger/30 p-3 rounded-xl mb-4">
                <Text className="text-state-danger text-sm font-bold">{error}</Text>
              </View>
            )}
            
            <View className="gap-5 pb-8">
              <View>
                <Text className="text-typography-muted text-xs font-bold uppercase tracking-wider mb-2">Title</Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Task title"
                  placeholderTextColor="rgb(var(--text-muted))"
                  className="bg-surface-background border border-surface-border text-typography-main px-4 py-3 rounded-xl font-medium"
                />
              </View>
              
              <View>
                <Text className="text-typography-muted text-xs font-bold uppercase tracking-wider mb-2">Description</Text>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Details about this task..."
                  placeholderTextColor="rgb(var(--text-muted))"
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  className="bg-surface-background border border-surface-border text-typography-main px-4 py-3 rounded-xl font-medium min-h-[100px]"
                />
              </View>

              <View className="flex-row gap-4">
                <View className="flex-1">
                  <Text className="text-typography-muted text-xs font-bold uppercase tracking-wider mb-2">Priority</Text>
                  <View className="bg-surface-background border border-surface-border rounded-xl overflow-hidden h-12 justify-center">
                    <Picker
                      selectedValue={priority}
                      onValueChange={setPriority}
                      style={{ color: 'rgb(var(--text-main))', ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }) } as any}
                      dropdownIconColor="rgb(var(--text-muted))"
                    >
                      <Picker.Item label="Urgent" value="urgent" />
                      <Picker.Item label="High" value="high" />
                      <Picker.Item label="Normal" value="medium" />
                      <Picker.Item label="Low" value="low" />
                    </Picker>
                  </View>
                </View>

                <View className="flex-1">
                  <Text className="text-typography-muted text-xs font-bold uppercase tracking-wider mb-2">Category</Text>
                  <TextInput
                    value={category}
                    onChangeText={setCategory}
                    placeholder="e.g. Bug, Feature"
                    placeholderTextColor="rgb(var(--text-muted))"
                    className="bg-surface-background border border-surface-border text-typography-main px-4 py-3 rounded-xl font-medium h-12"
                  />
                </View>
              </View>

              <View className="flex-row gap-4">
                <View className="flex-1">
                  <Text className="text-typography-muted text-xs font-bold uppercase tracking-wider mb-2">Due Date</Text>
                  <TextInput
                    value={dueDate}
                    onChangeText={setDueDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="rgb(var(--text-muted))"
                    className="bg-surface-background border border-surface-border text-typography-main px-4 py-3 rounded-xl font-medium h-12"
                  />
                </View>

                <View className="flex-1">
                  <Text className="text-typography-muted text-xs font-bold uppercase tracking-wider mb-2">Weight</Text>
                  <TextInput
                    value={weight}
                    onChangeText={setWeight}
                    keyboardType="numeric"
                    placeholder="1"
                    placeholderTextColor="rgb(var(--text-muted))"
                    className="bg-surface-background border border-surface-border text-typography-main px-4 py-3 rounded-xl font-medium h-12"
                  />
                </View>
              </View>
              
              <TouchableOpacity
                onPress={() => setIsRecurring(!isRecurring)}
                className="flex-row items-center mt-2"
              >
                <View className={`w-5 h-5 rounded flex items-center justify-center mr-3 ${isRecurring ? 'bg-brand-primary' : 'bg-surface-background border border-surface-border'}`}>
                  {isRecurring && <FontAwesome name="check" size={10} color="white" />}
                </View>
                <Text className="text-typography-main font-medium">Recurring Task</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

          {/* Footer */}
          <View className="p-5 border-t border-surface-border/50 flex-row justify-end gap-3 bg-surface-background/50">
            <TouchableOpacity 
              onPress={onClose} 
              disabled={saving}
              className="px-5 py-3 rounded-xl border border-surface-border active:opacity-75"
            >
              <Text className="text-typography-main font-bold">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={handleSave}
              disabled={saving}
              className="px-6 py-3 rounded-xl bg-brand-primary flex-row items-center active:opacity-75"
            >
              {saving ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Text className="text-white font-black">Save Changes</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
