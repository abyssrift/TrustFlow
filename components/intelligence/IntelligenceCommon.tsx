import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

export const Picker = ({ items, selectedId, onSelect, labelKey = 'name', disabled = false }: any) => (
  <View className={`flex-row flex-wrap gap-2 ${disabled ? 'opacity-30' : ''}`}>
    {items.map((item: any) => (
      <TouchableOpacity
        key={item.id}
        disabled={disabled}
        onPress={() => onSelect(item.id)}
        className={`px-5 py-2.5 rounded-xl border transition-all ${selectedId === item.id ? 'bg-brand-primary/5 border-brand-primary' : 'border-surface-border hover:bg-surface-background'}`}
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

export const SectionToggle = ({ active, onSelect, hasPermission }: { active: string, onSelect: (s: string) => void, hasPermission: (p: string) => boolean }) => (
  <View className="flex-row bg-surface-card rounded-2xl p-1.5 border border-surface-border mb-10 w-fit">
    {['Radar', 'Targets', 'Archives'].filter(s => s !== 'Archives' || hasPermission('archive.view')).map((s) => (
      <TouchableOpacity
        key={s}
        onPress={() => onSelect(s.toLowerCase())}
        className={`px-8 py-3 rounded-xl items-center flex-row ${active === s.toLowerCase() ? 'bg-brand-primary premium-shadow' : 'hover:bg-surface-background'}`}
      >
        <View className="mr-3">
          <FontAwesome
            name={s === 'Radar' ? 'crosshairs' : s === 'Targets' ? 'bullseye' : 'archive'}
            size={14}
            color={active === s.toLowerCase() ? 'white' : 'rgb(var(--typography-muted))'}
          />
        </View>
        <Text className={`font-black text-[10px] uppercase tracking-widest ${active === s.toLowerCase() ? 'text-white' : 'text-typography-muted'}`}>
          {s}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
);

export const KPIBoxWeb = ({ label, val, delta }: any) => (
  <View className="flex-1 min-w-[280px] bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow">
    <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">{label}</Text>
    <View className="flex-row items-baseline">
      <Text className="text-typography-main text-4xl font-black">{val}</Text>
      {delta !== undefined && (
        <View className={`ml-4 px-3 py-1 rounded-full ${delta >= 0 ? 'bg-state-success/10' : 'bg-state-danger/10'}`}>
          <Text className={`text-[10px] font-black ${delta >= 0 ? 'text-state-success' : 'text-state-danger'}`}>
            {delta >= 0 ? '+' : ''}{delta} units
          </Text>
        </View>
      )}
    </View>
  </View>
);

const getStatusInfo = (target: any) => {
  const deadline = target.target_deadline ? new Date(target.target_deadline) : null;
  const today = new Date();
  const daysUntil = deadline ? Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null;

  if (daysUntil !== null && daysUntil <= 1) {
    return { 
      color: 'rgb(var(--state-danger))', 
      bg: 'rgba(var(--state-danger), 0.15)',
      label: 'EXPIRES SOON', 
      gradient: ['#EF4444', '#B91C1C'] 
    };
  } else if (daysUntil !== null && daysUntil <= 3) {
    return { 
      color: 'rgb(var(--state-warning))', 
      bg: 'rgba(var(--state-warning), 0.15)',
      label: 'EXPIRING SOON', 
      gradient: ['#F59E0B', '#B45309'] 
    };
  }
  return { 
    color: 'rgb(var(--state-success))', 
    bg: 'rgba(var(--state-success), 0.15)',
    label: 'ON TRACK', 
    gradient: ['#10B981', '#047857'] 
  };
};

export const CircularTargetCard = ({ target, onEdit }: any) => {
  const isVolume = target.target_type === 'volume';
  const progress = isVolume 
    ? Math.min(((target.current_count || 0) / (target.target_quantity || 1)) * 100, 100)
    : 50;
  
  const status = getStatusInfo(target);
  const accentColor = 'rgb(var(--brand-accent))';
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <View className="w-[340px] bg-surface-card p-10 rounded-[40px] border border-surface-border premium-shadow hover:scale-[1.02] transition-all duration-300">
      {/* Header Info */}
      <View className="flex-row justify-between items-start mb-8">
        <View className="flex-1">
          <Text className="text-typography-main font-black text-2xl tracking-tighter mb-1">{target.stage?.name}</Text>
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-[0.2em]">
            {isVolume ? 'Volume Quota' : 'SLA Performance Goal'}
          </Text>
        </View>
        <View style={{ backgroundColor: status.bg, borderColor: status.color }} className="px-3 py-1.5 rounded-full border border-opacity-50">
          <Text style={{ color: status.color }} className="text-[8px] font-black uppercase tracking-widest">
            {status.label}
          </Text>
        </View>
      </View>

      {/* Circular Progress Container */}
      <View className="items-center justify-center mb-10 relative">
        <View className="w-40 h-40 items-center justify-center">
          <Svg width={160} height={160} viewBox="0 0 160 160" style={{ position: 'absolute' }}>
            <Defs>
              <LinearGradient id={`grad-${target.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor={status.gradient[0]} />
                <Stop offset="100%" stopColor={status.gradient[1]} />
              </LinearGradient>
            </Defs>
            
            {/* Background Track */}
            <Circle 
              cx={80} 
              cy={80} 
              r={45} 
              fill="none" 
              stroke="rgb(var(--surface-background))" 
              strokeWidth={12} 
              strokeOpacity={0.5}
            />
            
            {/* Progress Stroke */}
            <Circle
              cx={80}
              cy={80}
              r={45}
              fill="none"
              stroke={`url(#grad-${target.id})`}
              strokeWidth={12}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              style={{ transform: 'rotate(-90deg)', transformOrigin: '80px 80px' }}
            />
          </Svg>

          {/* Center Analytics */}
          <View className="items-center z-10">
            <View className="flex-row items-baseline">
              <Text className="text-typography-main text-3xl font-black tracking-tighter">
                {Math.round(progress)}
              </Text>
              <Text className="text-typography-muted text-xl font-black ml-1">%</Text>
            </View>
            <Text className="text-typography-muted text-[10px] font-bold mt-1 uppercase tracking-widest">Efficiency</Text>
          </View>
        </View>
      </View>

      {/* Metric Breakdown */}
      <View className="bg-surface-background/50 rounded-3xl p-6 border border-surface-border/30">
        {isVolume ? (
          <View className="flex-row justify-between items-center">
            <View>
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1">Processed</Text>
              <Text className="text-typography-main font-black text-lg">
                {target.current_count || 0} <Text className="text-sm font-bold text-typography-muted">Units</Text>
              </Text>
            </View>
            <View className="items-end">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1">Target</Text>
              <Text className="text-brand-primary font-black text-lg">{target.target_quantity}</Text>
            </View>
          </View>
        ) : (
          <View className="flex-row gap-6">
            <View className="flex-1">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1">Active</Text>
              <Text className="text-brand-primary font-black text-lg">{Math.round((target.target_active_seconds || 0) / 60)}m</Text>
            </View>
            <View className="flex-1">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1">Max Life</Text>
              <Text className="text-typography-main font-black text-lg">{Math.round((target.target_lifecycle_seconds || 0) / 3600)}h</Text>
            </View>
          </View>
        )}
      </View>

      {/* Footer Actions */}
      <View className="mt-8 flex-row items-center justify-between">
        <View className="flex-row items-center">
          <View className="mr-2">
            <FontAwesome name="calendar" size={10} color="rgb(var(--text-muted))" />
          </View>
          <Text className="text-typography-muted text-[10px] font-bold ml-2">
            {target.target_deadline ? new Date(target.target_deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'No Limit'}
          </Text>
        </View>
        
        <TouchableOpacity
          onPress={onEdit}
          className="bg-brand-primary/10 px-4 py-2 rounded-xl border border-brand-primary/20 hover:bg-brand-primary/20 transition-all"
        >
          <View className="flex-row items-center">
            <FontAwesome name="pencil" size={10} color="rgb(var(--brand-primary))" />
            <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest ml-2">Tune</Text>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export const CircularTargetCardMobile = ({ target, onEdit }: any) => {
  const isVolume = target.target_type === 'volume';
  const progress = isVolume 
    ? Math.min(((target.current_count || 0) / (target.target_quantity || 1)) * 100, 100)
    : 50;
  
  const status = getStatusInfo(target);
  const circumference = 2 * Math.PI * 35;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <View className="bg-surface-card p-6 rounded-3xl border border-surface-border mb-6 premium-shadow">
      <View className="flex-row justify-between items-start mb-6">
        <View className="flex-1">
          <Text className="text-typography-main font-black text-lg mb-1">{target.stage?.name}</Text>
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest">
            {isVolume ? 'Volume Quota' : 'SLA Performance Goal'}
          </Text>
        </View>
        <View style={{ backgroundColor: status.bg, borderColor: status.color }} className="px-2.5 py-1 rounded-full border border-opacity-50">
          <Text style={{ color: status.color }} className="text-[7px] font-black uppercase tracking-widest">
            {status.label}
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
              stroke="rgb(var(--surface-background))" 
              strokeWidth={8} 
              strokeOpacity={0.3}
            />
            <Circle
              cx={50}
              cy={50}
              r={35}
              fill="none"
              stroke={status.color}
              strokeWidth={8}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              style={{ transform: 'rotate(-90deg)', transformOrigin: '50px 50px' }}
            />
          </Svg>
          <View className="items-center z-10">
            <Text className="text-typography-main text-xl font-black">{Math.round(progress)}%</Text>
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
            <FontAwesome name="calendar" size={8} color="rgb(var(--text-muted))" />
            <Text className="text-typography-muted text-[8px] font-bold ml-1.5">
              {target.target_deadline ? new Date(target.target_deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'No Limit'}
            </Text>
          </View>

          <TouchableOpacity
            onPress={onEdit}
            className="flex-row items-center justify-center bg-brand-primary/10 py-2.5 rounded-xl border border-brand-primary/20"
          >
            <FontAwesome name="pencil" size={10} color="rgb(var(--brand-primary))" />
            <Text className="text-brand-primary text-[9px] font-black uppercase tracking-widest ml-2">Edit</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};
