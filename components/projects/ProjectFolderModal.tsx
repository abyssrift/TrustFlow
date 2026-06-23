import ConfirmModal from '@/components/common/ConfirmModal';
import PremiumCalendarPicker from '@/components/common/PremiumCalendarPicker';
import DraggableSheet from '@/components/common/DraggableSheet';
import { useThemeColors } from '@/hooks/useThemeColors';
import { PROJECT_STATUS_OPTIONS, useProjectFolderForm } from '@/lib/useProjectFolderForm';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import {
    ActivityIndicator,
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';

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
  };
}

export default function ProjectFolderModal({
  visible,
  onClose,
  onSuccess,
  project,
}: ProjectFolderModalProps) {
  const colors = useThemeColors();
  const {
    name, setName,
    description, setDescription,
    expiryDate, setExpiryDate,
    status, setStatus,
    loading,
    showArchiveConfirm, setShowArchiveConfirm,
    showCalendar, setShowCalendar,
    handleSave, handleArchiveProject,
  } = useProjectFolderForm({ visible, project, onSuccess, onClose });

  const body = (
      <View className="flex-1 bg-surface-background">
        {/* Header */}
        <View className="px-6 py-4 border-b border-surface-border flex-row items-center justify-between">
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
            <View className="flex-row gap-2 mb-2">
              <TouchableOpacity
                onPress={() => setShowCalendar(!showCalendar)}
                className="flex-1 bg-surface-card border border-surface-border p-4 rounded-xl flex-row items-center justify-between"
              >
                <Text className={expiryDate ? 'text-typography-main font-medium' : 'text-typography-muted'}>
                  {expiryDate ? new Date(expiryDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'No expiry date set'}
                </Text>
                <FontAwesome name="calendar" size={14} color="#64748b" />
              </TouchableOpacity>
              {expiryDate && (
                <TouchableOpacity
                  onPress={() => { setExpiryDate(null); setShowCalendar(false); }}
                  className="w-14 bg-surface-card border border-surface-border rounded-xl items-center justify-center"
                >
                  <FontAwesome name="times" size={14} color="#64748b" />
                </TouchableOpacity>
              )}
            </View>
            {showCalendar && (
              <PremiumCalendarPicker
                selectedDate={expiryDate}
                onSelect={(date) => { setExpiryDate(date); setShowCalendar(false); }}
                compact
              />
            )}
          </View>

          <View className="mb-10">
            <Text className="text-typography-muted text-xs font-bold uppercase mb-3 tracking-widest">
              Project Status
            </Text>
            <View className="flex-row justify-between">
              {PROJECT_STATUS_OPTIONS.map((option) => (
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

          {project && (
            <TouchableOpacity
              onPress={() => setShowArchiveConfirm(true)}
              className="mt-6 bg-state-danger/5 border border-state-danger/20 p-5 rounded-2xl flex-row items-center justify-between"
            >
              <View className="flex-1 mr-4">
                <Text className="text-state-danger font-black text-sm uppercase tracking-widest mb-1">Cold Storage</Text>
                <Text className="text-state-danger/60 text-[10px] font-medium leading-relaxed">
                  Recursively snapshots all project tasks and telemetry before removal from the active database.
                </Text>
              </View>
              <View className="w-10 h-10 bg-state-danger/10 rounded-full items-center justify-center">
                <FontAwesome name="archive" size={16} color={colors.danger} />
              </View>
            </TouchableOpacity>
          )}

          <View className="h-20" />
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
  );

  return (
    <>
      <DraggableSheet
        visible={visible}
        onClose={onClose}
        dimBackdrop
        maxHeight="92%"
        containerStyle={{ height: '92%' }}
        containerClassName="bg-surface-background rounded-t-[2rem] border-t border-surface-border overflow-hidden"
      >
        {body}
      </DraggableSheet>
      <ConfirmModal
        visible={showArchiveConfirm}
        onCancel={() => setShowArchiveConfirm(false)}
        onConfirm={handleArchiveProject}
        title="Project Snapshot Confirmation"
        description={`Are you certain you want to move "${project?.name}" to Cold Storage? This will snapshot all historical data and recursive child tasks. This action ensures data integrity but removes the project from the active pipeline.`}
        confirmLabel={loading ? 'Snapshotting...' : 'Confirm Archival'}
        variant="danger"
        loading={loading}
      />
    </>
  );
}
