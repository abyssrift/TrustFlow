import Popup from '@/components/common/Popup';
import ConfirmModal from '@/components/common/ConfirmModal';
import Calendar from '@/components/common/Calendar';
import Tooltip from '@/components/common/Tooltip';
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

  const nameMissing = !name.trim();

  return (
    <>
      <Popup
        visible={visible}
        onClose={onClose}
        dimBackdrop
        maxHeight="90%"
        presentation="auto"
        maxWidth={560}
        containerClassName="w-[95%] max-h-[90vh] rounded-3xl overflow-hidden premium-shadow"
      >
        <View
          className="w-full flex-1 rounded-3xl overflow-hidden"
          style={{ maxWidth: 560, backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}
        >
            {/* Header */}
            <View className="px-6 py-5 flex-row items-center justify-between" style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
              <Text style={{ color: c.textMain }} className="text-xl font-bold">
                {project ? 'Edit Project' : 'New Project'}
              </Text>
              <Tooltip label="Close">
                <TouchableOpacity onPress={onClose} className="p-2">
                  <FontAwesome name="times" size={20} color={c.textMuted} />
                </TouchableOpacity>
              </Tooltip>
            </View>

            {/* Form Content */}
            <ScrollView className="px-6" style={{ flexShrink: 1 }} contentContainerStyle={{ paddingTop: 24, paddingBottom: 8 }}>
              <View className="mb-6">
                <Text style={{ color: c.textMuted }} className="text-xs font-bold uppercase mb-2 tracking-widest">
                  Folder Name
                </Text>
                <TextInput
                  style={{ backgroundColor: c.background, borderWidth: 1, borderColor: nameMissing ? c.danger : c.border, color: c.textMain }}
                  className="p-4 rounded-xl"
                  placeholder="e.g. Q4 Marketing Campaign"
                  placeholderTextColor={c.textDim}
                  value={name}
                  onChangeText={setName}
                />
                {/* §19.1: this was a `showAlert('Error', 'Project name is
                    required')` fired on Save — a dialog that names the field,
                    then closes over the field it named. The rule is stated
                    where the fix is, and Save says why it is off. */}
                {nameMissing && (
                  <Text className="text-state-danger text-[11px] font-bold mt-2">
                    A project needs a name before it can be saved — type one above.
                  </Text>
                )}
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
                    <FontAwesome name="calendar-o" size={14} color={c.textDim} />
                  </TouchableOpacity>
                  {expiryDate && (
                    <Tooltip label="Clear date">
                      <TouchableOpacity
                        onPress={() => { setExpiryDate(null); setShowCalendar(false); }}
                        className="w-14 rounded-xl items-center justify-center"
                        style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
                      >
                        <FontAwesome name="times" size={14} color={c.textDim} />
                      </TouchableOpacity>
                    </Tooltip>
                  )}
                </View>
                {showCalendar && (
                  <Calendar
                    selectedDate={expiryDate}
                    onSelect={(date) => { setExpiryDate(date); setShowCalendar(false); }}
                    scale="compact"
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
                  {/* §17/§19.2 — "Cold Storage" and "telemetry ... removal from
                      the active database" describe an implementation, not what
                      happens to the user's work. Plain words for a destructive
                      action, and it says it is reversible, which it is
                      (rpc_restore_project). */}
                  <View className="flex-1 mr-4">
                    <Text style={{ color: c.danger }} className="font-black text-sm uppercase tracking-widest mb-1">Archive This Project</Text>
                    <Text style={{ color: c.danger + '99' }} className="text-[10px] font-medium leading-relaxed">
                      Takes the project and all its tasks out of the active list and keeps a full copy. You can restore it later from Archives.
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
                disabled={loading || nameMissing}
                className="flex-1 py-4 items-center justify-center rounded-xl"
                style={{ backgroundColor: loading || nameMissing ? c.primary + '80' : c.primary }}
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
      </Popup>
      <ConfirmModal
        visible={showArchiveConfirm}
        onCancel={() => setShowArchiveConfirm(false)}
        onConfirm={handleArchiveProject}
        title="Archive this project?"
        description={`"${project?.name}" and all of its tasks will leave the active list. A full copy is kept, and you can restore it from Archives at any time.`}
        confirmLabel={loading ? 'Archiving…' : 'Archive Project'}
        variant="danger"
        loading={loading}
      />
    </>
  );
}
