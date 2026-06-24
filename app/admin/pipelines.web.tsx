import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PipelineEditorProvider, usePipelineEditor } from '@/contexts/PipelineEditorContext';
import { useAuth } from '@/contexts/AuthContext';
import FontAwesome from '@expo/vector-icons/FontAwesome';

const STAGE_PRESETS = [
  { name: 'PENDING', color: '#64748b', is_initial: true },
  { name: 'IN PROGRESS', color: '#3b82f6' },
  { name: 'REVIEW', color: '#fbbf24', requires_submission: true },
  { name: 'COMPLETED', color: '#22c55e', is_terminal: true, terminal_type: 'success' },
];

const TRANSITION_PRESETS = [
  { from_position: 1, to_position: 2, label: 'Start Work' },
  { from_position: 2, to_position: 3, label: 'Submit for Review' },
  { from_position: 3, to_position: 4, label: 'Approve' },
  { from_position: 3, to_position: 2, label: 'Request Revision' },
];

// Core components
import StageBuilder from '@/components/pipeline-editor/StageBuilder.web';
import TransitionEditor from '@/components/pipeline-editor/TransitionEditor';
import AutomationEditor from '@/components/pipeline-editor/AutomationEditor';
import HandshakeEditor from '@/components/pipeline-editor/HandshakeEditor';
import SubpipelineEditor from '@/components/pipeline-editor/SubpipelineEditor';
import PipelineSettingsForm from '@/components/pipeline-editor/PipelineSettingsForm';
import { useThemeColors } from '@/hooks/useThemeColors';

type Section = 'stages' | 'transitions' | 'automations' | 'handshakes' | 'settings' | 'subpipelines';

function PipelinesWebInner() {
  const colors = useThemeColors();
  const { 
    pipelines, 
    selectedPipeline, 
    loading, 
    selectPipeline, 
    refreshPipelines,
    activeSection,
    setActiveSection,
    createPipeline,
    pipelineActions,
    roles,
    error,
    refreshPipelineData,
    clearError,
    assignmentPool,
    companyUsers,
    companyTeams,
    setAssignmentPool,
    setPoolMemberWithdrawn,
  } = usePipelineEditor();

  const { hasPermission } = useAuth();
  const canEdit = hasPermission('pipeline.edit');

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [isQuickCreate, setIsQuickCreate] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    refreshPipelines();
  }, []);

  const renderSection = () => {
    if (!selectedPipeline) {
      return (
        <View className="flex-1 items-center justify-center">
          <View className="bg-surface-card p-10 rounded-[3rem] border border-surface-border items-center max-w-md">
             <View className="w-20 h-20 bg-brand-primary/10 rounded-3xl items-center justify-center mb-6"><FontAwesome name="map-signs" size={32} className="text-brand-primary" /></View>
             <Text className="text-typography-main font-black text-2xl mb-4 text-center">No Pipeline Selected</Text>
             <Text className="text-typography-muted text-center leading-relaxed mb-8">
               Select a pipeline from the list to begin configuring stages, automations, and workflow logic.
             </Text>
             {canEdit && (
               <TouchableOpacity 
                 onPress={() => setIsCreateModalOpen(true)}
                 className="bg-brand-primary px-8 py-4 rounded-2xl active:scale-95 transition-all"
               >
                 <View className="flex-row items-center">
                   <FontAwesome name="plus" size={14} color="white" />
                   <Text className="text-white font-black ml-3 uppercase tracking-widest text-xs">Create New Pipeline</Text>
                 </View>
               </TouchableOpacity>
             )}
          </View>
        </View>
      );
    }

    switch (activeSection) {
      case 'stages': return <StageBuilder />;
      case 'transitions': return <TransitionEditor />;
      case 'automations': return <AutomationEditor />;
      case 'handshakes': return <HandshakeEditor />;
      case 'subpipelines':
        return (
          <ScrollView className="flex-1 bg-surface-background/30" contentContainerStyle={{ padding: 40 }}>
            <View className="max-w-2xl mx-auto w-full">
              <SubpipelineEditor />
            </View>
          </ScrollView>
        );
      case 'settings':
        return (
          <ScrollView className="flex-1 bg-surface-background/30" contentContainerStyle={{ padding: 40 }}>
            <View className="max-w-2xl mx-auto w-full">
              <PipelineSettingsForm
                initialData={{
                  id: selectedPipeline.id,
                  name: selectedPipeline.name,
                  description: selectedPipeline.description,
                  visibility_permissions: selectedPipeline.visibility_permissions || [],
                  task_visibility_mode: selectedPipeline.task_visibility_mode || 'all',
                  is_default: selectedPipeline.is_default || false,
                  assignment_mode: selectedPipeline.assignment_mode || 'manual',
                  assignment_pool_type: selectedPipeline.assignment_pool_type || 'users'
                }}
                roles={roles}
                error={error}
                submitLabel="Update Configuration"
                assignmentPool={assignmentPool}
                companyUsers={companyUsers}
                companyTeams={companyTeams}
                onSetAssignmentPool={setAssignmentPool}
                onSetPoolMemberWithdrawn={setPoolMemberWithdrawn}
                onCancel={() => {
                  clearError();
                  setActiveSection('stages');
                }}
                onClearError={clearError}
                onSubmit={async (data) => {
                  await pipelineActions.update(
                    selectedPipeline.id,
                    data.name,
                    data.description,
                    data.is_default,
                    data.visibility_permissions,
                    data.task_visibility_mode,
                    data.assignment_mode,
                    data.assignment_pool_type
                  );
                }}
                onDelete={async () => {
                  await pipelineActions.remove(selectedPipeline.id);
                }}
              />
            </View>
          </ScrollView>
        );
      default: return null;
    }
  };

  return (
    <GestureHandlerRootView className="flex-1">
      <View className="flex-1 flex-row bg-surface-background">
        {/* Registry Sidebar (Pipelines List) */}
        <View className="w-80 border-r border-surface-border bg-surface-card/30">
          <View className="p-8 border-b border-surface-border flex-row items-center justify-between">
            <View>
              <Text className="text-[10px] text-brand-primary font-black uppercase tracking-[0.2em] mb-2">System Registry</Text>
              <Text className="text-typography-main text-2xl font-black">Pipelines</Text>
            </View>
            {canEdit && (
              <TouchableOpacity 
                onPress={() => setIsCreateModalOpen(true)}
                className="w-10 h-10 bg-brand-primary/10 rounded-xl items-center justify-center hover:bg-brand-primary/20 transition-colors"
              >
                <FontAwesome name="plus" size={14} className="text-brand-primary" />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView className="flex-1 p-4">
            {loading && pipelines.length === 0 ? (
              <ActivityIndicator className="mt-10" color={colors.primary} />
            ) : (
              pipelines.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => selectPipeline(p)}
                  className={`p-5 rounded-2xl mb-3 border transition-all ${
                    selectedPipeline?.id === p.id 
                      ? 'bg-brand-primary border-brand-primary premium-shadow' 
                      : 'bg-surface-card border-surface-border hover:bg-surface-overlay'
                  }`}
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-3">
                      <Text className={`font-bold ${selectedPipeline?.id === p.id ? 'text-white' : 'text-typography-main'}`}>
                        {p.name}
                      </Text>
                      <View className="flex-row items-center gap-1.5">
                        {p.visibility_permissions && p.visibility_permissions.length > 0 && (
                          <FontAwesome 
                            name="lock" 
                            size={10} 
                            color={selectedPipeline?.id === p.id ? 'white' : colors.danger} 
                            style={{ opacity: selectedPipeline?.id === p.id ? 0.7 : 1 }}
                          />
                        )}
                        {p.task_visibility_mode === 'assigned_only' && (
                          <FontAwesome 
                            name="user-secret" 
                            size={10} 
                            color={selectedPipeline?.id === p.id ? 'white' : colors.primary} 
                            style={{ opacity: selectedPipeline?.id === p.id ? 0.7 : 1 }}
                          />
                        )}
                      </View>
                    </View>
                    
                    {p.is_default && (
                       <View className={`px-2 py-0.5 rounded-md ${selectedPipeline?.id === p.id ? 'bg-white/20' : 'bg-brand-primary/10'}`}>
                         <Text className={`text-[8px] font-black ${selectedPipeline?.id === p.id ? 'text-white' : 'text-brand-primary'}`}>
                           DEFAULT
                         </Text>
                       </View>
                    )}
                  </View>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>

        {/* Configuration Area */}
        <View className="flex-1">
          {selectedPipeline && (
            <View className="px-6 md:px-10 pt-10 pb-6 w-full">
              <View className="max-w-6xl mx-auto w-full flex-row flex-wrap items-center justify-between gap-6">
                <View className="flex-1 min-w-[280px]">
                   <Text className="text-typography-main text-3xl md:text-4xl font-black tracking-tighter mb-2" numberOfLines={2}>
                     {selectedPipeline.name}
                   </Text>
                   <Text className="text-typography-muted font-medium">Pipeline configuration and lifecycle management.</Text>
                </View>

                <View className="max-w-full">
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View className="flex-row bg-surface-card p-1.5 rounded-2xl border border-surface-border self-start">
                      {(['stages', 'transitions', 'automations', 'handshakes', 'subpipelines', 'settings'] as any[]).map((s) => (
                        <TouchableOpacity
                          key={s}
                          onPress={() => setActiveSection(s)}
                          className={`px-4 py-2.5 rounded-xl transition-all ${
                            activeSection === s ? 'bg-brand-primary' : 'hover:bg-surface-overlay'
                          }`}
                        >
                          <Text className={`text-[10px] font-black uppercase tracking-widest ${
                            activeSection === s ? 'text-white' : 'text-typography-muted'
                          }`}>
                            {s === 'transitions' ? 'Flow Rules' : s === 'subpipelines' ? 'Subpipelines' : s}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              </View>
            </View>
          )}

          <View className="flex-1 overflow-visible">
            {renderSection()}
          </View>
        </View>
      </View>

      {/* Creation Modal */}
      {isCreateModalOpen && (
        <View className="absolute inset-0 bg-black/80 items-center justify-center z-[100] backdrop-blur-md">
          <View className="bg-surface-card w-full max-w-xl rounded-[2.5rem] border border-surface-border p-10 premium-shadow">
            <View className="flex-row items-center justify-between mb-8">
              <View>
                <Text className="text-typography-main font-black text-3xl tracking-tighter">New Pipeline</Text>
                <Text className="text-typography-muted mt-1">Define a new workflow for system tasks.</Text>
              </View>
              <TouchableOpacity 
                onPress={() => {
                  setIsCreateModalOpen(false);
                  setNewName('');
                  setNewDesc('');
                }}
                className="w-10 h-10 bg-surface-background rounded-full items-center justify-center border border-surface-border"
              >
                <FontAwesome name="times" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <View className="space-y-6">
              <View>
                <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-3">Pipeline Name</Text>
                <TextInput
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="e.g. Standard Workflow"
                  placeholderTextColor={(colors.textMuted + '80')}
                  className="bg-surface-background text-typography-main px-6 py-4 rounded-2xl border border-surface-border text-lg font-bold focus:border-brand-primary"
                  autoFocus
                />
              </View>

              <View>
                <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-3">Description</Text>
                <TextInput
                  value={newDesc}
                  onChangeText={setNewDesc}
                  placeholder="Operational scope and purpose..."
                  placeholderTextColor={(colors.textMuted + '80')}
                  className="bg-surface-background text-typography-main px-6 py-4 rounded-2xl border border-surface-border min-h-[100px] text-base"
                  multiline
                  numberOfLines={3}
                />
              </View>

              <TouchableOpacity 
                onPress={() => setIsQuickCreate(!isQuickCreate)}
                className="flex-row items-center justify-between bg-surface-background p-5 rounded-2xl border border-surface-border"
              >
                <View className="flex-1 mr-4">
                  <Text className="text-typography-main font-bold">Quick Setup</Text>
                  <Text className="text-typography-muted text-xs mt-1">Deploy with 4 standard stages and workflow rules pre-configured.</Text>
                </View>
                <View className={`w-12 h-7 rounded-full flex-row items-center px-1 ${isQuickCreate ? 'bg-brand-primary justify-end' : 'bg-surface-overlay justify-start'}`}>
                  <View className="w-5 h-5 rounded-full bg-white shadow-sm" />
                </View>
              </TouchableOpacity>

              <View className="flex-row gap-4 mt-6">
                <TouchableOpacity
                  onPress={() => {
                    setIsCreateModalOpen(false);
                    setNewName('');
                    setNewDesc('');
                  }}
                  className="flex-1 bg-surface-background py-4 rounded-2xl border border-surface-border items-center"
                >
                  <Text className="text-typography-muted font-bold uppercase tracking-widest text-xs">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={async () => {
                    if (!newName.trim() || creating) return;
                    setCreating(true);
                    
                    const stages = isQuickCreate
                      ? STAGE_PRESETS.map((s, i) => ({ ...s, position: i + 1, is_initial: s.is_initial || false, is_terminal: s.is_terminal || false, requires_submission: s.requires_submission || false }))
                      : [{ name: 'START', color: '#64748b', position: 1, is_initial: true, is_terminal: false, requires_submission: false }];
                    const transitions = isQuickCreate ? TRANSITION_PRESETS : [];

                    const id = await createPipeline(newName, newDesc, stages, transitions);
                    if (id) {
                      setIsCreateModalOpen(false);
                      setNewName('');
                      setNewDesc('');
                      // The refresh and selection is handled in context or we can wait
                      // Select the newly created pipeline
                      const { data } = await refreshPipelines() as any || {};
                      // Note: createPipeline in context already calls refreshPipelines
                    }
                    setCreating(false);
                  }}
                  disabled={!newName.trim() || creating}
                  className={`flex-[2] py-4 rounded-2xl items-center ${!newName.trim() || creating ? 'bg-brand-primary/50' : 'bg-brand-primary'}`}
                >
                  {creating ? (
                    <ActivityIndicator color="white" size="small" />
                  ) : (
                    <Text className="text-white font-black uppercase tracking-widest text-xs">Create Pipeline</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      )}
    </GestureHandlerRootView>
  );
}

export default function PipelinesWebScreen() {
  const colors = useThemeColors();
  return (
    <PipelineEditorProvider>
      <PipelinesWebInner />
    </PipelineEditorProvider>
  );
}
