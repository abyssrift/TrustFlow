import React, { useEffect, useMemo } from 'react';
import { View, TouchableOpacity } from 'react-native';
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

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedView = Animated.createAnimatedComponent(View);

const NODE_WIDTH = 256; 
const NODE_HEIGHT = 160;

interface ConnectionLinesProps {
  stages: Stage[];
  transitions: Transition[];
}

export default function ConnectionLines({ stages, transitions }: ConnectionLinesProps) {
  const NODE_WIDTH = 256; 
  const NODE_HEIGHT = 160;

  const stagePositions = useMemo(() => {
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
    return transitions.map((transition) => {
      const fromPos = stagePositions[transition.from_stage_id];
      const toPos = stagePositions[transition.to_stage_id];

      if (!fromPos || !toPos) return null;

      const x1 = fromPos.x + NODE_WIDTH; // Precisely on the right edge/port
      const y1 = fromPos.y + (NODE_HEIGHT / 2);
      const x2 = toPos.x + 4; // Center of the input port dot
      const y2 = toPos.y + (NODE_HEIGHT / 2);

      const dx = x2 - x1;
      const dy = y2 - y1;
      
      // Improved curvature:
      // If nodes are stacked vertically (small dx), we need a wider sweep to avoid the node body.
      const horizontalCurvature = Math.max(Math.abs(dx) / 2, 100);
      const cp1x = x1 + horizontalCurvature;
      const cp1y = y1;
      const cp2x = x2 - horizontalCurvature;
      const cp2y = y2;

      const pathData = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
      
      // Midpoint for the "X" button (t = 0.5 for Cubic Bezier)
      const midX = 0.125 * x1 + 0.375 * cp1x + 0.375 * cp2x + 0.125 * x2;
      const midY = 0.125 * y1 + 0.375 * cp1y + 0.375 * cp2y + 0.125 * y2;

      return { id: transition.id, pathData, midX, midY };
    }).filter((t): t is { id: string, pathData: string, midX: number, midY: number } => t !== null);
  }, [transitions, stagePositions]);

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 }}>
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
            <Path d="M0,0 L0,7 L10,3.5 Z" fill="rgb(var(--brand-primary))" />
          </Marker>
        </Defs>

        {renderedTransitions.map((item) => (
          <React.Fragment key={item.id}>
            <Path
              d={item.pathData}
              fill="none"
              stroke="rgb(var(--brand-primary))"
              strokeWidth="6"
              strokeOpacity="0.05"
            />
            <AnimatedPath
              d={item.pathData}
              fill="none"
              stroke="rgb(var(--brand-primary))"
              strokeWidth="2.5"
              strokeOpacity="0.6"
              strokeDasharray="8,6"
              animatedProps={animatedPathProps}
              markerEnd="url(#arrowhead)"
            />
          </React.Fragment>
        ))}
      </Svg>

      {/* Interactive Overlay Layer (Buttons) */}
      {renderedTransitions.map((item) => (
        <View 
          key={`del-${item.id}`}
          style={{
            position: 'absolute',
            left: item.midX - 22,
            top: item.midY - 22,
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <TouchableOpacity
            onPress={() => deleteTransition(item.id)}
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: 'rgb(var(--surface-card))',
              borderWidth: 1,
              borderColor: 'rgb(var(--state-danger))',
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.3,
              shadowRadius: 4,
              elevation: 5,
            }}
          >
            <FontAwesome name="times" size={10} color="rgb(var(--state-danger))" />
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}
