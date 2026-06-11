import HorizontalScroll from '@/components/common/HorizontalScroll';
import AutomationEditor from '@/components/pipeline-editor/AutomationEditor';
import HandshakeEditor from '@/components/pipeline-editor/HandshakeEditor';
import PipelineList from '@/components/pipeline-editor/PipelineList';
import PipelineVisualizer from '@/components/pipeline-editor/PipelineVisualizer';
import StageBuilder from '@/components/pipeline-editor/StageBuilder';
import SubpipelineEditor from '@/components/pipeline-editor/SubpipelineEditor';
import TransitionEditor from '@/components/pipeline-editor/TransitionEditor';
import { PipelineEditorProvider, usePipelineEditor } from '@/contexts/PipelineEditorContext';
import { BackButton } from '@/components/common/BackButton';
import { useThemeColors } from '@/hooks/useThemeColors';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { ActivityIndicator, Platform, SafeAreaView, StatusBar, Text, TouchableOpacity, View } from 'react-native';
console.log('Admin Pipelines Loading - Platform check:', Platform?.OS);

// ── Section Tab Config ──────────────────────────────────────
const SECTIONS = [
  { key: 'stages', label: 'Stages', icon: 'th-list' },
  { key: 'visualizer', label: 'Designer', icon: 'paint-brush' },
  { key: 'transitions', label: 'Flow Rules', icon: 'random' },
  { key: 'automations', label: 'Automations', icon: 'bolt' },
  { key: 'handshakes', label: 'Handshakes', icon: 'handshake-o' },
  { key: 'subpipelines', label: 'Subpipelines', icon: 'sitemap' },
] as const;

function PipelineEditorInner() {
  const colors = useThemeColors();
  const router = useRouter();
  const {
    selectedPipeline, activeSection, setActiveSection,
    deselectPipeline, refreshPipelines, loading,
  } = usePipelineEditor();



  useEffect(() => {
    refreshPipelines();
  }, []);

  // ── Render Pipeline List if nothing selected ──
  if (!selectedPipeline) {
    return (
      <SafeAreaView className="flex-1" style={Platform.OS === 'android' ? { paddingTop: StatusBar.currentHeight } : {}}>
        <View className="flex-1 bg-surface-background" style={Platform.OS === 'web' ? ({ minHeight: '100vh' } as any) : {}}>
          {/* Top Bar */}
          <View className="bg-surface-card px-4 pt-4 pb-6 border-b border-surface-border">
            <View className="flex-row items-center justify-between">
              <BackButton />
              <View className="bg-brand-primary/10 px-3 py-1 rounded-full border border-brand-primary/20">
                <Text className="text-brand-primary text-[9px] font-black uppercase tracking-widest">Pipeline Editor</Text>
              </View>
            </View>
          </View>

          <View className="flex-1 px-4 pt-4">
            <PipelineList />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Render Pipeline Editor (selected pipeline) ──
  return (
    <SafeAreaView className="flex-1" style={Platform.OS === 'android' ? { paddingTop: StatusBar.currentHeight } : {}}>
      <View className="flex-1 bg-surface-background" style={Platform.OS === 'web' ? ({ minHeight: '100vh' } as any) : {}}>
        {/* Header with back button */}
        <View className="bg-surface-card px-4 pt-4 pb-4 border-b border-surface-border">
          <View className="flex-row items-center justify-between mb-4">
            <TouchableOpacity
              onPress={deselectPipeline}
              className="flex-row items-center h-11 pr-4"
            >
              <FontAwesome name="chevron-left" size={14} color={colors.textMuted} />
              <Text className="text-typography-muted font-bold text-sm ml-2">Pipelines</Text>
            </TouchableOpacity>
            <View className="bg-brand-primary-dim px-3 py-1 rounded-full border border-brand-primary/20">
              <Text className="text-brand-primary text-[9px] font-black uppercase tracking-widest">Editor</Text>
            </View>
          </View>

          {/* Pipeline Name */}
          <View>
            <Text className="text-typography-main text-2xl font-black">{selectedPipeline.name}</Text>
            {selectedPipeline.description && (
              <Text className="text-typography-muted text-sm mt-1">{selectedPipeline.description}</Text>
            )}
            {selectedPipeline.is_default && (
              <View className="bg-brand-primary-dim px-2 py-0.5 rounded-md self-start mt-1">
                <Text className="text-brand-primary text-[9px] font-black uppercase">Default Pipeline</Text>
              </View>
            )}
          </View>
        </View>

        <View className="flex-1 px-4 pt-4" style={Platform.OS === 'web' ? { display: 'flex', flexDirection: 'column', minHeight: 0 } : {}}>

        {/* Section Tabs */}
        <View className="mb-4">
          <HorizontalScroll>
            <View className="flex-row gap-2">
              {SECTIONS.map(s => {
                const isActive = activeSection === s.key;
                return (
                  <TouchableOpacity
                    key={s.key}
                    onPress={() => setActiveSection(s.key as any)}
                    className={`px-4 py-2.5 rounded-xl border flex-row items-center ${
                      isActive
                        ? 'bg-brand-primary border-brand-primary'
                        : 'bg-surface-card border-surface-border'
                    }`}
                  >
                    <FontAwesome
                      name={s.icon as any}
                      size={12}
                      color={isActive ? '#ffffff' : colors.textMuted}
                    />
                    <Text
                      className={`text-xs font-bold ml-2 ${
                        isActive ? 'text-typography-main' : 'text-typography-muted'
                      }`}
                    >
                      {s.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </HorizontalScroll>
        </View>

        {/* Loading Overlay */}
        {loading && (
          <View className="absolute top-0 right-0 z-50 p-4">
            <ActivityIndicator color={colors.primary} size="small" />
          </View>
        )}

        {/* Active Section */}
        <View className="flex-1" style={Platform.OS === 'web' ? ({ overflow: 'auto', display: 'flex', flexDirection: 'column' } as any) : {}}>
          {activeSection === 'stages' && <StageBuilder />}
          {activeSection === 'transitions' && <TransitionEditor />}
          {activeSection === 'automations' && <AutomationEditor />}
          {activeSection === 'handshakes' && <HandshakeEditor />}
          {activeSection === 'subpipelines' && <SubpipelineEditor />}
          {activeSection === 'visualizer' && <PipelineVisualizer />}
        </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

export default function PipelinesScreen() {
  return (
    <PipelineEditorProvider>
      <PipelineEditorInner />
    </PipelineEditorProvider>
  );
}
