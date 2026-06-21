import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useState } from 'react';
import { ActivityIndicator, Platform, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import type { StageDirection } from './actionRegistry';

// How far the triangular point extends past the rectangle body.
const ARROW_DEPTH = 12;
const BASE_PAD = 14;
const STROKE = 1.5;

/**
 * A stage-action button whose *shape* communicates direction: a rectangle body
 * with a triangular point — pointing right for a forward transition, left for a
 * backward one. The shape is a single SVG polygon (so the translucent fill +
 * outline have no overlapping seams); the icon/label sit on top.
 *
 * When `direction` is null it falls back to a plain rounded rectangle so callers
 * can route every stage action through this one component.
 */
export function DirectionalActionButton({
  direction,
  color,
  label,
  icon,
  loading = false,
  disabled = false,
  onPress,
  height = 38,
  fullWidth = false,
  block = false,
}: {
  direction: StageDirection;
  /** Tone (hex) used for the fill (10%), outline (30%), icon and label. */
  color: string;
  label: string;
  icon?: string | null;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
  height?: number;
  /** Share width inside a flex-row of buttons (the multi-action grid). */
  fullWidth?: boolean;
  /** Stretch to the full width of a column parent (a single standalone button). */
  block?: boolean;
}) {
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);

  const A = direction ? ARROW_DEPTH : 0;
  const hPad = BASE_PAD + A; // symmetric so the label stays centered
  const i = STROKE; // inset so the stroke isn't clipped at the edges

  const points = (() => {
    const w = width;
    const h = height;
    if (!w) return '';
    if (direction === 'forward') {
      return `${i},${i} ${w - A},${i} ${w - i},${h / 2} ${w - A},${h - i} ${i},${h - i}`;
    }
    if (direction === 'backward') {
      return `${A},${i} ${w - i},${i} ${w - i},${h - i} ${A},${h - i} ${i},${h / 2}`;
    }
    return `${i},${i} ${w - i},${i} ${w - i},${h - i} ${i},${h - i}`;
  })();

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      disabled={disabled || loading}
      onPress={onPress}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[
        { height, paddingHorizontal: hPad, justifyContent: 'center', opacity: disabled ? 0.5 : 1 },
        fullWidth ? { flex: 1, minWidth: '30%' } : block ? { alignSelf: 'stretch' } : { alignSelf: 'flex-start' },
        // Rounded fallback background only when not an arrow (arrow draws its own shape).
        !direction ? { borderRadius: 12 } : null,
        Platform.OS === 'web' ? ({ cursor: disabled ? 'default' : 'pointer' } as any) : null,
      ]}
    >
      {/* Shape layer */}
      {width > 0 && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="none">
          <Svg width={width} height={height}>
            <Polygon points={points} fill={color} fillOpacity={0.12} stroke={color} strokeOpacity={0.45} strokeWidth={STROKE} />
          </Svg>
        </View>
      )}

      {/* Content layer */}
      <View className="flex-row items-center justify-center">
        {loading ? (
          <ActivityIndicator size="small" color={color} />
        ) : (
          <>
            {icon ? <FontAwesome name={icon as any} size={11} color={color} style={{ marginRight: 7 }} /> : null}
            <Text numberOfLines={1} style={{ color }} className="text-[10px] font-black uppercase tracking-wider">
              {label}
            </Text>
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}
