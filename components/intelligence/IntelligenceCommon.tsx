import { useTheme } from '@/contexts/ThemeContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { NATIVE_THEME_COLORS } from '@/lib/layout';
import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

export const IntelligencePicker = ({ items, selectedId, onSelect, labelKey = 'name', disabled = false }: any) => (
  <View className={`flex-row flex-wrap gap-2 ${disabled ? 'opacity-30' : ''}`}>
    {items.map((item: any) => (
      <TouchableOpacity
        key={item.id}
        disabled={disabled}
        onPress={() => onSelect?.(item.id)}
        className={`px-5 py-2.5 rounded-xl border ${selectedId === item.id ? 'bg-brand-primary/5 border-brand-primary' : 'border-surface-border bg-surface-card'}`}
      >
        <View className="flex-row items-center">
          {selectedId === item.id && <View className="w-1.5 h-1.5 rounded-full bg-brand-primary mr-3" />}
          <Text className={`text-[11px] font-bold tracking-tight ${selectedId === item.id ? 'text-brand-primary font-black' : 'text-typography-muted'}`}>
            {item[labelKey] || 'N/A'}
          </Text>
        </View>
      </TouchableOpacity>
    ))}
  </View>
);

const SECTION_ICONS: Record<string, React.ComponentProps<typeof FontAwesome>['name']> = {
  Radar: 'crosshairs', Targets: 'bullseye', Archives: 'archive', Analytics: 'bar-chart',
};

export const SectionToggle = ({ active, onSelect, hasPermission }: { active: string, onSelect: (s: string) => void, hasPermission: (p: string) => boolean }) => {
  const colors = useThemeColors();
  const sections = ['Radar', 'Targets', 'Archives', 'Analytics'].filter(s => {
    if (s === 'Archives') return hasPermission('archive.view');
    if (s === 'Analytics') return hasPermission('analytics.view');
    return true;
  });
  return (
    <View className="flex-row flex-wrap gap-2 bg-surface-card rounded-2xl p-1.5 border border-surface-border mb-10 w-full max-w-full">
      {sections.map((s) => (
        <TouchableOpacity
          key={s}
          onPress={() => onSelect(s.toLowerCase())}
          className={`px-5 py-3 rounded-xl items-center flex-row justify-center flex-1 min-w-[132px] ${active === s.toLowerCase() ? 'bg-brand-primary premium-shadow' : 'bg-surface-card'}`}
        >
          <View className="mr-2">
            <FontAwesome
              name={SECTION_ICONS[s] ?? 'circle'}
              size={13}
              color={active === s.toLowerCase() ? 'white' : colors.textMuted}
            />
          </View>
          <Text className={`font-black text-[10px] uppercase tracking-widest text-center ${active === s.toLowerCase() ? 'text-white' : 'text-typography-muted'}`} numberOfLines={1}>
            {s}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

export const KPIBoxWeb = ({ label, val, delta }: any) => (
  <View className="flex-1 min-w-[220px] bg-surface-card p-5 rounded-[24px] border border-surface-border premium-shadow">
    <Text className="text-typography-muted text-[9px] font-black uppercase tracking-[0.2em] mb-3">{label}</Text>
    <View className="flex-row items-baseline">
      <Text className="text-typography-main text-2xl font-black">{val}</Text>
      {delta !== undefined && (
        <View className={`ml-3 px-2 py-0.5 rounded-full ${delta >= 0 ? 'bg-state-success/10' : 'bg-state-danger/10'}`}>
          <Text className={`text-[9px] font-black ${delta >= 0 ? 'text-state-success' : 'text-state-danger'}`}>
            {delta >= 0 ? '+' : ''}{delta}
          </Text>
        </View>
      )}
    </View>
  </View>
);

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
    <View className={`w-[280px] bg-surface-card p-6 rounded-[32px] border border-surface-border premium-shadow transition-all duration-300 ${target.status !== 'active' ? 'opacity-70 grayscale-[0.5]' : 'hover:scale-[1.02]'}`}>
      {/* Header Info */}
      <View className="flex-row justify-between items-start mb-6">
        <View className="flex-1">
          <Text className="text-typography-main font-black text-lg tracking-tighter mb-0.5" numberOfLines={1}>{target.stage?.name}</Text>
          <Text className="text-typography-muted text-[8px] font-black uppercase tracking-[0.2em]">
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
              style: { transform: 'rotate(-90deg)', transformOrigin: '60px 60px' },
            } as any} />
          </Svg>

          {/* Center Analytics */}
          <View className="items-center z-10">
            <View className="flex-row items-baseline">
              <Text className="text-typography-main text-2xl font-black tracking-tighter">
                {Math.round(progress)}
              </Text>
              <Text className="text-typography-muted text-sm font-black ml-0.5">%</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Metric Breakdown */}
      <View className="bg-surface-background/50 rounded-2xl p-4 border border-surface-border/30">
        {isVolume ? (
          <View className="flex-row justify-between items-center">
            <View>
              <Text className="text-typography-muted text-[8px] font-black uppercase tracking-widest mb-0.5">Processed</Text>
              <Text className="text-typography-main font-black text-base">
                {target.current_count || 0} <Text className="text-[10px] font-bold text-typography-muted">Units</Text>
              </Text>
            </View>
            <View className="items-end">
              <Text className="text-typography-muted text-[8px] font-black uppercase tracking-widest mb-0.5">Target</Text>
              <Text className="text-brand-primary font-black text-base">{target.target_quantity}</Text>
            </View>
          </View>
        ) : (
          <View className="flex-row gap-4">
            <View className="flex-1">
              <Text className="text-typography-muted text-[8px] font-black uppercase tracking-widest mb-0.5">Active</Text>
              <Text className="text-brand-primary font-black text-base">{Math.round((target.target_active_seconds || 0) / 60)}m</Text>
            </View>
            <View className="flex-1">
              <Text className="text-typography-muted text-[8px] font-black uppercase tracking-widest mb-0.5">Max Life</Text>
              <Text className="text-typography-main font-black text-base">{Math.round((target.target_lifecycle_seconds || 0) / 3600)}h</Text>
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
          <Text className="text-typography-muted text-[9px] font-bold">
            {target.target_deadline ? new Date(target.target_deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'No Limit'}
          </Text>
        </View>
        
        <View className="flex-row gap-2">
          {target.status === 'active' && (
            <>
              {isMet ? (
                <TouchableOpacity
                  onPress={() => onClear('completed')}
                  className="bg-state-success px-4 py-1.5 rounded-lg premium-shadow hover:scale-105 transition-all"
                >
                  <View className="flex-row items-center">
                    <FontAwesome name="check" size={9} color="white" />
                    <Text className="text-brand-on-primary text-[9px] font-black uppercase tracking-widest ml-1.5">Complete</Text>
                  </View>
                </TouchableOpacity>
              ) : isExpired ? (
                <TouchableOpacity
                  onPress={() => onClear('expired')}
                  className="bg-state-danger px-4 py-1.5 rounded-lg premium-shadow hover:scale-105 transition-all"
                >
                  <View className="flex-row items-center">
                    <FontAwesome name="times" size={9} color="white" />
                    <Text className="text-brand-on-primary text-[9px] font-black uppercase tracking-widest ml-1.5">Clear</Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={onEdit}
                  className="bg-brand-primary/10 px-3 py-1.5 rounded-lg border border-brand-primary/20 hover:bg-brand-primary/20 transition-all"
                >
                  <View className="flex-row items-center">
                    <FontAwesome name="pencil" size={9} color={palette.primary} />
                    <Text className="text-brand-primary text-[9px] font-black uppercase tracking-widest ml-1.5">Tune</Text>
                  </View>
                </TouchableOpacity>
              )}
            </>
          )}
          {target.status !== 'active' && (
            <View className="bg-surface-background/50 px-3 py-1.5 rounded-lg border border-surface-border/30">
               <Text className="text-typography-muted text-[8px] font-black uppercase tracking-widest">Archived</Text>
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
    <View className={`bg-surface-card p-6 rounded-3xl border ${isCompleted ? 'border-state-success' : isExpired ? 'border-state-danger' : 'border-surface-border'} mb-6 premium-shadow ${target.status !== 'active' && !isCompleted && !isExpired ? 'opacity-70 grayscale-[0.5]' : ''}`}>
      <View className="flex-row justify-between items-start mb-6">
        <View className="flex-1">
          <Text className="text-typography-main font-black text-lg mb-1">{target.stage?.name || 'Global Objective'}</Text>
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest">
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
          <View className="bg-surface-background/50 p-4 rounded-2xl border border-surface-border/30 mb-4">
            {isVolume ? (
              <View>
                <Text className="text-typography-muted text-[8px] font-black uppercase mb-1">Progress</Text>
                <Text className="text-typography-main font-black text-sm">
                  {target.current_count || 0} <Text className="text-[10px] font-bold text-typography-muted">/ {target.target_quantity}</Text>
                </Text>
              </View>
            ) : (
              <View className="flex-row gap-4">
                <View>
                  <Text className="text-typography-muted text-[8px] font-black uppercase mb-1">Target</Text>
                  <Text className="text-brand-primary font-black text-sm">{Math.round((target.target_active_seconds || 0) / 60)}m</Text>
                </View>
                <View>
                  <Text className="text-typography-muted text-[8px] font-black uppercase mb-1">Max</Text>
                  <Text className="text-typography-main font-black text-sm">{Math.round((target.target_lifecycle_seconds || 0) / 3600)}h</Text>
                </View>
              </View>
            )}
          </View>

          <View className="flex-row items-center mb-4">
            <FontAwesome name="calendar" size={8} color={colors.textDim} />
            <Text className="text-typography-muted text-[8px] font-bold ml-1.5">
              {target.target_deadline ? new Date(target.target_deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'No Limit'}
            </Text>
          </View>

          {target.status === 'active' ? (
            <View className="flex-row gap-2">
              {isMet ? (
                <TouchableOpacity
                  onPress={() => onAction(target.id, 'completed')}
                  className="flex-1 flex-row items-center justify-center bg-state-success py-2.5 rounded-xl premium-shadow"
                >
                  <FontAwesome name="check" size={10} color="white" />
                  <Text className="text-white text-[9px] font-black uppercase tracking-widest ml-2">Complete</Text>
                </TouchableOpacity>
              ) : isExpired ? (
                <TouchableOpacity
                  onPress={() => onAction(target.id, 'expired')}
                  className="flex-1 flex-row items-center justify-center bg-state-danger py-2.5 rounded-xl premium-shadow"
                >
                  <FontAwesome name="times" size={10} color="white" />
                  <Text className="text-white text-[9px] font-black uppercase tracking-widest ml-2">Clear</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={onEdit}
                  className="flex-1 flex-row items-center justify-center bg-brand-primary/10 py-2.5 rounded-xl border border-brand-primary/20"
                >
                  <FontAwesome name="pencil" size={10} color={colors.primary} />
                  <Text className="text-brand-primary text-[9px] font-black uppercase tracking-widest ml-2">Edit</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <TouchableOpacity 
              onPress={() => onAction(target.id, 'clear')}
              className="bg-surface-background/50 py-2.5 rounded-xl border border-surface-border/30 items-center"
            >
              <Text className="text-typography-muted text-[8px] font-black uppercase tracking-widest">Delete Record</Text>
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
    <View className="bg-surface-card p-6 rounded-3xl border border-surface-border mb-8 premium-shadow">
      <View className="flex-row items-center justify-between mb-6">
        <View>
          <Text className="text-typography-main font-black text-lg">Velocity Trace</Text>
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest">Completed Objectives / Week</Text>
        </View>
        <View className="w-8 h-8 rounded-full bg-brand-primary/10 items-center justify-center">
          <FontAwesome name="bolt" size={12} color={colors.primary} />
        </View>
      </View>

      {data.length === 0 ? (
        <View className="h-32 items-center justify-center bg-surface-background/50 rounded-2xl border border-dashed border-surface-border">
          <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">No Recent Deployments</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="h-40">
          <View style={{ height: chartHeight + 40 }} className="flex-row items-end px-2">
            {data.map((d, i) => {
              const h = (d.count / max) * chartHeight;
              return (
                <View key={i} style={{ width: barWidth, marginRight: gap }} className="items-center">
                  <View 
                    style={{ height: h, width: barWidth }} 
                    className="bg-brand-primary rounded-t-lg premium-shadow relative overflow-hidden"
                  >
                    <View className="absolute inset-0 bg-white/10" />
                  </View>
                  <Text className="text-typography-main font-black text-[10px] mt-2">{d.count}</Text>
                  <Text className="text-typography-muted text-[7px] font-bold uppercase mt-0.5">{d.date}</Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
};
