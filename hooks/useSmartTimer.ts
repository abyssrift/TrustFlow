import { useState, useEffect, useRef, useCallback } from 'react';
import { Platform, AppState, AppStateStatus } from 'react-native';

const IDLE_TIMEOUT = 30 * 60 * 1000;        // 30 minutes of no activity
const SESSION_MAX_DURATION = 6 * 60 * 60 * 1000; // 6 hours
const CHECK_INTERVAL = 10 * 1000;           // Check state every 10 seconds
const HEARTBEAT_INTERVAL = 30 * 1000;       // Pulse server every 30 seconds

export type SmartTimerConfig = {
  onAutoStop: () => Promise<void>;
  onAutoStart: () => Promise<void>;
  onHeartbeat?: () => Promise<void>;
  onAutoStopBeacon?: () => void;
  onActivity?: () => void;
  isActive: boolean;
  startedAt: string | null;
};

export function useSmartTimer({ onAutoStop, onAutoStart, onHeartbeat, onAutoStopBeacon, onActivity, isActive, startedAt }: SmartTimerConfig) {
  const [showIdleModal, setShowIdleModal] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const checkTimerRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatTimerRef = useRef<NodeJS.Timeout | null>(null);
  const broadcastRef = useRef<BroadcastChannel | null>(null);
  const isAutoStoppingRef = useRef(false);

  // Stable refs for callbacks — prevents interval re-registration when parent re-renders.
  // The interval closures always call the latest version of the callback via the ref.
  const onAutoStopRef = useRef(onAutoStop);
  const onHeartbeatRef = useRef(onHeartbeat);
  const onAutoStopBeaconRef = useRef(onAutoStopBeacon);
  const onActivityRef = useRef(onActivity);
  useEffect(() => { onAutoStopRef.current = onAutoStop; }, [onAutoStop]);
  useEffect(() => { onHeartbeatRef.current = onHeartbeat; }, [onHeartbeat]);
  useEffect(() => { onAutoStopBeaconRef.current = onAutoStopBeacon; }, [onAutoStopBeacon]);
  useEffect(() => { onActivityRef.current = onActivity; }, [onActivity]);

  // Cross-tab sync via BroadcastChannel — created once, never torn down until unmount
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('smart_timer_activity');
    broadcastRef.current = channel;
    channel.onmessage = (event) => {
      if (event.data === 'activity_detected') {
        lastActivityRef.current = Date.now();
        onActivityRef.current?.();
        setShowIdleModal(false);
      }
    };
    return () => {
      channel.close();
      broadcastRef.current = null;
    };
  }, []); // intentionally empty — channel lives for the hook's lifetime

  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    onActivityRef.current?.();
    setShowIdleModal(false);
    if (broadcastRef.current) {
      broadcastRef.current.postMessage('activity_detected');
    }
  }, []);

  // Monitor activity on Web
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    window.addEventListener('mousemove', recordActivity);
    window.addEventListener('keydown', recordActivity);
    window.addEventListener('click', recordActivity);
    window.addEventListener('scroll', recordActivity);
    return () => {
      window.removeEventListener('mousemove', recordActivity);
      window.removeEventListener('keydown', recordActivity);
      window.removeEventListener('click', recordActivity);
      window.removeEventListener('scroll', recordActivity);
    };
  }, [recordActivity]);

  // Main idle/max-session check loop
  // Only depends on isActive and startedAt — callbacks accessed via refs to prevent re-registration
  useEffect(() => {
    if (!isActive || !startedAt) {
      if (checkTimerRef.current) clearInterval(checkTimerRef.current);
      isAutoStoppingRef.current = false;
      setShowIdleModal(false);
      return;
    }

    const check = async () => {
      if (isAutoStoppingRef.current) return;
      const now = Date.now();
      const elapsedSinceActivity = now - lastActivityRef.current;
      const elapsedSinceStart = now - new Date(startedAt).getTime();

      const isIdle = elapsedSinceActivity > IDLE_TIMEOUT;
      const isForceStop = isIdle && elapsedSinceActivity > IDLE_TIMEOUT + 2 * 60 * 1000;
      const isMaxSession = elapsedSinceStart > SESSION_MAX_DURATION;

      if (isIdle) setShowIdleModal(true);

      if (isForceStop || isMaxSession) {
        isAutoStoppingRef.current = true;
        await onAutoStopRef.current();
        isAutoStoppingRef.current = false;
        setShowIdleModal(false);
      }
    };

    checkTimerRef.current = setInterval(check, CHECK_INTERVAL);
    return () => {
      if (checkTimerRef.current) clearInterval(checkTimerRef.current);
    };
  }, [isActive, startedAt]); // callbacks accessed via ref — no cascade on re-render

  const [lastHeartbeat, setLastHeartbeat] = useState<number | null>(null);

  // Server heartbeat loop
  // Only depends on isActive — onHeartbeat accessed via ref to prevent cascade re-registration
  useEffect(() => {
    if (!isActive) {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      setLastHeartbeat(null);
      return;
    }

    const pulse = async () => {
      const isVisible = Platform.OS === 'web'
        ? document.visibilityState === 'active' || document.visibilityState === 'visible'
        : AppState.currentState === 'active';
      if (!isVisible) return;

      try {
        await onHeartbeatRef.current?.();
        setLastHeartbeat(Date.now());
      } catch (err) {
        console.error('Heartbeat failed:', err);
      }
    };

    let appStateSubscription: any = null;
    if (Platform.OS !== 'web') {
      appStateSubscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
        if (nextAppState === 'active') pulse();
      });
    }

    pulse();
    heartbeatTimerRef.current = setInterval(pulse, HEARTBEAT_INTERVAL);

    return () => {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      if (appStateSubscription) appStateSubscription.remove();
    };
  }, [isActive]); // onHeartbeat accessed via ref — no cascade

  // Auto-stop on tab close (Web)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handlePageExit = () => {
      if (isActive && onAutoStopBeaconRef.current) {
        onAutoStopBeaconRef.current();
      }
    };
    // pagehide is more reliable than beforeunload on iOS Safari and Firefox
    window.addEventListener('beforeunload', handlePageExit);
    window.addEventListener('pagehide', handlePageExit);
    return () => {
      window.removeEventListener('beforeunload', handlePageExit);
      window.removeEventListener('pagehide', handlePageExit);
    };
  }, [isActive]);

  return {
    showIdleModal,
    setShowIdleModal,
    recordActivity,
    lastHeartbeat,
  };
}
