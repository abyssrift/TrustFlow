import React, { useState, useEffect } from 'react';
import { Text, View } from 'react-native';
import { useTimer } from '@/contexts/TimerContext';

interface TimerDisplayProps {
  className?: string;
  textClassName?: string;
  showSeconds?: boolean;
  hideIfInactive?: boolean;
}

/**
 * Atomic Timer Display component.
 * Uses the global TimerContext started_at timestamp and maintains its own
 * localized 1s tick to prevent app-wide re-renders.
 */
export default function TimerDisplay({ 
  className = "", 
  textClassName = "", 
  showSeconds = true,
  hideIfInactive = false
}: TimerDisplayProps) {
  const { activeSession, isActive } = useTimer();
  const [displayTime, setDisplayTime] = useState('00:00:00');

  useEffect(() => {
    if (!isActive || !activeSession?.started_at) {
      setDisplayTime('00:00:00');
      return;
    }

    const update = () => {
      const start = new Date(activeSession.started_at).getTime();
      // Note: serverTimeOffset logic will be added to TimerContext and used here
      const now = Date.now(); 
      const diff = Math.max(0, now - start);
      
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);

      const pad = (n: number) => n.toString().padStart(2, '0');
      
      if (showSeconds) {
        setDisplayTime(`${pad(h)}:${pad(m)}:${pad(s)}`);
      } else {
        setDisplayTime(`${pad(h)}:${pad(m)}`);
      }
    };

    // Initial update
    update();
    
    // Localized 1s interval
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [isActive, activeSession?.started_at, showSeconds]);

  if (hideIfInactive && !isActive) return null;

  return (
    <View className={`flex-row items-center ${className}`}>
      <Text className={`font-mono text-typography-main ${textClassName}`}>
        {displayTime}
      </Text>
    </View>
  );
}
