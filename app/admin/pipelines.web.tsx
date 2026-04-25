import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, SafeAreaView, Platform, StatusBar, ScrollView } from 'react-native';
import HorizontalScroll from '@/components/common/HorizontalScroll';
import { useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { PipelineEditorProvider, usePipelineEditor } from '@/contexts/PipelineEditorContext';
import PipelineList from '@/components/pipeline-editor/PipelineList';
import StageBuilder from '@/components/pipeline-editor/StageBuilder';
import TransitionEditor from '@/components/pipeline-editor/TransitionEditor';
import AutomationEditor from '@/components/pipeline-editor/AutomationEditor';
import HandshakeEditor from '@/components/pipeline-editor/HandshakeEditor';
import PipelineVisualizer from '@/components/pipeline-editor/PipelineVisualizer';

// ── Section Tab Config ──────────────────────────────────────
const SECTIONS = [
  { key: 'stages', label: 'Stages', icon: 'th-list' },
  { key: 'visualizer', label: 'Designer', icon: 'paint-brush' },
  { key: 'transitions', label: 'Flow Rules', icon: 'random' },
  { key: 'automations', label: 'Automations', icon: 'bolt' },
  { key: 'handshakes', label: 'Handshakes', icon: 'handshake-o' },
] as const;

function PipelineEditorInner() {
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
      <View style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        backgroundColor: 'rgb(8, 13, 24)',
      }}>
        {/* Top Bar */}
        <View style={{
          backgroundColor: 'rgb(15, 23, 42)',
          padding: '1rem',
          borderBottom: '1px solid rgb(51, 65, 85)',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              paddingRight: '1rem',
              cursor: 'pointer',
            }}
          >
            <FontAwesome name="chevron-left" size={14} color="#94a3b8" />
            <Text style={{ color: '#94a3b8', fontWeight: 'bold', fontSize: 14, marginLeft: '0.5rem' }}>Back</Text>
          </TouchableOpacity>
          <View style={{
            backgroundColor: 'rgba(99, 102, 241, 0.15)',
            paddingHorizontal: '0.75rem',
            paddingVertical: '0.25rem',
            borderRadius: '9999px',
            border: '1px solid rgba(99, 102, 241, 0.2)',
          }}>
            <Text style={{ color: 'rgb(99, 102, 241)', fontSize: 9, fontWeight: 'black', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pipeline Editor</Text>
          </View>
        </View>

        {/* Pipeline List Content */}
        <View style={{
          flex: 1,
          paddingLeft: '1rem',
          paddingRight: '1rem',
          paddingTop: '1rem',
          overflow: 'auto',
        }}>
          <PipelineList />
        </View>
      </View>
    );
  }

  // ── Render Pipeline Editor (selected pipeline) ──
  return (
    <View style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      width: '100vw',
      backgroundColor: 'rgb(8, 13, 24)',
    }}>
      {/* Header Bar */}
      <View style={{
        backgroundColor: 'rgb(15, 23, 42)',
        padding: '1rem',
        borderBottom: '1px solid rgb(51, 65, 85)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}>
        {/* Top Row: Back Button + Editor Badge */}
        <View style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <TouchableOpacity
            onPress={deselectPipeline}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              paddingRight: '1rem',
              cursor: 'pointer',
            }}
          >
            <FontAwesome name="chevron-left" size={14} color="#94a3b8" />
            <Text style={{ color: '#94a3b8', fontWeight: 'bold', fontSize: 14, marginLeft: '0.5rem' }}>Pipelines</Text>
          </TouchableOpacity>
          <View style={{
            backgroundColor: 'rgba(99, 102, 241, 0.15)',
            paddingHorizontal: '0.75rem',
            paddingVertical: '0.25rem',
            borderRadius: '9999px',
            border: '1px solid rgba(99, 102, 241, 0.2)',
          }}>
            <Text style={{ color: 'rgb(99, 102, 241)', fontSize: 9, fontWeight: 'black', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Editor</Text>
          </View>
        </View>

        {/* Pipeline Info */}
        <View>
          <Text style={{ color: 'rgb(248, 250, 252)', fontSize: 28, fontWeight: 'black' }}>{selectedPipeline.name}</Text>
          {selectedPipeline.description && (
            <Text style={{ color: 'rgb(148, 163, 184)', fontSize: 14, marginTop: '0.25rem' }}>{selectedPipeline.description}</Text>
          )}
          {selectedPipeline.is_default && (
            <View style={{
              backgroundColor: 'rgba(99, 102, 241, 0.15)',
              paddingHorizontal: '0.5rem',
              paddingVertical: '0.125rem',
              borderRadius: '0.375rem',
              marginTop: '0.25rem',
              alignSelf: 'flex-start',
            }}>
              <Text style={{ color: 'rgb(99, 102, 241)', fontSize: 9, fontWeight: 'black', textTransform: 'uppercase' }}>Default Pipeline</Text>
            </View>
          )}
        </View>
      </View>

      {/* Main Content Area - Scrollable */}
      <View style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        paddingLeft: '1rem',
        paddingRight: '1rem',
        paddingTop: '1rem',
        overflow: 'hidden',
        position: 'relative',
      }}>
        {/* Section Tabs */}
        <View style={{
          marginBottom: '1rem',
          display: 'flex',
          flexDirection: 'row',
          gap: '0.5rem',
          paddingBottom: '1rem',
          borderBottom: '1px solid rgb(51, 65, 85)',
          overflowX: 'auto',
          overflowY: 'hidden',
        }}>
          {SECTIONS.map(s => {
            const isActive = activeSection === s.key;
            return (
              <TouchableOpacity
                key={s.key}
                onPress={() => setActiveSection(s.key as any)}
                style={{
                  paddingHorizontal: '1rem',
                  paddingVertical: '0.625rem',
                  borderRadius: '0.75rem',
                  border: isActive ? '1px solid rgb(99, 102, 241)' : '1px solid rgb(51, 65, 85)',
                  backgroundColor: isActive ? 'rgb(99, 102, 241)' : 'rgb(15, 23, 42)',
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.2s ease',
                }}
              >
                <FontAwesome
                  name={s.icon as any}
                  size={12}
                  color={isActive ? '#ffffff' : '#64748b'}
                />
                <Text style={{
                  fontSize: 12,
                  fontWeight: 'bold',
                  color: isActive ? '#ffffff' : '#94a3b8',
                  textTransform: 'capitalize',
                }}>
                  {s.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Loading Overlay */}
        {loading && (
          <View style={{
            position: 'absolute',
            top: 0,
            right: 0,
            zIndex: 50,
            padding: '1rem',
          }}>
            <ActivityIndicator color="#6366f1" size="small" />
          </View>
        )}

        {/* Content Container - Scrollable */}
        <View style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
          paddingRight: '0.5rem',
        }}>
          {activeSection === 'stages' && <StageBuilder />}
          {activeSection === 'transitions' && <TransitionEditor />}
          {activeSection === 'automations' && <AutomationEditor />}
          {activeSection === 'handshakes' && <HandshakeEditor />}
          {activeSection === 'visualizer' && <PipelineVisualizer />}
        </View>
      </View>
    </View>
  );
}

export default function PipelinesScreen() {
  return (
    <PipelineEditorProvider>
      <PipelineEditorInner />
    </PipelineEditorProvider>
  );
}

