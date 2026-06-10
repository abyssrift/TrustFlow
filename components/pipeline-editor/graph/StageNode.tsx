import React, { useRef, useState, useMemo, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { 
  Gesture, 
  GestureDetector,
  TouchableOpacity as GHTouchableOpacity
} from 'react-native-gesture-handler';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring,
  runOnJS,
  useDerivedValue,
  type SharedValue
} from 'react-native-reanimated';
import { FontAwesome } from '@expo/vector-icons';
import { Stage } from '@/contexts/PipelineEditorContext';
import { useThemeColors } from '@/hooks/useThemeColors';

interface StageNodeProps {
  stage: Stage;
  index: number;
  onPositionChange: (id: string, x: number, y: number) => void;
  onEdit: () => void;
  onDelete: () => void;
  onStartConnection: (id: string, x: number, y: number) => void;
  onUpdateConnection: (x: number, y: number) => void;
  onEndConnection: (targetId?: string) => void;
  isConnecting: SharedValue<boolean>;
}

const GRID_SIZE = 20;
const NODE_WIDTH = 256; // w-64
const NODE_HEIGHT = 160;

export default function StageNode({ 
  stage, index, onPositionChange, onEdit, onDelete,
  onStartConnection, onUpdateConnection, onEndConnection,
  isConnecting 
}: StageNodeProps) {
  
  // Layout Logic
  const calcInitialX = () => stage.ui_metadata?.x ?? 50 + (index * 300) % 1200;
  const calcInitialY = () => stage.ui_metadata?.y ?? 50 + Math.floor(index / 4) * 200;
  
  const translateX = useSharedValue(calcInitialX());
  const translateY = useSharedValue(calcInitialY());

  // Sync with prop updates (e.g. data loaded from server)
  useEffect(() => {
    if (isDragging.value) return;
    
    const targetX = calcInitialX();
    const targetY = calcInitialY();
    
    if (translateX.value !== targetX) translateX.value = withSpring(targetX, { damping: 20 });
    if (translateY.value !== targetY) translateY.value = withSpring(targetY, { damping: 20 });
  }, [stage.ui_metadata, index]);

  const context = useSharedValue({ x: 0, y: 0 });
  const isDragging = useSharedValue(false);

  // Drag Gesture (Node Movement)
  const dragGesture = Gesture.Pan()
    .onStart(() => {
      isDragging.value = true;
      context.value = { x: translateX.value, y: translateY.value };
    })
    .onUpdate((e) => {
      // Snap to Grid
      const nextX = context.value.x + e.translationX;
      const nextY = context.value.y + e.translationY;
      translateX.value = Math.round(nextX / GRID_SIZE) * GRID_SIZE;
      translateY.value = Math.round(nextY / GRID_SIZE) * GRID_SIZE;
    })
    .onEnd(() => {
      isDragging.value = false;
      runOnJS(onPositionChange)(stage.id, translateX.value, translateY.value);
    });

  // Tap Gesture (Click to Edit)
  const tapGesture = Gesture.Tap()
    .numberOfTaps(1)
    .maxDuration(250)
    .onEnd(() => {
      runOnJS(onEdit)();
    });

  // Connection Gesture (Dragging from Output Port)
  const connectGesture = Gesture.Pan()
    .onStart((e) => {
      const portX = translateX.value + NODE_WIDTH;
      const portY = translateY.value + (NODE_HEIGHT / 2);
      runOnJS(onStartConnection)(stage.id, portX, portY);
    })
    .onUpdate((e) => {
      const currentX = translateX.value + NODE_WIDTH + e.translationX;
      const currentY = translateY.value + (NODE_HEIGHT / 2) + e.translationY;
      runOnJS(onUpdateConnection)(currentX, currentY);
    })
    .onEnd(() => {
      // Logic for detecting if dropped over a target is handled via broad JS communication or ref-based hit tests
      // For now, we signal end and let the parent handle target detection (or we'll add target detection later)
      runOnJS(onEndConnection)(undefined);
    });
  
  // Connection state style (Pulse effect for targets)
  const inputPortStyle = useAnimatedStyle(() => {
    const scaleValue = isConnecting.value && !stage.is_initial ? withSpring(1.5, { damping: 10 }) : withSpring(1);
    const opacityValue = isConnecting.value && !stage.is_initial ? withSpring(1) : 0.8;
    
    return {
      transform: [{ scale: scaleValue }],
      opacity: opacityValue,
      shadowColor: stage.color || colors.primary,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: isConnecting.value ? 0.8 : 0,
      shadowRadius: 10,
    };
  });

  const connectionHighlightStyle = useAnimatedStyle(() => {
    return {
      opacity: isConnecting.value ? 0.6 : 1,
      transform: [
        { scale: isConnecting.value ? withSpring(0.98) : withSpring(1) }
      ],
      borderWidth: isConnecting.value ? 3 : 2,
      borderColor: isConnecting.value ? colors.primary : colors.border,
    };
  });

  const animatedStyle = useAnimatedStyle(() => ({
    left: translateX.value,
    top: translateY.value,
    transform: [
      { scale: withSpring(isDragging.value ? 1.05 : 1) }
    ],
    zIndex: isDragging.value ? 100 : 1,
  }));



  return (
    <Animated.View style={[styles.container, animatedStyle]}>
      <GestureDetector gesture={dragGesture}>
        <Animated.View 
          className="bg-surface-card rounded-2xl shadow-xl overflow-hidden border-2 border-surface-border"
          style={[
            styles.card,
            connectionHighlightStyle,
            { borderTopColor: stage.color || colors.textMuted, borderTopWidth: 6 }
          ]}
        >
          {/* Header (Draggable, but buttons take priority) */}
          <View className="bg-surface-background/50 px-3 py-2 flex-row justify-between items-center border-b border-surface-border w-full">
            <View className="flex-row items-center gap-2">
              <View 
                className="w-2 h-2 rounded-full" 
                style={{ backgroundColor: stage.color || colors.textMuted }} 
              />
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">
                {stage.is_initial ? 'Entry' : stage.is_terminal ? 'Terminal' : 'Logic Block'}
              </Text>
            </View>
            <View className="flex-row gap-3">
              <TouchableOpacity 
                onPress={onEdit}
                className="p-1 hover:bg-surface-overlay rounded-md transition-all"
              >
                <FontAwesome name="pencil" size={10} color={stage.color || colors.textDim} />
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={onDelete}
                className="p-1 hover:bg-surface-overlay rounded-md transition-all"
              >
                <FontAwesome name="trash" size={10} color={colors.danger} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Body (Tappable to Edit) */}
          <GestureDetector gesture={tapGesture}>
            <View className="p-4 flex-1 justify-center w-full">
              <Text className="text-typography-main font-black text-lg leading-tight mb-1 uppercase tracking-tight">
                {stage.name}
              </Text>
              {!!stage.description && (
                <Text className="text-typography-muted text-[10px] leading-relaxed" numberOfLines={2}>
                  {stage.description}
                </Text>
              )}
              
              <View className="flex-row gap-1.5 mt-4">
                {stage.requires_submission && (
                  <View className="bg-surface-background/40 px-2 py-0.5 rounded border border-surface-border">
                    <FontAwesome name="upload" size={8} color={stage.color || colors.warning} />
                  </View>
                )}
                {stage.requires_timer && (
                  <View className="bg-surface-background/40 px-2 py-0.5 rounded border border-surface-border">
                    <FontAwesome name="clock-o" size={8} color={stage.color || colors.info} />
                  </View>
                )}
                {!!stage.linked_pipeline_id && (
                  <View className="bg-surface-background/40 px-2 py-0.5 rounded border border-surface-border">
                    <FontAwesome name="bolt" size={8} color={stage.color || colors.primary} />
                  </View>
                )}
              </View>
            </View>
          </GestureDetector>
        </Animated.View>
      </GestureDetector>

      {/* Input Port (Target) - Moved Outside Card to avoid clipping */}
      {!stage.is_initial && (
        <Animated.View style={[styles.inputPortContainer, inputPortStyle]} pointerEvents="none">
           <View 
            className="bg-surface-background border-2 items-center justify-center rounded-full" 
            style={[styles.inputPortDot, { borderColor: stage.color || colors.border }]}
           >
              <View 
                className="rounded-full" 
                style={[styles.inputPortInner, { backgroundColor: stage.color || colors.border }]} 
              />
           </View>
        </Animated.View>
      )}

      {/* Output Port (Source) - Moved Outside Card to avoid clipping */}
      {!stage.is_terminal && (
        <GestureDetector gesture={connectGesture}>
          <View style={styles.outputPortContainer}>
            <View 
              className="bg-surface-background border-2 shadow-xl items-center justify-center rounded-full" 
              style={[styles.outputPortDot, { borderColor: stage.color || colors.primary }]}
            >
              <View 
                className="rounded-full" 
                style={[styles.outputPortInner, { backgroundColor: stage.color || colors.primary }]} 
              />
            </View>
          </View>
        </GestureDetector>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  },
  card: {
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  },
  inputPortContainer: {
    position: 'absolute',
    left: -12,
    top: '50%',
    marginTop: -16,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  inputPortDot: {
    width: 16,
    height: 16,
  },
  inputPortInner: {
    width: 4,
    height: 4,
  },
  outputPortContainer: {
    position: 'absolute',
    right: -22,
    top: '50%',
    marginTop: -22,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
    ...(Platform.OS === 'web' ? { cursor: 'crosshair' } : {}),
  } as any,
  outputPortDot: {
    width: 20,
    height: 20,
  },
  outputPortInner: {
    width: 8,
    height: 8,
  }
});
