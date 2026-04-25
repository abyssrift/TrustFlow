import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PipelineEditorProvider, usePipelineEditor } from '@/contexts/PipelineEditorContext';
import FontAwesome from '@expo/vector-icons/FontAwesome';

// Actual tactical components
import StageBuilder from '@/components/pipeline-editor/StageBuilder.web';
import TransitionEditor from '@/components/pipeline-editor/TransitionEditor';
import AutomationEditor from '@/components/pipeline-editor/AutomationEditor';
import HandshakeEditor from '@/components/pipeline-editor/HandshakeEditor';
import PipelineVisualizer from '@/components/pipeline-editor/PipelineVisualizer';

type Section = 'stages' | 'visualizer' | 'transitions' | 'automations' | 'handshakes';

function PipelinesWebInner() {
  const { 
    pipelines, 
    selectedPipeline, 
    loading, 
    selectPipeline, 
    refreshPipelines,
    activeSection,
    setActiveSection
  } = usePipelineEditor();

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
             <Text className="text-typography-muted text-center leading-relaxed">
               Select a tactical protocol from the left registry to begin configuring its stages, automations, and operational logic.
             </Text>
          </View>
        </View>
      );
    }

    switch (activeSection) {
      case 'visualizer': return <PipelineVisualizer />;
      case 'stages': return <StageBuilder />;
      case 'transitions': return <TransitionEditor />;
      case 'automations': return <AutomationEditor />;
      case 'handshakes': return <HandshakeEditor />;
      default: return null;
    }
  };

  return (
    <GestureHandlerRootView className="flex-1">
      <View className="flex-1 flex-row bg-surface-background">
        {/* Registry Sidebar (Pipelines List) */}
        <View className="w-80 border-r border-surface-border bg-surface-card/30">
          <View className="p-8 border-b border-surface-border">
            <Text className="text-[10px] text-brand-primary font-black uppercase tracking-[0.2em] mb-2">System Registry</Text>
            <Text className="text-typography-main text-2xl font-black">Pipelines</Text>
          </View>

          <ScrollView className="flex-1 p-4">
            {loading && pipelines.length === 0 ? (
              <ActivityIndicator className="mt-10" color="rgb(var(--brand-primary))" />
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
                  <View className="flex-row items-center justify-between"><Text className={`font-bold ${selectedPipeline?.id === p.id ? 'text-white' : 'text-typography-main'}`}>{p.name}</Text>{p.is_default && (
                       <View className={`px-2 py-0.5 rounded-md ${selectedPipeline?.id === p.id ? 'bg-white/20' : 'bg-brand-primary/10'}`}><Text className={`text-[8px] font-black ${selectedPipeline?.id === p.id ? 'text-white' : 'text-brand-primary'}`}>DEFAULT</Text></View>
                     )}</View>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>

        {/* Configuration Area */}
        <View className="flex-1 p-10">
          <View className="max-w-6xl mx-auto w-full h-full">
            {selectedPipeline && (
              <View className="flex-row items-center justify-between mb-10">
                <View>
                   <Text className="text-typography-main text-4xl font-black tracking-tighter mb-2">{selectedPipeline.name}</Text>
                   <Text className="text-typography-muted font-medium">Protocol configuration and lifecycle management.</Text>
                </View>

                <View className="flex-row bg-surface-card p-1.5 rounded-2xl border border-surface-border">
                  {(['visualizer', 'stages', 'transitions', 'automations', 'handshakes'] as any[]).map((s) => (
                    <TouchableOpacity
                      key={s}
                      onPress={() => setActiveSection(s)}
                      className={`px-6 py-2.5 rounded-xl transition-all ${
                        activeSection === s ? 'bg-brand-primary' : 'hover:bg-surface-overlay'
                      }`}
                    >
                      <Text className={`text-[10px] font-black uppercase tracking-widest ${
                        activeSection === s ? 'text-white' : 'text-typography-muted'
                      }`}>
                        {s === 'visualizer' ? 'Designer' : s === 'transitions' ? 'Flow Rules' : s}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            <View className="flex-1 bg-surface-card/20 rounded-[3rem] border border-surface-border overflow-hidden">
              {renderSection()}
            </View>
          </View>
        </View>
      </View>
    </GestureHandlerRootView>
  );
}

export default function PipelinesWebScreen() {
  return (
    <PipelineEditorProvider>
      <PipelinesWebInner />
    </PipelineEditorProvider>
  );
}
