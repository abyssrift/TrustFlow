import AssignmentModePreview from '@/components/tasks/AssignmentModePreview';
import ClipboardControls from '@/components/common/ClipboardControls';
import PremiumCalendarPicker from '@/components/common/PremiumCalendarPicker';
import { usePipelineAssignmentPreview } from '@/lib/usePipelineAssignmentPreview';
import { useAuth } from '@/contexts/AuthContext';
import { useTaskCreation } from '@/contexts/TaskCreationContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { getPastedImageFile } from '@/lib/pasteImage';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

type Props = {
  visible: boolean;
  onClose: () => void;
  initialPipelineId?: string | null;
};

type Pipeline = { id: string; name: string };
type Project  = { id: string; name: string; color: string | null };

const QUICK_DATES = [
  { label: 'Tomorrow', days: 1  },
  { label: '+3 Days',  days: 3  },
  { label: '+1 Week',  days: 7  },
  { label: '+2 Weeks', days: 14 },
  { label: '+1 Month', days: 30 },
];

const HOUR_PRESETS = [1, 2, 4, 8, 16];

// Colors (not classNames) — these render inside a <Modal> subtree, so theme tokens
// must be resolved via useThemeColors() rather than CSS-variable-backed classNames.
function priorityTextColor(colors: ReturnType<typeof useThemeColors>, p: string): string {
  return ({ urgent: colors.danger, high: colors.warning, normal: colors.primary, low: colors.textDim } as Record<string, string>)[p] ?? colors.textDim;
}
function priorityBgColor(colors: ReturnType<typeof useThemeColors>, p: string): string {
  return ({ urgent: colors.danger + '33', high: colors.warning + '33', normal: colors.primary + '33', low: colors.border + '40' } as Record<string, string>)[p] ?? (colors.border + '40');
}

function quickDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getFileIcon(mimeType: string | null, colors: ReturnType<typeof useThemeColors>): { name: string; color: string } {
  const t = (mimeType || '').toLowerCase();
  if (t.includes('image')) return { name: 'file-image-o', color: colors.warning };
  if (t.includes('pdf')) return { name: 'file-pdf-o', color: colors.danger };
  if (t.includes('spreadsheet') || t.includes('excel') || t.includes('csv')) return { name: 'file-excel-o', color: colors.success };
  if (t.includes('word') || t.includes('document') || t.includes('text')) return { name: 'file-text-o', color: colors.info };
  return { name: 'file-o', color: colors.textMuted };
}

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
  const minSquareSize = 90;

  const availableWidth = containerWidth > 0 ? containerWidth : 300;
  
  let numCols = Math.floor((availableWidth + gap) / (minSquareSize + gap));
  if (numCols < 2) numCols = 2; 
  const exactSquareSize = Math.floor((availableWidth - (gap * (numCols - 1))) / numCols);

  if (files.length === 0) return null;

  return (
    <View 
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      className="flex-row flex-wrap w-full rounded-xl p-3 mb-4"
      style={{ gap, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}
    >
      {files.map((pf) => {
        const isImage = pf.type?.toLowerCase().includes('image');
        const { name: icon, color } = getFileIcon(pf.type || null, colors);

        return (
          <View 
            key={pf.id} 
            style={{ width: exactSquareSize, height: exactSquareSize, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}
            className="rounded-xl overflow-hidden relative"
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
                <View className="mt-2 px-2 py-0.5 rounded-md shadow-sm" style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}>
                  <Text className="text-[9px] font-black uppercase" style={{ color: colors.textMuted }} numberOfLines={1}>
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

export default function CreateTaskModal({ visible, onClose, initialPipelineId }: Props) {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const { hasPermission } = useAuth();
  const { draft, setDraft, createTask, createBulkTasks, loading, recentTasks, loadRecentTasks, briefFiles, setBriefFiles } = useTaskCreation();
  const [activeTab, setActiveTab] = useState<'details' | 'assignments'>('details');
  // Bulk quick-add: one task title per line, sharing all other draft fields.
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const bulkTitles = useMemo(
    () => bulkText.split('\n').map(t => t.trim()).filter(Boolean),
    [bulkText]
  );
  // Toggle bulk/single without discarding what's already typed (#26): entering
  // bulk seeds the list from the single title; leaving bulk collapses the list
  // back into the title. Neither field is cleared, so the other side is still
  // there if the user switches back.
  const toggleBulkMode = () => {
    if (!bulkMode) {
      if (!bulkText.trim() && draft.title?.trim()) setBulkText(draft.title);
      setBulkMode(true);
    } else {
      if (!draft.title?.trim() && bulkTitles.length) setDraft({ title: bulkTitles[0] });
      setBulkMode(false);
    }
  };
  const [users, setUsers]         = useState<any[]>([]);
  const [teams, setTeams]         = useState<any[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [projects,  setProjects]  = useState<Project[]>([]);
  const [weightText, setWeightText] = useState(String(draft.weight ?? 1));
  const [search, setSearch]       = useState('');
  const [pipelineSearch, setPipelineSearch] = useState('');
  const [projectSearch,  setProjectSearch]  = useState('');

  // Deadline calendar
  const [showCalendar, setShowCalendar]   = useState(false);
  const calendarButtonRef                 = useRef<any>(null);
  const [calendarPos, setCalendarPos]     = useState({ top: 0, left: 0, width: 0 });

  // Start date calendar
  const [showStartCalendar, setShowStartCalendar] = useState(false);
  const startCalendarButtonRef                     = useRef<any>(null);
  const [startCalendarPos, setStartCalendarPos]   = useState({ top: 0, left: 0, width: 0 });

  // Pipeline dropdown
  const [showPipelineDropdown, setShowPipelineDropdown] = useState(false);
  const pipelineButtonRef                               = useRef<any>(null);
  const [pipelineDropdownPos, setPipelineDropdownPos]   = useState({ top: 0, left: 0, width: 0 });

  // Project dropdown
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const projectButtonRef                              = useRef<any>(null);
  const [projectDropdownPos, setProjectDropdownPos]   = useState({ top: 0, left: 0, width: 0 });

  // Create project inline
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectColor, setNewProjectColor] = useState('#3B82F6');
  const [creatingProject, setCreatingProject] = useState(false);

  const PROJECT_COLORS = [
    '#EF4444', '#F97316', '#EAB308', '#22C55E',
    '#06B6D4', '#3B82F6', '#8B5CF6', '#EC4899',
  ];

  const closeAllOverlays = useCallback(() => {
    setShowCalendar(false);
    setShowStartCalendar(false);
    setShowPipelineDropdown(false);
    setShowProjectDropdown(false);
  }, []);

  const handleCreate = useCallback(async () => {
    if (bulkMode) {
      const n = await createBulkTasks(bulkTitles);
      if (n > 0) { setBulkText(''); onClose(); }
      return;
    }
    const id = await createTask();
    if (id) onClose();
  }, [bulkMode, bulkTitles, createBulkTasks, createTask, onClose]);

  const canSubmit = bulkMode ? bulkTitles.length > 0 : !!draft.title;

  // Keyboard: Escape closes overlays, ⌘/Ctrl+Enter submits
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAllOverlays();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSubmit && !loading) handleCreate();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, canSubmit, loading, closeAllOverlays, handleCreate]);

  useEffect(() => {
    if (visible) {
      loadRecentTasks();
      fetchResources();
      if (initialPipelineId && !draft.pipelineId) setDraft({ pipelineId: initialPipelineId });
      setWeightText(String(draft.weight ?? 1));
    } else {
      setBulkMode(false);
      setBulkText('');
    }
  }, [visible]);

  const fetchResources = async () => {
    const [{ data: userData }, { data: teamData }, { data: pipelineData }, { data: projectData }] = await Promise.all([
      supabase.from('users').select('id, full_name, avatar_url').is('deleted_at', null),
      supabase.from('teams').select('id, name, color').is('deleted_at', null),
      supabase.from('pipelines').select('id, name').is('deleted_at', null).order('name'),
      supabase.from('projects').select('id, name, color').is('deleted_at', null).order('name'),
    ]);
    setUsers(userData || []);
    setTeams(teamData || []);
    setPipelines(pipelineData || []);
    setProjects(projectData || []);
  };

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

  const handleCopyRecent = (task: any) => {
    setDraft({
      title:           `${task.title} (Clone)`,
      description:     task.description,
      priority:        task.priority === 'medium' ? 'normal' : task.priority,
      category:        task.category,
      weight:          task.weight,
      startDate:       task.start_date,
      dueDate:         task.due_date,
      estimatedHours:  task.estimated_hours,
      pipelineId:      task.pipeline_id,
      projectId:       task.project_id,
      assigneeUserIds: task.assignments?.filter((a: any) => a.assignee_user_id).map((a: any) => a.assignee_user_id) || [],
      assigneeTeamIds: task.assignments?.filter((a: any) => a.assignee_team_id).map((a: any) => a.assignee_team_id) || [],
    });
    setWeightText(String(task.weight ?? 1));
  };

  const toggleUser = (id: string) => {
    const exists = draft.assigneeUserIds.includes(id);
    setDraft({ assigneeUserIds: exists ? draft.assigneeUserIds.filter(u => u !== id) : [...draft.assigneeUserIds, id] });
  };

  const toggleTeam = (id: string) => {
    const exists = draft.assigneeTeamIds.includes(id);
    setDraft({ assigneeTeamIds: exists ? draft.assigneeTeamIds.filter(t => t !== id) : [...draft.assigneeTeamIds, id] });
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    setCreatingProject(true);
    try {
      const { data, error } = await supabase.rpc('rpc_create_project', {
        p_name: newProjectName,
        p_color: newProjectColor,
      });

      if (error) throw error;

      if (data) {
        setProjects([...projects, data]);
        setDraft({ projectId: data.id });
        setNewProjectName('');
        setNewProjectColor('#3B82F6');
        setShowCreateProject(false);
        setProjectSearch('');
      }
    } catch (err) {
      console.error('Failed to create project:', err);
    } finally {
      setCreatingProject(false);
    }
  };

  const selectedPipeline   = pipelines.find(p => p.id === draft.pipelineId);
  const selectedProject    = projects.find(p => p.id === draft.projectId);
  const assignmentCount    = draft.assigneeUserIds.length + draft.assigneeTeamIds.length;
  const { preview: assignmentPreview } = usePipelineAssignmentPreview(draft.pipelineId);
  const dateConflict       = !!(draft.startDate && draft.dueDate && draft.startDate > draft.dueDate);


  return (
    <Modal visible={visible} transparent animationType="fade">
      <View className="flex-1 items-center justify-center p-10" style={{ backdropFilter: 'blur(12px)', backgroundColor: colors.background + 'CC' } as any}>
        <View className="w-full max-w-[1200px] h-[800px] rounded-[3rem] overflow-hidden flex-row premium-shadow" style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>

          {/* ── LEFT SIDEBAR ── */}
          <View className="w-80 p-8" style={{ borderRightWidth: 1, borderColor: colors.border, backgroundColor: colors.background + '4D' }}>
            <View className="flex-row items-center mb-8">
              <FontAwesome name="history" size={14} color={colors.primary} />
              <Text className="text-[10px] font-black uppercase tracking-[0.2em] ml-3" style={{ color: colors.textMuted }}>Tactical Archive</Text>
            </View>
            <Text className="font-black text-xl mb-2 tracking-tight" style={{ color: colors.textMain }}>Recent Tasks</Text>
            <Text className="text-[10px] font-bold mb-5" style={{ color: colors.textDim }}>Tap any card to clone it</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {recentTasks.map(t => (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => handleCopyRecent(t)}
                  className="p-4 rounded-2xl mb-3 hover:border-brand-primary/50 transition-all group"
                  style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
                >
                  <View className="flex-row items-center justify-between mb-1">
                    <Text className="font-bold text-sm flex-1 group-hover:text-brand-primary" style={{ color: colors.textMain }} numberOfLines={1}>{t.title}</Text>
                    {t.priority && (
                      <View className="ml-2 px-2 py-0.5 rounded-md" style={{ backgroundColor: priorityBgColor(colors, t.priority) }}>
                        <Text className="text-[9px] font-black uppercase" style={{ color: priorityTextColor(colors, t.priority) }}>{t.priority}</Text>
                      </View>
                    )}
                  </View>
                  <View className="flex-row items-center justify-between mt-1">
                    <Text className="text-[10px] uppercase font-black tracking-widest" style={{ color: colors.textMuted }}>{t.category || 'General'}</Text>
                    <Text className="text-[9px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all" style={{ color: colors.primary }}>Clone →</Text>
                  </View>
                </TouchableOpacity>
              ))}
              {recentTasks.length === 0 && (
                <View className="py-20 items-center opacity-30">
                  <FontAwesome name="inbox" size={32} color={colors.textMuted} />
                  <Text className="text-[10px] font-black uppercase tracking-widest mt-4" style={{ color: colors.textMuted }}>Empty Stack</Text>
                </View>
              )}
            </ScrollView>
          </View>

          {/* ── MAIN CONTENT ── */}
          <View className="flex-1 flex-col">

            {/* Header */}
            <View className="px-10 py-8 flex-row items-center justify-between" style={{ borderBottomWidth: 1, borderColor: colors.border }}>
              <View>
                <Text className="text-[10px] font-black uppercase tracking-[0.3em] mb-1" style={{ color: colors.textMuted }}>Task Orchestrator</Text>
                <Text className="text-3xl font-black tracking-tighter" style={{ color: colors.textMain }}>Initialize Deployment</Text>
              </View>
                <TouchableOpacity
                  onPress={onClose}
                  disabled={loading}
                  className={`w-12 h-12 rounded-full items-center justify-center transition-colors ${loading ? 'opacity-40' : 'hover:border-brand-primary'}`}
                  style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}
                >
                  <FontAwesome name="times" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Tabs */}
            <View className="px-10 py-4 flex-row gap-8" style={{ borderBottomWidth: 1, borderColor: colors.border + '66' }}>
              <TouchableOpacity onPress={() => setActiveTab('details')}>
                <Text
                  className="font-black text-xs uppercase tracking-widest pb-2 transition-all"
                  style={{ color: activeTab === 'details' ? colors.primary : colors.textMuted, borderBottomWidth: 2, borderBottomColor: activeTab === 'details' ? colors.primary : 'transparent' }}
                >
                  Details
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setActiveTab('assignments')}>
                <View className="flex-row items-center gap-2 pb-2 border-b-2" style={{ borderBottomColor: activeTab === 'assignments' ? colors.primary : 'transparent' }}>
                  <Text className="font-black text-xs uppercase tracking-widest" style={{ color: activeTab === 'assignments' ? colors.primary : colors.textMuted }}>
                    Assignments
                  </Text>
                  {assignmentCount > 0 && (
                    <View className="rounded-full w-4 h-4 items-center justify-center" style={{ backgroundColor: colors.primary }}>
                      <Text className="text-white font-black text-[9px]">{assignmentCount}</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            </View>

            {/* Form */}
            <ScrollView className="flex-1 px-10 pt-6" onScrollBeginDrag={closeAllOverlays}>
              {activeTab === 'details' ? (
                <View className="gap-7 pb-20">

                  {/* Title */}
                  <View>
                    <View className="flex-row items-center justify-between mb-3">
                      <Text className="text-[10px] font-black uppercase tracking-widest ml-1" style={{ color: colors.textMuted }}>
                        {bulkMode ? 'Engagement Titles' : 'Engagement Title'}
                      </Text>
                      <View className="flex-row items-center gap-4 mr-1">
                        {/* Single ⇆ Bulk toggle — bulk shares all other fields across every task */}
                        <TouchableOpacity
                          onPress={toggleBulkMode}
                          className={`flex-row items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all ${bulkMode ? '' : 'hover:bg-surface-overlay'}`}
                          style={{ backgroundColor: bulkMode ? colors.primary + '1A' : undefined, borderColor: bulkMode ? colors.primary : colors.border }}
                        >
                          <FontAwesome name="list-ul" size={10} color={bulkMode ? colors.primary : colors.textMuted} />
                          <Text className="text-[9px] font-black uppercase tracking-wider" style={{ color: bulkMode ? colors.primary : colors.textMuted }}>Bulk</Text>
                        </TouchableOpacity>
                        <ClipboardControls
                          value={bulkMode ? bulkText : draft.title}
                          onPaste={t => bulkMode
                            ? setBulkText(prev => prev ? `${prev}\n${t}` : t)
                            : setDraft({ title: t })}
                        />
                        <Text className="text-[10px] font-black uppercase tracking-wider" style={{ color: colors.danger }}>Required</Text>
                      </View>
                    </View>
                    {bulkMode ? (
                      <>
                        <TextInput
                          value={bulkText}
                          onChangeText={setBulkText}
                          multiline
                          placeholder={'One task per line, e.g.\nAudit firewall rules\nRotate API keys\nReview access logs'}
                          placeholderTextColor={colors.textDim}
                          style={{ minHeight: 132, textAlignVertical: 'top', backgroundColor: colors.background, color: colors.textMain, borderWidth: 1, borderColor: bulkTitles.length ? colors.border : colors.danger + '4D' }}
                          className="rounded-2xl px-6 py-4 font-bold text-base leading-6 transition-colors"
                        />
                        <Text className="text-[10px] font-bold mt-2 ml-1 tracking-wide" style={{ color: colors.textDim }}>
                          {bulkTitles.length} task{bulkTitles.length === 1 ? '' : 's'} · all share the fields below
                        </Text>
                      </>
                    ) : (
                      <TextInput
                        value={draft.title ?? ''}
                        onChangeText={t => setDraft({ title: t })}
                        placeholder="e.g. Critical Infrastructure Audit"
                        placeholderTextColor={colors.textDim}
                        className="rounded-2xl px-6 py-5 font-black text-lg transition-colors"
                        style={{ backgroundColor: colors.background, color: colors.textMain, borderWidth: 1, borderColor: draft.title ? colors.border : colors.danger + '4D' }}
                      />
                    )}
                  </View>

                  {/* Priority + Weight */}
                  <View className="flex-row gap-8">
                    <View className="flex-1">
                      <Text className="text-[10px] font-black uppercase tracking-widest mb-3 ml-1" style={{ color: colors.textMuted }}>Priority Level</Text>
                      <View className="flex-row rounded-2xl p-1.5" style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}>
                        {(['low', 'normal', 'high', 'urgent'] as const).map(p => (
                          <TouchableOpacity
                            key={p}
                            onPress={() => setDraft({ priority: p })}
                            className={`flex-1 py-3 items-center rounded-xl transition-all ${draft.priority === p ? '' : 'hover:bg-surface-overlay'}`}
                            style={{ backgroundColor: draft.priority === p ? colors.primary : undefined }}
                          >
                            <Text className="font-black text-[10px] uppercase tracking-widest" style={{ color: draft.priority === p ? '#fff' : colors.textMuted }}>{p}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                    <View className="w-36">
                      <Text className="text-[10px] font-black uppercase tracking-widest mb-3 ml-1" style={{ color: colors.textMuted }}>Weight</Text>
                      <TextInput
                        value={weightText}
                        onChangeText={t => {
                          const digits = t.replace(/[^0-9]/g, '');
                          setWeightText(digits);
                          if (digits) setDraft({ weight: parseInt(digits, 10) });
                        }}
                        onBlur={() => setWeightText(String(draft.weight ?? 1))}
                        keyboardType="numeric"
                        className="rounded-2xl px-6 py-4 font-black text-center"
                        style={{ backgroundColor: colors.background, color: colors.textMain, borderWidth: 1, borderColor: colors.border }}
                      />
                    </View>
                  </View>

                  {/* Pipeline + Project */}
                  <View className="flex-row gap-8">
                    <View className="flex-1">
                      <Text className="text-[10px] font-black uppercase tracking-widest mb-3 ml-1" style={{ color: colors.textMuted }}>Pipeline</Text>
                      <TouchableOpacity
                        ref={pipelineButtonRef}
                        onPress={() => {
                          if (!showPipelineDropdown) {
                            openOverlay(pipelineButtonRef, setPipelineDropdownPos, setShowPipelineDropdown);
                            setShowCalendar(false); setShowStartCalendar(false); setShowProjectDropdown(false);
                          } else { setShowPipelineDropdown(false); }
                        }}
                        className="rounded-2xl px-5 py-4 flex-row items-center justify-between transition-all"
                        style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: showPipelineDropdown ? colors.primary : colors.border }}
                      >
                        <View className="flex-row items-center gap-3 flex-1">
                          <FontAwesome name="sitemap" size={13} color={draft.pipelineId ? colors.primary : colors.textDim} />
                          <Text className="font-black text-sm flex-1" style={{ color: draft.pipelineId ? colors.textMain : colors.textDim }} numberOfLines={1}>
                            {selectedPipeline?.name ?? 'None'}
                          </Text>
                        </View>
                        <FontAwesome name={showPipelineDropdown ? 'chevron-up' : 'chevron-down'} size={11} color={colors.textDim} />
                      </TouchableOpacity>
                    </View>

                    <View className="flex-1">
                      <Text className="text-[10px] font-black uppercase tracking-widest mb-3 ml-1" style={{ color: colors.textMuted }}>Project</Text>
                      <TouchableOpacity
                        ref={projectButtonRef}
                        onPress={() => {
                          if (!showProjectDropdown) {
                            openOverlay(projectButtonRef, setProjectDropdownPos, setShowProjectDropdown);
                            setShowCalendar(false); setShowStartCalendar(false); setShowPipelineDropdown(false);
                          } else { setShowProjectDropdown(false); }
                        }}
                        className="rounded-2xl px-5 py-4 flex-row items-center justify-between transition-all"
                        style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: showProjectDropdown ? colors.accent : colors.border }}
                      >
                        <View className="flex-row items-center gap-3 flex-1">
                          {selectedProject?.color
                            ? <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: selectedProject.color }} />
                            : <FontAwesome name="folder-o" size={13} color={colors.textDim} />
                          }
                          <Text className="font-black text-sm flex-1" style={{ color: draft.projectId ? colors.textMain : colors.textDim }} numberOfLines={1}>
                            {selectedProject?.name ?? 'None'}
                          </Text>
                        </View>
                        <FontAwesome name={showProjectDropdown ? 'chevron-up' : 'chevron-down'} size={11} color={colors.textDim} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Auto-assignment preview — shows the pipeline's mode and who it will pick */}
                  <AssignmentModePreview preview={assignmentPreview} hasManualAssignees={assignmentCount > 0} />

                  {/* Start Date + Deadline */}
                  <View className="gap-2">
                    <View className="flex-row gap-8">
                      {/* Start Date */}
                      <View className="flex-1">
                        <Text className="text-[10px] font-black uppercase tracking-widest mb-3 ml-1" style={{ color: colors.textMuted }}>Start Date</Text>
                        <View className="rounded-2xl flex-row items-center overflow-hidden" style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: dateConflict ? colors.warning : colors.border }}>
                          <TouchableOpacity
                            ref={startCalendarButtonRef}
                            onPress={() => {
                              if (!showStartCalendar) {
                                openOverlay(startCalendarButtonRef, setStartCalendarPos, setShowStartCalendar);
                                setShowCalendar(false); setShowPipelineDropdown(false); setShowProjectDropdown(false);
                              } else { setShowStartCalendar(false); }
                            }}
                            className="flex-1 px-6 py-4"
                          >
                            <Text className="font-black text-sm" style={{ color: draft.startDate ? colors.textMain : colors.textDim }}>
                              {draft.startDate ? new Date(draft.startDate).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'Set Start Date'}
                            </Text>
                          </TouchableOpacity>
                          {draft.startDate ? (
                            <TouchableOpacity onPress={() => setDraft({ startDate: null })} className="px-4 py-4">
                              <FontAwesome name="times-circle" size={14} color={colors.textDim} />
                            </TouchableOpacity>
                          ) : (
                            <TouchableOpacity
                              onPress={() => {
                                if (!showStartCalendar) {
                                  openOverlay(startCalendarButtonRef, setStartCalendarPos, setShowStartCalendar);
                                  setShowCalendar(false); setShowPipelineDropdown(false); setShowProjectDropdown(false);
                                } else { setShowStartCalendar(false); }
                              }}
                              className="px-4 py-4"
                            >
                              <FontAwesome name="calendar-o" size={14} color={colors.accent} />
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>

                      {/* Deadline */}
                      <View className="flex-1">
                        <Text className="text-[10px] font-black uppercase tracking-widest mb-3 ml-1" style={{ color: colors.textMuted }}>Deadline</Text>
                        <View className="rounded-2xl flex-row items-center overflow-hidden" style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: dateConflict ? colors.warning : colors.border }}>
                          <TouchableOpacity
                            ref={calendarButtonRef}
                            onPress={() => {
                              if (!showCalendar) {
                                openOverlay(calendarButtonRef, setCalendarPos, setShowCalendar);
                                setShowStartCalendar(false); setShowPipelineDropdown(false); setShowProjectDropdown(false);
                              } else { setShowCalendar(false); }
                            }}
                            className="flex-1 px-6 py-4"
                          >
                            <Text className="font-black text-sm" style={{ color: draft.dueDate ? colors.textMain : colors.textDim }}>
                              {draft.dueDate ? new Date(draft.dueDate).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'Set Deadline'}
                            </Text>
                          </TouchableOpacity>
                          {draft.dueDate ? (
                            <TouchableOpacity onPress={() => setDraft({ dueDate: null })} className="px-4 py-4">
                              <FontAwesome name="times-circle" size={14} color={colors.textDim} />
                            </TouchableOpacity>
                          ) : (
                            <TouchableOpacity
                              onPress={() => {
                                if (!showCalendar) {
                                  openOverlay(calendarButtonRef, setCalendarPos, setShowCalendar);
                                  setShowStartCalendar(false); setShowPipelineDropdown(false); setShowProjectDropdown(false);
                                } else { setShowCalendar(false); }
                              }}
                              className="px-4 py-4"
                            >
                              <FontAwesome name="calendar" size={14} color={colors.primary} />
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    </View>

                    {/* Date conflict warning */}
                    {dateConflict && (
                      <View className="flex-row items-center gap-2 ml-1">
                        <FontAwesome name="exclamation-triangle" size={11} color={colors.warning} />
                        <Text className="text-[10px] font-black uppercase tracking-wider" style={{ color: colors.warning }}>Start date is after deadline</Text>
                      </View>
                    )}
                  </View>

                  {/* Category + Max Hours */}
                  <View className="flex-row gap-8">
                    <View className="flex-1">
                      <View className="flex-row items-center justify-between mb-3 ml-1">
                        <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Category Registry</Text>
                        <ClipboardControls value={draft.category} onPaste={t => setDraft({ category: t })} />
                      </View>
                      <TextInput
                        value={draft.category ?? ''}
                        onChangeText={t => setDraft({ category: t })}
                        placeholder="General"
                        placeholderTextColor={colors.textDim}
                        className="rounded-2xl px-6 py-4 font-black"
                        style={{ backgroundColor: colors.background, color: colors.textMain, borderWidth: 1, borderColor: colors.border }}
                      />
                    </View>
                    <View className="w-52">
                      <Text className="text-[10px] font-black uppercase tracking-widest mb-3 ml-1" style={{ color: colors.textMuted }}>Max Hours</Text>
                      <View className="rounded-2xl px-3 py-4 flex-row items-center gap-1" style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}>
                        <TextInput
                          value={draft.estimatedHours != null ? draft.estimatedHours.toString() : ''}
                          onChangeText={t => {
                            const val = parseFloat(t);
                            setDraft({ estimatedHours: t === '' ? null : isNaN(val) ? null : val });
                          }}
                          placeholder="e.g. 4"
                          placeholderTextColor={colors.textDim}
                          keyboardType="decimal-pad"
                          className="flex-1 font-black"
                          style={{ color: colors.textMain }}
                        />
                        <Text className="text-[10px] font-black uppercase tracking-wider" style={{ color: colors.textDim }}>hrs</Text>
                      </View>
                      {/* Hour presets */}
                      <View className="flex-row gap-1.5 mt-2 flex-wrap">
                        {HOUR_PRESETS.map(h => (
                          <TouchableOpacity
                            key={h}
                            onPress={() => setDraft({ estimatedHours: draft.estimatedHours === h ? null : h })}
                            className={`px-2.5 py-1 rounded-lg border transition-all ${draft.estimatedHours === h ? '' : 'hover:border-brand-primary/50'}`}
                            style={{ backgroundColor: draft.estimatedHours === h ? colors.primary : colors.background, borderColor: draft.estimatedHours === h ? colors.primary : colors.border }}
                          >
                            <Text className="text-[10px] font-black" style={{ color: draft.estimatedHours === h ? '#fff' : colors.textDim }}>{h}h</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  </View>

                  {/* Mandate Documentation */}
                  <View>
                    <View className="flex-row items-center justify-between mb-3 ml-1">
                      <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Mandate Documentation</Text>
                      <ClipboardControls
                        value={draft.description}
                        onPaste={t => setDraft({ description: draft.description ? `${draft.description}\n${t}` : t })}
                      />
                    </View>
                    <TextInput
                      value={draft.description ?? ''}
                      onChangeText={t => setDraft({ description: t })}
                      placeholder="Define the scope of this tactical objective..."
                      placeholderTextColor={colors.textDim}
                      multiline
                      numberOfLines={5}
                      textAlignVertical="top"
                      className="rounded-3xl px-6 py-5 text-sm leading-6 h-36"
                      style={{ backgroundColor: colors.background, color: colors.textMain, borderWidth: 1, borderColor: colors.border }}
                    />
                  </View>

                  {/* Brief Files — per-task attachments, hidden in bulk mode */}
                  {!bulkMode && (
                  <View>
                    <Text className="text-[10px] font-black uppercase tracking-widest mb-3 ml-1" style={{ color: colors.textMuted }}>Brief Files</Text>
                    <Text className="text-xs mb-4" style={{ color: colors.textMuted }}>Attach reference materials, specs, or context files for the assignee.</Text>

                    {/* Adaptive File Grid */}
                    {briefFiles.length > 0 && (
                      <AdaptiveFileGrid 
                        files={briefFiles} 
                        onRemove={(id) => setBriefFiles(prev => prev.filter(x => x.id !== id))} 
                        isUploading={loading} 
                      />
                    )}

                    <View className="flex-row gap-4">
                      <TouchableOpacity
                        onPress={async () => {
                          const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, allowsMultipleSelection: true });
                          if (!result.canceled) setBriefFiles(prev => [...prev, ...result.assets.map(a => ({ id: Math.random().toString(36).substring(7), uri: a.uri, name: a.fileName || `image_${Date.now()}.jpg`, size: a.fileSize || 0, type: a.mimeType || 'image/jpeg' }))]);
                        }}
                        className="flex-row items-center px-4 py-3 rounded-xl hover:border-brand-primary transition-colors"
                        style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}
                      >
                        <FontAwesome name="camera" size={13} color={colors.primary} />
                        <Text className="text-xs font-black uppercase ml-2" style={{ color: colors.primary }}>Add Photo</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={async () => {
                          const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true });
                          if (!result.canceled) setBriefFiles(prev => [...prev, ...result.assets.map(a => ({ id: Math.random().toString(36).substring(7), uri: a.uri, name: a.name, size: a.size || 0, type: a.mimeType || 'application/octet-stream' }))]);
                        }}
                        className="flex-row items-center px-4 py-3 rounded-xl hover:border-brand-primary transition-colors"
                        style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}
                      >
                        <FontAwesome name="paperclip" size={13} color={colors.primary} />
                        <Text className="text-xs font-black uppercase ml-2" style={{ color: colors.primary }}>Attach File</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={async () => {
                          const file = await getPastedImageFile();
                          if (file) setBriefFiles(prev => [...prev, file]);
                        }}
                        className="flex-row items-center px-4 py-3 rounded-xl hover:border-brand-primary transition-colors"
                        style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}
                      >
                        <FontAwesome name="clipboard" size={13} color={colors.primary} />
                        <Text className="text-xs font-black uppercase ml-2" style={{ color: colors.primary }}>Paste Image</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  )}

                </View>
              ) : (
                /* ── ASSIGNMENTS TAB ── */
                <View className="gap-8 pb-10">
                  <View className="rounded-2xl flex-row items-center px-6 py-4 mb-4" style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}>
                    <FontAwesome name="search" size={14} color={colors.textMuted} />
                    <TextInput
                      placeholder="Search Agents or Teams..."
                      placeholderTextColor={colors.textDim}
                      value={search}
                      onChangeText={setSearch}
                      className="flex-1 font-bold ml-4"
                      style={{ color: colors.textMain }}
                    />
                    {search.length > 0 && (
                      <TouchableOpacity onPress={() => setSearch('')} className="ml-2 p-1">
                        <FontAwesome name="times-circle" size={13} color={colors.textDim} />
                      </TouchableOpacity>
                    )}
                  </View>

                  <View className="flex-row gap-8">
                    <View className="flex-1">
                      <Text className="text-[10px] font-black uppercase tracking-widest mb-4 ml-1" style={{ color: colors.primary }}>Individual Agents</Text>
                      <View className="gap-2">
                        {users.filter(u => u.full_name?.toLowerCase().includes(search.toLowerCase())).map(u => (
                          <TouchableOpacity
                            key={u.id}
                            onPress={() => toggleUser(u.id)}
                            className={`flex-row items-center justify-between p-4 rounded-xl border transition-all ${draft.assigneeUserIds.includes(u.id) ? '' : 'hover:border-brand-primary/40'}`}
                            style={{
                              backgroundColor: draft.assigneeUserIds.includes(u.id) ? colors.primary + '1A' : colors.background + '80',
                              borderColor: draft.assigneeUserIds.includes(u.id) ? colors.primary : colors.border,
                            }}
                          >
                            <View className="flex-row items-center">
                              <View className="w-8 h-8 rounded-full items-center justify-center mr-3" style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
                                <Text className="font-black text-[10px]" style={{ color: colors.textMain }}>{u.full_name?.charAt(0)}</Text>
                              </View>
                              <Text className="font-bold text-sm" style={{ color: colors.textMain }}>{u.full_name}</Text>
                            </View>
                            {draft.assigneeUserIds.includes(u.id) && <FontAwesome name="check" size={12} color={colors.primary} />}
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>

                    <View className="flex-1">
                      <Text className="text-[10px] font-black uppercase tracking-widest mb-4 ml-1" style={{ color: colors.accent }}>Tactical Teams</Text>
                      <View className="gap-2">
                        {teams.filter(t => t.name?.toLowerCase().includes(search.toLowerCase())).map(t => (
                          <TouchableOpacity
                            key={t.id}
                            onPress={() => toggleTeam(t.id)}
                            className={`flex-row items-center justify-between p-4 rounded-xl border transition-all ${draft.assigneeTeamIds.includes(t.id) ? '' : 'hover:border-brand-accent/40'}`}
                            style={{
                              backgroundColor: draft.assigneeTeamIds.includes(t.id) ? colors.accent + '1A' : colors.background + '80',
                              borderColor: draft.assigneeTeamIds.includes(t.id) ? colors.accent : colors.border,
                            }}
                          >
                            <View className="flex-row items-center">
                              <View style={{ backgroundColor: t.color || colors.accent }} className="w-3 h-3 rounded-full mr-4" />
                              <Text className="font-bold text-sm" style={{ color: colors.textMain }}>{t.name}</Text>
                            </View>
                            {draft.assigneeTeamIds.includes(t.id) && <FontAwesome name="check" size={12} color={colors.accent} />}
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Footer */}
            <View className="px-10 py-6 flex-row gap-6 items-center" style={{ borderTopWidth: 1, borderColor: colors.border }}>
              <TouchableOpacity
                onPress={onClose}
                disabled={loading}
                className="flex-1 py-5 rounded-2xl items-center hover:bg-surface-overlay transition-colors"
                style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}
              >
                <Text className="font-black uppercase tracking-widest text-xs" style={{ color: colors.textMuted }}>Keep as Draft</Text>
              </TouchableOpacity>
              <View className="flex-[2] gap-1.5">
                <TouchableOpacity
                  onPress={handleCreate}
                  disabled={loading || !canSubmit}
                  className={`py-5 rounded-2xl items-center premium-shadow transition-all ${loading || !canSubmit ? 'opacity-50' : 'hover:scale-[1.01] active:scale-[0.98]'}`}
                  style={{ backgroundColor: loading || !canSubmit ? colors.border : colors.primary }}
                >
                  {loading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-white font-black uppercase tracking-[0.3em] text-xs">
                      {bulkMode ? `Deploy ${bulkTitles.length} Task${bulkTitles.length === 1 ? '' : 's'}` : 'Authorize Deployment'}
                    </Text>
                  )}
                </TouchableOpacity>
                <Text className="text-[9px] font-bold text-center tracking-wider" style={{ color: colors.textDim }}>⌘ + Enter to submit</Text>
              </View>
            </View>

            {loading && (
              <View className="absolute inset-0 z-50 items-center justify-center" style={{ backgroundColor: colors.background + 'B3' }}>
                <View className="rounded-[2rem] px-7 py-6 items-center premium-shadow" style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text className="font-black uppercase tracking-[0.25em] text-[10px] mt-3" style={{ color: colors.textMain }}>Creating task</Text>
                </View>
              </View>
            )}

          </View>
        </View>

        {/* ── Fixed-position overlays ── */}

        {(showCalendar || showStartCalendar || showPipelineDropdown || showProjectDropdown) && (
          <TouchableOpacity
            style={{ position: 'fixed', inset: 0, zIndex: 998 } as any}
            onPress={closeAllOverlays}
            activeOpacity={0}
          />
        )}

        {/* Deadline calendar */}
        {showCalendar && (
          <View style={{ position: 'fixed', top: calendarPos.top, left: Math.max(20, Math.min(calendarPos.left, width - 420)), zIndex: 999 } as any}>
            <PremiumCalendarPicker
              selectedDate={draft.dueDate}
              onSelect={date => setDraft({ dueDate: date })}
              accentColor={colors.primary}
              rangeDate={draft.startDate}
              rangeColor={colors.accent}
              compact
              showQuickSelect
            />
          </View>
        )}

        {/* Start date calendar */}
        {showStartCalendar && (
          <View style={{ position: 'fixed', top: startCalendarPos.top, left: Math.max(20, Math.min(startCalendarPos.left, width - 420)), zIndex: 999 } as any}>
            <PremiumCalendarPicker
              selectedDate={draft.startDate}
              accentColor={colors.accent}
              onSelect={date => setDraft({ startDate: date })}
              rangeDate={draft.dueDate}
              rangeColor={colors.primary}
              compact
              showQuickSelect
            />
          </View>
        )}

        {/* Pipeline dropdown */}
        {showPipelineDropdown && (
          <View
            style={{ position: 'fixed', top: pipelineDropdownPos.top, left: pipelineDropdownPos.left, width: pipelineDropdownPos.width, zIndex: 999, maxHeight: 300, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border } as any}
            className="rounded-2xl overflow-hidden premium-shadow"
          >
            <View className="p-3" style={{ borderBottomWidth: 1, borderColor: colors.border }}>
              <View className="flex-row items-center px-4 py-2.5 rounded-xl gap-3" style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}>
                <FontAwesome name="search" size={12} color={colors.textDim} />
                <TextInput value={pipelineSearch} onChangeText={setPipelineSearch} placeholder="Search pipelines..." placeholderTextColor={colors.textDim} className="flex-1 font-bold text-sm" style={{ color: colors.textMain }} autoFocus />
              </View>
            </View>
            <ScrollView style={{ maxHeight: 220 }}>
              <TouchableOpacity
                onPress={() => { setDraft({ pipelineId: null }); setShowPipelineDropdown(false); setPipelineSearch(''); }}
                className="flex-row items-center px-5 py-3.5 hover:bg-surface-overlay"
                style={{ borderBottomWidth: 1, borderColor: colors.border + '66', backgroundColor: !draft.pipelineId ? colors.primary + '0D' : undefined }}
              >
                <FontAwesome name="times-circle-o" size={13} color={colors.textDim} />
                <Text className="font-bold text-sm ml-3 flex-1" style={{ color: colors.textDim }}>None</Text>
                {!draft.pipelineId && <FontAwesome name="check" size={11} color={colors.primary} />}
              </TouchableOpacity>
              {pipelines.filter(p => p.name.toLowerCase().includes(pipelineSearch.toLowerCase())).map(p => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => { setDraft({ pipelineId: p.id }); setShowPipelineDropdown(false); setPipelineSearch(''); }}
                  className="flex-row items-center px-5 py-3.5 hover:bg-surface-overlay"
                  style={{ backgroundColor: draft.pipelineId === p.id ? colors.primary + '0D' : undefined }}
                >
                  <FontAwesome name="sitemap" size={13} color={draft.pipelineId === p.id ? colors.primary : colors.textDim} />
                  <Text className="font-bold text-sm ml-3 flex-1" style={{ color: draft.pipelineId === p.id ? colors.primary : colors.textMain }}>{p.name}</Text>
                  {draft.pipelineId === p.id && <FontAwesome name="check" size={11} color={colors.primary} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Project dropdown */}
        {showProjectDropdown && (
          <View
            style={{ position: 'fixed', top: projectDropdownPos.top, left: projectDropdownPos.left, width: projectDropdownPos.width, zIndex: 999, maxHeight: 400, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border } as any}
            className="rounded-2xl overflow-hidden premium-shadow"
          >
            {!showCreateProject ? (
              <>
                <View className="p-3 flex-row gap-2" style={{ borderBottomWidth: 1, borderColor: colors.border }}>
                  <View className="flex-1 flex-row items-center px-4 py-2.5 rounded-xl gap-3" style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}>
                    <FontAwesome name="search" size={12} color={colors.textDim} />
                    <TextInput value={projectSearch} onChangeText={setProjectSearch} placeholder="Search projects..." placeholderTextColor={colors.textDim} className="flex-1 font-bold text-sm" style={{ color: colors.textMain }} autoFocus />
                  </View>
                  {hasPermission('project.create') && (
                    <TouchableOpacity
                      onPress={() => setShowCreateProject(true)}
                      className="rounded-xl px-3 py-2.5 items-center justify-center hover:bg-brand-accent/20 transition-colors"
                      style={{ backgroundColor: colors.accent + '1A', borderWidth: 1, borderColor: colors.accent }}
                    >
                      <FontAwesome name="plus" size={13} color={colors.accent} />
                    </TouchableOpacity>
                  )}
                </View>
                <ScrollView style={{ maxHeight: 330 }}>
                  <TouchableOpacity
                    onPress={() => { setDraft({ projectId: null }); setShowProjectDropdown(false); setProjectSearch(''); }}
                    className="flex-row items-center px-5 py-3.5 hover:bg-surface-overlay"
                    style={{ borderBottomWidth: 1, borderColor: colors.border + '66', backgroundColor: !draft.projectId ? colors.accent + '0D' : undefined }}
                  >
                    <FontAwesome name="times-circle-o" size={13} color={colors.textDim} />
                    <Text className="font-bold text-sm ml-3 flex-1" style={{ color: colors.textDim }}>None</Text>
                    {!draft.projectId && <FontAwesome name="check" size={11} color={colors.accent} />}
                  </TouchableOpacity>
                  {projects.filter(p => p.name.toLowerCase().includes(projectSearch.toLowerCase())).map(p => (
                    <TouchableOpacity
                      key={p.id}
                      onPress={() => { setDraft({ projectId: p.id }); setShowProjectDropdown(false); setProjectSearch(''); }}
                      className="flex-row items-center px-5 py-3.5 hover:bg-surface-overlay"
                      style={{ backgroundColor: draft.projectId === p.id ? colors.accent + '0D' : undefined }}
                    >
                      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: p.color || colors.accent }} />
                      <Text className="font-bold text-sm ml-3 flex-1" style={{ color: draft.projectId === p.id ? colors.accent : colors.textMain }}>{p.name}</Text>
                      {draft.projectId === p.id && <FontAwesome name="check" size={11} color={colors.accent} />}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            ) : (
              <View className="p-5">
                <View className="flex-row items-center justify-between mb-5">
                  <Text className="font-black text-sm" style={{ color: colors.textMain }}>Create Project</Text>
                  <TouchableOpacity onPress={() => { setShowCreateProject(false); setNewProjectName(''); setNewProjectColor('#3B82F6'); }} disabled={creatingProject}>
                    <FontAwesome name="times" size={14} color={colors.textDim} />
                  </TouchableOpacity>
                </View>

                <TextInput
                  value={newProjectName}
                  onChangeText={setNewProjectName}
                  placeholder="Project name..."
                  placeholderTextColor={colors.textDim}
                  editable={!creatingProject}
                  className="rounded-xl px-4 py-3 font-bold mb-4"
                  style={{ backgroundColor: colors.background, color: colors.textMain, borderWidth: 1, borderColor: colors.border }}
                />

                <Text className="text-[10px] font-black uppercase tracking-widest mb-3 ml-1" style={{ color: colors.textMuted }}>Color</Text>
                <View className="flex-row gap-2.5 mb-4">
                  {PROJECT_COLORS.map(color => (
                    <TouchableOpacity
                      key={color}
                      onPress={() => setNewProjectColor(color)}
                      disabled={creatingProject}
                      style={{ backgroundColor: color, borderColor: newProjectColor === color ? '#fff' : 'transparent', borderWidth: newProjectColor === color ? 2 : 0 }}
                      className="w-8 h-8 rounded-lg opacity-90 hover:opacity-100 transition-opacity"
                    />
                  ))}
                </View>

                <View className="flex-row gap-2">
                  <TouchableOpacity
                    onPress={() => { setShowCreateProject(false); setNewProjectName(''); setNewProjectColor('#3B82F6'); }}
                    disabled={creatingProject}
                    className="flex-1 rounded-xl py-3 items-center hover:bg-surface-overlay transition-colors"
                    style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}
                  >
                    <Text className="font-bold text-sm" style={{ color: colors.textMuted }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleCreateProject}
                    disabled={creatingProject || !newProjectName.trim()}
                    className={`flex-1 rounded-xl py-3 items-center ${creatingProject || !newProjectName.trim() ? 'opacity-50' : 'hover:scale-105 transition-transform'}`}
                    style={{ backgroundColor: creatingProject || !newProjectName.trim() ? colors.border : colors.accent }}
                  >
                    {creatingProject ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text className="text-white font-bold text-sm">Create</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

      </View>
    </Modal>
  );
}