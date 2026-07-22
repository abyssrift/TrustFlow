import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

type Note = { id: string; body: string; updatedAt: number };

// First non-empty line, trimmed — the sticky-note "title" shown on its chip.
export function noteTitle(body: string): string {
  const line = body.split('\n').map(l => l.trim()).find(Boolean);
  return line ? line.slice(0, 22) : 'New note';
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
  const [notes, setNotes] = useState<Note[]>(() => load(userId));
  const [activeId, setActiveId] = useState<string | null>(() => load(userId)[0]?.id ?? null);
  const firstRun = useRef(true);

  // Reload when the signed-in user changes.
  useEffect(() => {
    const loaded = load(userId);
    setNotes(loaded);
    setActiveId(loaded[0]?.id ?? null);
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
    setNotes(prev => {
      const next = prev.filter(n => n.id !== active.id);
      setActiveId(next[0]?.id ?? null);
      return next;
    });
  };

  return (
    <View className="flex-1">
      {/* Chip selector — every note stays here; the open one is highlighted. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3 -mx-1 flex-none" contentContainerStyle={{ paddingHorizontal: 4, gap: 6 }}>
        {notes.map(n => {
          const isActive = n.id === activeId;
          return (
            <Pressable
              key={n.id}
              onPress={() => setActiveId(n.id)}
              className={`h-8 justify-center rounded-full border px-3 ${isActive ? 'border-brand-primary bg-brand-primary/15' : 'border-surface-border bg-surface-card hover:bg-surface-overlay'}`}
            >
              <Text className={`text-[11px] font-bold ${isActive ? 'text-brand-primary' : 'text-typography-muted'}`} numberOfLines={1}>
                {noteTitle(n.body)}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={addNote}
          accessibilityLabel="New note"
          className="h-8 w-8 items-center justify-center rounded-full border border-dashed border-surface-border hover:bg-surface-overlay"
        >
          <FontAwesome name="plus" size={11} color={colors.muted} />
        </Pressable>
      </ScrollView>

      {active ? (
        <>
          <View className="flex-1 rounded-2xl border border-surface-border bg-surface-card p-3">
            <TextInput
              value={active.body}
              onChangeText={updateActive}
              multiline
              placeholder="Write anything — reminders, things to look out for…"
              placeholderTextColor={colors.muted}
              className="flex-1 text-sm text-typography-main"
              style={{ textAlignVertical: 'top', outlineWidth: 0 } as any}
            />
          </View>
          <View className="mt-2 flex-row items-center justify-between px-1">
            <Text className="text-typography-muted text-[10px] font-bold">
              {new Date(active.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </Text>
            <Pressable onPress={deleteActive} accessibilityLabel="Delete note" className="flex-row items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-state-danger/10">
              <FontAwesome name="trash-o" size={11} color={colors.danger} />
              <Text className="text-state-danger text-[10px] font-black uppercase tracking-widest">Delete</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <Pressable onPress={addNote} className="flex-1 items-center justify-center rounded-2xl border border-dashed border-surface-border hover:bg-surface-overlay">
          <FontAwesome name="sticky-note-o" size={22} color={colors.muted} />
          <Text className="mt-3 text-typography-muted text-xs font-bold">Create your first note</Text>
          <Text className="mt-1 text-typography-muted text-[10px]">Private to you, saved on this device</Text>
        </Pressable>
      )}
    </View>
  );
}
