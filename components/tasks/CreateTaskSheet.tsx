import { useThemeColors } from '@/hooks/useThemeColors';
import { getPastedImageFile } from '@/lib/pasteImage';
import { FontAwesome } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DraggableSheet from '../common/DraggableSheet';
import ClipboardControls from '../common/ClipboardControls';
import PremiumCalendarPicker from '../common/PremiumCalendarPicker';
import { formatFileSize, getFileIcon } from '@/lib/taskFileHelpers';
import { useCreateTaskWizard } from '@/lib/useCreateTaskWizard';

// ─── Adaptive File Grid ───────────────────────────────────────────────────────

function AdaptiveFileGrid({
  files,
  onRemove,
  isUploading = false
}: {
  files: any[];
  onRemove: (id: string) => void;
  isUploading?: boolean;
}) {
  const [containerWidth, setContainerWidth] = useState(0);
  const colors = useThemeColors();

  const gap = 12;
  const minSquareSize = 90; // Slightly smaller for inline forms

  // Fallback width before layout calculation fires
  const availableWidth = containerWidth > 0 ? containerWidth : 300;

  let numCols = Math.floor((availableWidth + gap) / (minSquareSize + gap));
  if (numCols < 2) numCols = 2;
  const exactSquareSize = Math.floor((availableWidth - (gap * (numCols - 1))) / numCols);

  if (files.length === 0) return null;

  return (
    <View
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      className="flex-row flex-wrap w-full bg-surface-background border border-surface-border rounded-xl p-3 mb-3"
      style={{ gap }}
    >
      {files.map((pf) => {
        const isImage = pf.type?.toLowerCase().includes('image');
        const { name: icon, color } = getFileIcon(pf.type || null, colors);

        return (
          <View
            key={pf.id}
            style={{ width: exactSquareSize, height: exactSquareSize }}
            className="rounded-xl overflow-hidden border border-surface-border bg-surface-card relative"
          >
            {isImage ? (
              <Image
                source={{ uri: pf.uri }}
                style={{ flex: 1, width: '100%', height: '100%', position: 'absolute' }}
                resizeMode="cover"
              />
            ) : (
              <View className="flex-1 items-center justify-center p-2" style={{ backgroundColor: color + '15' }}>
                <FontAwesome name={icon as any} size={exactSquareSize > 80 ? 32 : 24} color={color} />
                <View className="mt-2 bg-surface-background px-2 py-0.5 rounded-md border border-surface-border shadow-sm">
                  <Text className="text-[9px] font-black uppercase text-typography-muted" numberOfLines={1}>
                    {pf.name.split('.').pop() || 'FILE'}
                  </Text>
                </View>
              </View>
            )}

            {isUploading ? (
              <View className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 rounded-full items-center justify-center">
                <ActivityIndicator size="small" color="#fff" style={{ transform: [{ scale: 0.6 }] }} />
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => onRemove(pf.id)}
                className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 rounded-full items-center justify-center hover:bg-black/80 transition-colors"
                style={Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}}
              >
                <FontAwesome name="times" size={10} color="#fff" />
              </TouchableOpacity>
            )}

            <View className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 backdrop-blur-md">
              <Text className="text-white text-[9px] font-bold text-center" numberOfLines={1}>
                {formatFileSize(pf.size)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type Props = {
  visible: boolean;
  onClose: () => void;
  initialPipelineId?: string | null;
};

export default function CreateTaskSheet({ visible, onClose, initialPipelineId }: Props) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const {
    draft, setDraft, loading, recentTasks, briefFiles, setBriefFiles,
    step, setStep,
    bulkMode, setBulkMode,
    bulkText, setBulkText,
    bulkTitles, canSubmit,
    users, teams,
    showCalendar, setShowCalendar,
    templates, saveAsTemplate, loadTemplate, deleteTemplate,
    handleCreate, removeBriefFile,
  } = useCreateTaskWizard({ visible, initialPipelineId });

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <View className="gap-6">
            {/* Quick Start — Recent Tasks & Templates */}
            <View className="pb-6 border-b border-surface-border/50">
              {recentTasks.length > 0 && (
                <View className="mb-5">
                  <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Copy Recent</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View className="flex-row gap-2 pr-2">
                      {recentTasks.slice(0, 6).map(t => (
                        <TouchableOpacity
                          key={t.id}
                          onPress={() => setDraft({
                            title: t.title,
                            description: t.description || '',
                            category: t.category || 'General',
                            priority: t.priority === 'medium' ? 'normal' : (t.priority || 'normal'),
                          })}
                          className="bg-surface-card border border-surface-border rounded-xl px-4 py-3"
                          style={{ maxWidth: 140 }}
                        >
                          <Text className="text-typography-main font-bold text-xs" numberOfLines={1}>{t.title}</Text>
                          <Text className="text-typography-muted text-[9px] font-bold uppercase mt-0.5">{t.category || 'General'}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              )}

              <View>
                <View className="flex-row items-center justify-between mb-2">
                  <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest ml-1">Templates</Text>
                  <TouchableOpacity onPress={saveAsTemplate} className="flex-row items-center gap-1">
                    <FontAwesome name="bookmark-o" size={10} color={colors.primary} />
                    <Text className="text-brand-primary text-[10px] font-black uppercase">Save Current</Text>
                  </TouchableOpacity>
                </View>
                {templates.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View className="flex-row gap-2 pr-2">
                      {templates.map((t, i) => (
                        <TouchableOpacity
                          key={i}
                          onPress={() => loadTemplate(t)}
                          onLongPress={() =>
                            Alert.alert('Delete Template', `Remove "${t.name}"?`, [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Delete', style: 'destructive', onPress: () => deleteTemplate(i) },
                            ])
                          }
                          className="bg-brand-primary/10 border border-brand-primary/30 rounded-xl px-4 py-3"
                          style={{ maxWidth: 140 }}
                        >
                          <Text className="text-brand-primary font-bold text-xs" numberOfLines={1}>{t.name}</Text>
                          <Text className="text-brand-primary/60 text-[9px] font-bold uppercase mt-0.5">Hold to delete</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                ) : (
                  <Text className="text-typography-muted text-[10px] ml-1 font-medium">No templates yet. Fill in details and tap Save.</Text>
                )}
              </View>
            </View>

            <View>
              <View className="flex-row items-center justify-between mb-2 ml-1">
                <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest">
                  {bulkMode ? 'Titles' : 'Title'}
                </Text>
                <View className="flex-row items-center gap-3">
                  <TouchableOpacity
                    onPress={() => setBulkMode(b => !b)}
                    className={`flex-row items-center gap-1.5 px-2.5 py-1 rounded-lg border ${bulkMode ? 'bg-brand-primary/10 border-brand-primary' : 'border-surface-border'}`}
                  >
                    <FontAwesome name="list-ul" size={10} color={bulkMode ? colors.primary : colors.textMuted} />
                    <Text className={`text-[9px] font-black uppercase tracking-wider ${bulkMode ? 'text-brand-primary' : 'text-typography-muted'}`}>Bulk</Text>
                  </TouchableOpacity>
                  <ClipboardControls
                    value={bulkMode ? bulkText : draft.title}
                    onPaste={t => bulkMode
                      ? setBulkText(prev => prev ? `${prev}\n${t}` : t)
                      : setDraft({ title: t })}
                  />
                </View>
              </View>
              {bulkMode ? (
                <>
                  <TextInput
                    value={bulkText}
                    onChangeText={setBulkText}
                    placeholder={'One task per line'}
                    placeholderTextColor={colors.textDim}
                    multiline
                    textAlignVertical="top"
                    className="bg-surface-background border border-surface-border rounded-xl px-5 py-4 text-typography-main font-bold text-base h-32"
                  />
                  <Text className="text-typography-dim text-[10px] font-bold mt-1.5 ml-1">
                    {bulkTitles.length} task{bulkTitles.length === 1 ? '' : 's'} · all share the fields in the next steps
                  </Text>
                </>
              ) : (
                <TextInput
                  value={draft.title ?? ''}
                  onChangeText={t => setDraft({ title: t })}
                  placeholder="Deployment Objective"
                  placeholderTextColor={colors.textDim}
                  className="bg-surface-background border border-surface-border rounded-xl px-5 py-4 text-typography-main font-bold text-base"
                />
              )}
            </View>
            <View>
              <View className="flex-row items-center justify-between mb-2 ml-1">
                <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest">Category</Text>
                <ClipboardControls value={draft.category} onPaste={t => setDraft({ category: t })} />
              </View>
              <TextInput
                value={draft.category ?? ''}
                onChangeText={t => setDraft({ category: t })}
                placeholder="General"
                placeholderTextColor={colors.textDim}
                className="bg-surface-background border border-surface-border rounded-xl px-5 py-4 text-typography-main font-bold"
              />
            </View>
            <View>
              <View className="flex-row items-center justify-between mb-2 ml-1">
                <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest">Description</Text>
                <ClipboardControls
                  value={draft.description}
                  onPaste={t => setDraft({ description: draft.description ? `${draft.description}\n${t}` : t })}
                />
              </View>
              <TextInput
                value={draft.description ?? ''}
                onChangeText={t => setDraft({ description: t })}
                placeholder="Operation details..."
                placeholderTextColor={colors.textDim}
                multiline
                numberOfLines={4}
                className="bg-surface-background border border-surface-border rounded-xl px-5 py-4 text-typography-main text-sm h-32"
              />
            </View>
          </View>
        );
      case 2:
        return (
          <View className="gap-6">
             <View>
                <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-4 ml-1">Priority</Text>
                <View className="flex-row flex-wrap gap-2">
                  {['low', 'normal', 'high', 'urgent'].map(p => (
                    <TouchableOpacity
                      key={p}
                      onPress={() => setDraft({ priority: p as any })}
                      className={`px-6 py-3 rounded-full border ${draft.priority === p ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                    >
                      <Text className={`font-black text-[10px] uppercase tracking-widest ${draft.priority === p ? 'text-white' : 'text-typography-muted'}`}>{p}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
             </View>
             <View>
                <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-4 ml-1">Deadline Sequence</Text>
                <TouchableOpacity
                  onPress={() => setShowCalendar(!showCalendar)}
                  className="bg-surface-background border border-surface-border rounded-xl px-5 py-4 flex-row items-center justify-between"
                >
                   <Text className={`font-black ${draft.dueDate ? 'text-typography-main' : 'text-typography-dim'}`}>
                      {draft.dueDate ? new Date(draft.dueDate).toLocaleDateString(undefined, { dateStyle: 'long' }) : 'Set Objective Deadline'}
                   </Text>
                   <FontAwesome name="calendar" size={14} className="text-brand-primary" />
                </TouchableOpacity>

                {showCalendar && (
                  <View className="mt-4">
                    <PremiumCalendarPicker
                      selectedDate={draft.dueDate}
                      onSelect={(date) => {
                        setDraft({ dueDate: date });
                        setShowCalendar(false);
                      }}
                    />
                  </View>
                )}
             </View>
             <View>
                <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Weight</Text>
                <View className="flex-row items-center gap-4">
                   <TouchableOpacity onPress={() => setDraft({ weight: Math.max(1, draft.weight - 1) })} className="w-12 h-12 bg-surface-background border border-surface-border rounded-xl items-center justify-center">
                      <FontAwesome name="minus" size={14} className="text-typography-main" />
                   </TouchableOpacity>
                   <Text className="text-typography-main font-black text-2xl w-12 text-center">{draft.weight}</Text>
                   <TouchableOpacity onPress={() => setDraft({ weight: draft.weight + 1 })} className="w-12 h-12 bg-surface-background border border-surface-border rounded-xl items-center justify-center">
                      <FontAwesome name="plus" size={14} className="text-typography-main" />
                   </TouchableOpacity>
                </View>
             </View>
          </View>
        );
      case 3:
        return (
          <View className="gap-6">
             <View>
               <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-3 ml-1">Brief Files</Text>
               <Text className="text-typography-muted text-[10px] mb-3">Attach reference materials for the assignee.</Text>

               {briefFiles.length > 0 && (
                 <AdaptiveFileGrid
                   files={briefFiles}
                   onRemove={removeBriefFile}
                   isUploading={false}
                 />
               )}

               <View className="flex-row flex-wrap gap-3">
                 <TouchableOpacity
                   onPress={async () => {
                     const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true });
                     if (!result.canceled) setBriefFiles(prev => [...prev, ...result.assets.map(a => ({ id: Math.random().toString(36).substring(7), uri: a.uri, name: a.fileName || `image_${Date.now()}.jpg`, size: a.fileSize || 0, type: a.mimeType || 'image/jpeg' }))]);
                   }}
                   className="flex-row items-center bg-surface-background px-3 py-2 rounded-xl border border-surface-border"
                 >
                   <FontAwesome name="camera" size={11} color={colors.primary} />
                   <Text className="text-brand-primary text-[10px] font-black uppercase ml-1.5">Add Photo</Text>
                 </TouchableOpacity>
                 <TouchableOpacity
                   onPress={async () => {
                     const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true });
                     if (!result.canceled) setBriefFiles(prev => [...prev, ...result.assets.map(a => ({ id: Math.random().toString(36).substring(7), uri: a.uri, name: a.name, size: a.size || 0, type: a.mimeType || 'application/octet-stream' }))]);
                   }}
                   className="flex-row items-center bg-surface-background px-3 py-2 rounded-xl border border-surface-border"
                 >
                   <FontAwesome name="paperclip" size={11} color={colors.primary} />
                   <Text className="text-brand-primary text-[10px] font-black uppercase ml-1.5">Attach File</Text>
                 </TouchableOpacity>
                 <TouchableOpacity
                   onPress={async () => {
                     const file = await getPastedImageFile();
                     if (file) setBriefFiles(prev => [...prev, file]);
                     else Alert.alert('No Image', 'There is no image on the clipboard to paste.');
                   }}
                   className="flex-row items-center bg-surface-background px-3 py-2 rounded-xl border border-surface-border"
                 >
                   <FontAwesome name="clipboard" size={11} color={colors.primary} />
                   <Text className="text-brand-primary text-[10px] font-black uppercase ml-1.5">Paste Image</Text>
                 </TouchableOpacity>
               </View>
             </View>

             <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Resources</Text>
             <ScrollView className="max-h-96">
                <Text className="text-brand-primary text-[10px] font-black uppercase mb-3">Agents</Text>
                <View className="flex-row flex-wrap gap-2 mb-6">
                   {users.map(u => (
                     <TouchableOpacity
                       key={u.id}
                       onPress={() => setDraft({ assigneeUserIds: draft.assigneeUserIds.includes(u.id) ? draft.assigneeUserIds.filter(id => id !== u.id) : [...draft.assigneeUserIds, u.id] })}
                       className={`px-4 py-2 rounded-lg border ${draft.assigneeUserIds.includes(u.id) ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                     >
                       <Text className={`text-[10px] font-bold ${draft.assigneeUserIds.includes(u.id) ? 'text-white' : 'text-typography-main'}`}>{u.full_name}</Text>
                     </TouchableOpacity>
                   ))}
                </View>
                <Text className="text-brand-accent text-[10px] font-black uppercase mb-3">Teams</Text>
                <View className="flex-row flex-wrap gap-2 mb-6">
                   {teams.map(t => (
                     <TouchableOpacity
                       key={t.id}
                       onPress={() => setDraft({ assigneeTeamIds: draft.assigneeTeamIds.includes(t.id) ? draft.assigneeTeamIds.filter(id => id !== t.id) : [...draft.assigneeTeamIds, t.id] })}
                       className={`px-4 py-2 rounded-lg border ${draft.assigneeTeamIds.includes(t.id) ? 'bg-brand-accent border-brand-accent' : 'bg-surface-background border-surface-border'}`}
                     >
                       <Text className={`text-[10px] font-bold ${draft.assigneeTeamIds.includes(t.id) ? 'text-white' : 'text-typography-main'}`}>{t.name}</Text>
                     </TouchableOpacity>
                   ))}
                </View>
             </ScrollView>
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <DraggableSheet
      visible={visible}
      onClose={onClose}
      dimBackdrop
      maxHeight="94%"
      containerStyle={{ height: '94%' }}
      containerClassName="bg-surface-background rounded-t-[2rem] border-t border-surface-border overflow-hidden"
    >
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <View className="flex-1 bg-surface-background">
          {/* Header */}
          <View className="px-6 py-4 flex-row items-center justify-between border-b border-surface-border">
             <TouchableOpacity onPress={onClose} disabled={loading} className={loading ? 'opacity-40' : ''}>
                <Text className="text-typography-muted font-bold">Cancel</Text>
             </TouchableOpacity>
             <Text className="text-typography-main font-black uppercase tracking-widest text-xs">New Task</Text>
             <TouchableOpacity onPress={() => handleCreate(onClose)} disabled={loading || !canSubmit}>
                {loading ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text className={`font-black uppercase tracking-widest text-xs ${!canSubmit ? 'text-typography-dim' : 'text-brand-primary'}`}>
                    {bulkMode && bulkTitles.length > 0 ? `Create ${bulkTitles.length}` : 'Create'}
                  </Text>
                )}
             </TouchableOpacity>
          </View>

          {/* Progress Bar */}
          <View className="flex-row h-1 bg-surface-overlay">
             <View className="bg-brand-primary h-full" style={{ width: `${(step / 3) * 100}%` }} />
          </View>

          {/* Content */}
          <ScrollView className="flex-1 p-6" showsVerticalScrollIndicator={false}>
             {renderStep()}
          </ScrollView>

          {/* Bottom Nav */}
          <View className="p-6 border-t border-surface-border flex-row justify-between items-center" style={{ paddingBottom: insets.bottom + 20 }}>
             <TouchableOpacity
               onPress={() => setStep(s => Math.max(1, s - 1))}
              disabled={step === 1 || loading}
               className={`w-14 h-14 items-center justify-center rounded-2xl bg-surface-card border border-surface-border ${step === 1 ? 'opacity-20' : ''}`}
             >
                <FontAwesome name="chevron-left" size={16} className="text-typography-main" />
             </TouchableOpacity>

             {step < 3 ? (
               <TouchableOpacity
                 onPress={() => setStep(s => s + 1)}
                 disabled={loading}
                 className="flex-1 ml-4 h-14 bg-brand-primary items-center justify-center rounded-2xl premium-shadow"
               >
                  <Text className="text-white font-black uppercase tracking-widest text-xs">Next Phase</Text>
               </TouchableOpacity>
             ) : (
               <TouchableOpacity
                 onPress={() => handleCreate(onClose)}
                 disabled={loading || !canSubmit}
                 className={`flex-1 ml-4 h-14 bg-brand-primary items-center justify-center rounded-2xl premium-shadow ${!canSubmit ? 'opacity-50' : ''}`}
               >
                  {loading ? <ActivityIndicator color="white" /> : <Text className="text-white font-black uppercase tracking-widest text-xs">{bulkMode ? `Deploy ${bulkTitles.length}` : 'Deploy Now'}</Text>}
               </TouchableOpacity>
             )}
          </View>

          {loading && (
            <View className="absolute inset-0 z-50 items-center justify-center bg-surface-background/70">
              <View className="bg-surface-card border border-surface-border rounded-3xl px-6 py-5 items-center premium-shadow">
                <ActivityIndicator size="large" color={colors.primary} />
                <Text className="text-typography-main font-black uppercase tracking-[0.2em] text-[10px] mt-3">Creating task</Text>
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </DraggableSheet>
  );
}
