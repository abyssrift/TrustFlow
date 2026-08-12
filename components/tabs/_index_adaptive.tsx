import Popup from '@/components/common/Popup';
import WidgetGrid from '@/components/dashboard/widgets/WidgetGrid';
import { AddWidgetPopup, DashboardMenuPopup, WidgetConfigPopup } from '@/components/dashboard/widgets/WidgetPopups';
import { WidgetLayoutProvider } from '@/components/dashboard/widgets/registry';
import LiveSessionsPopup from '@/components/tabs/LiveSessionsPopup';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardDataProvider, useDashboardData } from '@/contexts/DashboardDataContext';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useDashboardLayout, type DashboardLayout } from '@/hooks/useDashboardLayout';
import { useNavBarPosition } from '@/hooks/useNavBarPosition';
import { useThemeColors } from '@/hooks/useThemeColors';
import type { DashboardConfig, WidgetInstance } from '@/lib/dashboardWidgets';
import { TAB_BAR_HEIGHT } from '@/lib/layout';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, RefreshControl, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';

// ── Helpers ──────────────────────────────────────────────────────────────

const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

// ── Component ────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const { user, profile } = useAuth();

  // Same hook, same storage key and same registry as the desktop screen: the
  // two files diverge on chrome (this one has a tab bar, a nav-bar position and
  // a tighter header), never on what a widget is or where its data comes from.
  const layout = useDashboardLayout();

  const [showLiveSessions, setShowLiveSessions] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [editing, setEditing] = useState(false);
  // The id, not the instance — the config sheet writes straight through
  // layout.setConfig, so a captured object would show the option the user left.
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const configuring = layout.instances.find(i => i.id === configuringId) ?? null;

  const displayName = useMemo(() => {
    return profile?.display_name || profile?.full_name || user?.user_metadata?.full_name || 'Operator';
  }, [profile, user]);

  const firstName = useMemo(() => displayName.split(' ')[0], [displayName]);

  return (
    // DashboardDataProvider so N widget instances share ONE copy of every
    // query — including the 500-row rpc_projects_table read that
    // useDashboardProjects exists to deduplicate. WidgetLayoutProvider so the
    // overview chart's inline period switch writes the same per-instance config
    // its sheet does; useWidgetLayout() throws without it, on purpose.
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
          // the overview-graph metrics this modal never touches survive the
          // save — the hand-rolled merge that used to live here is the hook's
          // one persist path now, and the refetch follows the fetch key.
          await layout.saveConfig(newConfig);
          setShowSettings(false);
        }}
      />
    </DashboardDataProvider>
  );
}

/**
 * Split out only because pull-to-refresh and the loading gate read
 * `useDashboardData()`, which the component mounting the provider cannot.
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
  const { width } = useWindowDimensions();
  const { unreadCount } = useNotifications();
  const router = useRouter();
  const colors = useThemeColors();
  const isLargeScreen = width > 768;
  const { position: navPosition } = useNavBarPosition();
  const { loading, refreshing, refreshAll } = useDashboardData();

  return (
    <ScrollView
      className="flex-1 bg-surface-background p-5"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingTop: Platform.OS === 'web' ? (isLargeScreen || navPosition !== 'top' ? 0 : TAB_BAR_HEIGHT.web) : TAB_BAR_HEIGHT.native, paddingBottom: (Platform.OS !== 'web' || !isLargeScreen) ? TAB_BAR_HEIGHT.native + 16 : 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={colors.primary} />}
    >
      <View className="mb-5 mt-4 flex-row justify-between items-start">
        <View className="flex-1 mr-3">
          <Text className="text-typography-main text-2xl font-black tracking-tight" numberOfLines={2}>
            {getGreeting()}, {firstName}
          </Text>
        </View>
        {/* 44x44, not 40x40 — these are the screen's primary tap targets and
            were under the minimum. Still three of them: at 390px a fourth does
            not fit, which is why edit mode lives behind the sliders menu and
            its own controls appear on their own row below. */}
        <View className="flex-row items-center gap-1.5">
          <TouchableOpacity
            onPress={() => router.push('/search' as any)}
            accessibilityRole="button"
            accessibilityLabel="Search"
            className="bg-surface-card rounded-full items-center justify-center border border-surface-border flex-shrink-0"
            style={{ width: 44, height: 44 }}
          >
            <FontAwesome name="search" size={15} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/notifications' as any)}
            accessibilityRole="button"
            accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
            className="bg-surface-card rounded-full items-center justify-center border border-surface-border flex-shrink-0"
            style={{ width: 44, height: 44 }}
          >
            <FontAwesome name="bell-o" size={15} color={colors.primary} />
            {unreadCount > 0 && (
              <View
                className="absolute top-0 right-0 bg-state-danger rounded-full items-center justify-center"
                style={{ minWidth: 16, height: 16, paddingHorizontal: 3 }}
              >
                <Text className="text-white text-[9px] font-black leading-none">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onOpenMenu}
            accessibilityRole="button"
            accessibilityLabel="Dashboard settings"
            className="bg-surface-card rounded-full items-center justify-center border border-surface-border flex-shrink-0"
            style={{ width: 44, height: 44 }}
          >
            <FontAwesome name="sliders" size={15} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Edit mode gets its own full-width row rather than a fourth header
          button: two labelled targets at 44px tall fit here at 390px, where
          they would not fit beside the three above. */}
      {editing && (
        <View className="flex-row items-center gap-2 mb-4">
          <TouchableOpacity
            onPress={onAddWidget}
            accessibilityRole="button"
            accessibilityLabel="Add a widget"
            className="flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-surface-card border border-surface-border"
            style={{ minHeight: 44 }}
          >
            <FontAwesome name="plus" size={12} color={colors.primary} />
            <Text className="text-typography-main text-xs font-bold">Add widget</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onDoneEditing}
            accessibilityRole="button"
            accessibilityLabel="Finish editing the dashboard layout"
            className="flex-1 rounded-xl bg-brand-primary items-center justify-center"
            style={{ minHeight: 44 }}
          >
            <Text className="text-white text-xs font-bold">Done</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Two different waits, both real. `hydrated` covers AsyncStorage AND
          permissionsLoaded — permissions start empty, so seeding before that
          flips hands back a dashboard with every gated widget stripped out. */}
      {(!layout.hydrated || loading) && !refreshing ? (
        <View className="items-center justify-center py-24">
          <ActivityIndicator size="large" color={colors.primary} />
          <Text className="text-typography-muted mt-3 font-bold uppercase tracking-widest text-[10px]">Loading data...</Text>
        </View>
      ) : (
        <WidgetGrid
          instances={layout.instances}
          editing={editing}
          layout={layout}
          onConfigure={onConfigure}
        />
      )}
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
    const { data: p } = await supabase.from('pipelines').select('id, name').is('deleted_at', null);
    const { data: s } = await supabase.from('pipeline_stages').select('id, name, pipeline_id, is_terminal, terminal_type').order('position', { ascending: true });
    setPipelines(p || []);
    setStages(s || []);
    setLoading(false);
  };

  const togglePipeline = (id: string) => {
    const isRemoving = selectedPipelines.includes(id);
    if (isRemoving) {
      setSelectedPipelines(prev => prev.filter(p => p !== id));
      const stageIds = stages.filter(s => s.pipeline_id === id).map(s => s.id);
      setSelectedSuccessStages(prev => prev.filter(sid => !stageIds.includes(sid)));
    } else {
      setSelectedPipelines(prev => [...prev, id]);
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

  return (
    <Popup visible={visible} onClose={onClose} presentation="auto" maxWidth={420}>
          <View className="px-4 py-3 border-b border-surface-border flex-row justify-between items-center bg-surface-card">
            <View>
              <Text className="text-typography-main text-base font-black">Dashboard Config</Text>
              <Text className="text-typography-muted text-[10px] font-bold uppercase">Pipeline Source Settings</Text>
            </View>
            <TouchableOpacity onPress={onClose} className="w-9 h-9 rounded-full bg-surface-background items-center justify-center border border-surface-border">
              <FontAwesome name="times" size={13} color={colors.textDim} />
            </TouchableOpacity>
          </View>

          <ScrollView className="flex-1 px-4 py-4">
            {loading ? (
              <View className="py-10 items-center">
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : (
              <View className="pb-8">
                {/* All Pipelines Toggle */}
                <TouchableOpacity
                  onPress={() => setUseAllPipelines(v => !v)}
                  className={`px-3.5 py-3 rounded-xl border mb-3 flex-row items-center justify-between ${useAllPipelines ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-card border-surface-border'}`}
                >
                  <View className="flex-1 mr-4">
                    <Text className={`font-black text-sm mb-0.5 ${useAllPipelines ? 'text-brand-primary' : 'text-typography-main'}`}>
                      Monitor All Pipelines
                    </Text>
                    <Text className="text-typography-muted text-[10px] font-medium">
                      Auto-include all pipelines. Success stages detected from terminal stages.
                    </Text>
                  </View>
                  <View
                    className={`w-12 h-7 rounded-full justify-center px-1 border-2 ${useAllPipelines ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
                  >
                    <View
                      className="w-4 h-4 rounded-full bg-white"
                      style={{ alignSelf: useAllPipelines ? 'flex-end' : 'flex-start' }}
                    />
                  </View>
                </TouchableOpacity>

                {useAllPipelines && (
                  <View className="bg-surface-card px-3.5 py-3 rounded-xl border border-surface-border mb-5">
                    <View className="flex-row items-center mb-1.5">
                      <FontAwesome name="check-circle" size={12} color={colors.primary} />
                      <Text className="text-brand-primary font-black text-[10px] ml-2 uppercase tracking-widest">Auto Mode Active</Text>
                    </View>
                    <Text className="text-typography-muted text-xs font-medium leading-relaxed">
                      All {pipelines.length} pipeline{pipelines.length !== 1 ? 's' : ''} monitored. Stages with{' '}
                      <Text className="text-state-success font-bold">terminal_type = success</Text> count as Completed. Other terminal stages show as Failed/Rejected.
                    </Text>
                  </View>
                )}

                {!useAllPipelines && (
                  <>
                    <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2.5">Select Pipelines</Text>
                    <View className="gap-2 mb-5">
                      {pipelines.map(p => (
                        <TouchableOpacity
                          key={p.id}
                          onPress={() => togglePipeline(p.id)}
                          className={`px-3.5 py-2.5 rounded-lg border flex-row items-center justify-between ${selectedPipelines.includes(p.id) ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
                        >
                          <Text className={`font-bold text-sm ${selectedPipelines.includes(p.id) ? 'text-white' : 'text-typography-main'}`}>{p.name}</Text>
                          {selectedPipelines.includes(p.id) && <FontAwesome name="check" size={12} color="white" />}
                        </TouchableOpacity>
                      ))}
                    </View>

                    {selectedPipelines.length > 0 && (
                      <>
                        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-0.5">Success Stages</Text>
                        <Text className="text-typography-muted text-xs mb-3 font-medium">
                          Completed stages are pre-selected. These count toward the "Completed" metric.
                        </Text>
                        {selectedPipelines.map(pid => {
                          const pipeline = pipelines.find(p => p.id === pid);
                          const pipelineStages = stages.filter(s => s.pipeline_id === pid);
                          return (
                            <View key={pid} className="mb-3 bg-surface-card p-3 rounded-xl border border-surface-border">
                              <Text className="text-typography-main font-black mb-2 text-sm">{pipeline?.name}</Text>
                              <View className="flex-row flex-wrap gap-2">
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
                                      className={`px-2.5 py-1.5 rounded-lg border flex-row items-center ${isSelected ? 'bg-state-success/10 border-state-success' : 'bg-surface-background border-surface-border'}`}
                                    >
                                      <FontAwesome
                                        name={isSelected ? "check-circle" : "circle-o"}
                                        size={16}
                                        color={isSelected ? colors.success : colors.textDim}
                                        style={{ marginRight: 5 }}
                                      />
                                      <Text className={`text-[10px] font-bold mr-1.5 ${isSelected ? 'text-state-success' : 'text-typography-muted'}`}>{s.name}</Text>
                                      {s.is_terminal && (
                                        <View className={`px-1.5 py-0.5 rounded-full ${terminalBg}`}>
                                          <Text className={`text-[7px] font-black uppercase ${terminalColor}`}>
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
                      </>
                    )}
                  </>
                )}
              </View>
            )}
          </ScrollView>

          <View className="px-4 py-3 border-t border-surface-border bg-surface-card">
            <TouchableOpacity
              onPress={handleSave}
              className="w-full h-11 rounded-xl bg-brand-primary items-center justify-center"
            >
              <Text className="text-white font-black uppercase tracking-widest text-sm">Save Config</Text>
            </TouchableOpacity>
          </View>
    </Popup>
  );
}
