import Popup from '@/components/common/Popup';
import Tooltip from '@/components/common/Tooltip';
import WidgetGrid from '@/components/dashboard/widgets/WidgetGrid';
import { AddWidgetPopup, DashboardMenuPopup, WidgetConfigPopup } from '@/components/dashboard/widgets/WidgetPopups';
import { WidgetLayoutProvider } from '@/components/dashboard/widgets/registry';
import LiveSessionsPopup from '@/components/tabs/LiveSessionsPopup';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardDataProvider, useDashboardData } from '@/contexts/DashboardDataContext';
import { useDashboardLayout, type DashboardLayout } from '@/hooks/useDashboardLayout';
import { useThemeColors } from '@/hooks/useThemeColors';
import type { DashboardConfig, WidgetInstance } from '@/lib/dashboardWidgets';
import { isAuthError, supabase, triggerAuthError } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';

// ── Helpers ──────────────────────────────────────────────────────────────

const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

// ── Component ────────────────────────────────────────────────────────────

export default function DashboardScreenWeb() {
  const { user, profile } = useAuth();

  // Instances + the persisted config in one hook, on the one storage key both
  // screens already used. The panels this screen used to hardcode are widget
  // types in the registry now, and the queries that fed them moved into
  // DashboardDataProvider — which is what keeps the 500-row rpc_projects_table
  // read at one per dashboard however many project widgets a layout holds.
  const layout = useDashboardLayout();

  const [showLiveSessions, setShowLiveSessions] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [editing, setEditing] = useState(false);
  // The id, not the instance: the config sheet auto-applies straight through
  // layout.setConfig (no draft copy, same contract as the filter panels), so a
  // captured instance object would keep showing the option the user just left.
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const configuring = layout.instances.find(i => i.id === configuringId) ?? null;

  const displayName = useMemo(() => {
    return profile?.display_name || profile?.full_name || user?.user_metadata?.full_name || 'Operator';
  }, [profile, user]);

  const firstName = useMemo(() => displayName.split(' ')[0], [displayName]);

  return (
    // Both providers sit above the grid and both are load-bearing.
    // DashboardDataProvider so N instances share one copy of every query;
    // WidgetLayoutProvider so a widget that writes its own config — the
    // overview chart's inline period switch — writes the same place its config
    // sheet does. useWidgetLayout() throws without it, deliberately: a period
    // toggle that silently does nothing is worse than a crash.
    <DashboardDataProvider
      config={layout.config}
      ready={layout.hydrated}
      onOpenLiveSessions={() => setShowLiveSessions(true)}
    >
      <WidgetLayoutProvider layout={layout}>
        <DashboardCanvas
          layout={layout}
          firstName={firstName}
          editing={editing}
          onOpenMenu={() => setShowMenu(true)}
          onAddWidget={() => setShowAddWidget(true)}
          onDoneEditing={() => setEditing(false)}
          onConfigure={instance => setConfiguringId(instance.id)}
        />
      </WidgetLayoutProvider>

      {/* Stays mounted by the screen, not by the facts widget: it is a whole
          popup with its own fetch, and the widget only asks for it to open. */}
      <LiveSessionsPopup visible={showLiveSessions} onClose={() => setShowLiveSessions(false)} />

      <DashboardMenuPopup
        visible={showMenu}
        onClose={() => setShowMenu(false)}
        onEditLayout={() => { setShowMenu(false); setEditing(true); }}
        onOpenPipelineConfig={() => { setShowMenu(false); setShowSettings(true); }}
      />

      <AddWidgetPopup
        visible={showAddWidget}
        onClose={() => setShowAddWidget(false)}
        instances={layout.instances}
        onAdd={layout.addWidget}
      />

      <WidgetConfigPopup
        visible={!!configuring}
        onClose={() => setConfiguringId(null)}
        instance={configuring}
        onChange={(key, value) => configuring && layout.setConfig(configuring.id, key, value)}
      />

      <DashboardSettingsModal
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        config={layout.config}
        onSave={async (newConfig) => {
          // saveConfig spreads over the stored object, so the widget layout and
          // the overview-graph metrics survive a pipeline-selection save. The
          // hand-rolled field-by-field merge that used to live here is the
          // hook's single persist path now. Changing the tracked pipelines also
          // changes the provider's fetch key, so the refetch is automatic.
          await layout.saveConfig(newConfig);
          setShowSettings(false);
        }}
      />
    </DashboardDataProvider>
  );
}

/**
 * Everything below the providers. Split out for one reason: pull-to-refresh and
 * the loading gate read `useDashboardData()`, which the component that mounts
 * the provider cannot do.
 */
function DashboardCanvas({
  layout,
  firstName,
  editing,
  onOpenMenu,
  onAddWidget,
  onDoneEditing,
  onConfigure,
}: {
  layout: DashboardLayout;
  firstName: string;
  editing: boolean;
  onOpenMenu: () => void;
  onAddWidget: () => void;
  onDoneEditing: () => void;
  onConfigure: (instance: WidgetInstance) => void;
}) {
  const colors = useThemeColors();
  const { loading, refreshing, refreshAll } = useDashboardData();

  return (
    <ScrollView
      className="flex-1 bg-surface-background"
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={colors.primary} />}
    >
      <View className="max-w-[1280px] mx-auto w-full px-8 py-8">
        <View className="mb-7 flex-row items-start justify-between gap-6">
          <View className="flex-1 min-w-0">
            <Text className="text-typography-main text-2xl font-black tracking-tight">
              {getGreeting()}, {firstName}
            </Text>
            {/* The facts line that used to sit under the greeting is the
                `facts` widget now — same row, same wording, first in the seeded
                layout, but removable by someone who does not want it. */}
          </View>

          {/* Two icon buttons, not two labelled pills. They are the least
              important controls on the page and used to be the loudest. In edit
              mode they give way to the two that are: add something, and get
              back out. Same pair of controls, never both at once. */}
          <View className="flex-row items-center gap-2 pt-1">
            {editing ? (
              <>
                <TouchableOpacity
                  onPress={onAddWidget}
                  accessibilityRole="button"
                  accessibilityLabel="Add a widget"
                  className="flex-row items-center gap-2 rounded-xl border border-surface-border hover:bg-surface-overlay px-4 transition-colors"
                  style={{ minHeight: 44 }}
                >
                  <FontAwesome name="plus" size={12} color={colors.primary} />
                  <Text className="text-typography-main text-xs font-bold">Add widget</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={onDoneEditing}
                  accessibilityRole="button"
                  accessibilityLabel="Finish editing the dashboard layout"
                  className="rounded-xl bg-brand-primary hover:bg-brand-primary-hover items-center justify-center px-5 transition-colors"
                  style={{ minHeight: 44 }}
                >
                  <Text className="text-white text-xs font-bold">Done</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Tooltip label="Dashboard layout and pipeline settings">
                  <TouchableOpacity
                    onPress={onOpenMenu}
                    accessibilityRole="button"
                    accessibilityLabel="Dashboard settings"
                    className="rounded-xl border border-surface-border hover:bg-surface-overlay items-center justify-center transition-colors"
                    style={{ width: 44, height: 44 }}
                  >
                    <FontAwesome name="sliders" size={14} color={colors.textMuted} />
                  </TouchableOpacity>
                </Tooltip>
                <Tooltip label="Refresh">
                  <TouchableOpacity
                    onPress={refreshAll}
                    accessibilityRole="button"
                    accessibilityLabel="Refresh dashboard"
                    className="rounded-xl border border-surface-border hover:bg-surface-overlay items-center justify-center transition-colors"
                    style={{ width: 44, height: 44 }}
                  >
                    <FontAwesome name="refresh" size={14} color={colors.textMuted} />
                  </TouchableOpacity>
                </Tooltip>
              </>
            )}
          </View>
        </View>

        {/* `hydrated` is not the same wait as `loading`, and both belong here.
            AuthContext's permissions start empty, so until permissionsLoaded
            flips every hasPermission call answers false and the seed would come
            back with all four gated widgets stripped out — painting that and
            then swapping it is worse than one spinner. */}
        {!layout.hydrated || loading ? (
          <View className="py-24 items-center justify-center">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <WidgetGrid
            instances={layout.instances}
            editing={editing}
            layout={layout}
            onConfigure={onConfigure}
          />
        )}
      </View>
    </ScrollView>
  );
}

// ── Settings Modal ───────────────────────────────────────────────────────

function DashboardSettingsModal({ visible, onClose, config, onSave }: {
  visible: boolean;
  onClose: () => void;
  config: DashboardConfig | null;
  onSave: (config: DashboardConfig) => void;
}) {
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [stages, setStages] = useState<any[]>([]);
  const [selectedPipelines, setSelectedPipelines] = useState<string[]>([]);
  const [selectedSuccessStages, setSelectedSuccessStages] = useState<string[]>([]);
  const [useAllPipelines, setUseAllPipelines] = useState(true);
  const [loading, setLoading] = useState(false);
  const colors = useThemeColors();

  useEffect(() => {
    if (visible) {
      fetchData();
      if (config) {
        setSelectedPipelines(config.pipelineIds || []);
        setSelectedSuccessStages(config.successStageIds || []);
        // Treat as "all pipelines" if explicitly set, or if no pipelines were manually selected
        if (config.useAllPipelines !== undefined) {
          setUseAllPipelines(config.useAllPipelines);
        } else {
          setUseAllPipelines((config.pipelineIds || []).length === 0);
        }
      } else {
        setUseAllPipelines(true);
        setSelectedPipelines([]);
        setSelectedSuccessStages([]);
      }
    }
  }, [visible, config]);

  const fetchData = async () => {
    setLoading(true);
    const { data: p, error: pipelineError } = await supabase.from('pipelines').select('id, name').is('deleted_at', null);
    if (isAuthError(pipelineError)) {
      triggerAuthError();
      setLoading(false);
      return;
    }
    const { data: s, error: stageError } = await supabase.from('pipeline_stages').select('id, name, pipeline_id, is_terminal, terminal_type').order('position', { ascending: true });
    if (isAuthError(stageError)) {
      triggerAuthError();
      setLoading(false);
      return;
    }
    setPipelines(p || []);
    setStages(s || []);
    setLoading(false);
  };

  const togglePipeline = (id: string) => {
    const isRemoving = selectedPipelines.includes(id);
    if (isRemoving) {
      setSelectedPipelines(prev => prev.filter(p => p !== id));
      // Remove all stages belonging to this pipeline from success stages
      const stageIds = stages.filter(s => s.pipeline_id === id).map(s => s.id);
      setSelectedSuccessStages(prev => prev.filter(sid => !stageIds.includes(sid)));
    } else {
      setSelectedPipelines(prev => [...prev, id]);
      // Auto-select terminal_type='success' stages for this pipeline
      const completedIds = stages
        .filter(s => s.pipeline_id === id && s.is_terminal && s.terminal_type === 'success')
        .map(s => s.id);
      setSelectedSuccessStages(prev => [...new Set([...prev, ...completedIds])]);
    }
  };

  const toggleStage = (id: string) => {
    setSelectedSuccessStages(prev => {
      if (prev.includes(id)) return prev.filter(s => s !== id);
      return [...prev, id];
    });
  };

  const handleSave = () => {
    if (useAllPipelines) {
      onSave({ pipelineIds: [], successStageIds: [], useAllPipelines: true });
    } else {
      onSave({ pipelineIds: selectedPipelines, successStageIds: selectedSuccessStages, useAllPipelines: false });
    }
  };

  // Was a raw RN `Modal`, which the repo's popup rule forbids outright. It is
  // an info-dense config dialog, so it keeps its ~900px width (ux-consistency
  // §"Desktop density": 720–1100 is the band for this) rather than collapsing
  // to the 420px single column the old default would have given it.
  return (
    <Popup visible={visible} onClose={onClose} presentation="auto" maxWidth={896} maxHeight="90%">
        <View className="flex-1">
          <View className="p-6 border-b border-surface-border flex-row justify-between items-center">
            <View className="flex-1 pr-4">
              <Text className="text-typography-main text-xl font-black tracking-tight">Dashboard configuration</Text>
              <Text className="text-typography-muted text-xs mt-1">Choose which pipelines to monitor and which stages count as done.</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              className="rounded-full bg-surface-background items-center justify-center border border-surface-border"
              style={{ width: 44, height: 44 }}
            >
              <FontAwesome name="times" size={14} color={colors.textDim} />
            </TouchableOpacity>
          </View>

          <ScrollView className="p-6">
            {loading ? (
              <ActivityIndicator size="large" color={colors.primary} />
            ) : (
              <View>
                {/* All Pipelines Toggle */}
                <TouchableOpacity
                  onPress={() => setUseAllPipelines(v => !v)}
                  className={`p-6 rounded-3xl border mb-8 flex-row items-center justify-between ${useAllPipelines ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                >
                  <View className="flex-1 mr-6">
                    <Text className={`font-black text-base mb-1 ${useAllPipelines ? 'text-brand-primary' : 'text-typography-main'}`}>
                      Monitor All Pipelines
                    </Text>
                    <Text className="text-typography-muted text-xs font-medium">
                      Include every pipeline automatically. Success stages are auto-detected from{' '}
                      <Text className="text-state-success font-bold">terminal_type = success</Text> stages.
                    </Text>
                  </View>
                  <View
                    className={`w-14 h-8 rounded-full justify-center px-1 border-2 ${useAllPipelines ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
                  >
                    <View
                      className="w-5 h-5 rounded-full bg-white"
                      style={{ alignSelf: useAllPipelines ? 'flex-end' : 'flex-start' }}
                    />
                  </View>
                </TouchableOpacity>

                {useAllPipelines && (
                  <View className="bg-surface-background p-6 rounded-3xl border border-surface-border mb-8">
                    <View className="flex-row items-center mb-3">
                      <FontAwesome name="check-circle" size={14} className="text-brand-primary" />
                      <Text className="text-brand-primary font-black text-xs ml-2 uppercase tracking-widest">Auto Mode Active</Text>
                    </View>
                    <Text className="text-typography-muted text-sm font-medium leading-relaxed">
                      All {pipelines.length} pipeline{pipelines.length !== 1 ? 's' : ''} are being monitored. Stages with{' '}
                      <Text className="text-state-success font-bold">terminal_type = success</Text> count toward the Completed metric.
                      Stages with other terminal types (failed, cancelled) are tracked separately as Failed/Rejected.
                    </Text>
                  </View>
                )}

                {!useAllPipelines && (
                  <>
                    <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-6">Select Pipelines to Monitor</Text>
                    <View className="flex-row flex-wrap gap-4 mb-10">
                      {pipelines.map(p => (
                        <TouchableOpacity
                          key={p.id}
                          onPress={() => togglePipeline(p.id)}
                          className={`px-6 py-4 rounded-2xl border ${selectedPipelines.includes(p.id) ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                        >
                          <Text className={`font-black text-xs ${selectedPipelines.includes(p.id) ? 'text-white' : 'text-typography-main'}`}>{p.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {selectedPipelines.length > 0 && (
                      <>
                        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-3">Define Success Stages</Text>
                        <Text className="text-typography-muted text-xs mb-6 font-medium">
                          Completed terminal stages are pre-selected. Adjust as needed — these are the stages that count toward "Completed".
                        </Text>
                        <View className="gap-8">
                          {selectedPipelines.map(pid => {
                            const pipeline = pipelines.find(p => p.id === pid);
                            const pipelineStages = stages.filter(s => s.pipeline_id === pid);
                            return (
                              <View key={pid} className="bg-surface-background p-6 rounded-3xl border border-surface-border">
                                <Text className="text-typography-main font-black mb-4">{pipeline?.name}</Text>
                                <View className="flex-row flex-wrap gap-3">
                                  {pipelineStages.map(s => {
                                    const isSelected = selectedSuccessStages.includes(s.id);
                                    const terminalColor =
                                      s.terminal_type === 'success' ? 'text-state-success' :
                                      s.terminal_type === 'failure' ? 'text-state-danger' :
                                      'text-state-warning';
                                    const terminalBg =
                                      s.terminal_type === 'success' ? 'bg-state-success/20' :
                                      s.terminal_type === 'failure' ? 'bg-state-danger/20' :
                                      'bg-state-warning/20';
                                    return (
                                      <TouchableOpacity
                                        key={s.id}
                                        onPress={() => toggleStage(s.id)}
                                        className={`px-4 py-2 rounded-xl border flex-row items-center ${isSelected ? 'bg-state-success/20 border-state-success' : 'bg-surface-card border-surface-border'}`}
                                      >
                                        <FontAwesome
                                          name={isSelected ? 'check-square' : 'square-o'}
                                          size={14}
                                          className={isSelected ? 'text-state-success' : 'text-typography-dim'}
                                          style={{ marginRight: 8 }}
                                        />
                                        <Text className={`text-[11px] font-bold mr-2 ${isSelected ? 'text-state-success' : 'text-typography-muted'}`}>{s.name}</Text>
                                        {s.is_terminal && (
                                          <View className={`px-2 py-0.5 rounded-full ${terminalBg}`}>
                                            <Text className={`text-[8px] font-black uppercase ${terminalColor}`}>
                                              {s.terminal_type || 'terminal'}
                                            </Text>
                                          </View>
                                        )}
                                      </TouchableOpacity>
                                    );
                                  })}
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      </>
                    )}
                  </>
                )}
              </View>
            )}
          </ScrollView>

          <View className="p-6 border-t border-surface-border flex-row gap-4">
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              className="flex-1 rounded-xl bg-surface-background border border-surface-border items-center justify-center"
              style={{ minHeight: 44 }}
            >
              <Text className="text-typography-muted text-xs font-bold">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              accessibilityRole="button"
              className="flex-[2] rounded-xl bg-brand-primary hover:bg-brand-primary-hover items-center justify-center transition-colors"
              style={{ minHeight: 44 }}
            >
              <Text className="text-white text-xs font-bold">Save configuration</Text>
            </TouchableOpacity>
          </View>
        </View>
    </Popup>
  );
}
