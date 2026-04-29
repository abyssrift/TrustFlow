import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useTaskDetail } from '@/contexts/TaskDetailContext';
import { useAuth } from '@/contexts/AuthContext';
import { useElapsedTime } from '@/hooks/useElapsedTime';

/**
 * TimerPanel — shown inside the Task Detail page.
 *
 * Shows one of three states:
 *  1. MY active session  → Live counter + Pause button
 *  2. Someone else's session → Live counter (view-only)
 *  3. No active session + user is assigned → "Start Working" / Resume button
 *
 * The timer is informational — it does NOT gate the action buttons.
 */
export default function TimerPanel() {
  const { data, startWork, stopWork } = useTaskDetail();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  if (!data) return null;

  const activeSessions = data.work_sessions.filter((ws) => ws.status === 'active');
  const mySession = activeSessions.find((ws) => ws.user_id === user?.id);
  const othersSession = !mySession && activeSessions.length > 0 ? activeSessions[0] : null;

  // Show "Start Working" when: assigned, stage requires timer, and no active session of my own
  const hasWorkedBefore = data.work_sessions.some(ws => ws.user_id === user?.id);
  const canStart = data.permissions.is_assigned && data.current_stage?.requires_timer && !mySession;

  // Nothing to show if no session exists and user cannot start one
  if (!mySession && !othersSession && !canStart) return null;

  // ── State 3: no active session, user can start ─────────────────────
  if (!mySession && !othersSession && canStart) {
    const label = hasWorkedBefore ? 'Resume Working' : 'Start Working';
    return (
      <TouchableOpacity
        onPress={async () => {
          setBusy(true);
          try { await startWork(); }
          catch (err: any) { Alert.alert('Error', err.message || 'Could not start session.'); }
          finally { setBusy(false); }
        }}
        disabled={busy}
        className="mx-4 mb-2 mt-1 flex-row items-center justify-center gap-2 rounded-2xl border border-state-info/30 bg-state-info/5 px-4 py-3 active:opacity-75"
      >
        {busy
          ? <ActivityIndicator size="small" color="rgb(var(--state-info))" />
          : <FontAwesome name="play" size={10} color="rgb(var(--state-info))" />
        }
        <Text className="text-state-info text-[11px] font-black uppercase tracking-widest">
          {busy ? 'Starting...' : label}
        </Text>
      </TouchableOpacity>
    );
  }

  // ── State 1 & 2: active session exists ────────────────────────────
  const displaySession = mySession ?? othersSession!;
  
  // Find avatar url or fallback name from the user context
  const workerAvatar = data.assignments.find(a => a.user?.id === displaySession.user_id)?.user?.avatar_url ||
                       (data.manager?.id === displaySession.user_id ? data.manager?.avatar_url : null) ||
                       (data.creator?.id === displaySession.user_id ? data.creator?.avatar_url : null);

  return (
    <TimerPanelInner
      session={displaySession}
      avatarUrl={workerAvatar}
      isMySession={!!mySession}
      busy={busy}
      onPause={async () => {
        setBusy(true);
        try { await stopWork(); }
        catch (err: any) { Alert.alert('Error', err.message || 'Could not stop session.'); }
        finally { setBusy(false); }
      }}
      onResume={async () => {
        setBusy(true);
        try { await startWork(); }
        catch (err: any) { Alert.alert('Error', err.message || 'Could not resume session.'); }
        finally { setBusy(false); }
      }}
      canStart={canStart}
    />
  );
}

// ─── Inner component (useElapsedTime must live at top-level of a component) ──

type SessionRef = { id: string; user_name: string | null; user_id: string; started_at: string };

function TimerPanelInner({
  session, avatarUrl, isMySession, busy, onPause, onResume, canStart,
}: {
  session: SessionRef;
  avatarUrl: string | null;
  isMySession: boolean;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  canStart: boolean;
}) {
  const elapsed = useElapsedTime(session.started_at);

  return (
    <View className="mx-4 mb-2 mt-1 rounded-2xl border border-state-info/30 bg-state-info/5 overflow-hidden">
      <View className="h-0.5 bg-state-info/40" />

      <View className="flex-row items-center px-4 py-3 gap-3">
        {/* Avatar / Pulsing indicator */}
        <View className="relative">
          {avatarUrl ? (
            <View className="w-8 h-8 rounded-full overflow-hidden border border-surface-border">
              {/* If you had an image loader, you'd use <Image source={{uri: avatarUrl}} /> here. Using a placeholder for now. */}
              <View className="w-full h-full bg-brand-primary/20 items-center justify-center">
                <Text className="text-brand-primary font-black text-xs">
                  {(session.user_name || '?').charAt(0).toUpperCase()}
                </Text>
              </View>
            </View>
          ) : (
            <View className="w-8 h-8 rounded-full bg-brand-primary/20 items-center justify-center border border-surface-border">
              <Text className="text-brand-primary font-black text-xs">
                {(session.user_name || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          
          <View className="absolute -bottom-1 -right-1 items-center justify-center w-3.5 h-3.5 rounded-full bg-surface-background border border-surface-border">
            <View className="w-1.5 h-1.5 rounded-full bg-state-info" />
          </View>
        </View>

        {/* Session info */}
        <View className="flex-1">
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-[0.15em]">
            {isMySession ? 'YOUR ACTIVE SESSION' : `${session.user_name ?? 'Someone'} is working`}
          </Text>
          <Text className="text-state-info font-black text-xl tracking-tighter font-mono mt-0.5">
            {elapsed}
          </Text>
        </View>

        {/* Controls — only shown for current user's session */}
        {isMySession && (
          <View className="flex-row gap-2">
            {/* Pause */}
            <TouchableOpacity
              onPress={onPause}
              disabled={busy}
              className={`flex-row items-center px-3 py-2 rounded-xl border border-state-warning/40 bg-state-warning/10 ${busy ? 'opacity-50' : ''}`}
            >
              {busy
                ? <ActivityIndicator size="small" color="rgb(var(--state-warning))" />
                : <>
                    <FontAwesome name="pause" size={10} color="rgb(var(--state-warning))" />
                    <Text className="text-state-warning text-[10px] font-black uppercase tracking-wider ml-1.5">
                      Pause
                    </Text>
                  </>
              }
            </TouchableOpacity>
          </View>
        )}

        {/* Resume button — when assigned and someone else is working (rare) OR own session just ended */}
        {!isMySession && canStart && (
          <TouchableOpacity
            onPress={onResume}
            disabled={busy}
            className={`flex-row items-center px-3 py-2 rounded-xl border border-state-info/40 bg-state-info/10 ${busy ? 'opacity-50' : ''}`}
          >
            {busy
              ? <ActivityIndicator size="small" color="rgb(var(--state-info))" />
              : <>
                  <FontAwesome name="play" size={10} color="rgb(var(--state-info))" />
                  <Text className="text-state-info text-[10px] font-black uppercase tracking-wider ml-1.5">
                    Resume
                  </Text>
                </>
            }
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
