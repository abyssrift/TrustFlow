import { supabase } from '@/lib/supabase';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useThemeColors } from '@/hooks/useThemeColors';

type Item = {
  key: string;
  kind: 'move' | 'work';
  at: string;
  actorId: string | null;
  taskId: string;
  taskTitle: string;
  toStage?: string | null;
  seconds?: number;
};

function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function ago(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function dur(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

// Board activity feed: stage moves (who moved what where) + completed work
// sessions (who worked how long on what), merged newest-first. Stage history is
// pipeline-scoped; sessions are scoped to the board's task ids.
export default function KanbanActivity({
  pipelineId,
  taskIds,
  memberById,
  onOpen,
}: {
  pipelineId?: string;
  taskIds: string[];
  memberById: Map<string, { name: string; avatar?: string | null }>;
  onOpen: (taskId: string) => void;
}) {
  const colors = useThemeColors();
  const [items, setItems] = useState<Item[]>([]);
  const [actors, setActors] = useState<Record<string, { name: string; avatar?: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const taskIdKey = useMemo(() => [...taskIds].sort().join(','), [taskIds]);

  useEffect(() => {
    if (!pipelineId) return;
    let cancelled = false;
    const ids = taskIdKey ? taskIdKey.split(',') : [];

    const fetchAll = async () => {
      const [{ data: hist }, { data: sess }] = await Promise.all([
        supabase
          .from('pipeline_stage_history')
          .select('id, task_id, to_stage_name, transitioned_at, transitioned_by, task:task_id(title)')
          .eq('pipeline_id', pipelineId)
          .order('transitioned_at', { ascending: false })
          .limit(25),
        ids.length
          ? supabase
              .from('task_work_sessions')
              .select('id, task_id, user_id, started_at, last_heartbeat_at, task:task_id(title)')
              .eq('status', 'completed')
              .in('task_id', ids)
              .order('started_at', { ascending: false })
              .limit(25)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      if (cancelled) return;

      const merged: Item[] = [];
      for (const h of hist || []) {
        merged.push({
          key: `h${h.id}`, kind: 'move', at: h.transitioned_at, actorId: h.transitioned_by,
          taskId: h.task_id, taskTitle: (h.task as any)?.title || 'a task', toStage: h.to_stage_name,
        });
      }
      for (const s of sess || []) {
        const secs = Math.max(0, Math.floor((new Date(s.last_heartbeat_at).getTime() - new Date(s.started_at).getTime()) / 1000));
        merged.push({
          key: `w${s.id}`, kind: 'work', at: s.started_at, actorId: s.user_id,
          taskId: s.task_id, taskTitle: (s.task as any)?.title || 'a task', seconds: secs,
        });
      }
      merged.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      const trimmed = merged.slice(0, 30);
      setItems(trimmed);
      setLoading(false);

      // Resolve any actors not already known from the members list.
      const missing = [...new Set(trimmed.map(i => i.actorId).filter(Boolean) as string[])]
        .filter(id => !memberById.has(id));
      if (missing.length) {
        const { data: us } = await supabase.from('users').select('id, full_name, email, avatar_url').in('id', missing);
        if (cancelled || !us) return;
        const map: Record<string, { name: string; avatar?: string | null }> = {};
        for (const u of us) map[u.id] = { name: u.full_name || u.email || 'Member', avatar: u.avatar_url };
        setActors(map);
      }
    };

    setLoading(true);
    fetchAll();

    const ch = supabase
      .channel(`kanban-activity-${pipelineId}-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pipeline_stage_history', filter: `pipeline_id=eq.${pipelineId}` }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_work_sessions' }, () => fetchAll())
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [pipelineId, taskIdKey]);

  const actorOf = (id: string | null) =>
    (id && (memberById.get(id) || actors[id])) || { name: 'Someone', avatar: null as string | null };

  if (loading) {
    return <View className="flex-1 items-center justify-center"><ActivityIndicator size="small" color={colors.primary} /></View>;
  }
  if (items.length === 0) {
    return <Text className="px-1 py-3 text-typography-muted text-xs">No activity yet.</Text>;
  }

  return (
    <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
      {items.map(it => {
        const actor = actorOf(it.actorId);
        return (
          <Pressable key={it.key} onPress={() => onOpen(it.taskId)} className="mb-1 flex-row items-start gap-2.5 rounded-xl px-2 py-2 hover:bg-surface-overlay">
            <View className="mt-0.5 h-7 w-7 overflow-hidden rounded-full border border-surface-border bg-brand-primary/10 items-center justify-center">
              {actor.avatar ? <Image source={{ uri: actor.avatar }} className="h-full w-full" /> : <Text className="text-brand-primary text-[9px] font-black">{initials(actor.name)}</Text>}
            </View>
            <View className="flex-1 min-w-0">
              <Text className="text-typography-main text-[12px] leading-4" numberOfLines={2}>
                <Text className="font-bold">{actor.name}</Text>
                {it.kind === 'move'
                  ? <Text className="text-typography-muted"> moved to </Text>
                  : <Text className="text-typography-muted"> worked </Text>}
                {it.kind === 'move'
                  ? <Text className="font-bold text-brand-primary">{it.toStage || 'a stage'}</Text>
                  : <Text className="font-bold text-brand-primary">{dur(it.seconds || 0)}</Text>}
                <Text className="text-typography-muted"> · {it.taskTitle}</Text>
              </Text>
              <Text className="text-typography-muted text-[10px] font-bold mt-0.5">{ago(it.at)}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
