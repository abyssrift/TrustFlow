import React, { useEffect, useMemo } from 'react';
import { View, TouchableOpacity, Text } from 'react-native';
import Svg, { Path, Marker, Defs } from 'react-native-svg';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle,
  useAnimatedProps, 
  withRepeat, 
  withTiming, 
  LinearTransition,
  Easing
} from 'react-native-reanimated';
import { FontAwesome } from '@expo/vector-icons';
import { usePipelineEditor, Stage, Transition } from '@/contexts/PipelineEditorContext';
import { useThemeColors } from '@/hooks/useThemeColors';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedView = Animated.createAnimatedComponent(View);

const NODE_WIDTH = 256; 
const NODE_HEIGHT = 160;

interface ConnectionLinesProps {
  const colors = useThemeColors();
  stages: Stage[];
  transitions: Transition[];
  onEditTransition?: (id: string) => void;
}

export default function ConnectionLines({ stages, transitions, onEditTransition }: ConnectionLinesProps) {
  const colors = useThemeColors();
  const NODE_WIDTH = 256; 
  const NODE_HEIGHT = 160;

  const stagePositions = useMemo(() => {
    const colors = useThemeColors();
    return stages.reduce((acc, s, index) => {
      const x = s.ui_metadata?.x ?? 50 + (index * 300) % 1200;
      const y = s.ui_metadata?.y ?? 50 + Math.floor(index / 4) * 200;
      acc[s.id] = { x, y };
      return acc;
    }, {} as Record<string, { x: number, y: number }>);
  }, [stages]);

  // 1. Animation for the flowing dashes
  const dashOffset = useSharedValue(0);
  
  useEffect(() => {
    dashOffset.value = withRepeat(
      withTiming(-20, { duration: 1000, easing: Easing.linear }),
      -1,
      false
    );
  }, []);

  // 2. Shared Animated Props (Fix Rule of Hooks)
  const animatedPathProps = useAnimatedProps(() => ({
    strokeDashoffset: dashOffset.value,
  }));

  const { deleteTransition } = usePipelineEditor();

  // 3. Pre-calculate path data (Memoized)
  const renderedTransitions = useMemo(() => {
    const pairCounts: Record<string, number> = {};

    return transitions.map((transition) => {
      const fromPos = stagePositions[transition.from_stage_id];
      const toPos = stagePositions[transition.to_stage_id];

      if (!fromPos || !toPos) return null;

      // Group transitions to offset overlapping lines
      const pairKey = `${transition.from_stage_id}-${transition.to_stage_id}`;
      const indexInPair = pairCounts[pairKey] || 0;
      pairCounts[pairKey] = indexInPair + 1;

      const x1 = fromPos.x + NODE_WIDTH; 
      const y1 = fromPos.y + (NODE_HEIGHT / 2);
      const x2 = toPos.x + 4; 
      const y2 = toPos.y + (NODE_HEIGHT / 2);

      const dx = x2 - x1;
      const dy = y2 - y1;
      
      // Dynamic offset for multiple transitions between same nodes
      const verticalOffset = (indexInPair - ((pairCounts[pairKey] - 1) / 2)) * 40;
      
      const horizontalCurvature = Math.max(Math.abs(dx) / 2, 100);
      const cp1x = x1 + horizontalCurvature;
      const cp1y = y1 + verticalOffset;
      const cp2x = x2 - horizontalCurvature;
      const cp2y = y2 + verticalOffset;

      const pathData = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
      
      const midX = 0.125 * x1 + 0.375 * cp1x + 0.375 * cp2x + 0.125 * x2;
      const midY = 0.125 * y1 + 0.375 * cp1y + 0.375 * cp2y + 0.125 * y2;

      return { id: transition.id, pathData, midX, midY, indexInPair };
    }).filter((t): t is { id: string, pathData: string, midX: number, midY: number, indexInPair: number } => t !== null);
  }, [transitions, stagePositions]);

  return (
    <View className="absolute inset-0 z-0">
      <Svg height="100%" width="100%">
        <Defs>
          <Marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <Path d="M0,0 L0,7 L10,3.5 Z" fill={colors.primary} />
          </Marker>
        </Defs>

        {renderedTransitions.map((item) => {
          const transition = transitions.find(t => t.id === item.id);
          return (
            <React.Fragment key={item.id}>
              <Path
                d={item.pathData}
                fill="none"
                stroke={colors.primary}
                strokeWidth="6"
                strokeOpacity="0.05"
              />
              <AnimatedPath
                d={item.pathData}
                fill="none"
                stroke={colors.primary}
                strokeWidth="2.5"
                strokeOpacity="0.6"
                strokeDasharray="8,6"
                animatedProps={animatedPathProps}
                markerEnd="url(#arrowhead)"
              />
            </React.Fragment>
          );
        })}
      </Svg>

      {/* Interactive Overlay Layer (Buttons & Labels) */}
      {renderedTransitions.map((item) => {
        const transition = transitions.find(t => t.id === item.id);
        return (
          <View 
            key={`overlay-${item.id}`}
            style={{ left: item.midX - 50, top: item.midY - 22 }}
            className="absolute w-[100px] h-[44px] items-center justify-center z-50 flex-row gap-1.5"
          >
            {!!transition?.label && (
              <View className="bg-surface-card px-2 py-0.5 rounded-md border border-surface-border shadow-sm absolute -top-5">
                <Text className="text-typography-main text-[9px] font-black uppercase tracking-tighter">
                  {transition.label}
                </Text>
              </View>
            )}

            <TouchableOpacity
              onPress={() => onEditTransition?.(item.id)}
              className="w-6 h-6 rounded-full bg-surface-card border border-brand-primary items-center justify-center shadow-lg hover:bg-brand-primary/10 transition-all active:scale-90"
            >
              <FontAwesome name="pencil" size={10} color={colors.primary} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => deleteTransition(item.id)}
              className="w-6 h-6 rounded-full bg-surface-card border border-state-danger items-center justify-center shadow-lg hover:bg-state-danger/10 transition-all active:scale-90"
            >
              <FontAwesome name="times" size={11} color={colors.danger} />
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}
