import { useTheme } from '@/contexts/ThemeContext';
import { useBillingPlan } from '@/hooks/useBillingPlan';
import { useThemeColors } from '@/hooks/useThemeColors';
import { AnalyticsLimits, getAnalyticsLimits } from '@/lib/planLimits';
import { NATIVE_THEME_COLORS } from '@/lib/layout';
import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

export const IntelligencePicker = ({ items, selectedId, onSelect, labelKey = 'name', disabled = false }: any) => {
  const colors = useThemeColors();
  return (
    <View className={`flex-row flex-wrap gap-2 ${disabled ? 'opacity-30' : ''}`}>
      {items.map((item: any) => {
        const isSelected = selectedId === item.id;
        return (
          <TouchableOpacity
            key={item.id}
            disabled={disabled}
            onPress={() => onSelect?.(item.id)}
            className="px-5 py-2.5 rounded-xl border"
            style={{ backgroundColor: isSelected ? `${colors.primary}0d` : colors.card, borderColor: isSelected ? colors.primary : colors.border }}
          >
            <View className="flex-row items-center">
              {isSelected && <View className="w-1.5 h-1.5 rounded-full mr-3" style={{ backgroundColor: colors.primary }} />}
              <Text className={`text-[11px] tracking-tight ${isSelected ? 'font-black' : 'font-bold'}`} style={{ color: isSelected ? colors.primary : colors.textMuted }}>
                {item[labelKey] || 'N/A'}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const SECTION_ICONS: Record<string, React.ComponentProps<typeof FontAwesome>['name']> = {
  Radar: 'crosshairs', Targets: 'bullseye', Archives: 'archive', Analytics: 'bar-chart',
};

const SECTION_LOCK_FEATURES: Partial<Record<string, (keyof AnalyticsLimits)[]>> = {
  Radar: ['funnel', 'personnel'],
  Analytics: ['throughput', 'personnel'],
};

export const SectionToggle = ({ active, onSelect, hasPermission }: { active: string, onSelect: (s: string) => void, hasPermission: (p: string) => boolean }) => {
  const colors = useThemeColors();
  const { limits: planLimits } = useBillingPlan();
  const limits = getAnalyticsLimits(planLimits);
  const sections = ['Radar', 'Targets', 'Archives', 'Analytics'].filter(s => {
    if (s === 'Archives') return hasPermission('archive.view');
    if (s === 'Analytics') return hasPermission('analytics.view');
    return true;
  });
  return (
    <View className="flex-row flex-wrap gap-2 rounded-2xl p-1.5 border mb-10 w-full max-w-full" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
      {sections.map((s) => {
        const isActive = active === s.toLowerCase();
        const hasLocked = SECTION_LOCK_FEATURES[s]?.some(f => !limits[f]) ?? false;
        return (
          <TouchableOpacity
            key={s}
            onPress={() => onSelect(s.toLowerCase())}
            className={`px-5 py-3 rounded-xl items-center flex-row justify-center flex-1 min-w-[132px] ${isActive ? 'premium-shadow' : ''}`}
            style={{ backgroundColor: isActive ? colors.primary : colors.card }}
          >
            <View className="mr-2">
              <FontAwesome
                name={SECTION_ICONS[s] ?? 'circle'}
                size={13}
                color={isActive ? 'white' : colors.textMuted}
              />
            </View>
            <Text className="font-black text-[10px] uppercase tracking-widest text-center" style={{ color: isActive ? 'white' : colors.textMuted }} numberOfLines={1}>
              {s}
            </Text>
            {hasLocked && (
              <FontAwesome
                name="lock"
                size={8}
                color={isActive ? 'rgba(255,255,255,0.5)' : colors.textMuted}
                style={{ marginLeft: 5 }}
              />
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

export const KPIBoxWeb = ({ label, val, delta }: any) => {
  const colors = useThemeColors();
  return (
    <View className="flex-1 min-w-[220px] p-5 rounded-[24px] border premium-shadow" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
      <Text className="text-[9px] font-black uppercase tracking-[0.2em] mb-3" style={{ color: colors.textMuted }}>{label}</Text>
      <View className="flex-row items-baseline">
        <Text className="text-2xl font-black" style={{ color: colors.textMain }}>{val}</Text>
        {delta !== undefined && (
          <View className="ml-3 px-2 py-0.5 rounded-full" style={{ backgroundColor: delta >= 0 ? `${colors.success}1a` : `${colors.danger}1a` }}>
            <Text className="text-[9px] font-black" style={{ color: delta >= 0 ? colors.success : colors.danger }}>
              {delta >= 0 ? '+' : ''}{delta}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

const getStatusInfo = (target: any, colors: any) => {
  if (target.status === 'completed') {
    return {
      color: colors.success,
      bg: (colors.success + '26'),
      label: 'COMPLETED',
      gradient: [colors.success, colors.primary]
    };
  }
  if (target.status === 'expired') {
    return {
      color: colors.textDim,
      bg: (colors.border + '33'),
      label: 'EXPIRED',
      gradient: [colors.textDim, colors.textMuted]
    };
  }

  const deadline = target.target_deadline ? new Date(target.target_deadline) : null;
  const today = new Date();
  const daysUntil = deadline ? Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null;

  if (daysUntil !== null && daysUntil <= 0) {
    return { 
      color: colors.danger, 
      bg: (colors.danger + '26'),
      label: 'EXPIRED', 
      gradient: [colors.danger, colors.danger] 
    };
  } else if (daysUntil !== null && daysUntil <= 1) {
    return { 
      color: colors.danger, 
      bg: (colors.danger + '26'),
      label: 'EXPIRES SOON', 
      gradient: [colors.danger, colors.danger] 
    };
  } else if (daysUntil !== null && daysUntil <= 3) {
    return { 
      color: colors.warning, 
      bg: (colors.warning + '26'),
      label: 'EXPIRING SOON', 
      gradient: [colors.warning, colors.accent] 
    };
  }
  return { 
    color: colors.success, 
    bg: (colors.success + '26'),
    label: 'ON TRACK', 
    gradient: [colors.success, colors.primary] 
  };
};

export const CircularTargetCard = ({ target, onEdit, onClear }: any) => {
  const colors = useThemeColors();
  const { theme } = useTheme();
  const palette = NATIVE_THEME_COLORS[theme];
  const isVolume = target.target_type === 'volume';
  const progress = isVolume 
    ? Math.min(((target.current_count || 0) / (target.target_quantity || 1)) * 100, 100)
    : 50; // Performance goals currently static 50% for visual
  
  const status = getStatusInfo(target, colors);
  const circumference = 2 * Math.PI * 35;
  const strokeDashoffset = circumference - (progress / 100) * circumference;
  const isExpired = status.label === 'EXPIRED' && target.status === 'active';
  const isMet = progress >= 100 && target.status === 'active';

  return (
    <View className={`w-[280px] p-6 rounded-[32px] border premium-shadow transition-all duration-300 ${target.status !== 'active' ? 'opacity-70 grayscale-[0.5]' : 'hover:scale-[1.02]'}`} style={{ backgroundColor: colors.card, borderColor: colors.border }}>
      {/* Header Info */}
      <View className="flex-row justify-between items-start mb-6">
        <View className="flex-1">
          <Text className="font-black text-lg tracking-tighter mb-0.5" style={{ color: colors.textMain }} numberOfLines={1}>{target.stage?.name}</Text>
          <Text className="text-[8px] font-black uppercase tracking-[0.2em]" style={{ color: colors.textMuted }}>
            {isVolume ? 'Volume Quota' : 'SLA Goal'}
          </Text>
        </View>
        <View style={{ backgroundColor: status.bg, borderColor: status.color }} className="px-2 py-1 rounded-full border border-opacity-30">
          <Text style={{ color: status.color }} className="text-[7px] font-black uppercase tracking-widest">
            {status.label}
          </Text>
        </View>
      </View>

      {/* Circular Progress Container */}
      <View className="items-center justify-center mb-6 relative">
        <View className="w-32 h-32 items-center justify-center">
          <Svg width={120} height={120} viewBox="0 0 120 120" style={{ position: 'absolute' }}>
            <Defs>
              <LinearGradient id={`grad-${target.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor={status.gradient[0]} />
                <Stop offset="100%" stopColor={status.gradient[1]} />
              </LinearGradient>
            </Defs>
            
            {/* Background Track */}
            <Circle 
              cx={60} 
              cy={60} 
              r={35} 
              fill="none" 
              stroke={palette.background}
              strokeWidth={10} 
              strokeOpacity={0.5}
            />
            
            {/* Progress Stroke */}
            <Circle {...{
              cx: 60, cy: 60, r: 35, fill: 'none',
              stroke: `url(#grad-${target.id})`,
              strokeWidth: 10, strokeDasharray: circumference,
              strokeDashoffset: strokeDashoffset, strokeLinecap: 'round',
              // SVG-native rotate about the center — CSS transformOrigin in an RNSVG
              // style leaks a kebab `transform-origin` DOM attr on web (React warns).
              transform: 'rotate(-90, 60, 60)',
            } as any} />
          </Svg>

          {/* Center Analytics */}
          <View className="items-center z-10">
            <View className="flex-row items-baseline">
              <Text className="text-2xl font-black tracking-tighter" style={{ color: colors.textMain }}>
                {Math.round(progress)}
              </Text>
              <Text className="text-sm font-black ml-0.5" style={{ color: colors.textMuted }}>%</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Metric Breakdown */}
      <View className="rounded-2xl p-4 border" style={{ backgroundColor: `${colors.background}80`, borderColor: `${colors.border}4d` }}>
        {isVolume ? (
          <View className="flex-row justify-between items-center">
            <View>
              <Text className="text-[8px] font-black uppercase tracking-widest mb-0.5" style={{ color: colors.textMuted }}>Processed</Text>
              <Text className="font-black text-base" style={{ color: colors.textMain }}>
                {target.current_count || 0} <Text className="text-[10px] font-bold" style={{ color: colors.textMuted }}>Units</Text>
              </Text>
            </View>
            <View className="items-end">
              <Text className="text-[8px] font-black uppercase tracking-widest mb-0.5" style={{ color: colors.textMuted }}>Target</Text>
              <Text className="font-black text-base" style={{ color: colors.primary }}>{target.target_quantity}</Text>
            </View>
          </View>
        ) : (
          <View className="flex-row gap-4">
            <View className="flex-1">
              <Text className="text-[8px] font-black uppercase tracking-widest mb-0.5" style={{ color: colors.textMuted }}>Active</Text>
              <Text className="font-black text-base" style={{ color: colors.primary }}>{Math.round((target.target_active_seconds || 0) / 60)}m</Text>
            </View>
            <View className="flex-1">
              <Text className="text-[8px] font-black uppercase tracking-widest mb-0.5" style={{ color: colors.textMuted }}>Max Life</Text>
              <Text className="font-black text-base" style={{ color: colors.textMain }}>{Math.round((target.target_lifecycle_seconds || 0) / 3600)}h</Text>
            </View>
          </View>
        )}
      </View>

      {/* Footer Actions */}
      <View className="mt-6 flex-row items-center justify-between">
        <View className="flex-row items-center">
          <View className="mr-1.5">
            <FontAwesome name="calendar" size={9} color={colors.textDim} />
          </View>
          <Text className="text-[9px] font-bold" style={{ color: colors.textMuted }}>
            {target.target_deadline ? new Date(target.target_deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'No Limit'}
          </Text>
        </View>

        <View className="flex-row gap-2">
          {target.status === 'active' && (
            <>
              {isMet ? (
                <TouchableOpacity
                  onPress={() => onClear('completed')}
                  className="px-4 py-1.5 rounded-lg premium-shadow hover:scale-105 transition-all"
                  style={{ backgroundColor: colors.success }}
                >
                  <View className="flex-row items-center">
                    <FontAwesome name="check" size={9} color="white" />
                    <Text className="text-[9px] font-black uppercase tracking-widest ml-1.5" style={{ color: 'white' }}>Complete</Text>
                  </View>
                </TouchableOpacity>
              ) : isExpired ? (
                <TouchableOpacity
                  onPress={() => onClear('expired')}
                  className="px-4 py-1.5 rounded-lg premium-shadow hover:scale-105 transition-all"
                  style={{ backgroundColor: colors.danger }}
                >
                  <View className="flex-row items-center">
                    <FontAwesome name="times" size={9} color="white" />
                    <Text className="text-[9px] font-black uppercase tracking-widest ml-1.5" style={{ color: 'white' }}>Clear</Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={onEdit}
                  className="px-3 py-1.5 rounded-lg border hover:bg-brand-primary/20 transition-all"
                  style={{ backgroundColor: `${colors.primary}1a`, borderColor: `${colors.primary}33` }}
                >
                  <View className="flex-row items-center">
                    <FontAwesome name="pencil" size={9} color={palette.primary} />
                    <Text className="text-[9px] font-black uppercase tracking-widest ml-1.5" style={{ color: colors.primary }}>Tune</Text>
                  </View>
                </TouchableOpacity>
              )}
            </>
          )}
          {target.status !== 'active' && (
            <View className="px-3 py-1.5 rounded-lg border" style={{ backgroundColor: `${colors.background}80`, borderColor: `${colors.border}4d` }}>
               <Text className="text-[8px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Archived</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
};

export const CircularTargetCardMobile = ({ target, onEdit, onAction }: any) => {
  const colors = useThemeColors();
  const { theme } = useTheme();
  const palette = NATIVE_THEME_COLORS[theme];
  const isCompleted = target.status === 'completed';
  const isVolume = target.target_type === 'volume';
  const progress = isVolume 
    ? Math.min(((target.current_count || 0) / (target.target_quantity || 1)) * 100, 100)
    : Math.min(((target.active_seconds || 0) / (target.target_active_seconds || 1)) * 100, 100);
  
  const status = getStatusInfo(target, colors);
  const circumference = 2 * Math.PI * 35;
  const strokeDashoffset = circumference - (progress / 100) * circumference;
  
  const isExpired = target.status === 'expired' || (target.status === 'active' && status.label === 'EXPIRED');
  const isMet = progress >= 100 && target.status === 'active';

  // Reward/Punishment Styles
  const stateColor = isCompleted ? palette.success : isExpired ? palette.danger : palette.primary;
  const stateLabel = isCompleted ? 'ACHIEVED' : isExpired ? 'MISSED' : 'ACTIVE';

  return (
    <View className={`p-6 rounded-3xl border mb-6 premium-shadow ${target.status !== 'active' && !isCompleted && !isExpired ? 'opacity-70 grayscale-[0.5]' : ''}`} style={{ backgroundColor: colors.card, borderColor: isCompleted ? colors.success : isExpired ? colors.danger : colors.border }}>
      <View className="flex-row justify-between items-start mb-6">
        <View className="flex-1">
          <Text className="font-black text-lg mb-1" style={{ color: colors.textMain }}>{target.stage?.name || 'Global Objective'}</Text>
          <Text className="text-[9px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>
            {isVolume ? 'Volume Quota' : 'SLA Performance Goal'}
          </Text>
        </View>
        <View style={{ backgroundColor: isCompleted ? (colors.success + '1a') : isExpired ? (colors.danger + '1a') : status.bg, borderColor: stateColor }} className="px-2.5 py-1 rounded-full border border-opacity-50">
          <Text style={{ color: stateColor }} className="text-[7px] font-black uppercase tracking-widest">
            {stateLabel}
          </Text>
        </View>
      </View>

      <View className="flex-row items-center gap-6">
        <View className="w-24 h-24 items-center justify-center">
          <Svg width={100} height={100} viewBox="0 0 100 100" style={{ position: 'absolute' }}>
            <Circle 
              cx={50} 
              cy={50} 
              r={35} 
              fill="none" 
              stroke={(colors.border + '4d')} 
              strokeWidth={8} 
            />
            <Circle
              cx={50}
              cy={50}
              r={35}
              fill="none"
              stroke={stateColor}
              strokeWidth={8}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
            />
          </Svg>
          <View className="items-center z-10">
            <Text 
              style={{ color: stateColor }}
              className="text-xl font-black"
            >
              {Math.round(progress)}%
            </Text>
          </View>
        </View>

        <View className="flex-1">
          <View className="p-4 rounded-2xl border mb-4" style={{ backgroundColor: `${colors.background}80`, borderColor: `${colors.border}4d` }}>
            {isVolume ? (
              <View>
                <Text className="text-[8px] font-black uppercase mb-1" style={{ color: colors.textMuted }}>Progress</Text>
                <Text className="font-black text-sm" style={{ color: colors.textMain }}>
                  {target.current_count || 0} <Text className="text-[10px] font-bold" style={{ color: colors.textMuted }}>/ {target.target_quantity}</Text>
                </Text>
              </View>
            ) : (
              <View className="flex-row gap-4">
                <View>
                  <Text className="text-[8px] font-black uppercase mb-1" style={{ color: colors.textMuted }}>Target</Text>
                  <Text className="font-black text-sm" style={{ color: colors.primary }}>{Math.round((target.target_active_seconds || 0) / 60)}m</Text>
                </View>
                <View>
                  <Text className="text-[8px] font-black uppercase mb-1" style={{ color: colors.textMuted }}>Max</Text>
                  <Text className="font-black text-sm" style={{ color: colors.textMain }}>{Math.round((target.target_lifecycle_seconds || 0) / 3600)}h</Text>
                </View>
              </View>
            )}
          </View>

          <View className="flex-row items-center mb-4">
            <FontAwesome name="calendar" size={8} color={colors.textDim} />
            <Text className="text-[8px] font-bold ml-1.5" style={{ color: colors.textMuted }}>
              {target.target_deadline ? new Date(target.target_deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'No Limit'}
            </Text>
          </View>

          {target.status === 'active' ? (
            <View className="flex-row gap-2">
              {isMet ? (
                <TouchableOpacity
                  onPress={() => onAction(target.id, 'completed')}
                  className="flex-1 flex-row items-center justify-center py-2.5 rounded-xl premium-shadow"
                  style={{ backgroundColor: colors.success }}
                >
                  <FontAwesome name="check" size={10} color="white" />
                  <Text className="text-white text-[9px] font-black uppercase tracking-widest ml-2">Complete</Text>
                </TouchableOpacity>
              ) : isExpired ? (
                <TouchableOpacity
                  onPress={() => onAction(target.id, 'expired')}
                  className="flex-1 flex-row items-center justify-center py-2.5 rounded-xl premium-shadow"
                  style={{ backgroundColor: colors.danger }}
                >
                  <FontAwesome name="times" size={10} color="white" />
                  <Text className="text-white text-[9px] font-black uppercase tracking-widest ml-2">Clear</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={onEdit}
                  className="flex-1 flex-row items-center justify-center py-2.5 rounded-xl border"
                  style={{ backgroundColor: `${colors.primary}1a`, borderColor: `${colors.primary}33` }}
                >
                  <FontAwesome name="pencil" size={10} color={colors.primary} />
                  <Text className="text-[9px] font-black uppercase tracking-widest ml-2" style={{ color: colors.primary }}>Edit</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => onAction(target.id, 'clear')}
              className="py-2.5 rounded-xl border items-center"
              style={{ backgroundColor: `${colors.background}80`, borderColor: `${colors.border}4d` }}
            >
              <Text className="text-[8px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Delete Record</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
};
export const CompletionVelocityMobile = ({ data }: { data: { date: string, count: number }[] }) => {
  const colors = useThemeColors();
  const max = Math.max(...data.map(d => d.count), 5);
  const chartHeight = 120;
  const barWidth = 30;
  const gap = 15;

  return (
    <View className="p-6 rounded-3xl border mb-8 premium-shadow" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
      <View className="flex-row items-center justify-between mb-6">
        <View>
          <Text className="font-black text-lg" style={{ color: colors.textMain }}>Velocity Trace</Text>
          <Text className="text-[9px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Completed Objectives / Week</Text>
        </View>
        <View className="w-8 h-8 rounded-full items-center justify-center" style={{ backgroundColor: `${colors.primary}1a` }}>
          <FontAwesome name="bolt" size={12} color={colors.primary} />
        </View>
      </View>

      {data.length === 0 ? (
        <View className="h-32 items-center justify-center rounded-2xl border border-dashed" style={{ backgroundColor: `${colors.background}80`, borderColor: colors.border }}>
          <Text className="text-[10px] font-bold uppercase tracking-widest" style={{ color: colors.textMuted }}>No Recent Deployments</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="h-40">
          <View style={{ height: chartHeight + 40 }} className="flex-row items-end px-2">
            {data.map((d, i) => {
              const h = (d.count / max) * chartHeight;
              return (
                <View key={i} style={{ width: barWidth, marginRight: gap }} className="items-center">
                  <View
                    style={{ height: h, width: barWidth, backgroundColor: colors.primary }}
                    className="rounded-t-lg premium-shadow relative overflow-hidden"
                  >
                    <View className="absolute inset-0 bg-white/10" />
                  </View>
                  <Text className="font-black text-[10px] mt-2" style={{ color: colors.textMain }}>{d.count}</Text>
                  <Text className="text-[7px] font-bold uppercase mt-0.5" style={{ color: colors.textMuted }}>{d.date}</Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
};
