import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
vi.mock('react-native-svg', () => ({ Circle: 'Circle', G: 'G', default: 'Svg', Line: 'Line', Polyline: 'Polyline' }));
vi.mock('@expo/vector-icons', () => ({ FontAwesome: 'FontAwesome' }));
vi.mock('@/hooks/useThemeColors', () => ({ useThemeColors: () => ({}) }));
vi.mock('@/hooks/usePipelineOverviewData', () => ({
  DEFAULT_OVERVIEW_METRICS: [],
  OVERVIEW_METRICS: [],
  usePipelineOverviewData: () => ({ data: [], loading: false, error: null }),
}));

import { buildOverviewSeries } from './PipelineOverviewChartNative';

describe('buildOverviewSeries', () => {
  it('skips unavailable values and breaks line segments across gaps', () => {
    const result = buildOverviewSeries([
      { key: 'a', label: 'A', throughput: 2, points: 0, hours: 1, success_rate: 20 },
      { key: 'b', label: 'B', throughput: 0, points: 0, hours: 1, success_rate: null },
      { key: 'c', label: 'C', throughput: 4, points: 0, hours: 1, success_rate: 40 },
    ], 'success_rate', 100, 80, 10);

    expect(result.dots).toHaveLength(2);
    expect(result.segments).toHaveLength(2);
    expect(result.segments.every(segment => segment.split(' ').length === 1)).toBe(true);
  });

  it('keeps a measured zero as a plottable point', () => {
    const result = buildOverviewSeries([
      { key: 'a', label: 'A', throughput: 0, points: 0, hours: 0, success_rate: 0 },
    ], 'success_rate', 100, 80, 10);

    expect(result.dots).toHaveLength(1);
    expect(result.segments).toEqual(['50,90']);
  });
});
