import React from 'react';
import { ActivityIndicator, PanResponder, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Tooltip from '@/components/common/Tooltip';
import { useThemeColors } from '@/hooks/useThemeColors';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useContextualGuide } from '@/contexts/ContextualGuideContext';
import { eligibleGuidePhases, getGuideStatusLabel, type GuideDefinition, type GuideRowStatus } from '@/lib/contextualGuides';
import {
  clampGuidePanelPosition,
  getDefaultGuidePanelPosition,
  isGuidePanelPosition,
  moveGuidePanelByKey,
  type GuidePanelPoint,
  type GuidePanelSize,
} from '@/lib/guidePanelPosition';

const PANEL_STORAGE_KEY = 'guide-checklist:panel-position';
const PANEL_MAX_WIDTH = 384;
const PANEL_MAX_HEIGHT = 560;
const PANEL_ESTIMATED_HEIGHT = 420;
export default function GuideChecklist({ launcherBottom }: { launcherBottom: number }) {
  const { guideDefinitions, progressById, newGuideIds, checklistVisible, closeChecklist, launchGuide, progressLoading, progressError, fallbackActive, progressRetry, eligibilityLoading } = useContextualGuide();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const [hideCompleted, setHideCompleted] = React.useState(false);
  const phases = eligibleGuidePhases(guideDefinitions);
  const [expandedPhases, setExpandedPhases] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(phases.map(({ id }) => [id, true])),
  );
  const panelWidth = Math.max(0, Math.min(PANEL_MAX_WIDTH, viewportWidth - 32));
  const panelMaxHeight = Math.max(0, Math.min(PANEL_MAX_HEIGHT, viewportHeight - 32));
  const panelSize = React.useRef<GuidePanelSize>({ width: panelWidth, height: Math.min(PANEL_ESTIMATED_HEIGHT, panelMaxHeight) });
  // Width changes immediately with the viewport; retain the measured height until
  // onLayout reports the responsive panel's new dimensions.
  panelSize.current = { width: panelWidth, height: Math.min(panelSize.current.height, panelMaxHeight) };
  const viewport = React.useRef({ width: viewportWidth, height: viewportHeight });
  viewport.current = { width: viewportWidth, height: viewportHeight };
  const defaultPosition = getDefaultGuidePanelPosition(panelSize.current, viewport.current);
  const [savedPosition, setSavedPosition] = usePersistedState<GuidePanelPoint>(PANEL_STORAGE_KEY, getDefaultGuidePanelPosition(panelSize.current, viewport.current, launcherBottom), isGuidePanelPosition);
  const [dragPosition, setDragPosition] = React.useState<GuidePanelPoint | null>(null);
  const dragOrigin = React.useRef<GuidePanelPoint>(savedPosition);
  const positionRef = React.useRef(savedPosition);
  positionRef.current = dragPosition ?? savedPosition;
  const setSavedPositionRef = React.useRef(setSavedPosition);
  setSavedPositionRef.current = setSavedPosition;
  const rows = guideDefinitions.filter((guide) => !hideCompleted || !['done', 'familiar'].includes(progressById[guide.id]?.status ?? ''));
  const loading = eligibilityLoading || progressLoading;
  const position = clampGuidePanelPosition(positionRef.current, panelSize.current, viewport.current);
  const allComplete = guideDefinitions.length > 0 && guideDefinitions.every((guide) => ['done', 'familiar'].includes(progressById[guide.id]?.status ?? ''));
  const wasAllComplete = React.useRef(allComplete);

  React.useEffect(() => {
    if (checklistVisible && allComplete && !wasAllComplete.current) closeChecklist();
    wasAllComplete.current = allComplete;
  }, [allComplete, checklistVisible, closeChecklist]);

  React.useEffect(() => {
    const next = clampGuidePanelPosition(savedPosition, panelSize.current, viewport.current);
    if (next.x !== savedPosition.x || next.y !== savedPosition.y) setSavedPosition(next);
  }, [viewportWidth, viewportHeight, panelWidth, panelMaxHeight, savedPosition, setSavedPosition]);

  const panResponder = React.useRef(PanResponder.create({
    // Let the Reset and Close controls receive taps. Capture only an actual drag.
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponderCapture: (_event, gesture) => Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3,
    onPanResponderGrant: () => {
      dragOrigin.current = positionRef.current;
      setDragPosition(positionRef.current);
    },
    onPanResponderMove: (_event, gesture) => {
      const next = clampGuidePanelPosition({ x: dragOrigin.current.x + gesture.dx, y: dragOrigin.current.y + gesture.dy }, panelSize.current, viewport.current);
      positionRef.current = next;
      setDragPosition(next);
    },
    onPanResponderRelease: () => {
      const next = clampGuidePanelPosition(positionRef.current, panelSize.current, viewport.current);
      setDragPosition(null);
      setSavedPositionRef.current(next);
    },
    onPanResponderTerminate: () => {
      const next = clampGuidePanelPosition(positionRef.current, panelSize.current, viewport.current);
      setDragPosition(null);
      setSavedPositionRef.current(next);
    },
  })).current;

  const onPanelLayout = React.useCallback((event: any) => {
    const { width: measuredWidth, height: measuredHeight } = event.nativeEvent.layout;
    panelSize.current = { width: measuredWidth, height: measuredHeight };
    const next = clampGuidePanelPosition(positionRef.current, panelSize.current, viewport.current);
    if (next.x !== positionRef.current.x || next.y !== positionRef.current.y) {
      positionRef.current = next;
      if (dragPosition) setDragPosition(next); else setSavedPosition(next);
    }
  }, [dragPosition, setSavedPosition]);

  const onHeaderKeyDown = React.useCallback((event: any) => {
    const key = event?.nativeEvent?.key ?? event?.key;
    if (!key?.startsWith('Arrow')) return;
    event.preventDefault?.();
    event.nativeEvent?.preventDefault?.();
    const next = moveGuidePanelByKey(positionRef.current, key, !!(event.shiftKey ?? event.nativeEvent?.shiftKey), panelSize.current, viewport.current);
    positionRef.current = next;
    setDragPosition(null);
    setSavedPosition(next);
  }, [setSavedPosition]);

  const resetPosition = React.useCallback(() => {
    const next = getDefaultGuidePanelPosition(panelSize.current, viewport.current, launcherBottom);
    positionRef.current = next;
    setDragPosition(null);
    setSavedPosition(next);
  }, [launcherBottom, setSavedPosition]);

  if (!checklistVisible) return null;

  return <View testID="guide-checklist-panel" pointerEvents="box-none" onLayout={onPanelLayout} className="absolute overflow-hidden rounded-xl border border-surface-border bg-surface-card/90" style={{ left: position.x, top: position.y, width: panelWidth, maxHeight: panelMaxHeight, zIndex: 1001 }}>
    <View className="flex-row items-center justify-between border-b border-surface-border px-3 py-2">
      <Pressable {...panResponder.panHandlers} {...({ onKeyDown: onHeaderKeyDown } as any)} accessibilityRole="button" accessibilityLabel="Move To Do checklist" accessibilityHint="Drag to move the checklist. Use arrow keys to move it; hold Shift to move faster." className="min-h-[44px] flex-1 justify-center rounded-lg">
        <Text className="text-lg font-bold text-typography-main">Your To Do guides</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Reset checklist position" onPress={resetPosition} className="min-h-[44px] min-w-[44px] items-center justify-center rounded-xl hover:bg-surface-background active:bg-surface-background">
        <Text className="text-sm font-semibold text-typography-muted">Reset</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Close checklist" onPress={closeChecklist} className="min-h-[44px] min-w-[44px] items-center justify-center rounded-xl hover:bg-surface-background active:bg-surface-background">
        <Text className="text-sm font-semibold text-typography-main">Close</Text>
      </Pressable>
    </View>
    <View className="px-3 pb-3 pt-2">
      <Pressable accessibilityRole="switch" accessibilityState={{ checked: hideCompleted }} accessibilityLabel="Hide completed" onPress={() => setHideCompleted((value) => !value)} className="mb-2 min-h-[44px] flex-row items-center gap-2 rounded-xl px-2">
        <View className={`h-5 w-5 rounded border border-surface-border ${hideCompleted ? 'bg-brand-primary' : 'bg-surface-background'}`} />
        <Text className="text-sm text-typography-main">Hide completed</Text>
      </Pressable>
      {loading ? <View className="min-h-[64px] items-center justify-center"><ActivityIndicator /></View> : <ScrollView style={{ maxHeight: Math.max(0, panelMaxHeight - (progressError ? 238 : 142)) }} showsVerticalScrollIndicator={false}>
        {phases.map((phase) => {
          const eligible = phase.guides;
          const phaseRows = rows.filter((guide) => phase.guides.some(({ id }) => id === guide.id));
          const doneCount = eligible.filter((guide) => ['done', 'familiar'].includes(progressById[guide.id]?.status ?? '')).length;
          const expanded = expandedPhases[phase.id] !== false;
          return <View key={phase.id} className="mb-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${phase.title} guides`}
              accessibilityState={{ expanded }}
              onPress={() => setExpandedPhases((current) => ({ ...current, [phase.id]: !expanded }))}
              className="min-h-[44px] flex-row items-center justify-between rounded-xl px-2 hover:bg-surface-background active:bg-surface-background"
            >
              <Text className="text-sm font-bold text-typography-main">{phase.title}</Text>
              <Text className="text-xs font-semibold text-typography-muted">{doneCount} of {eligible.length}</Text>
            </Pressable>
            <View
              accessibilityRole="progressbar"
              accessibilityLabel={`${phase.title} progress`}
              accessibilityValue={{ min: 0, max: eligible.length, now: doneCount, text: `${doneCount} of ${eligible.length} guides complete` }}
              className="mb-1 flex-row gap-1"
            >
              {eligible.map((guide) => <View key={guide.id} className={`h-2 flex-1 rounded-full ${['done', 'familiar'].includes(progressById[guide.id]?.status ?? '') ? 'bg-state-success' : 'bg-surface-border'}`} />)}
            </View>
            {expanded && phaseRows.map((guide) => <GuideRow key={guide.id} guide={guide} status={progressById[guide.id]?.status ?? 'not_started'} isNew={newGuideIds.includes(guide.id)} disabled={!!progressError && !fallbackActive} onLaunch={() => { void launchGuide(guide.id); }} />)}
          </View>;
        })}
      </ScrollView>}
      {progressError && <View className="mt-3 rounded-xl bg-state-warning p-3">
        <Text className="mb-2 text-sm text-typography-main">{fallbackActive ? 'Cloud progress is unavailable. You can keep learning; progress is saved on this device.' : 'Could not load guide progress.'}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry guide progress" onPress={() => { void progressRetry(); }} className="min-h-[44px] justify-center rounded-xl bg-brand-primary px-4"><Text className="text-center font-semibold text-surface-background">Retry</Text></Pressable>
      </View>}
    </View>
  </View>;
}

function GuideRow({ guide, status, isNew, disabled, onLaunch }: { guide: GuideDefinition; status: GuideRowStatus; isNew: boolean; disabled: boolean; onLaunch(): void }) {
  const action = status === 'done' || status === 'familiar' ? 'Replay' : status === 'in_progress' ? 'Resume' : 'Start';
  const colors = useThemeColors();
  const icon = status === 'done' || status === 'familiar' ? 'repeat' : 'play';
  return <View className="mb-1 border-b border-surface-border px-2 py-2">
    <View className="mb-1 flex-row items-center gap-2">
      <Text className="flex-1 text-base font-bold text-typography-main">{guide.title}</Text>
      {isNew && <View accessibilityLabel={`${guide.title}, newly available`} accessibilityRole="image" className="h-2 w-2 rounded-full bg-state-info" />}
    </View>
    <Text className="mb-2 text-sm leading-5 text-typography-muted">{guide.summary}</Text>
    <View className="flex-row items-center justify-between gap-3">
      <Text className="text-sm text-typography-label">{getGuideStatusLabel(status)}</Text>
      <Tooltip label={`${action} ${guide.title} guide`}>
        <Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={`${action} ${guide.title} guide`} accessibilityState={{ disabled }} onPress={onLaunch} className="min-h-[44px] min-w-[44px] items-center justify-center rounded-xl hover:bg-surface-background active:bg-surface-background">
          <FontAwesome name={icon} size={16} color={disabled ? colors.textMuted : colors.primary} />
        </Pressable>
      </Tooltip>
    </View>
  </View>;
}
