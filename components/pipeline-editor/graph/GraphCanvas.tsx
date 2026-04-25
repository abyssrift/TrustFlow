import React, { useMemo } from 'react';
import { View, StyleSheet, Dimensions, TouchableOpacity, Platform } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { 
  Gesture, 
  GestureDetector, 
  GestureHandlerRootView 
} from 'react-native-gesture-handler';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  useAnimatedProps,
  withSpring,
  runOnJS
} from 'react-native-reanimated';
import Svg, { Circle, Line, Defs, Pattern, Rect } from 'react-native-svg';
import { usePipelineEditor, Stage } from '@/contexts/PipelineEditorContext';
import StageNode from './StageNode';
import ConnectionLines from './ConnectionLines';

interface GraphCanvasProps {
  onEditStage: (s: Stage) => void;
  onDeleteStage: (id: string) => void;
}

const GRID_SIZE = 20;
const NODE_WIDTH = 256; 
const NODE_HEIGHT = 160;

const AnimatedLine = Animated.createAnimatedComponent(Line);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

export default function GraphCanvas({ onEditStage, onDeleteStage }: GraphCanvasProps) {
  const { stages, transitions, updateStagePosition, addTransition } = usePipelineEditor();

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);

  const stagePositions = useMemo(() => {
    return stages.reduce((acc, s, index) => {
      const x = s.ui_metadata?.x ?? 50 + (index * 300) % 1200;
      const y = s.ui_metadata?.y ?? 50 + Math.floor(index / 4) * 200;
      acc[s.id] = { x, y };
      return acc;
    }, {} as Record<string, { x: number, y: number }>);
  }, [stages]);

  // Rubber Band State (for live wiring)
  const isConnecting = useSharedValue(false);
  const connectionStart = useSharedValue({ x: 0, y: 0, stageId: "" });
  const connectionEnd = useSharedValue({ x: 0, y: 0 });

  const onStartConnection = (id: string, x: number, y: number) => {
    isConnecting.value = true;
    connectionStart.value = { x, y, stageId: id };
    connectionEnd.value = { x, y };
  };

  const onUpdateConnection = (x: number, y: number) => {
    connectionEnd.value = { x, y };
  };

  const onEndConnection = (targetId?: string) => {
    const finalX = connectionEnd.value.x;
    const finalY = connectionEnd.value.y;
    const fromId = connectionStart.value.stageId;

    isConnecting.value = false;

    // Hit-test logic: Find if finalX/finalY is inside any node bounding box (except source)
    let detectedTargetId = targetId;
    
    if (!detectedTargetId) {
       for (const stage of stages) {
          if (stage.id === fromId) continue;
          
          const pos = stagePositions[stage.id];
          const sx = stage.ui_metadata?.x ?? pos.x;
          const sy = stage.ui_metadata?.y ?? pos.y;
          
          // Use the center-ish of the drop point for a more forgiving hit test
          if (finalX >= sx && finalX <= sx + NODE_WIDTH &&
              finalY >= sy && finalY <= sy + NODE_HEIGHT) {
             detectedTargetId = stage.id;
             break;
          }
       }
    }

    if (fromId && detectedTargetId && fromId !== detectedTargetId) {
      runOnJS(addTransition)(fromId, detectedTargetId, "Next Step");
    }
  };

  const panStart = useSharedValue({ x: 0, y: 0 });
  const panGesture = Gesture.Pan()
    .onStart(() => {
      panStart.value = { x: translateX.value, y: translateY.value };
    })
    .onUpdate((e) => {
      translateX.value = panStart.value.x + e.translationX;
      translateY.value = panStart.value.y + e.translationY;
    });

  const startScale = useSharedValue(1);
  const zoomGesture = Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value;
    })
    .onUpdate((e) => {
      scale.value = Math.max(0.2, Math.min(2, startScale.value * e.scale));
    });

  const canvasStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value }
    ],
  }));

  const rubberBandStyle = useAnimatedStyle(() => {
    if (!isConnecting.value) return { opacity: 0 };
    return {
      opacity: 1,
    };
  });

  const handleWheel = (e: any) => {
    if (Platform.OS !== 'web') return;
    
    // Zoom if Ctrl/Meta is held, otherwise pan
    if (e.ctrlKey || e.metaKey) {
       // Prevent page zoom
       if (e.preventDefault) e.preventDefault();
       const zoomSpeed = 0.001;
       const newScale = scale.value - e.deltaY * zoomSpeed;
       scale.value = Math.max(0.2, Math.min(2, newScale));
    } else {
       // Allow panning
       translateX.value -= e.deltaX;
       translateY.value -= e.deltaY;
       
       // If we are actively panning inside the canvas, stop the page from scrolling
       if (e.preventDefault) e.preventDefault();
    }
  };

  return (
    <GestureHandlerRootView style={styles.root}>
      <View 
        style={styles.container}
        {...(Platform.OS === 'web' ? { onWheel: handleWheel } : {})}
      >
        {/* Background Grid */}
        <Animated.View style={[StyleSheet.absoluteFill, canvasStyle]}>
          <Svg width="100%" height="100%">
            <Defs>
              <Pattern
                id="grid"
                width={GRID_SIZE * 2}
                height={GRID_SIZE * 2}
                patternUnits="userSpaceOnUse"
              >
                <Circle cx="2" cy="2" r="1" fill="rgb(var(--surface-border))" opacity="0.5" />
              </Pattern>
            </Defs>
            <Rect 
               width="10000" 
               height="10000" 
               fill="url(#grid)" 
               x="-5000"
               y="-5000"
            />
          </Svg>
        </Animated.View>

        {/* Reset View Button */}
        {Platform.OS === 'web' && (
          <View style={{ position: 'absolute', bottom: 20, right: 20, zIndex: 1000, flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity 
              onPress={() => { translateX.value = withSpring(0); translateY.value = withSpring(0); scale.value = withSpring(1); }}
              className="bg-surface-card p-3 rounded-xl border border-surface-border shadow-xl hover:bg-surface-overlay"
            ><FontAwesome name="compress" size={16} className="text-brand-primary" /></TouchableOpacity>
          </View>
        )}

        <GestureDetector gesture={Gesture.Simultaneous(panGesture, zoomGesture)}>
          <Animated.View style={[styles.canvas, canvasStyle]}>
            {/* Connection Lines (SVG Layer) */}
            <ConnectionLines stages={stages} transitions={transitions} />

            {/* Stages (Nodes) */}
            {stages.map((stage, index) => (
              <StageNode 
                key={stage.id} 
                stage={stage} 
                index={index}
                onPositionChange={updateStagePosition}
                onEdit={() => onEditStage(stage)}
                onDelete={() => onDeleteStage(stage.id)}
                onStartConnection={onStartConnection}
                onUpdateConnection={onUpdateConnection}
                onEndConnection={onEndConnection}
                isConnecting={isConnecting}
              />
            ))}

            {/* Live Wire (Rubber Band) */}
            <Animated.View 
              style={[StyleSheet.absoluteFill, rubberBandStyle]}
              pointerEvents="none"
            >
               <Svg height="100%" width="100%">
                  <LineRubberBand 
                    startShared={connectionStart} 
                    endShared={connectionEnd} 
                  />
               </Svg>
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      </View>
    </GestureHandlerRootView>
  );
}

// Sub-component for the live rubber band path
function LineRubberBand({ startShared, endShared }: any) {
  const animatedProps = useAnimatedProps(() => ({
    x1: startShared.value.x,
    y1: startShared.value.y,
    x2: endShared.value.x,
    y2: endShared.value.y,
  }));

  return (
    <AnimatedLine 
       animatedProps={animatedProps}
       stroke="rgb(var(--brand-primary))"
       strokeWidth="2"
       strokeDasharray="5,5"
    />
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  canvas: {
    width: 5000,
    height: 5000,
    ...(Platform.OS === 'web' ? { cursor: 'grab' } : {}),
  }
});
