import ClipboardControls from '@/components/common/ClipboardControls';
import PremiumCalendarPicker from '@/components/common/PremiumCalendarPicker';
import { getPastedImageFile } from '@/lib/pasteImage';
import { useTaskCreation } from '@/contexts/TaskCreationContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import { useThemeColors } from '@/hooks/useThemeColors';

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

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-state-danger',
  high:   'text-state-warning',
  normal: 'text-brand-primary',
  low:    'text-typography-dim',
};
const PRIORITY_BG: Record<string, string> = {
  urgent: 'bg-state-danger/20',
  high:   'bg-state-warning/20',
  normal: 'bg-brand-primary/20',
  low:    'bg-surface-overlay',
};

function quickDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export default function CreateTaskModal({ visible, onClose, initialPipelineId }: Props) {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const { hasPermission } = useAuth();
  const { draft, setDraft, createTask, loading, recentTasks, loadRecentTasks, briefFiles, setBriefFiles } = useTaskCreation();
  const [activeTab, setActiveTab] = useState<'details' | 'assignments'>('details');
  const [users, setUsers]         = useState<any[]>([]);
  const [teams, setTeams]         = useState<any[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [projects,  setProjects]  = useState<Project[]>([]);
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
    const id = await createTask();
    if (id) onClose();
  }, [createTask, onClose]);

  // Keyboard: Escape closes overlays, ⌘/Ctrl+Enter submits
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAllOverlays();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && draft.title && !loading) handleCreate();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, draft.title, loading, closeAllOverlays, handleCreate]);

  useEffect(() => {
    if (visible) {
      loadRecentTasks();
      fetchResources();
      if (initialPipelineId && !draft.pipelineId) setDraft({ pipelineId: initialPipelineId });
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
      priority:        task.priority,
      category:        task.category,
      weight:          task.weight,
      assigneeUserIds: task.assignments?.filter((a: any) => a.assignee_user_id).map((a: any) => a.assignee_user_id) || [],
      assigneeTeamIds: task.assignments?.filter((a: any) => a.assignee_team_id).map((a: any) => a.assignee_team_id) || [],
    });
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
  const dateConflict       = !!(draft.startDate && draft.dueDate && draft.startDate > draft.dueDate);


  return (
    <Modal visible={visible} transparent animationType="fade">
      <View className="flex-1 bg-surface-background/80 items-center justify-center p-10" style={{ backdropFilter: 'blur(12px)' } as any}>
        <View className="bg-surface-card w-full max-w-[1200px] h-[800px] rounded-[3rem] border border-surface-border overflow-hidden flex-row premium-shadow">

          {/* ── LEFT SIDEBAR ── */}
          <View className="w-80 border-r border-surface-border bg-surface-background/30 p-8">
            <View className="flex-row items-center mb-8">
              <FontAwesome name="history" size={14} className="text-brand-primary" />
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] ml-3">Tactical Archive</Text>
            </View>
            <Text className="text-typography-main font-black text-xl mb-2 tracking-tight">Recent Tasks</Text>
            <Text className="text-typography-dim text-[10px] font-bold mb-5">Tap any card to clone it</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {recentTasks.map(t => (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => handleCopyRecent(t)}
                  className="p-4 rounded-2xl bg-surface-card border border-surface-border mb-3 hover:border-brand-primary/50 transition-all group"
                >
                  <View className="flex-row items-center justify-between mb-1">
                    <Text className="text-typography-main font-bold text-sm flex-1 group-hover:text-brand-primary" numberOfLines={1}>{t.title}</Text>
                    {t.priority && (
                      <View className={`ml-2 px-2 py-0.5 rounded-md ${PRIORITY_BG[t.priority] ?? 'bg-surface-overlay'}`}>
                        <Text className={`text-[9px] font-black uppercase ${PRIORITY_COLORS[t.priority] ?? 'text-typography-dim'}`}>{t.priority}</Text>
                      </View>
                    )}
                  </View>
                  <View className="flex-row items-center justify-between mt-1">
                    <Text className="text-typography-muted text-[10px] uppercase font-black tracking-widest">{t.category || 'General'}</Text>
                    <Text className="text-brand-primary text-[9px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all">Clone →</Text>
                  </View>
                </TouchableOpacity>
              ))}
              {recentTasks.length === 0 && (
                <View className="py-20 items-center opacity-30">
                  <FontAwesome name="inbox" size={32} color={colors.textMuted} />
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mt-4">Empty Stack</Text>
                </View>
              )}
            </ScrollView>
          </View>

          {/* ── MAIN CONTENT ── */}
          <View className="flex-1 flex-col">

            {/* Header */}
            <View className="px-10 py-8 border-b border-surface-border flex-row items-center justify-between">
              <View>
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.3em] mb-1">Task Orchestrator</Text>
                <Text className="text-typography-main text-3xl font-black tracking-tighter">Initialize Deployment</Text>
              </View>
                <TouchableOpacity
                  onPress={onClose}
                  disabled={loading}
                  className={`w-12 h-12 bg-surface-background rounded-full items-center justify-center border border-surface-border transition-colors ${loading ? 'opacity-40' : 'hover:border-brand-primary'}`}
                >
                  <FontAwesome name="times" size={18} className="text-typography-muted" />
              </TouchableOpacity>
            </View>

            {/* Tabs */}
            <View className="px-10 py-4 flex-row gap-8 border-b border-surface-border/40">
              <TouchableOpacity onPress={() => setActiveTab('details')}>
                <Text className={`font-black text-xs uppercase tracking-widest pb-2 border-b-2 transition-all ${activeTab === 'details' ? 'text-brand-primary border-brand-primary' : 'text-typography-muted border-transparent'}`}>
                  Details
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setActiveTab('assignments')}>
                <View className="flex-row items-center gap-2 pb-2 border-b-2" style={{ borderBottomColor: activeTab === 'assignments' ? colors.primary : 'transparent' }}>
                  <Text className={`font-black text-xs uppercase tracking-widest ${activeTab === 'assignments' ? 'text-brand-primary' : 'text-typography-muted'}`}>
                    Assignments
                  </Text>
                  {assignmentCount > 0 && (
                    <View className="bg-brand-primary rounded-full w-4 h-4 items-center justify-center">
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
                      <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest ml-1">Engagement Title</Text>
                      <View className="flex-row items-center gap-4 mr-1">
                        <ClipboardControls value={draft.title} onPaste={t => setDraft({ title: t })} />
                        <Text className="text-state-danger text-[10px] font-black uppercase tracking-wider">Required</Text>
                      </View>
                    </View>
                    <TextInput
                      value={draft.title ?? ''}
                      onChangeText={t => setDraft({ title: t })}
                      placeholder="e.g. Critical Infrastructure Audit"
                      placeholderTextColor={colors.textDim}
                      className={`bg-surface-background border rounded-2xl px-6 py-5 text-typography-main font-black text-lg transition-colors ${draft.title ? 'border-surface-border' : 'border-state-danger/30'}`}
                    />
                  </View>

                  {/* Priority + Weight */}
                  <View className="flex-row gap-8">
                    <View className="flex-1">
                      <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-3 ml-1">Priority Level</Text>
                      <View className="flex-row bg-surface-background border border-surface-border rounded-2xl p-1.5">
                        {(['low', 'normal', 'high', 'urgent'] as const).map(p => (
                          <TouchableOpacity
                            key={p}
                            onPress={() => setDraft({ priority: p })}
                            className={`flex-1 py-3 items-center rounded-xl transition-all ${draft.priority === p ? 'bg-brand-primary' : 'hover:bg-surface-overlay'}`}
                          >
                            <Text className={`font-black text-[10px] uppercase tracking-widest ${draft.priority === p ? 'text-white' : 'text-typography-muted'}`}>{p}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                    <View className="w-36">
                      <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-3 ml-1">Weight</Text>
                      <TextInput
                        value={(draft.weight ?? 1).toString()}
                        onChangeText={t => setDraft({ weight: parseInt(t) || 1 })}
                        keyboardType="numeric"
                        className="bg-surface-background border border-surface-border rounded-2xl px-6 py-4 text-typography-main font-black text-center"
                      />
                    </View>
                  </View>

                  {/* Pipeline + Project */}
                  <View className="flex-row gap-8">
                    <View className="flex-1">
                      <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-3 ml-1">Pipeline</Text>
                      <TouchableOpacity
                        ref={pipelineButtonRef}
                        onPress={() => {
                          if (!showPipelineDropdown) {
                            openOverlay(pipelineButtonRef, setPipelineDropdownPos, setShowPipelineDropdown);
                            setShowCalendar(false); setShowStartCalendar(false); setShowProjectDropdown(false);
                          } else { setShowPipelineDropdown(false); }
                        }}
                        className={`bg-surface-background border rounded-2xl px-5 py-4 flex-row items-center justify-between transition-all ${showPipelineDropdown ? 'border-brand-primary' : 'border-surface-border'}`}
                      >
                        <View className="flex-row items-center gap-3 flex-1">
                          <FontAwesome name="sitemap" size={13} color={draft.pipelineId ? colors.primary : colors.textDim} />
                          <Text className={`font-black text-sm flex-1 ${draft.pipelineId ? 'text-typography-main' : 'text-typography-dim'}`} numberOfLines={1}>
                            {selectedPipeline?.name ?? 'None'}
                          </Text>
                        </View>
                        <FontAwesome name={showPipelineDropdown ? 'chevron-up' : 'chevron-down'} size={11} color={colors.textDim} />
                      </TouchableOpacity>
                    </View>

                    <View className="flex-1">
                      <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-3 ml-1">Project</Text>
                      <TouchableOpacity
                        ref={projectButtonRef}
                        onPress={() => {
                          if (!showProjectDropdown) {
                            openOverlay(projectButtonRef, setProjectDropdownPos, setShowProjectDropdown);
                            setShowCalendar(false); setShowStartCalendar(false); setShowPipelineDropdown(false);
                          } else { setShowProjectDropdown(false); }
                        }}
                        className={`bg-surface-background border rounded-2xl px-5 py-4 flex-row items-center justify-between transition-all ${showProjectDropdown ? 'border-brand-accent' : 'border-surface-border'}`}
                      >
                        <View className="flex-row items-center gap-3 flex-1">
                          {selectedProject?.color
                            ? <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: selectedProject.color }} />
                            : <FontAwesome name="folder-o" size={13} color={colors.textDim} />
                          }
                          <Text className={`font-black text-sm flex-1 ${draft.projectId ? 'text-typography-main' : 'text-typography-dim'}`} numberOfLines={1}>
                            {selectedProject?.name ?? 'None'}
                          </Text>
                        </View>
                        <FontAwesome name={showProjectDropdown ? 'chevron-up' : 'chevron-down'} size={11} color={colors.textDim} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Start Date + Deadline */}
                  <View className="gap-2">
                    <View className="flex-row gap-8">
                      {/* Start Date */}
                      <View className="flex-1">
                        <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-3 ml-1">Start Date</Text>
                        <View className={`bg-surface-background border rounded-2xl flex-row items-center overflow-hidden ${dateConflict ? 'border-state-warning' : 'border-surface-border'}`}>
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
                            <Text className={`font-black text-sm ${draft.startDate ? 'text-typography-main' : 'text-typography-dim'}`}>
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
                        <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-3 ml-1">Deadline</Text>
                        <View className={`bg-surface-background border rounded-2xl flex-row items-center overflow-hidden ${dateConflict ? 'border-state-warning' : 'border-surface-border'}`}>
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
                            <Text className={`font-black text-sm ${draft.dueDate ? 'text-typography-main' : 'text-typography-dim'}`}>
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
                        <Text className="text-state-warning text-[10px] font-black uppercase tracking-wider">Start date is after deadline</Text>
                      </View>
                    )}
                  </View>

                  {/* Category + Max Hours */}
                  <View className="flex-row gap-8">
                    <View className="flex-1">
                      <View className="flex-row items-center justify-between mb-3 ml-1">
                        <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest">Category Registry</Text>
                        <ClipboardControls value={draft.category} onPaste={t => setDraft({ category: t })} />
                      </View>
                      <TextInput
                        value={draft.category ?? ''}
                        onChangeText={t => setDraft({ category: t })}
                        placeholder="General"
                        placeholderTextColor={colors.textDim}
                        className="bg-surface-background border border-surface-border rounded-2xl px-6 py-4 text-typography-main font-black"
                      />
                    </View>
                    <View className="w-52">
                      <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-3 ml-1">Max Hours</Text>
                      <View className="bg-surface-background border border-surface-border rounded-2xl px-6 py-4 flex-row items-center gap-2">
                        <TextInput
                          value={draft.estimatedHours != null ? draft.estimatedHours.toString() : ''}
                          onChangeText={t => {
                            const val = parseFloat(t);
                            setDraft({ estimatedHours: t === '' ? null : isNaN(val) ? null : val });
                          }}
                          placeholder="e.g. 4"
                          placeholderTextColor={colors.textDim}
                          keyboardType="decimal-pad"
                          className="flex-1 text-typography-main font-black"
                        />
                        <Text className="text-typography-dim text-[10px] font-black uppercase tracking-wider">hrs</Text>
                      </View>
                      {/* Hour presets */}
                      <View className="flex-row gap-1.5 mt-2 flex-wrap">
                        {HOUR_PRESETS.map(h => (
                          <TouchableOpacity
                            key={h}
                            onPress={() => setDraft({ estimatedHours: draft.estimatedHours === h ? null : h })}
                            className={`px-2.5 py-1 rounded-lg border transition-all ${draft.estimatedHours === h ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border hover:border-brand-primary/50'}`}
                          >
                            <Text className={`text-[10px] font-black ${draft.estimatedHours === h ? 'text-white' : 'text-typography-dim'}`}>{h}h</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  </View>

                  {/* Mandate Documentation */}
                  <View>
                    <View className="flex-row items-center justify-between mb-3 ml-1">
                      <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest">Mandate Documentation</Text>
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
                      className="bg-surface-background border border-surface-border rounded-3xl px-6 py-5 text-typography-main text-sm leading-6 h-36"
                    />
                  </View>

                  {/* Brief Files */}
                  <View>
                    <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-3 ml-1">Brief Files</Text>
                    <Text className="text-typography-muted text-xs mb-4">Attach reference materials, specs, or context files for the assignee.</Text>
                    {briefFiles.length > 0 && (
                      <View className="gap-2 mb-4">
                        {briefFiles.map(f => (
                          <View key={f.id} className="flex-row items-center bg-surface-background px-4 py-3 rounded-xl border border-surface-border/50">
                            <FontAwesome name={f.type.startsWith('image/') ? 'file-image-o' : 'file-o'} size={13} color={colors.primary} />
                            <Text className="text-typography-main text-xs font-bold ml-3 flex-1" numberOfLines={1}>{f.name}</Text>
                            <TouchableOpacity onPress={() => setBriefFiles(prev => prev.filter(x => x.id !== f.id))} className="ml-3 p-1">
                              <FontAwesome name="times-circle" size={13} color={colors.danger} />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    )}
                    <View className="flex-row gap-4">
                      <TouchableOpacity
                        onPress={async () => {
                          const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, allowsMultipleSelection: true });
                          if (!result.canceled) setBriefFiles(prev => [...prev, ...result.assets.map(a => ({ id: Math.random().toString(36).substring(7), uri: a.uri, name: a.fileName || `image_${Date.now()}.jpg`, size: a.fileSize || 0, type: a.mimeType || 'image/jpeg' }))]);
                        }}
                        className="flex-row items-center bg-surface-background px-4 py-3 rounded-xl border border-surface-border hover:border-brand-primary transition-colors"
                      >
                        <FontAwesome name="camera" size={13} color={colors.primary} />
                        <Text className="text-brand-primary text-xs font-black uppercase ml-2">Add Photo</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={async () => {
                          const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true });
                          if (!result.canceled) setBriefFiles(prev => [...prev, ...result.assets.map(a => ({ id: Math.random().toString(36).substring(7), uri: a.uri, name: a.name, size: a.size || 0, type: a.mimeType || 'application/octet-stream' }))]);
                        }}
                        className="flex-row items-center bg-surface-background px-4 py-3 rounded-xl border border-surface-border hover:border-brand-primary transition-colors"
                      >
                        <FontAwesome name="paperclip" size={13} color={colors.primary} />
                        <Text className="text-brand-primary text-xs font-black uppercase ml-2">Attach File</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={async () => {
                          const file = await getPastedImageFile();
                          if (file) setBriefFiles(prev => [...prev, file]);
                        }}
                        className="flex-row items-center bg-surface-background px-4 py-3 rounded-xl border border-surface-border hover:border-brand-primary transition-colors"
                      >
                        <FontAwesome name="clipboard" size={13} color={colors.primary} />
                        <Text className="text-brand-primary text-xs font-black uppercase ml-2">Paste Image</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                </View>
              ) : (
                /* ── ASSIGNMENTS TAB ── */
                <View className="gap-8 pb-10">
                  <View className="bg-surface-background border border-surface-border rounded-2xl flex-row items-center px-6 py-4 mb-4">
                    <FontAwesome name="search" size={14} color={colors.textMuted} />
                    <TextInput
                      placeholder="Search Agents or Teams..."
                      placeholderTextColor={colors.textDim}
                      value={search}
                      onChangeText={setSearch}
                      className="flex-1 text-typography-main font-bold ml-4"
                    />
                    {search.length > 0 && (
                      <TouchableOpacity onPress={() => setSearch('')} className="ml-2 p-1">
                        <FontAwesome name="times-circle" size={13} color={colors.textDim} />
                      </TouchableOpacity>
                    )}
                  </View>

                  <View className="flex-row gap-8">
                    <View className="flex-1">
                      <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest mb-4 ml-1">Individual Agents</Text>
                      <View className="gap-2">
                        {users.filter(u => u.full_name?.toLowerCase().includes(search.toLowerCase())).map(u => (
                          <TouchableOpacity
                            key={u.id}
                            onPress={() => toggleUser(u.id)}
                            className={`flex-row items-center justify-between p-4 rounded-xl border transition-all ${draft.assigneeUserIds.includes(u.id) ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-background/50 border-surface-border hover:border-brand-primary/40'}`}
                          >
                            <View className="flex-row items-center">
                              <View className="w-8 h-8 rounded-full bg-surface-card border border-surface-border items-center justify-center mr-3">
                                <Text className="text-typography-main font-black text-[10px]">{u.full_name?.charAt(0)}</Text>
                              </View>
                              <Text className="text-typography-main font-bold text-sm">{u.full_name}</Text>
                            </View>
                            {draft.assigneeUserIds.includes(u.id) && <FontAwesome name="check" size={12} color={colors.primary} />}
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>

                    <View className="flex-1">
                      <Text className="text-brand-accent text-[10px] font-black uppercase tracking-widest mb-4 ml-1">Tactical Teams</Text>
                      <View className="gap-2">
                        {teams.filter(t => t.name?.toLowerCase().includes(search.toLowerCase())).map(t => (
                          <TouchableOpacity
                            key={t.id}
                            onPress={() => toggleTeam(t.id)}
                            className={`flex-row items-center justify-between p-4 rounded-xl border transition-all ${draft.assigneeTeamIds.includes(t.id) ? 'bg-brand-accent/10 border-brand-accent' : 'bg-surface-background/50 border-surface-border hover:border-brand-accent/40'}`}
                          >
                            <View className="flex-row items-center">
                              <View style={{ backgroundColor: t.color || colors.accent }} className="w-3 h-3 rounded-full mr-4" />
                              <Text className="text-typography-main font-bold text-sm">{t.name}</Text>
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
            <View className="px-10 py-6 border-t border-surface-border flex-row gap-6 items-center">
              <TouchableOpacity
                onPress={onClose}
                disabled={loading}
                className="flex-1 bg-surface-background py-5 rounded-2xl border border-surface-border items-center hover:bg-surface-overlay transition-colors"
              >
                <Text className="text-typography-muted font-black uppercase tracking-widest text-xs">Keep as Draft</Text>
              </TouchableOpacity>
              <View className="flex-[2] gap-1.5">
                <TouchableOpacity
                  onPress={handleCreate}
                  disabled={loading || !draft.title}
                  className={`py-5 rounded-2xl items-center premium-shadow transition-all ${loading || !draft.title ? 'bg-surface-border opacity-50' : 'bg-brand-primary hover:scale-[1.01] active:scale-[0.98]'}`}
                >
                  {loading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-white font-black uppercase tracking-[0.3em] text-xs">Authorize Deployment</Text>
                  )}
                </TouchableOpacity>
                <Text className="text-typography-dim text-[9px] font-bold text-center tracking-wider">⌘ + Enter to submit</Text>
              </View>
            </View>

            {loading && (
              <View className="absolute inset-0 z-50 items-center justify-center bg-surface-background/70">
                <View className="bg-surface-card border border-surface-border rounded-[2rem] px-7 py-6 items-center premium-shadow">
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text className="text-typography-main font-black uppercase tracking-[0.25em] text-[10px] mt-3">Creating task</Text>
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
          <View style={{ position: 'fixed', top: calendarPos.top, left: Math.max(20, Math.min(calendarPos.left, width - 820)), width: Math.min(width - 40, 800), zIndex: 999 } as any}>
            <PremiumCalendarPicker
              selectedDate={draft.dueDate}
              onSelect={date => { setDraft({ dueDate: date }); setShowCalendar(false); }}
            />
          </View>
        )}

        {/* Start date calendar */}
        {showStartCalendar && (
          <View style={{ position: 'fixed', top: startCalendarPos.top, left: Math.max(20, Math.min(startCalendarPos.left, width - 820)), width: Math.min(width - 40, 800), zIndex: 999 } as any}>
            <PremiumCalendarPicker
              selectedDate={draft.startDate}
              accentColor={colors.accent}
              onSelect={date => { setDraft({ startDate: date }); setShowStartCalendar(false); }}
            />
          </View>
        )}

        {/* Pipeline dropdown */}
        {showPipelineDropdown && (
          <View
            style={{ position: 'fixed', top: pipelineDropdownPos.top, left: pipelineDropdownPos.left, width: pipelineDropdownPos.width, zIndex: 999, maxHeight: 300 } as any}
            className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden premium-shadow"
          >
            <View className="p-3 border-b border-surface-border">
              <View className="bg-surface-background flex-row items-center px-4 py-2.5 rounded-xl border border-surface-border gap-3">
                <FontAwesome name="search" size={12} color={colors.textDim} />
                <TextInput value={pipelineSearch} onChangeText={setPipelineSearch} placeholder="Search pipelines..." placeholderTextColor={colors.textDim} className="flex-1 text-typography-main font-bold text-sm" autoFocus />
              </View>
            </View>
            <ScrollView style={{ maxHeight: 220 }}>
              <TouchableOpacity onPress={() => { setDraft({ pipelineId: null }); setShowPipelineDropdown(false); setPipelineSearch(''); }} className={`flex-row items-center px-5 py-3.5 border-b border-surface-border/40 hover:bg-surface-overlay ${!draft.pipelineId ? 'bg-brand-primary/5' : ''}`}>
                <FontAwesome name="times-circle-o" size={13} color={colors.textDim} />
                <Text className="text-typography-dim font-bold text-sm ml-3 flex-1">None</Text>
                {!draft.pipelineId && <FontAwesome name="check" size={11} color={colors.primary} />}
              </TouchableOpacity>
              {pipelines.filter(p => p.name.toLowerCase().includes(pipelineSearch.toLowerCase())).map(p => (
                <TouchableOpacity key={p.id} onPress={() => { setDraft({ pipelineId: p.id }); setShowPipelineDropdown(false); setPipelineSearch(''); }} className={`flex-row items-center px-5 py-3.5 hover:bg-surface-overlay ${draft.pipelineId === p.id ? 'bg-brand-primary/5' : ''}`}>
                  <FontAwesome name="sitemap" size={13} color={draft.pipelineId === p.id ? colors.primary : colors.textDim} />
                  <Text className={`font-bold text-sm ml-3 flex-1 ${draft.pipelineId === p.id ? 'text-brand-primary' : 'text-typography-main'}`}>{p.name}</Text>
                  {draft.pipelineId === p.id && <FontAwesome name="check" size={11} color={colors.primary} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Project dropdown */}
        {showProjectDropdown && (
          <View
            style={{ position: 'fixed', top: projectDropdownPos.top, left: projectDropdownPos.left, width: projectDropdownPos.width, zIndex: 999, maxHeight: 400 } as any}
            className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden premium-shadow"
          >
            {!showCreateProject ? (
              <>
                <View className="p-3 border-b border-surface-border flex-row gap-2">
                  <View className="flex-1 bg-surface-background flex-row items-center px-4 py-2.5 rounded-xl border border-surface-border gap-3">
                    <FontAwesome name="search" size={12} color={colors.textDim} />
                    <TextInput value={projectSearch} onChangeText={setProjectSearch} placeholder="Search projects..." placeholderTextColor={colors.textDim} className="flex-1 text-typography-main font-bold text-sm" autoFocus />
                  </View>
                  {hasPermission('project.create') && (
                    <TouchableOpacity onPress={() => setShowCreateProject(true)} className="bg-brand-accent/10 border border-brand-accent rounded-xl px-3 py-2.5 items-center justify-center hover:bg-brand-accent/20 transition-colors">
                      <FontAwesome name="plus" size={13} color={colors.accent} />
                    </TouchableOpacity>
                  )}
                </View>
                <ScrollView style={{ maxHeight: 330 }}>
                  <TouchableOpacity onPress={() => { setDraft({ projectId: null }); setShowProjectDropdown(false); setProjectSearch(''); }} className={`flex-row items-center px-5 py-3.5 border-b border-surface-border/40 hover:bg-surface-overlay ${!draft.projectId ? 'bg-brand-accent/5' : ''}`}>
                    <FontAwesome name="times-circle-o" size={13} color={colors.textDim} />
                    <Text className="text-typography-dim font-bold text-sm ml-3 flex-1">None</Text>
                    {!draft.projectId && <FontAwesome name="check" size={11} color={colors.accent} />}
                  </TouchableOpacity>
                  {projects.filter(p => p.name.toLowerCase().includes(projectSearch.toLowerCase())).map(p => (
                    <TouchableOpacity key={p.id} onPress={() => { setDraft({ projectId: p.id }); setShowProjectDropdown(false); setProjectSearch(''); }} className={`flex-row items-center px-5 py-3.5 hover:bg-surface-overlay ${draft.projectId === p.id ? 'bg-brand-accent/5' : ''}`}>
                      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: p.color || colors.accent }} />
                      <Text className={`font-bold text-sm ml-3 flex-1 ${draft.projectId === p.id ? 'text-brand-accent' : 'text-typography-main'}`}>{p.name}</Text>
                      {draft.projectId === p.id && <FontAwesome name="check" size={11} color={colors.accent} />}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            ) : (
              <View className="p-5">
                <View className="flex-row items-center justify-between mb-5">
                  <Text className="text-typography-main font-black text-sm">Create Project</Text>
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
                  className="bg-surface-background border border-surface-border rounded-xl px-4 py-3 text-typography-main font-bold mb-4"
                />

                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-3 ml-1">Color</Text>
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
                    className="flex-1 bg-surface-background border border-surface-border rounded-xl py-3 items-center hover:bg-surface-overlay transition-colors"
                  >
                    <Text className="text-typography-muted font-bold text-sm">Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleCreateProject}
                    disabled={creatingProject || !newProjectName.trim()}
                    className={`flex-1 rounded-xl py-3 items-center ${creatingProject || !newProjectName.trim() ? 'bg-surface-border opacity-50' : 'bg-brand-accent hover:scale-105 transition-transform'}`}
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
