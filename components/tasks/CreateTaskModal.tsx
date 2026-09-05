import { useAlert } from '@/contexts/AlertContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { getPastedImageFile, applyTaskSeed } from '@/lib/pasteImage';
import type { StagedBriefFile } from '@/contexts/TaskCreationContext';
import { FilePreviewModal, getPreviewKind, type PreviewKind } from '@/components/common/FilePreview';
import ImageLightbox from '@/components/common/ImageLightbox';
import { FontAwesome } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import Tooltip from '@/components/common/Tooltip';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DraggableSheet from '../common/DraggableSheet';
import LoadingOverlay from '../common/LoadingOverlay';
import ClipboardControls from '../common/ClipboardControls';
import SearchableMultiSelect from '../common/SearchableMultiSelect';
import { DateRangePillPicker } from '@/components/intelligence/DateRangeFilter';
import { formatFileSize, getFileIcon } from '@/lib/taskFileHelpers';
import { useCreateTaskWizard } from '@/lib/useCreateTaskWizard';
import { usePipelineAssignmentPreview } from '@/lib/usePipelineAssignmentPreview';
import AssignmentModePreview from './AssignmentModePreview';

// Priority level colors (#252): urgent=danger, high=warning, normal=brand, low=success.
const PRIORITY_STYLE: Record<string, { selectedBg: string; selectedBorder: string; idleText: string }> = {
  urgent: { selectedBg: 'bg-state-danger', selectedBorder: 'border-state-danger', idleText: 'text-state-danger' },
  high:   { selectedBg: 'bg-state-warning', selectedBorder: 'border-state-warning', idleText: 'text-state-warning' },
  normal: { selectedBg: 'bg-brand-primary', selectedBorder: 'border-brand-primary', idleText: 'text-typography-muted' },
  low:    { selectedBg: 'bg-state-success', selectedBorder: 'border-state-success', idleText: 'text-state-success' },
};

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
  const [lightboxFile, setLightboxFile] = useState<{ uri: string; name: string } | null>(null);
  const [preview, setPreview] = useState<{ uri: string; name: string; kind: PreviewKind; sizeBytes?: number } | null>(null);

  const gap = 12;
  const minSquareSize = 90; // Slightly smaller for inline forms

  // Fallback width before layout calculation fires
  const availableWidth = containerWidth > 0 ? containerWidth : 300;

  let numCols = Math.floor((availableWidth + gap) / (minSquareSize + gap));
  if (numCols < 2) numCols = 2;
  const exactSquareSize = Math.floor((availableWidth - (gap * (numCols - 1))) / numCols);

  if (files.length === 0) return null;

  return (
    <>
    <View
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      className="flex-row flex-wrap w-full bg-surface-background border border-surface-border rounded-xl p-3 mb-3"
      style={{ gap }}
    >
      {files.map((pf) => {
        const isImage = pf.type?.toLowerCase().includes('image');
        const { name: icon, color } = getFileIcon(pf.type || null, colors);
        const kind = !isImage ? getPreviewKind(pf.type || null, pf.name) : null;
        const canPreview = isImage || !!kind;

        return (
          <View
            key={pf.id}
            style={{ width: exactSquareSize, height: exactSquareSize }}
            className="rounded-xl overflow-hidden border border-surface-border bg-surface-card relative"
          >
            {/* Press target is an absolute-fill touchable; the overlay buttons
                below are SIBLINGS, not children — nested touchables silently
                swallow presses on react-native-web. */}
            <TouchableOpacity
              activeOpacity={canPreview ? 0.7 : 1}
              disabled={!canPreview}
              onPress={() => {
                if (isImage) setLightboxFile({ uri: pf.uri, name: pf.name });
                else if (kind) setPreview({ uri: pf.uri, name: pf.name, kind, sizeBytes: pf.size });
              }}
              style={Platform.OS === 'web' && canPreview ? ({ cursor: 'pointer' } as any) : undefined}
              className="absolute inset-0"
            >
              {isImage ? (
                <Image
                  source={{ uri: pf.uri }}
                  style={{ flex: 1, width: '100%', height: '100%' }}
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
            </TouchableOpacity>

            {isUploading ? (
              <View className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 rounded-full items-center justify-center">
                <ActivityIndicator size="small" color="#fff" style={{ transform: [{ scale: 0.6 }] }} />
              </View>
            ) : (
              <Tooltip label="Remove file">
                <TouchableOpacity
                  onPress={() => onRemove(pf.id)}
                  className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 rounded-full items-center justify-center hover:bg-black/80 transition-colors"
                  style={Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}}
                >
                  <FontAwesome name="times" size={10} color="#fff" />
                </TouchableOpacity>
              </Tooltip>
            )}

            <View pointerEvents="none" className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 backdrop-blur-md">
              <Text className="text-white text-[9px] font-bold text-center" numberOfLines={1}>
                {formatFileSize(pf.size)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
    {lightboxFile && (
      <ImageLightbox
        visible
        uri={lightboxFile.uri}
        fileName={lightboxFile.name}
        onClose={() => setLightboxFile(null)}
      />
    )}
    {preview && (
      <FilePreviewModal
        visible
        uri={preview.uri}
        fileName={preview.name}
        kind={preview.kind}
        onClose={() => setPreview(null)}
        sizeBytes={preview.sizeBytes}
      />
    )}
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type Props = {
  visible: boolean;
  onClose: () => void;
  initialPipelineId?: string | null;
  initialText?: string | null;
  initialFiles?: StagedBriefFile[] | null;
};

export default function CreateTaskModal({ visible, onClose, initialPipelineId, initialText, initialFiles }: Props) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { showAlert, showConfirm } = useAlert();
  const {
    draft, setDraft, toggleTeamAssignee, loading, recentTasks, briefFiles, setBriefFiles,
    step, setStep,
    bulkMode, toggleBulkMode,
    bulkText, setBulkText,
    bulkTitles, canSubmit,
    users, teams,
    templates, saveAsTemplate, loadTemplate, deleteTemplate,
    handleCreate, removeBriefFile,
  } = useCreateTaskWizard({ visible, initialPipelineId });
  const { preview: assignmentPreview } = usePipelineAssignmentPreview(draft.pipelineId);
  const dateConflict = !!(draft.startDate && draft.dueDate && draft.startDate > draft.dueDate);

  // Phase 3: seed from a screen-level paste/drop. Native screens don't pass
  // these today (no OS drag / bare-Ctrl+V idiom), so this is a harmless no-op
  // here — kept identical to the web modal in case a native caller ever seeds.
  useEffect(() => {
    if (!visible) return;
    applyTaskSeed(
      { initialText, initialFiles },
      { title: draft.title, description: draft.description },
      setDraft,
      (files) => setBriefFiles(prev => [...prev, ...files]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

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
                            showConfirm('Delete Template', `Remove "${t.name}"?`, () => deleteTemplate(i), undefined, 'Delete', undefined, 'destructive')
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
                    onPress={toggleBulkMode}
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
                  {['low', 'normal', 'high', 'urgent'].map(p => {
                    const style = PRIORITY_STYLE[p];
                    const selected = draft.priority === p;
                    return (
                      <TouchableOpacity
                        key={p}
                        onPress={() => setDraft({ priority: p as any })}
                        className={`px-6 py-3 rounded-full border ${selected ? `${style.selectedBg} ${style.selectedBorder}` : `bg-surface-background border-surface-border`}`}
                      >
                        <Text className={`font-black text-[10px] uppercase tracking-widest ${selected ? 'text-white' : style.idleText}`}>{p}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
             </View>
             <View>
                <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-4 ml-1">Timeline</Text>
                <DateRangePillPicker
                  from={draft.startDate}
                  to={draft.dueDate}
                  fromPlaceholder="Start"
                  toPlaceholder="Deadline"
                  onApply={(f, t) => setDraft({ startDate: f, dueDate: t })}
                  onClear={() => setDraft({ startDate: null, dueDate: null })}
                />
                {dateConflict && (
                  <View className="flex-row items-center gap-2 ml-1 mt-2">
                    <FontAwesome name="exclamation-triangle" size={11} className="text-typography-muted" color={colors.warning} />
                    <Text className="text-typography-label text-[10px] font-black uppercase tracking-wider" style={{ color: colors.warning }}>Start date is after deadline</Text>
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
                     else showAlert('No Image', 'There is no image on the clipboard to paste.');
                   }}
                   className="flex-row items-center bg-surface-background px-3 py-2 rounded-xl border border-surface-border"
                 >
                   <FontAwesome name="clipboard" size={11} color={colors.primary} />
                   <Text className="text-brand-primary text-[10px] font-black uppercase ml-1.5">Paste Image</Text>
                 </TouchableOpacity>
               </View>
             </View>

             <AssignmentModePreview
               preview={assignmentPreview}
               hasManualAssignees={draft.assigneeUserIds.length + draft.assigneeTeamIds.length > 0}
             />

             <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2 ml-1">Resources</Text>
             <View className="gap-6">
                <SearchableMultiSelect
                  title="Agents"
                  items={users.map(u => ({
                    id: u.id,
                    label: u.full_name || u.email,
                    color: colors.primary,
                    icon: 'user',
                  }))}
                  selectedIds={draft.assigneeUserIds}
                  onToggle={(id) => setDraft({ assigneeUserIds: draft.assigneeUserIds.includes(id) ? draft.assigneeUserIds.filter(x => x !== id) : [...draft.assigneeUserIds, id] })}
                  searchPlaceholder="Search agents..."
                  emptyText="No agents match your search."
                  accent={colors.primary}
                />
                <SearchableMultiSelect
                  title="Teams"
                  items={teams.map(t => ({
                    id: t.id,
                    label: t.name,
                    description: t.description,
                    color: t.color || colors.accent,
                  }))}
                  selectedIds={draft.assigneeTeamIds}
                  onToggle={toggleTeamAssignee}
                  searchPlaceholder="Search teams..."
                  emptyText="No teams match your search."
                  accent={colors.accent}
                />
             </View>
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

          <LoadingOverlay visible={loading} message="Creating task" />
        </View>
      </KeyboardAvoidingView>
    </DraggableSheet>
  );
}
