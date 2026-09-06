import { useThemeColors } from '@/hooks/useThemeColors';
import { useCollapsibleHeaderScroll } from '@/hooks/useCollapsibleHeader';
import { formatRelative } from '@/lib/time';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Tooltip from '@/components/common/Tooltip';

type Note = { id: string; body: string; updatedAt: number };

// First non-empty line, trimmed — the sticky-note "title" shown on its chip.
export function noteTitle(body: string): string {
  const line = body.split('\n').map(l => l.trim()).find(Boolean);
  return line ? line.slice(0, 22) : 'New note';
}

// Second non-empty line (or the rest of the first, if it's the only one) — the
// preview shown under the title in the list row.
function notePreview(body: string): string {
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  const preview = lines[1] ?? '';
  return preview.slice(0, 60);
}

const keyFor = (userId?: string) => `kanban_notes_v1_${userId || 'anon'}`;

function load(userId?: string): Note[] {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// Private, local, per-user notes (Features.md Kanban sidebar). Windows Notes feel:
// many notes, a chip selector across the top, one open at a time. Persisted to
// localStorage only — never leaves the device, so no RLS/table needed.
export default function KanbanNotes({ userId }: { userId?: string }) {
  const colors = useThemeColors();
  // Drives the RightSidebar header collapse when the notes list is scrolled —
  // same SharedValue as the People tab's member list (siblings under the same
  // <CollapsibleHeaderProvider> in RightSidebar). Null-safe outside a provider.
  const headerScroll = useCollapsibleHeaderScroll();
  const [notes, setNotes] = useState<Note[]>(() => load(userId));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const firstRun = useRef(true);

  // Reload when the signed-in user changes.
  useEffect(() => {
    const loaded = load(userId);
    setNotes(loaded);
    setActiveId(null);
    setSearch('');
    firstRun.current = true;
  }, [userId]);

  // Persist on change (skip the initial hydrate).
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    try { localStorage.setItem(keyFor(userId), JSON.stringify(notes)); } catch {}
  }, [notes, userId]);

  const active = useMemo(() => notes.find(n => n.id === activeId) ?? null, [notes, activeId]);

  const addNote = () => {
    const note: Note = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, body: '', updatedAt: Date.now() };
    setNotes(prev => [note, ...prev]);
    setActiveId(note.id);
  };

  const updateActive = (body: string) => {
    if (!active) return;
    setNotes(prev => prev.map(n => (n.id === active.id ? { ...n, body, updatedAt: Date.now() } : n)));
  };

  const deleteActive = () => {
    if (!active) return;
    setNotes(prev => prev.filter(n => n.id !== active.id));
    setActiveId(null);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(n => n.body.toLowerCase().includes(q));
  }, [notes, search]);

  // Editor — opened by tapping a row in the list below.
  if (active) {
    return (
      <View className="flex-1">
        <View className="flex-row items-center justify-between mb-3">
          <Pressable onPress={() => setActiveId(null)} className="flex-row items-center gap-1.5 rounded-lg px-1 py-1 hover:bg-surface-overlay">
            <FontAwesome name="chevron-left" size={11} color={colors.muted} />
            <Text className="text-typography-muted text-[11px] font-bold">All notes</Text>
          </Pressable>
          <Pressable onPress={deleteActive} accessibilityLabel="Delete note" className="flex-row items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-state-danger/10">
            <FontAwesome name="trash-o" size={11} color={colors.danger} />
            <Text className="text-state-danger text-[10px] font-black uppercase tracking-widest">Delete</Text>
          </Pressable>
        </View>
        <View className="flex-1 rounded-2xl border border-surface-border bg-surface-card p-3">
          <TextInput
            value={active.body}
            onChangeText={updateActive}
            multiline
            autoFocus
            placeholder="Write anything — reminders, things to look out for…"
            placeholderTextColor={colors.muted}
            className="flex-1 text-sm text-typography-main"
            style={{ textAlignVertical: 'top' } as any}
          />
        </View>
        <Text className="mt-2 text-typography-muted text-[10px] font-bold px-1">
          {new Date(active.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    );
  }

  // List — scalable for many notes (#257): vertical rows with title + preview
  // + relative time instead of a horizontal chip strip.
  return (
    <View className="flex-1">
      <View className="flex-row items-center gap-2 mb-3">
        <View className="flex-1 flex-row items-center rounded-xl border border-surface-border bg-surface-card px-3 h-9">
          <FontAwesome name="search" size={11} color={colors.muted} style={{ marginRight: 8 }} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search notes..."
            placeholderTextColor={colors.muted}
            className="flex-1 text-typography-main text-xs font-bold"
          />
        </View>
        <Tooltip label="New note">
          <Pressable
            onPress={addNote}
            accessibilityLabel="New note"
            className="h-9 w-9 items-center justify-center rounded-xl border border-dashed border-surface-border hover:bg-surface-overlay"
          >
            <FontAwesome name="plus" size={12} color={colors.muted} />
          </Pressable>
        </Tooltip>
      </View>

      {notes.length === 0 ? (
        <Pressable onPress={addNote} className="flex-1 items-center justify-center rounded-2xl border border-dashed border-surface-border hover:bg-surface-overlay">
          <FontAwesome name="sticky-note-o" size={22} color={colors.muted} />
          <Text className="mt-3 text-typography-muted text-xs font-bold">Create your first note</Text>
          <Text className="mt-1 text-typography-muted text-[10px]">Private to you, saved on this device</Text>
        </Pressable>
      ) : filtered.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-typography-muted text-xs font-bold">No notes match "{search}"</Text>
        </View>
      ) : (
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} {...headerScroll}>
          {filtered.map(n => {
            const preview = notePreview(n.body);
            return (
              <Pressable
                key={n.id}
                onPress={() => setActiveId(n.id)}
                className="rounded-xl border border-surface-border bg-surface-card px-3 py-2.5 hover:bg-surface-overlay"
              >
                <View className="flex-row items-center justify-between mb-0.5">
                  <Text className="text-typography-main text-xs font-bold flex-1 mr-2" numberOfLines={1}>{noteTitle(n.body)}</Text>
                  <Text className="text-typography-muted text-[10px] font-bold flex-shrink-0">{formatRelative(new Date(n.updatedAt))}</Text>
                </View>
                {!!preview && (
                  <Text className="text-typography-muted text-[11px]" numberOfLines={1}>{preview}</Text>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
