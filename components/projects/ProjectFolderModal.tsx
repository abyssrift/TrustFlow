import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';

interface ProjectFolderModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  project?: {
    id: string;
    name: string;
    description: string;
    expiry_date: string | null;
    status: 'active' | 'closed' | 'archived';
    color: string;
  };
}

export default function ProjectFolderModal({
  visible,
  onClose,
  onSuccess,
  project,
}: ProjectFolderModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [status, setStatus] = useState<'active' | 'closed' | 'archived'>('active');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (project) {
      setName(project.name);
      setDescription(project.description || '');
      setExpiryDate(project.expiry_date ? new Date(project.expiry_date).toISOString().split('T')[0] : '');
      setStatus(project.status || 'active');
    } else {
      setName('');
      setDescription('');
      setExpiryDate('');
      setStatus('active');
    }
  }, [project, visible]);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Project name is required');
      return;
    }

    try {
      setLoading(true);
      const projectData = {
        name: name.trim(),
        description: description.trim(),
        expiry_date: expiryDate ? new Date(expiryDate).toISOString() : null,
        status: status,
        updated_at: new Date().toISOString(),
      };

      let error;
      if (project) {
        ({ error } = await supabase
          .from('projects')
          .update(projectData)
          .eq('id', project.id));
      } else {
        const { data: userData } = await supabase.auth.getUser();
        ({ error } = await supabase.from('projects').insert([
          {
            ...projectData,
            company_id: (await supabase.rpc('my_company_id')).data,
            created_by: userData.user?.id,
          },
        ]));
      }

      if (error) throw error;

      Alert.alert('Success', `Project ${project ? 'updated' : 'created'} successfully`);
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error saving project:', err);
      Alert.alert('Error', err.message || 'Failed to save project');
    } finally {
      setLoading(false);
    }
  };

  const statusOptions: { value: typeof status; label: string; icon: string }[] = [
    { value: 'active', label: 'Active', icon: 'play-circle' },
    { value: 'closed', label: 'Closed', icon: 'check-circle' },
    { value: 'archived', label: 'Archived', icon: 'archive' },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View className="flex-1 bg-surface-background">
        {/* Header */}
        <View className="px-6 py-4 border-b border-surface-border flex-row items-center justify-between mt-8">
          <Text className="text-typography-main text-xl font-bold">
            {project ? 'Edit Project' : 'New Project'}
          </Text>
          <TouchableOpacity onPress={onClose} className="p-2">
            <FontAwesome name="close" size={20} color="#94a3b8" />
          </TouchableOpacity>
        </View>

        {/* Form Content */}
        <ScrollView className="flex-1 px-6 pt-6">
          <View className="mb-6">
            <Text className="text-typography-muted text-xs font-bold uppercase mb-2 tracking-widest">
              Folder Name
            </Text>
            <TextInput
              className="bg-surface-card border border-surface-border p-4 rounded-xl text-typography-main"
              placeholder="e.g. Q4 Marketing Campaign"
              placeholderTextColor="#64748b"
              value={name}
              onChangeText={setName}
            />
          </View>

          <View className="mb-6">
            <Text className="text-typography-muted text-xs font-bold uppercase mb-2 tracking-widest">
              Description
            </Text>
            <TextInput
              className="bg-surface-card border border-surface-border p-4 rounded-xl text-typography-main"
              placeholder="What is this project about?"
              placeholderTextColor="#64748b"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              value={description}
              onChangeText={setDescription}
            />
          </View>

          <View className="mb-6">
            <Text className="text-typography-muted text-xs font-bold uppercase mb-2 tracking-widest">
              Expiry Date (Optional)
            </Text>
            <TextInput
              className="bg-surface-card border border-surface-border p-4 rounded-xl text-typography-main"
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#64748b"
              value={expiryDate}
              onChangeText={setExpiryDate}
            />
            <Text className="text-typography-muted text-[10px] mt-2">
              Leave blank if the project has no set deadline.
            </Text>
          </View>

          <View className="mb-10">
            <Text className="text-typography-muted text-xs font-bold uppercase mb-3 tracking-widest">
              Project Status
            </Text>
            <View className="flex-row justify-between">
              {statusOptions.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  onPress={() => setStatus(option.value)}
                  className={`flex-1 mx-1 p-3 rounded-xl border items-center ${
                    status === option.value
                      ? 'bg-brand-primary/20 border-brand-primary'
                      : 'bg-surface-card border-surface-border/50'
                  }`}
                >
                  <FontAwesome 
                    name={option.icon as any} 
                    size={16} 
                    color={status === option.value ? '#818cf8' : '#64748b'} 
                    style={{ marginBottom: 4 }}
                  />
                  <Text 
                    className={`text-[10px] font-bold ${
                      status === option.value ? 'text-brand-primary' : 'text-typography-muted'
                    }`}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>

        {/* Footer */}
        <View className="px-6 py-6 border-t border-surface-border flex-row gap-4">
          <TouchableOpacity
            onPress={onClose}
            className="flex-1 py-4 items-center justify-center rounded-xl border border-brand-primary"
          >
            <Text className="text-brand-primary font-bold">Cancel</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleSave}
            disabled={loading}
            className={`flex-1 py-4 items-center justify-center rounded-xl bg-brand-primary ${
              loading ? 'bg-brand-primary/50' : ''
            }`}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-bold">
                {project ? 'Update Project' : 'Create Project'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
