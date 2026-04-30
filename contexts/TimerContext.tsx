import React, { createContext, useContext, useCallback, useState, useRef, useEffect } from 'react';
import { Platform, AppState, AppStateStatus, DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, supabaseUrl, supabaseAnonKey } from '@/lib/supabase';
import { useAuth } from './AuthContext';
import { useSmartTimer } from '@/hooks/useSmartTimer';

const ASYNC_STORAGE_KEY = 'TRUSTFLOW_PENDING_TIMER';

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
  smartTimer: {
    showIdleModal: boolean;
    setShowIdleModal: (show: boolean) => void;
    recordActivity: () => void;
    lastHeartbeat: number | null;
    lastActivityTime: number;
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
  
  const commitTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentPendingTaskIdRef = useRef<string | null>(null);
  const lastFetchTimestampRef = useRef<number>(0);
  const lastActivityTimeRef = useRef<number>(Date.now());

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

  useEffect(() => {
    calibrateTime();
    fetchActiveSession().then(() => syncOrphanedSession());
  }, [calibrateTime, fetchActiveSession, syncOrphanedSession]);

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
      p_stopped_at: stoppedAt || new Date(Date.now() + serverTimeOffset).toISOString()
    });
    
    if (error) console.error('[Timer] Stop failed:', error);
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
    if (error && (error.code === 'P0001' || error.message?.includes('conflict'))) {
      console.warn('[Timer] Heartbeat rejected, clearing session.');
      setActiveSession(null);
    }
  }, [activeSession]);

  const stopWorkBeacon = useCallback(() => {
    if (Platform.OS !== 'web' || !session?.access_token || !activeSession) return;
    const url = `${supabaseUrl}/rest/v1/rpc/rpc_stop_work`;
    const body = JSON.stringify({ 
      p_session_id: activeSession.id,
      p_task_id: activeSession.task_id,
      p_stopped_at: new Date(lastActivityTimeRef.current + serverTimeOffset).toISOString()
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

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      if (nextAppState.match(/inactive|background/)) {
        lastActivityTimeRef.current = Date.now();
      }
    };
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  const smartTimer = useSmartTimer({
    onAutoStop: async () => {
      const truncatedTime = new Date(lastActivityTimeRef.current + serverTimeOffset).toISOString();
      await stopWork(undefined, truncatedTime);
    },
    onAutoStart: async () => {}, 
    onHeartbeat: heartbeatWork,
    onAutoStopBeacon: stopWorkBeacon,
    isActive: !!activeSession,
    startedAt: activeSession?.started_at || null,
  });

  return (
    <TimerContext.Provider value={{ 
      isActive: !!activeSession, 
      activeSession,
      isCommitting,
      serverTimeOffset,
      startWork, 
      stopWork, 
      passiveStart,
      smartTimer: { ...smartTimer, recordActivity: () => { lastActivityTimeRef.current = Date.now(); smartTimer.recordActivity(); }, lastActivityTime: lastActivityTimeRef.current }
    }}>
      {children}
    </TimerContext.Provider>
  );
};

