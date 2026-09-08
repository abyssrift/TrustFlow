// Mobile/native counterpart to two desktop surfaces:
// 1. The topbar "attention ribbon" (TimelineStrip.web.tsx + its hover dropdown,
//    TimelineDropdown.web.tsx) — the nearest-10 "Upcoming" list below mirrors
//    that data exactly (useUpcomingTasks).
// 2. The fullscreen month calendar (CalendarOverlay.web.tsx) — the grid above
//    mirrors its per-day task-chip design, fed by the same month-bounded fetch
//    (fetchDeadlineTasks), since PremiumCalendarPicker's plain dot markers
//    don't resemble it.
import { BackButton } from '@/components/common/BackButton';
import { useAuth } from '@/contexts/AuthContext';
import { RIBBON_WINDOW_OPTIONS, useAttentionRibbonWindow } from '@/hooks/useAttentionRibbonWindow';
import { useThemeColors } from '@/hooks/useThemeColors';
import {
  buildMonthGrid,
  fetchDeadlineTasks,
  formatRelativeDue,
  subscribeDeadlineChanges,
  toDayKey,
  useUpcomingTasks,
  type ProjectDeadline,
  type UpcomingTask,
} from '@/hooks/useUpcomingTasks';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MAX_CHIPS = 2;

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export default function DeadlinesScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const userId = user?.id;

  // "Upcoming" list — same nearest-10/30-day-lookback data as the topbar ribbon,
  // including its customizable look-ahead window (#67), persisted per-device.
  const { windowDays, setWindow } = useAttentionRibbonWindow();
  const { tasks: ribbonTasks, projects: ribbonProjects, loading: ribbonLoading } = useUpcomingTasks({ windowDays, withProjects: true });
  const deadlineItems = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const projectItems = ribbonProjects
      .filter((project): project is ProjectDeadline & { dueDate: string } => !project.done && !!project.dueDate)
      .map((project) => ({
        kind: 'project' as const,
        id: project.id,
        title: project.name,
        dueDate: project.dueDate,
        overdue: new Date(project.dueDate) < today,
        color: project.color ?? colors.primary,
        subtitle: project.clientName ? `Project · ${project.clientName}` : 'Project',
      }));
    const taskItems = ribbonTasks.map((task) => ({
      kind: 'task' as const,
      id: task.id,
      title: task.title,
      dueDate: task.dueDate,
      overdue: task.overdue,
      color: task.stageColor,
      subtitle: `${task.pipelineName} · ${task.stageName}`,
    }));
    return [...taskItems, ...projectItems].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 10);
  }, [colors.primary, ribbonProjects, ribbonTasks]);

  // Month grid — same month-bounded fetch the desktop calendar overlay uses,
  // independent of the ribbon's 10-item cap (a task due in 3 weeks can be on
  // the grid without being in the "Upcoming" list yet).
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(new Date()));
  const [monthTasks, setMonthTasks] = useState<UpcomingTask[]>([]);
  const requestId = useRef(0);
  const refetchMonth = useCallback(async () => {
    if (!userId) return;
    const id = ++requestId.current;
    const nextMonthStart = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1);
    const tasks = await fetchDeadlineTasks(userId, {
      gte: monthAnchor.toISOString(),
      lt: nextMonthStart.toISOString(),
      rawLimit: 500,
    });
    if (id === requestId.current) setMonthTasks(tasks);
  }, [userId, monthAnchor]);

  useEffect(() => { refetchMonth(); }, [refetchMonth]);
  useEffect(() => {
    if (!userId) return;
    return subscribeDeadlineChanges(refetchMonth);
  }, [userId, refetchMonth]);

  const todayKey = toDayKey(new Date());
  const grid = useMemo(() => buildMonthGrid(monthAnchor), [monthAnchor]);
  const monthLabel = monthAnchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const tasksByDay = useMemo(() => {
    const map = new Map<string, UpcomingTask[]>();
    for (const t of monthTasks) {
      const key = toDayKey(new Date(t.dueDate));
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }, [monthTasks]);

  const goToTask = (id: string) => router.push(`/task/${id}` as any);

  return (
    <View className="flex-1 bg-surface-background" style={{ paddingTop: insets.top }}>
      <View className="px-4 pt-2 pb-1 flex-row items-center justify-between">
        <BackButton label="Menu" />
        <Text className="text-typography-main font-black text-lg tracking-tight">Deadlines</Text>
        <View className="w-16" />
      </View>

      <ScrollView className="flex-1 px-4" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="flex-row items-center justify-between mt-2 mb-3">
          <TouchableOpacity
            onPress={() => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
            className="w-9 h-9 items-center justify-center rounded-xl bg-surface-card border border-surface-border"
          >
            <FontAwesome name="chevron-left" size={13} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMonthAnchor(startOfMonth(new Date()))}>
            <Text className="text-typography-main font-black text-base">{monthLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
            className="w-9 h-9 items-center justify-center rounded-xl bg-surface-card border border-surface-border"
          >
            <FontAwesome name="chevron-right" size={13} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <View className="bg-surface-card border border-surface-border rounded-2xl p-2">
          <View className="flex-row mb-1">
            {WEEKDAY_LABELS.map((w, i) => (
              <View key={i} className="flex-1 items-center py-1">
                <Text className="text-typography-dim text-[9px] font-black uppercase">{w}</Text>
              </View>
            ))}
          </View>
          <View className="flex-row flex-wrap">
            {grid.map((d) => {
              const key = toDayKey(d);
              const inMonth = d.getMonth() === monthAnchor.getMonth();
              const isToday = key === todayKey;
              const dayTasks = tasksByDay.get(key) ?? [];
              const chips = dayTasks.slice(0, MAX_CHIPS);
              const extra = dayTasks.length - chips.length;
              return (
                <View key={key} style={{ width: '14.285%', minHeight: 58 }} className="p-0.5">
                  <View
                    className="flex-1 rounded-lg p-1"
                    style={{
                      borderWidth: isToday ? 1 : 0,
                      borderColor: colors.primary,
                      backgroundColor: isToday ? colors.primary + '14' : colors.background,
                      opacity: inMonth ? 1 : 0.4,
                    }}
                  >
                    <Text
                      className="text-[10px] font-bold"
                      style={{ color: isToday ? colors.primary : colors.textMain }}
                    >
                      {d.getDate()}
                    </Text>
                    {chips.map((t) => (
                      <TouchableOpacity key={t.id} onPress={() => goToTask(t.id)}>
                        <View
                          className="rounded px-1 mt-0.5"
                          style={{ backgroundColor: t.stageColor + '33', borderLeftWidth: 2, borderLeftColor: t.stageColor }}
                        >
                          <Text className="text-[8px] font-bold" style={{ color: colors.textMain }} numberOfLines={1}>
                            {t.title}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                    {extra > 0 && (
                      <Text className="text-[7px] font-black mt-0.5" style={{ color: colors.textDim }}>+{extra} more</Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        <View className="mt-6">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">
              Upcoming ({deadlineItems.length})
            </Text>
            <View className="flex-row gap-1.5">
              {RIBBON_WINDOW_OPTIONS.map((opt) => {
                const active = opt.days === windowDays;
                return (
                  <TouchableOpacity
                    key={opt.days}
                    onPress={() => setWindow(opt.days)}
                    accessibilityRole="button"
                    accessibilityLabel={`Show deadlines due within ${opt.label}`}
                    accessibilityState={{ selected: active }}
                    className={active ? 'h-11 min-w-11 px-2.5 items-center justify-center rounded-full bg-brand-primary' : 'h-11 min-w-11 px-2.5 items-center justify-center rounded-full border border-surface-border bg-surface-card'}
                  >
                    <Text className="text-[10px] font-black" style={{ color: active ? colors.card : colors.textMuted }}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {ribbonLoading ? (
            <ActivityIndicator size="small" color={colors.primary} className="mt-6" />
          ) : deadlineItems.length === 0 ? (
            <View className="items-center justify-center py-10 bg-surface-card border border-surface-border rounded-2xl">
              <FontAwesome name="check-circle" size={28} color={colors.textMuted} />
              <Text className="text-typography-muted text-sm font-bold mt-3">No upcoming deadlines</Text>
            </View>
          ) : (
            deadlineItems.map((t) => (
              <TouchableOpacity
                key={`${t.kind}-${t.id}`}
                onPress={() => t.kind === 'project' ? router.push(`/projects/${t.id}` as any) : goToTask(t.id)}
                accessibilityRole="button"
                accessibilityLabel={`${t.kind === 'project' ? 'Project' : 'Task'}: ${t.title}, ${formatRelativeDue(t.dueDate, t.overdue)}`}
                className="flex-row items-center p-4 mb-2 rounded-2xl border bg-surface-card"
                style={{ borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: t.color }}
              >
                <View className="flex-1 min-w-0 mr-3">
                  <Text className="text-typography-main font-bold text-sm" numberOfLines={1}>{t.title}</Text>
                  <Text className="text-typography-muted text-[11px] mt-0.5" numberOfLines={1}>
                    {t.subtitle}
                  </Text>
                </View>
                <Text
                  className="text-[10.5px] font-black flex-shrink-0"
                  style={{ color: t.overdue ? colors.danger : colors.textDim }}
                >
                  {formatRelativeDue(t.dueDate, t.overdue)}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}
