import ConfirmModal from '@/components/common/ConfirmModal';
import PremiumCalendarPicker from '@/components/common/PremiumCalendarPicker';
import { useThemeColors } from '@/hooks/useThemeColors';
import { PROJECT_STATUS_OPTIONS, useProjectFolderForm } from '@/lib/useProjectFolderForm';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import {
    ActivityIndicator,
    Modal,
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
  const c = useThemeColors();
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

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)', padding: 24 }}>
          <View
            className="w-full rounded-3xl overflow-hidden"
            style={{ maxWidth: 560, maxHeight: '90%', backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}
          >
            {/* Header */}
            <View className="px-6 py-5 flex-row items-center justify-between" style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
              <Text style={{ color: c.textMain }} className="text-xl font-bold">
                {project ? 'Edit Project' : 'New Project'}
              </Text>
              <TouchableOpacity onPress={onClose} className="p-2">
                <FontAwesome name="close" size={20} color={c.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Form Content */}
            <ScrollView className="px-6" contentContainerStyle={{ paddingTop: 24, paddingBottom: 8 }}>
              <View className="mb-6">
                <Text style={{ color: c.textMuted }} className="text-xs font-bold uppercase mb-2 tracking-widest">
                  Folder Name
                </Text>
                <TextInput
                  style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border, color: c.textMain }}
                  className="p-4 rounded-xl"
                  placeholder="e.g. Q4 Marketing Campaign"
                  placeholderTextColor={c.textDim}
                  value={name}
                  onChangeText={setName}
                />
              </View>

              <View className="mb-6">
                <Text style={{ color: c.textMuted }} className="text-xs font-bold uppercase mb-2 tracking-widest">
                  Description
                </Text>
                <TextInput
                  style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border, color: c.textMain }}
                  className="p-4 rounded-xl"
                  placeholder="What is this project about?"
                  placeholderTextColor={c.textDim}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  value={description}
                  onChangeText={setDescription}
                />
              </View>

              <View className="mb-6">
                <Text style={{ color: c.textMuted }} className="text-xs font-bold uppercase mb-2 tracking-widest">
                  Expiry Date (Optional)
                </Text>
                <View className="flex-row gap-2 mb-2">
                  <TouchableOpacity
                    onPress={() => setShowCalendar(!showCalendar)}
                    className="flex-1 p-4 rounded-xl flex-row items-center justify-between"
                    style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
                  >
                    <Text style={{ color: expiryDate ? c.textMain : c.textMuted, fontWeight: expiryDate ? '500' : '400' }}>
                      {expiryDate ? new Date(expiryDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'No expiry date set'}
                    </Text>
                    <FontAwesome name="calendar" size={14} color={c.textDim} />
                  </TouchableOpacity>
                  {expiryDate && (
                    <TouchableOpacity
                      onPress={() => { setExpiryDate(null); setShowCalendar(false); }}
                      className="w-14 rounded-xl items-center justify-center"
                      style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
                    >
                      <FontAwesome name="times" size={14} color={c.textDim} />
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
                <Text style={{ color: c.textMuted }} className="text-xs font-bold uppercase mb-3 tracking-widest">
                  Project Status
                </Text>
                <View className="flex-row justify-between">
                  {PROJECT_STATUS_OPTIONS.map((option) => {
                    const active = status === option.value;
                    return (
                      <TouchableOpacity
                        key={option.value}
                        onPress={() => setStatus(option.value)}
                        className="flex-1 mx-1 p-3 rounded-xl items-center"
                        style={{
                          backgroundColor: active ? c.primary + '33' : c.background,
                          borderWidth: 1,
                          borderColor: active ? c.primary : c.border + '80',
                        }}
                      >
                        <FontAwesome
                          name={option.icon as any}
                          size={16}
                          color={active ? c.primary : c.textDim}
                          style={{ marginBottom: 4 }}
                        />
                        <Text style={{ color: active ? c.primary : c.textMuted }} className="text-[10px] font-bold">
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {project && (
                <TouchableOpacity
                  onPress={() => setShowArchiveConfirm(true)}
                  className="mt-6 p-5 rounded-2xl flex-row items-center justify-between"
                  style={{ backgroundColor: c.danger + '0D', borderWidth: 1, borderColor: c.danger + '33' }}
                >
                  <View className="flex-1 mr-4">
                    <Text style={{ color: c.danger }} className="font-black text-sm uppercase tracking-widest mb-1">Cold Storage</Text>
                    <Text style={{ color: c.danger + '99' }} className="text-[10px] font-medium leading-relaxed">
                      Recursively snapshots all project tasks and telemetry before removal from the active database.
                    </Text>
                  </View>
                  <View className="w-10 h-10 rounded-full items-center justify-center" style={{ backgroundColor: c.danger + '1A' }}>
                    <FontAwesome name="archive" size={16} color={c.danger} />
                  </View>
                </TouchableOpacity>
              )}
            </ScrollView>

            {/* Footer */}
            <View className="px-6 py-6 flex-row gap-4" style={{ borderTopWidth: 1, borderTopColor: c.border }}>
              <TouchableOpacity
                onPress={onClose}
                className="flex-1 py-4 items-center justify-center rounded-xl"
                style={{ borderWidth: 1, borderColor: c.primary }}
              >
                <Text style={{ color: c.primary }} className="font-bold">Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleSave}
                disabled={loading}
                className="flex-1 py-4 items-center justify-center rounded-xl"
                style={{ backgroundColor: loading ? c.primary + '80' : c.primary }}
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
        </View>
      </Modal>
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
