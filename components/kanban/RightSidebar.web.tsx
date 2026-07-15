import { useThemeColors } from '@/hooks/useThemeColors';
import { useTicker } from '@/hooks/useTicker';
import { supabase } from '@/lib/supabase';
import type { ActiveSessionUser } from '@/components/task-detail/TaskCardActions';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import KanbanNotes from './KanbanNotes.web';
import KanbanActivity from './KanbanActivity.web';
import TimeByCategoryPie from './TimeByCategoryPie.web';

cssInterop(FontAwesome, {
  className: { target: 'style', nativeStyleToProp: { color: true, size: true } },
} as any);

const PANEL_W = 296;
const RAIL_W = 18;
const LEAVE_GRACE_MS = 160; // mirror RetractableTopBar: brief exits don't collapse

type BoardTask = { id: string; title: string; category?: string | null; total_seconds?: number };
type Member = { id: string; name: string; avatar?: string | null; isOwner: boolean; working: boolean };
type WorkInfo = { taskId: string; taskTitle: string; startedAt: string };

function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function fmt(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

function Avatar({ name, avatar, size = 36 }: { name: string; avatar?: string | null; size?: number }) {
  return (
    <View style={{ width: size, height: size }} className="overflow-hidden rounded-full border border-surface-border bg-brand-primary/10 items-center justify-center">
      {avatar ? (
        <Image source={{ uri: avatar }} style={{ width: size, height: size }} />
      ) : (
        <Text className="text-brand-primary font-black" style={{ fontSize: size * 0.34 }}>{initials(name)}</Text>
      )}
    </View>
  );
}

// One member row. useTicker lives here (a leaf) so the working timer's 1s tick
// never re-renders the whole sidebar.
function MemberRow({ member, work, onOpen }: { member: Member; work?: WorkInfo; onOpen: (taskId: string) => void }) {
  const elapsed = useTicker(work ? work.startedAt : null, { active: !!work });
  const body = (
    <View className="flex-row items-center gap-3">
      <View>
        <Avatar name={member.name} avatar={member.avatar} />
        {work && <View className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-background bg-brand-primary pulse-animation" />}
      </View>
      <View className="flex-1 min-w-0">
        <View className="flex-row items-center gap-1.5">
          <Text className="text-typography-main text-sm font-bold" numberOfLines={1}>{member.name}</Text>
          {member.isOwner && <Text className="text-brand-primary text-[8px] font-black uppercase tracking-widest">Owner</Text>}
        </View>
        {work ? (
          <Text className="text-brand-primary text-[11px] font-bold" numberOfLines={1}>
            {fmt(elapsed)} · {work.taskTitle}
          </Text>
        ) : (
          <Text className="text-typography-muted text-[11px]" numberOfLines={1}>Has access</Text>
        )}
      </View>
    </View>
  );
  return work ? (
    <Pressable onPress={() => onOpen(work.taskId)} className="mb-1.5 rounded-xl px-2 py-2 hover:bg-surface-overlay">{body}</Pressable>
  ) : (
    <View className="mb-1.5 rounded-xl px-2 py-2">{body}</View>
  );
}

// Right-side board sidebar (Features.md "Kanban & Views"). Collapsed to a thin
// rail + a circular pull-tab; hover peeks it open, clicking the tab pins it.
// Interaction lifted from RetractableTopBar (peek + suppress-on-click) and NavRail
// (descendant-overflow hover zone). Tabs: People (access list + time pie), Activity,
// and private Notes. Membership is the real access list (rpc_get_pipeline_members) —
// role-gated, never derived from task assignments.
export default function RightSidebar({
  pipelineId,
  pipelineName,
  taskCount,
  visibilityMode,
  tasks,
  activeSessions,
  currentUserId,
}: {
  pipelineId?: string;
  pipelineName?: string;
  taskCount: number;
  visibilityMode?: 'all' | 'assigned_only';
  tasks: BoardTask[];
  activeSessions: Record<string, ActiveSessionUser[]>;
  currentUserId?: string;
}) {
  const colors = useThemeColors();
  const router = useRouter();
  const [pinned, setPinned] = useState(() => {
    if (Platform.OS === 'web') {
      try { return localStorage.getItem('kanban_rightbar_pinned') === 'true'; } catch {}
    }
    return false;
  });
  const [peek, setPeek] = useState(false);
  const [tab, setTab] = useState<'people' | 'activity' | 'notes'>('people');
  const expanded = pinned || peek;

  const wrapperRef = useRef<any>(null);
  const leaveTimer = useRef<any>(null);
  const suppressPeek = useRef(false); // click-collapse mustn't instantly re-peek

  useEffect(() => {
    const el = wrapperRef.current;
    const domNode = el instanceof Element ? el : (el as any)?.getDOMNode?.() ?? null;
    if (!domNode) return;
    const clear = () => { if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; } };
    const onEnter = () => { clear(); if (!suppressPeek.current) setPeek(true); };
    const onLeave = () => {
      clear();
      leaveTimer.current = setTimeout(() => { setPeek(false); suppressPeek.current = false; }, LEAVE_GRACE_MS);
    };
    domNode.addEventListener('mouseenter', onEnter);
    domNode.addEventListener('mouseleave', onLeave);
    return () => { clear(); domNode.removeEventListener('mouseenter', onEnter); domNode.removeEventListener('mouseleave', onLeave); };
  }, []);

  const toggle = () => {
    const next = !pinned;
    if (pinned) { suppressPeek.current = true; setPeek(false); }
    setPinned(next);
    if (Platform.OS === 'web') { try { localStorage.setItem('kanban_rightbar_pinned', String(next)); } catch {} }
  };

  // Who's working right now, in which task, since when — keyed by user.
  const workByUser = useMemo(() => {
    const titleById = new Map(tasks.map(t => [t.id, t.title]));
    const m = new Map<string, WorkInfo>();
    for (const [taskId, list] of Object.entries(activeSessions)) {
      for (const s of list) {
        const prev = m.get(s.userId);
        if (!prev || new Date(s.startedAt) < new Date(prev.startedAt)) {
          m.set(s.userId, { taskId, taskTitle: titleById.get(taskId) || 'a task', startedAt: s.startedAt });
        }
      }
    }
    return m;
  }, [tasks, activeSessions]);

  // Authoritative access list — role-gated, resolved server-side (SECURITY DEFINER),
  // so it respects pipeline scope and never leaks non-members via task assignments.
  const [access, setAccess] = useState<{ id: string; full_name: string | null; email: string | null; avatar_url: string | null; is_owner: boolean }[]>([]);
  useEffect(() => {
    if (!pipelineId) { setAccess([]); return; }
    let cancelled = false;
    supabase.rpc('rpc_get_pipeline_members', { p_pipeline_id: pipelineId }).then(({ data }) => {
      if (!cancelled && data) setAccess(data as any);
    });
    return () => { cancelled = true; };
  }, [pipelineId]);

  const members = useMemo<Member[]>(() => {
    return access
      .map(u => ({
        id: u.id,
        name: u.full_name || u.email || 'Member',
        avatar: u.avatar_url,
        isOwner: u.is_owner,
        working: workByUser.has(u.id),
      }))
      .sort((a, b) => (a.working === b.working ? a.name.localeCompare(b.name) : a.working ? -1 : 1));
  }, [access, workByUser]);

  const memberById = useMemo(() => {
    const m = new Map<string, { name: string; avatar?: string | null }>();
    for (const mem of members) m.set(mem.id, { name: mem.name, avatar: mem.avatar });
    return m;
  }, [members]);

  const taskIds = useMemo(() => tasks.map(t => t.id), [tasks]);
  const workingCount = members.filter(m => m.working).length;
  const visLabel = visibilityMode === 'assigned_only' ? 'Assigned members only' : 'Open to workspace';
  const chevron = expanded ? 'chevron-right' : 'chevron-left';

  const TabButton = ({ id, icon, label }: { id: 'people' | 'activity' | 'notes'; icon: any; label: string }) => (
    <Pressable
      onPress={() => setTab(id)}
      className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-lg py-2 ${tab === id ? 'bg-surface-card' : 'hover:bg-surface-card/50'}`}
    >
      <FontAwesome name={icon} size={11} color={tab === id ? colors.primary : colors.muted} />
      <Text className={`text-[10px] font-black uppercase tracking-wider ${tab === id ? 'text-typography-main' : 'text-typography-muted'}`}>{label}</Text>
    </Pressable>
  );

  return (
    <View ref={wrapperRef} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: RAIL_W, zIndex: 40 }}>
      {/* PANEL — descendant of the narrow rail so hovering it keeps the hover zone
          alive (same trick NavRail uses for its overflow overlay). */}
      <View
        className="border-l border-surface-border bg-surface-background premium-shadow transition-all duration-300 ease-in-out"
        style={{
          position: 'absolute', top: 0, bottom: 0, right: 0, width: PANEL_W,
          transform: [{ translateX: expanded ? 0 : PANEL_W }],
          opacity: expanded ? 1 : 0,
        }}
      >
        <View className="flex-1 p-4">
          {/* Header — mirrors NavRail's accent-bar title block. */}
          <View className="mb-4 mt-1 flex-row items-center px-1">
            <View className="mr-3 h-9 w-1.5 rounded-full bg-brand-primary" />
            <View className="flex-1 min-w-0">
              <Text className="text-typography-main text-lg font-black tracking-tighter" numberOfLines={1}>
                {pipelineName || 'Board'}
              </Text>
              <Text className="text-brand-primary text-[10px] font-bold uppercase tracking-widest">Board Info</Text>
            </View>
          </View>

          {/* Tab switcher */}
          <View className="mb-4 flex-row gap-1 rounded-xl border border-surface-border bg-surface-background p-1">
            <TabButton id="people" icon="users" label="People" />
            <TabButton id="activity" icon="bolt" label="Activity" />
            <TabButton id="notes" icon="sticky-note-o" label="Notes" />
          </View>

          {tab === 'people' && (
            <View className="flex-1">
              {/* Pipeline stats */}
              <View className="mb-3 flex-row gap-2">
                <View className="flex-1 rounded-xl border border-surface-border bg-surface-card px-3 py-2.5">
                  <Text className="text-typography-main text-xl font-black">{taskCount}</Text>
                  <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest">Tasks</Text>
                </View>
                <View className="flex-1 rounded-xl border border-surface-border bg-surface-card px-3 py-2.5">
                  <Text className="text-typography-main text-xl font-black">{members.length}</Text>
                  <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest">People</Text>
                </View>
              </View>

              <TimeByCategoryPie tasks={tasks} />

              <View className="mb-3 flex-row items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-3 py-2">
                <FontAwesome name={visibilityMode === 'assigned_only' ? 'lock' : 'globe'} size={11} color={colors.muted} />
                <Text className="text-typography-muted text-[11px] font-bold">{visLabel}</Text>
              </View>

              <View className="mb-2 flex-row items-center justify-between px-1">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Has access</Text>
                {workingCount > 0 && (
                  <View className="flex-row items-center gap-1.5">
                    <View className="h-2 w-2 rounded-full bg-brand-primary pulse-animation" />
                    <Text className="text-brand-primary text-[10px] font-black">{workingCount} working</Text>
                  </View>
                )}
              </View>

              <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
                {members.length === 0 ? (
                  <Text className="px-1 py-3 text-typography-muted text-xs">No one has access yet.</Text>
                ) : (
                  members.map(m => (
                    <MemberRow key={m.id} member={m} work={workByUser.get(m.id)} onOpen={id => router.push(`/task/${id}` as any)} />
                  ))
                )}
              </ScrollView>
            </View>
          )}

          {tab === 'activity' && (
            <View className="flex-1">
              <KanbanActivity
                pipelineId={pipelineId}
                taskIds={taskIds}
                memberById={memberById}
                onOpen={id => router.push(`/task/${id}` as any)}
              />
            </View>
          )}

          {tab === 'notes' && <KanbanNotes userId={currentUserId} />}
        </View>
      </View>

      {/* RAIL — thin accent line down the right edge, always visible. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 3 }}
        className={expanded ? 'bg-brand-primary/50' : 'bg-brand-primary/25'}
      />

      {/* PULL TAB — circular bump near the top; click pins/unpins. */}
      <Pressable
        onPress={toggle}
        accessibilityLabel={pinned ? 'Hide board info' : 'Show board info'}
        style={{ position: 'absolute', top: 80, right: 0 }}
        className="h-9 w-6 items-center justify-center rounded-l-full border border-r-0 border-surface-border bg-surface-card/95 premium-shadow glass-card hover:bg-surface-overlay transition-colors duration-150"
      >
        <FontAwesome name={chevron} size={11} color={colors.textDim} />
      </Pressable>
    </View>
  );
}
