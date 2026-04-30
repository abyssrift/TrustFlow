import React, { createContext, useContext, useCallback, useState, useRef, useEffect } from 'react';
import { Platform, AppState, AppStateStatus } from 'react-native';
import { supabase, supabaseUrl, supabaseAnonKey } from '@/lib/supabase';
import { useAuth } from './AuthContext';
import { useSmartTimer } from '@/hooks/useSmartTimer';

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
  startWork: (taskId: string, taskTitle: string) => Promise<void>;
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
  
  const commitTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentPendingTaskIdRef = useRef<string | null>(null);
  const lastFetchTimestampRef = useRef<number>(0);
  const lastActivityTimeRef = useRef<number>(Date.now());

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
      // If we found a real session, update local state
      setActiveSession(data as unknown as WorkSession);
      // We found a real session, so we can clear the pending ref for this task
      if (currentPendingTaskIdRef.current === (data as any).task_id) {
        currentPendingTaskIdRef.current = null;
      }
    } else {
      // If DB says NO session, but we have a PENDING one, do NOT clear setActiveSession(null)
      // unless we are NOT currently in the middle of a commit timeout
      if (!currentPendingTaskIdRef.current) {
        setActiveSession(null);
      }
    }
  }, [user]);

  useEffect(() => {
    fetchActiveSession();
  }, [fetchActiveSession]);

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

  useEffect(() => {
    const healer = setInterval(fetchActiveSession, 60000);
    return () => clearInterval(healer);
  }, [fetchActiveSession]);

  const stopWork = useCallback(async (taskId?: string, stoppedAt?: string) => {
    const targetId = taskId || activeSession?.task_id;
    if (!targetId) return;

    if (commitTimeoutRef.current) {
      clearTimeout(commitTimeoutRef.current);
      commitTimeoutRef.current = null;
    }
    currentPendingTaskIdRef.current = null;
    setIsCommitting(false);

    if (activeSession?.id === 'pending') {
      setActiveSession(null);
      return;
    }

    const { error } = await supabase.rpc('rpc_stop_work', { 
      p_task_id: targetId,
      p_stopped_at: stoppedAt || new Date().toISOString()
    });
    
    if (error) console.error('[Timer] Stop failed:', error);
    await fetchActiveSession();
  }, [activeSession, fetchActiveSession]);

  const startWork = useCallback(async (taskId: string, taskTitle: string) => {
    if (activeSession?.task_id === taskId && activeSession.id !== 'pending') return;

    if (commitTimeoutRef.current) clearTimeout(commitTimeoutRef.current);
    
    currentPendingTaskIdRef.current = taskId;
    setIsCommitting(true);
    
    const startedAt = new Date().toISOString();
    setActiveSession({
      id: 'pending',
      task_id: taskId,
      started_at: startedAt,
      last_heartbeat_at: startedAt,
      status: 'active',
      task: { title: taskTitle }
    });

    commitTimeoutRef.current = setTimeout(async () => {
      if (currentPendingTaskIdRef.current !== taskId) return;
      try {
        const { error } = await supabase.rpc('rpc_start_work', { 
          p_task_id: taskId,
          p_start_time: startedAt 
        });
        if (error) throw error;
        await fetchActiveSession();
      } catch (err: any) {
        console.error('[Timer] Commit failed:', err);
        await fetchActiveSession();
      } finally {
        setIsCommitting(false);
        commitTimeoutRef.current = null;
        currentPendingTaskIdRef.current = null;
      }
    }, 15000);
  }, [activeSession, fetchActiveSession]);

  // Intent-based Trigger: Starts timer if inactive, otherwise just records activity
  const passiveStart = useCallback(async (taskId: string, taskTitle: string) => {
    lastActivityTimeRef.current = Date.now();
    if (!activeSession) {
      await startWork(taskId, taskTitle);
    } else if (activeSession.task_id !== taskId) {
      // Swapping tasks
      await startWork(taskId, taskTitle);
    } else {
      // Already active on this task, just a heartbeat pulse maybe
      await supabase.rpc('rpc_heartbeat_work', { p_task_id: taskId });
    }
  }, [activeSession, startWork]);

  const heartbeatWork = useCallback(async () => {
    if (!activeSession || activeSession.id === 'pending') return;
    await supabase.rpc('rpc_heartbeat_work', { p_task_id: activeSession.task_id });
  }, [activeSession]);

  const stopWorkBeacon = useCallback(() => {
    if (Platform.OS !== 'web' || !session?.access_token || !activeSession || activeSession.id === 'pending') return;
    const url = `${supabaseUrl}/rest/v1/rpc/rpc_stop_work`;
    const body = JSON.stringify({ 
      p_task_id: activeSession.task_id,
      p_stopped_at: new Date(lastActivityTimeRef.current).toISOString()
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
  }, [activeSession, session]);

  // Mobile AppState Handling: Auto-stop on background (for security/accuracy) or just record "last gasp"
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      if (nextAppState.match(/inactive|background/)) {
        if (activeSession && activeSession.id !== 'pending') {
          console.log('[Timer] App backgrounded, recording last activity...');
          // On mobile, we might want to auto-stop to prevent "ghost hours" if the user forgets the app
          // But for now, let's just record activity.
          lastActivityTimeRef.current = Date.now();
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [activeSession]);

  const recordActivity = useCallback(() => {
    lastActivityTimeRef.current = Date.now();
  }, []);

  const smartTimer = useSmartTimer({
    onAutoStop: async () => {
      const truncatedTime = new Date(lastActivityTimeRef.current).toISOString();
      await stopWork(undefined, truncatedTime);
    },
    onAutoStart: async () => {}, 
    onHeartbeat: heartbeatWork,
    onAutoStopBeacon: stopWorkBeacon,
    isActive: !!activeSession,
    startedAt: activeSession?.started_at || null,
  });

  const extendedSmartTimer = {
    ...smartTimer,
    recordActivity: () => {
      recordActivity();
      smartTimer.recordActivity();
    },
    lastActivityTime: lastActivityTimeRef.current
  };

  return (
    <TimerContext.Provider value={{ 
      isActive: !!activeSession, 
      activeSession,
      startWork, 
      stopWork, 
      passiveStart,
      smartTimer: extendedSmartTimer 
    }}>
      {children}
    </TimerContext.Provider>
  );
};
