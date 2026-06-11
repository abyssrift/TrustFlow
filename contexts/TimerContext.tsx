import React, { createContext, useContext, useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { Platform, AppState, AppStateStatus, DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, supabaseUrl, supabaseAnonKey } from '@/lib/supabase';
import { useAuth } from './AuthContext';
import { useSmartTimer } from '@/hooks/useSmartTimer';

const ASYNC_STORAGE_KEY = 'TRUSTFLOW_PENDING_TIMER';
const SESSION_STORAGE_KEY = 'tf_reload_session';

export type WorkSession = {
  id: string;
  task_id: string;
  started_at: string;
  last_heartbeat_at: string;
  status: 'active' | 'completed';
  task?: { title: string };
};

type TimerContextType = {
  isActive: boolean;
  activeSession: WorkSession | null;
  isCommitting: boolean;
  serverTimeOffset: number;
  startWork: (taskId: string, taskTitle: string, isManual?: boolean) => Promise<void>;
  stopWork: (taskId?: string, stoppedAt?: string) => Promise<void>;
  passiveStart: (taskId: string, taskTitle: string) => Promise<void>;
  lastStoppedAt: string | null;
  smartTimer: {
    showIdleModal: boolean;
    setShowIdleModal: (show: boolean) => void;
    recordActivity: () => void;
    lastHeartbeat: number | null;
    lastActivityTime: number;
    getLastActivityTime: () => number;
  };
};

const TimerContext = createContext<TimerContextType | null>(null);

export const useTimer = () => {
  const context = useContext(TimerContext);
  if (!context) throw new Error('useTimer must be used within a TimerProvider');
  return context;
};

export const TimerProvider = ({ children }: { children: React.ReactNode }) => {
  const { user, session } = useAuth();
  const [activeSession, setActiveSession] = useState<WorkSession | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [serverTimeOffset, setServerTimeOffset] = useState(0);
  const [lastStoppedAt, setLastStoppedAt] = useState<string | null>(null);
  
  const commitTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentPendingTaskIdRef = useRef<string | null>(null);
  const lastFetchTimestampRef = useRef<number>(0);
  const lastActivityTimeRef = useRef<number>(Date.now());
  // Captured synchronously at mount — before the null-activeSession effect can clear sessionStorage.
  // restoreAfterReload() reads this ref instead of calling sessionStorage.getItem() again.
  const pendingReloadIntentRef = useRef<string | null>(
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? sessionStorage.getItem(SESSION_STORAGE_KEY)
      : null
  );

  // NTP Calibration Logic
  const calibrateTime = useCallback(async () => {
    try {
      const reqTime = Date.now();
      const { data, error } = await supabase.rpc('get_server_time');
      const resTime = Date.now();
      
      if (!error && data) {
        const serverTime = new Date(data).getTime();
        // NTP Formula: ((server - req) + (server - res)) / 2
        const offset = ((serverTime - reqTime) + (serverTime - resTime)) / 2;
        setServerTimeOffset(offset);
        console.log('[Timer] Clock Calibrated. Offset:', offset, 'ms');
      }
    } catch (err) {
      console.warn('[Timer] Calibration failed, falling back to local time.');
    }
  }, []);

  const fetchActiveSession = useCallback(async () => {
    if (!user) return;
    const fetchTime = Date.now();
    
    const { data, error } = await supabase
      .from('task_work_sessions')
      .select('*, task:tasks(title)')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (fetchTime < lastFetchTimestampRef.current) return;
    lastFetchTimestampRef.current = fetchTime;

    if (!error && data) {
      setActiveSession(data as unknown as WorkSession);
      if (currentPendingTaskIdRef.current === (data as any).task_id) {
        currentPendingTaskIdRef.current = null;
        await AsyncStorage.removeItem(ASYNC_STORAGE_KEY);
      }
    } else {
      if (!currentPendingTaskIdRef.current) {
        setActiveSession(null);
      }
    }
  }, [user]);

  // Sync Orphaned Sessions (Crash Recovery)
  const syncOrphanedSession = useCallback(async () => {
    if (!user) return;
    const stored = await AsyncStorage.getItem(ASYNC_STORAGE_KEY);
    if (!stored) return;

    try {
      const intent = JSON.parse(stored);
      console.log('[Timer] Found orphaned session intent, attempting recovery...');
      
      const { data: current } = await supabase
        .from('task_work_sessions')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();

      if (!current) {
        await supabase.rpc('rpc_start_work', { 
          p_task_id: intent.task_id,
          p_start_time: intent.started_at 
        });
      }
      await AsyncStorage.removeItem(ASYNC_STORAGE_KEY);
      await fetchActiveSession();
    } catch (e) {
      console.error('[Timer] Recovery failed:', e);
    }
  }, [user, fetchActiveSession]);

  // Write real session to sessionStorage so we can detect page reload vs tab close.
  // sessionStorage survives refresh but is cleared on tab close.
  // 'pending' sessions are excluded — the beacon guards against stopping them already.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (activeSession && activeSession.id !== 'pending') {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
        id: activeSession.id,
        task_id: activeSession.task_id,
        started_at: activeSession.started_at,
        task_title: activeSession.task?.title ?? '',
      }));
    } else if (!activeSession) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, [activeSession]);

  // On reload, the pagehide beacon stops the session in the DB.
  // sessionStorage survives the reload, so we detect this and reactivate
  // the same session row (preserving its original started_at).
  const restoreAfterReload = useCallback(async () => {
    if (!user || Platform.OS !== 'web') return;
    const stored = pendingReloadIntentRef.current;
    pendingReloadIntentRef.current = null; // consume — prevent double-restore
    if (!stored) return;

    let intent: { id: string; task_id: string; started_at: string };
    try { intent = JSON.parse(stored); } catch { return; }

    const { data: sessionRow } = await supabase
      .from('task_work_sessions')
      .select('id, status')
      .eq('id', intent.id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (sessionRow?.status === 'completed') {
      // Beacon stopped it during reload — restore to active so the timer continues
      const { error } = await supabase
        .from('task_work_sessions')
        .update({ status: 'active', stopped_at: null })
        .eq('id', intent.id)
        .eq('user_id', user.id);

      if (!error) {
        console.log('[Timer] Session reactivated after page reload');
        await fetchActiveSession();
      } else {
        console.warn('[Timer] Could not reactivate session after reload:', error.message);
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
    }
    // If status is still 'active' (beacon didn't fire / race), fetchActiveSession already restored it
  }, [user, fetchActiveSession]);

  // When Chrome restores a tab from BFCache (e.g. Ctrl+Shift+T), React state is thawed from the
  // frozen snapshot — including a stale activeSession. Re-sync with the server to reflect reality.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) fetchActiveSession();
    };
    window.addEventListener('pageshow', handlePageShow as EventListener);
    return () => window.removeEventListener('pageshow', handlePageShow as EventListener);
  }, [fetchActiveSession]);

  useEffect(() => {
    calibrateTime();
    fetchActiveSession()
      .then(() => syncOrphanedSession())
      .then(() => restoreAfterReload());
  }, [calibrateTime, fetchActiveSession, syncOrphanedSession, restoreAfterReload]);

  // Singleton Tick Emitter (High Performance)
  useEffect(() => {
    if (!activeSession) return;
    const interval = setInterval(() => {
      DeviceEventEmitter.emit('timer:tick');
    }, 1000);
    return () => clearInterval(interval);
  }, [!!activeSession]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('global_timer_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_work_sessions', filter: `user_id=eq.${user.id}` }, () => {
        fetchActiveSession();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, fetchActiveSession]);

  const stopWork = useCallback(async (taskId?: string, stoppedAt?: string) => {
    const targetId = taskId || activeSession?.task_id;
    const sessionId = activeSession?.id;
    if (!targetId) return;

    if (commitTimeoutRef.current) {
      clearTimeout(commitTimeoutRef.current);
      commitTimeoutRef.current = null;
    }
    currentPendingTaskIdRef.current = null;
    await AsyncStorage.removeItem(ASYNC_STORAGE_KEY);
    setIsCommitting(false);

    if (sessionId === 'pending') {
      setActiveSession(null);
      return;
    }

    setIsCommitting(true);
    const { error } = await supabase.rpc('rpc_stop_work', {
      p_session_id: sessionId,
      p_task_id: targetId,
      p_stopped_at: stoppedAt || new Date(Date.now() + serverTimeOffset).toISOString(),
    });
    
    if (error) console.error('[Timer] Stop failed:', error);
    setLastStoppedAt(new Date().toISOString());
    await fetchActiveSession();
    setIsCommitting(false);
  }, [activeSession, fetchActiveSession, serverTimeOffset]);

  const startWork = useCallback(async (taskId: string, taskTitle: string, isManual: boolean = false) => {
    if (activeSession?.task_id === taskId && activeSession.id !== 'pending') return;
    if (isCommitting) return;

    if (commitTimeoutRef.current) clearTimeout(commitTimeoutRef.current);
    
    currentPendingTaskIdRef.current = taskId;
    const startedAt = new Date(Date.now() + serverTimeOffset).toISOString();
    
    const pendingSession: WorkSession = {
      id: 'pending',
      task_id: taskId,
      started_at: startedAt,
      last_heartbeat_at: startedAt,
      status: 'active',
      task: { title: taskTitle }
    };

    setActiveSession(pendingSession);
    await AsyncStorage.setItem(ASYNC_STORAGE_KEY, JSON.stringify(pendingSession));

    const commit = async () => {
      if (currentPendingTaskIdRef.current !== taskId) return;
      setIsCommitting(true);
      try {
        const { error } = await supabase.rpc('rpc_start_work', { 
          p_task_id: taskId,
          p_start_time: startedAt 
        });
        if (error) throw error;
        await fetchActiveSession();
      } catch (err: any) {
        console.error('[Timer] Commit failed:', err);
      } finally {
        setIsCommitting(false);
        commitTimeoutRef.current = null;
        currentPendingTaskIdRef.current = null;
      }
    };

    if (isManual) {
      await commit();
    } else {
      commitTimeoutRef.current = setTimeout(commit, 15000);
    }
  }, [activeSession, fetchActiveSession, serverTimeOffset, isCommitting]);

  const passiveStart = useCallback(async (taskId: string, taskTitle: string) => {
    lastActivityTimeRef.current = Date.now();
    if (!activeSession || activeSession.task_id !== taskId) {
      await startWork(taskId, taskTitle, false);
    } else if (activeSession.id !== 'pending') {
      await supabase.rpc('rpc_heartbeat_work', { p_session_id: activeSession.id });
    }
  }, [activeSession, startWork]);

  const heartbeatWork = useCallback(async () => {
    if (!activeSession || activeSession.id === 'pending') return;
    const { error } = await supabase.rpc('rpc_heartbeat_work', { p_session_id: activeSession.id });
    if (error) {
      // Clear on any backend rejection — session is invalid regardless of reason
      // P0002 = not found, 23505 = already completed, 42501 = membership revoked, P0001 = conflict
      console.warn('[Timer] Heartbeat rejected, clearing session.', error.code, error.message);
      setActiveSession(null);
    }
  }, [activeSession]);

  const stopWorkBeacon = useCallback(() => {
    if (Platform.OS !== 'web' || !session?.access_token || !activeSession || activeSession.id === 'pending') return;
    const url = `${supabaseUrl}/rest/v1/rpc/rpc_stop_work`;
    const body = JSON.stringify({
      p_session_id: activeSession.id,
      p_task_id: activeSession.task_id,
      p_stopped_at: new Date(Date.now() + serverTimeOffset).toISOString()
    });
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': supabaseAnonKey,
      },
      body,
      keepalive: true,
    }).catch(err => console.error('[TimerBeacon] Failed:', err));
  }, [activeSession, session, serverTimeOffset]);

  const handleAutoStop = useCallback(async () => {
    const truncatedTime = new Date(lastActivityTimeRef.current + serverTimeOffset).toISOString();
    await stopWork(undefined, truncatedTime);
  }, [stopWork, serverTimeOffset]);

  const handleAutoStart = useCallback(async () => {}, []);

  const smartTimer = useSmartTimer({
    onAutoStop: handleAutoStop,
    onAutoStart: handleAutoStart,
    onHeartbeat: heartbeatWork,
    onAutoStopBeacon: stopWorkBeacon,
    onActivity: () => { lastActivityTimeRef.current = Date.now(); },
    isActive: !!activeSession,
    startedAt: activeSession?.started_at || null,
  });

  // Memoized so taps (which call recordActivity) and unrelated parent renders
  // don't cascade a new context value to every useTimer() consumer.
  const contextValue = useMemo<TimerContextType>(() => ({
    isActive: !!activeSession,
    activeSession,
    isCommitting,
    serverTimeOffset,
    startWork,
    stopWork,
    passiveStart,
    lastStoppedAt,
    smartTimer: {
      showIdleModal: smartTimer.showIdleModal,
      setShowIdleModal: smartTimer.setShowIdleModal,
      recordActivity: () => { lastActivityTimeRef.current = Date.now(); smartTimer.recordActivity(); },
      lastHeartbeat: smartTimer.lastHeartbeat,
      lastActivityTime: lastActivityTimeRef.current,
      getLastActivityTime: () => lastActivityTimeRef.current,
    },
  }), [
    activeSession,
    isCommitting,
    serverTimeOffset,
    startWork,
    stopWork,
    passiveStart,
    lastStoppedAt,
    smartTimer.showIdleModal,
    smartTimer.setShowIdleModal,
    smartTimer.recordActivity,
    smartTimer.lastHeartbeat,
  ]);

  return (
    <TimerContext.Provider value={contextValue}>
      {children}
    </TimerContext.Provider>
  );
};

