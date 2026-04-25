import React, { useRef, useState, useMemo, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { 
  Gesture, 
  GestureDetector 
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
  
  // Connection state style
  const connectionHighlightStyle = useAnimatedStyle(() => {
    return {
      opacity: isConnecting.value ? 0.6 : 1,
      transform: [
        { scale: isConnecting.value ? withSpring(0.98) : withSpring(1) }
      ],
      borderWidth: isConnecting.value ? 3 : 2,
      // Using hex-strings is safer for some reanimated versions, 
      // but we'll stick to the var-strings if established or use themed constants if available.
      // For now, making it clear these are design tokens.
      borderColor: isConnecting.value ? 'rgb(var(--brand-primary))' : 'rgb(var(--surface-border))',
    };
  });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: withSpring(isDragging.value ? 1.05 : 1) }
    ],
    zIndex: isDragging.value ? 100 : 1,
  }));

  // Target detection during connection
  const handleMouseEnter = () => {
    if (isConnecting) {
      // Highlight this node as target?
    }
  };

  return (
    <Animated.View style={[styles.container, animatedStyle]}>
      <GestureDetector gesture={Gesture.Exclusive(dragGesture, tapGesture)}>
        <Animated.View 
          className="bg-surface-card rounded-2xl shadow-xl overflow-hidden border-2 border-surface-border"
          style={[
            styles.card,
            connectionHighlightStyle,
            { borderTopColor: stage.color || 'rgb(var(--text-muted))', borderTopWidth: 6 }
          ]}
        >
          {/* Header */}
          <View 
            className="bg-surface-background/50 px-3 py-2 flex-row justify-between items-center border-b border-surface-border"
            style={styles.header}
          ><View style={styles.headerLeft}><View style={[styles.statusDot, { backgroundColor: stage.color || '#64748b' }]} /><Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">{stage.is_initial ? 'Entry' : stage.is_terminal ? 'Terminal' : 'Logic Block'}</Text></View><View style={styles.headerRight}><TouchableOpacity onPress={onEdit}><FontAwesome name="pencil" size={10} color="rgb(var(--text-muted))" /></TouchableOpacity><TouchableOpacity onPress={onDelete}><FontAwesome name="trash" size={10} color="rgb(var(--state-danger))" /></TouchableOpacity></View></View>

          {/* Body */}
          <View className="p-4 flex-1 justify-center" style={styles.body}><Text className="text-typography-main font-black text-lg leading-tight mb-1 uppercase tracking-tight">{stage.name}</Text>{stage.description && (<Text className="text-typography-muted text-[10px] leading-relaxed" numberOfLines={2}>{stage.description}</Text>)}<View className="flex-row gap-1.5 mt-4" style={styles.flagsContainer}>{stage.requires_submission && (<View className="bg-brand-primary/10 px-2 py-0.5 rounded border border-brand-primary/20"><FontAwesome name="upload" size={8} color="rgb(var(--state-warning))" /></View>)}{stage.requires_timer && (<View className="bg-brand-primary/10 px-2 py-0.5 rounded border border-brand-primary/20"><FontAwesome name="clock-o" size={8} color="rgb(var(--state-info))" /></View>)}{stage.linked_pipeline_id && (<View className="bg-brand-primary/10 px-2 py-0.5 rounded border border-brand-primary/20"><FontAwesome name="bolt" size={8} color="rgb(var(--brand-primary))" /></View>)}</View></View>

          {/* Input Port (Visual only) */}
          {!stage.is_initial && (
            <View style={styles.inputPortContainer}>
               <View className="bg-surface-background border-2 border-surface-border rounded-full items-center justify-center" style={styles.inputPortDot}>
                  <View className="bg-surface-border rounded-full" style={styles.inputPortInner} />
               </View>
            </View>
          )}

          {/* Output Port (Interactive) */}
          {!stage.is_terminal && (
            <GestureDetector gesture={connectGesture}>
              <View style={styles.outputPortContainer}>
                <View className="bg-surface-background border-2 border-brand-primary rounded-full shadow-xl items-center justify-center" style={styles.outputPortDot}>
                  <View className="bg-brand-primary rounded-full" style={styles.outputPortInner} />
                </View>
              </View>
            </GestureDetector>
          )}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  },
  card: {
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  },
  header: {
    width: '100%',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  headerRight: {
    flexDirection: 'row',
    gap: 12,
  },
  body: {
    width: '100%',
  },
  flagsContainer: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 16,
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
  },
  outputPortDot: {
    width: 20,
    height: 20,
  },
  outputPortInner: {
    width: 8,
    height: 8,
  }
});
