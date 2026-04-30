import { useState, useEffect, useRef, useCallback } from 'react';
import { Platform, AppState, AppStateStatus } from 'react-native';

const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes of no activity
const SESSION_MAX_DURATION = 6 * 60 * 60 * 1000; // 6 hours
const CHECK_INTERVAL = 10 * 1000; // Check state every 10 seconds
const HEARTBEAT_INTERVAL = 30 * 1000; // Pulse server every 30 seconds

export type SmartTimerConfig = {
  onAutoStop: () => Promise<void>;
  onAutoStart: () => Promise<void>;
  onHeartbeat?: () => Promise<void>;
  onAutoStopBeacon?: () => void; // Sync-like fire-and-forget for tab close
  isActive: boolean;
  startedAt: string | null;
};

export function useSmartTimer({ onAutoStop, onAutoStart, onHeartbeat, onAutoStopBeacon, isActive, startedAt }: SmartTimerConfig) {
  const [showIdleModal, setShowIdleModal] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const checkTimerRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatTimerRef = useRef<NodeJS.Timeout | null>(null);
  const broadcastRef = useRef<BroadcastChannel | null>(null);

  // Cross-tab sync using BroadcastChannel
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof BroadcastChannel === 'undefined') return;
    
    const channel = new BroadcastChannel('smart_timer_activity');
    broadcastRef.current = channel;

    channel.onmessage = (event) => {
      if (event.data === 'activity_detected') {
        lastActivityRef.current = Date.now();
        if (showIdleModal) setShowIdleModal(false);
      }
    };

    return () => {
      channel.close();
    };
  }, [showIdleModal]);

  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (showIdleModal) setShowIdleModal(false);
    
    // Notify other tabs
    if (broadcastRef.current) {
      broadcastRef.current.postMessage('activity_detected');
    }
  }, [showIdleModal]);

  // Monitor activity on Web
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handleActivity = () => recordActivity();

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('click', handleActivity);
    window.addEventListener('scroll', handleActivity);

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('click', handleActivity);
      window.removeEventListener('scroll', handleActivity);
    };
  }, [recordActivity]);

  // Main logic loop (Idle & Max Session)
  useEffect(() => {
    if (!isActive || !startedAt) {
      if (checkTimerRef.current) clearInterval(checkTimerRef.current);
      setShowIdleModal(false);
      return;
    }

    const check = async () => {
      const now = Date.now();
      const elapsedSinceActivity = now - lastActivityRef.current;
      const elapsedSinceStart = now - new Date(startedAt).getTime();

      // 1. Idle Detection
      if (elapsedSinceActivity > IDLE_TIMEOUT) {
        if (!showIdleModal) {
          setShowIdleModal(true);
        }
        
        // Auto-stop after 2 mins of modal being ignored
        if (elapsedSinceActivity > IDLE_TIMEOUT + 2 * 60 * 1000) {
          await onAutoStop();
          setShowIdleModal(false);
        }
      }

      // 2. Max Session Cutoff
      if (elapsedSinceStart > SESSION_MAX_DURATION) {
        await onAutoStop();
        setShowIdleModal(false);
      }
    };

    checkTimerRef.current = setInterval(check, CHECK_INTERVAL);

    return () => {
      if (checkTimerRef.current) clearInterval(checkTimerRef.current);
    };
  }, [isActive, startedAt, showIdleModal, onAutoStop]);

  const [lastHeartbeat, setLastHeartbeat] = useState<number | null>(null);

  // Server Heartbeat loop
  useEffect(() => {
    if (!isActive || !onHeartbeat) {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      setLastHeartbeat(null);
      return;
    }

    const pulse = async () => {
      // Platform-specific visibility check
      const isVisible = Platform.OS === 'web' 
        ? document.visibilityState === 'active' || document.visibilityState === 'visible'
        : AppState.currentState === 'active';

      if (!isVisible) return;
      
      try {
        await onHeartbeat();
        setLastHeartbeat(Date.now());
      } catch (err) {
        console.error('Heartbeat failed:', err);
      }
    };

    // Listen for app state changes on Native
    let appStateSubscription: any = null;
    if (Platform.OS !== 'web') {
      appStateSubscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
        if (nextAppState === 'active') {
          pulse(); // Pulse immediately when returning to foreground
        }
      });
    }

    // Initial pulse
    pulse();
    heartbeatTimerRef.current = setInterval(pulse, HEARTBEAT_INTERVAL);

    return () => {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      if (appStateSubscription) appStateSubscription.remove();
    };
  }, [isActive, onHeartbeat]);

  // Auto-stop on tab close (Web)
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handleBeforeUnload = () => {
      if (isActive && onAutoStopBeacon) {
        // "Last Gasp" - browser guarantees this fetch finishes after tab close
        onAutoStopBeacon();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isActive, onAutoStopBeacon]);

  // Note: We NO LONGER stop on unmount because the timer is global
  // and managed by the root TimerProvider.

  return {
    showIdleModal,
    setShowIdleModal,
    recordActivity,
    lastHeartbeat
  };
}
