import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated, PanResponder, Platform, Dimensions } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useTimer } from '@/contexts/TimerContext';
import { useRouter } from 'expo-router';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function TimerIsland() {
  const { isActive, activeSession, stopWork, serverTimeOffset } = useTimer();
  const [elapsed, setElapsed] = useState('00:00:00');
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();

  // Animation values
  const pan = useRef(new Animated.ValueXY({ x: (SCREEN_WIDTH / 2) - 80, y: 20 })).current;
  const scale = useRef(new Animated.Value(0)).current;
  const expandAnim = useRef(new Animated.Value(0)).current;

  // Track dragging state to prevent clicks during drag
  const isDragging = useRef(false);

  useEffect(() => {
    if (isActive) {
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        tension: 50,
        friction: 7,
      }).start();

      const interval = setInterval(() => {
        if (!activeSession?.started_at) return;
        const start = new Date(activeSession.started_at).getTime();
        const diff = Date.now() + serverTimeOffset - start;
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        setElapsed(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
      }, 1000);

      return () => clearInterval(interval);
    } else {
      Animated.timing(scale, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
      setExpanded(false);
    }
  }, [isActive, activeSession?.started_at, serverTimeOffset]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        isDragging.current = false;
        pan.setOffset({
          x: (pan.x as any)._value,
          y: (pan.y as any)._value
        });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: (e, gesture) => {
        if (Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5) {
          isDragging.current = true;
        }
        return Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false })(e, gesture);
      },
      onPanResponderRelease: () => {
        pan.flattenOffset();
      },
    })
  ).current;

  const toggleExpand = () => {
    if (isDragging.current) return;
    const toValue = expanded ? 0 : 1;
    Animated.spring(expandAnim, {
      toValue,
      useNativeDriver: false,
      friction: 8,
      tension: 40,
    }).start();
    setExpanded(!expanded);
  };

  if (!isActive) return null;

  const islandWidth = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [140, 300],
  });

  const islandHeight = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [38, 70],
  });

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={{
        position: 'absolute',
        left: pan.x,
        top: pan.y,
        transform: [{ scale }],
        width: islandWidth,
        height: islandHeight,
        zIndex: 9999,
      }}
      className="bg-surface-card rounded-full shadow-2xl border border-surface-border/50 items-center justify-center overflow-hidden"
    >
      <View className="flex-row items-center px-3 w-full h-full">
        {/* Left: Pulse & Timer */}
        <TouchableOpacity 
          onPress={toggleExpand} 
          activeOpacity={0.8}
          className="flex-row items-center"
        >
           <View className="w-2 h-2 rounded-full bg-brand-primary animate-pulse mr-2.5 ml-1" />
           {!expanded && (
             <Text className="text-white font-mono text-xs font-black mr-2">{elapsed}</Text>
           )}
        </TouchableOpacity>

        {/* Info (Expanded) */}
        {expanded && (
          <View className="flex-1 px-1">
            <Text className="text-typography-muted text-[7px] font-black uppercase tracking-tighter opacity-60">
              {activeSession?.id === 'pending' ? 'Committing...' : 'Active Session'}
            </Text>
            <TouchableOpacity onPress={() => !isDragging.current && router.push(`/task/${activeSession?.task_id}`)}>
              <Text className="text-white text-[10px] font-bold" numberOfLines={1}>
                {activeSession?.task?.title || 'Task Details'}
              </Text>
            </TouchableOpacity>
            <Text className="text-brand-primary font-mono text-[9px] font-black mt-0.5">{elapsed}</Text>
          </View>
        )}

        {/* Right: Controls */}
        <View className="flex-row items-center gap-1.5 pr-1">
          {expanded && (
             <TouchableOpacity 
                onPress={() => stopWork()}
                className="w-7 h-7 rounded-full bg-state-danger/10 items-center justify-center border border-state-danger/20 active:bg-state-danger/30"
              >
                <FontAwesome name="stop" size={9} color="rgb(var(--state-danger))" />
             </TouchableOpacity>
          )}
          
          <TouchableOpacity 
            onPress={toggleExpand}
            className="w-7 h-7 rounded-full bg-white/10 items-center justify-center active:bg-white/20"
          >
            <FontAwesome name={expanded ? 'compress' : 'expand'} size={9} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
}
