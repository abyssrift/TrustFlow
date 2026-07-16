import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { fetchDeadlineTasks, fetchUnscheduledCount, subscribeDeadlineChanges, type UpcomingTask } from '@/hooks/useUpcomingTasks';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const TRANSITION_MS = 320;
const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_CHIPS = 3;

type Rect = { top: number; left: number; width: number; height: number };
type Phase = 'opening' | 'open' | 'closing';

function toKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// Same 6x7 leading/trailing-day grid as TimelineDropdown's mini calendar.
function buildMonthGrid(anchor: Date): Date[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const gridStart = new Date(year, month, 1 - startOffset);
  return Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
}

export default function CalendarOverlay({
  open,
  originRect,
  onClose,
}: {
  open: boolean;
  originRect: Rect | null;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id;

  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>('opening');
  const wasOpen = useRef(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(new Date()));
  const [monthTasks, setMonthTasks] = useState<UpcomingTask[]>([]);
  const [unscheduledCount, setUnscheduledCount] = useState(0);
  const [hiddenStages, setHiddenStages] = useState<Set<string>>(new Set());

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // FLIP lifecycle: open → 'opening' (paint at originRect, no transition) →
  // rAF x2 → 'open' (transition to fullscreen). close → 'closing' (transition
  // back to originRect) → timeout → unmount. Reduced motion skips the
  // in-between phases entirely.
  useEffect(() => {
    let raf1: number | undefined;
    let raf2: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (open) {
      wasOpen.current = true;
      setMounted(true);
      if (reducedMotion) {
        setPhase('open');
      } else {
        setPhase('opening');
        raf1 = requestAnimationFrame(() => {
          raf2 = requestAnimationFrame(() => setPhase('open'));
        });
      }
    } else if (wasOpen.current) {
      wasOpen.current = false;
      if (reducedMotion) {
        setMounted(false);
      } else {
        setPhase('closing');
        timer = setTimeout(() => setMounted(false), TRANSITION_MS);
      }
    }
    return () => {
      if (raf1 !== undefined) cancelAnimationFrame(raf1);
      if (raf2 !== undefined) cancelAnimationFrame(raf2);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [open, reducedMotion]);

  // Reset to the current month (and clear any stage filter) each time the overlay opens.
  useEffect(() => {
    if (open) {
      setMonthAnchor(startOfMonth(new Date()));
      setHiddenStages(new Set());
    }
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mounted]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Month task fetch — the shared assignment-aware fetch (manager, personal,
  // or team assignment), bounded to the displayed month instead of "nearest 10".
  // Guarded by a request token so a slow response from a month you've since
  // navigated away from can't clobber newer data.
  const monthRequestId = useRef(0);
  const refetchMonth = useCallback(async () => {
    if (!userId) return;
    const requestId = ++monthRequestId.current;
    try {
      const nextMonthStart = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1);
      const mapped = await fetchDeadlineTasks(userId, {
        gte: monthAnchor.toISOString(),
        lt: nextMonthStart.toISOString(),
        rawLimit: 500,
      });
      if (requestId === monthRequestId.current) setMonthTasks(mapped);
    } catch {
      // keep stale data on error
    }
  }, [userId, monthAnchor]);

  // Personal unscheduled-tasks count (nudge copy in the sidebar).
  const refetchUnscheduled = useCallback(async () => {
    if (!userId) return;
    try {
      const count = await fetchUnscheduledCount(userId);
      setUnscheduledCount(count);
    } catch {
      // ignore
    }
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    refetchMonth();
  }, [open, refetchMonth]);

  useEffect(() => {
    if (!open) return;
    refetchUnscheduled();
  }, [open, refetchUnscheduled]);

  // Live updates while the overlay is open — a task created/edited/assigned
  // by anyone should show up here without waiting for a reopen.
  useEffect(() => {
    if (!open || !userId) return;
    return subscribeDeadlineChanges(() => {
      refetchMonth();
      refetchUnscheduled();
    });
  }, [open, userId, refetchMonth, refetchUnscheduled]);

  if (!mounted) return null;

  const fallbackRect: Rect = { top: window.innerHeight / 2 - 22, left: window.innerWidth / 2 - 170, width: 340, height: 44 };
  const origin = originRect || fallbackRect;
  const fullscreen: Rect = { top: 16, left: 16, width: window.innerWidth - 32, height: window.innerHeight - 32 };

  const targetRect = phase === 'open' ? fullscreen : origin;
  const radius = phase === 'open' ? 20 : 16;
  const animate = phase !== 'opening';
  const panelTransition = reducedMotion
    ? 'none'
    : `top ${TRANSITION_MS}ms ${EASING}, left ${TRANSITION_MS}ms ${EASING}, width ${TRANSITION_MS}ms ${EASING}, height ${TRANSITION_MS}ms ${EASING}, border-radius ${TRANSITION_MS}ms ${EASING}`;

  const todayKey = toKey(new Date());
  const grid = buildMonthGrid(monthAnchor);
  const monthLabel = monthAnchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const tasksByDay = new Map<string, UpcomingTask[]>();
  for (const t of monthTasks) {
    const key = toKey(new Date(t.dueDate));
    const list = tasksByDay.get(key) || [];
    list.push(t);
    tasksByDay.set(key, list);
  }

  // Unique stages present this month, in first-seen (≈ due-date) order —
  // doubles as the legend and the filter toggle list in the footer bar.
  const legendStages: { name: string; color: string }[] = [];
  const seenStages = new Set<string>();
  for (const t of monthTasks) {
    if (t.stageName && !seenStages.has(t.stageName)) {
      seenStages.add(t.stageName);
      legendStages.push({ name: t.stageName, color: t.stageColor });
    }
  }

  const toggleStage = (name: string) => {
    setHiddenStages((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const goToTask = (id: string) => {
    router.push(`/task/${id}` as any);
    onClose();
  };

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 998,
          backgroundColor: 'rgba(0,0,0,0.45)',
          opacity: animate ? 1 : 0,
          transition: reducedMotion ? 'none' : `opacity ${TRANSITION_MS}ms ${EASING}`,
        }}
      />
      <div
        style={{
          position: 'fixed',
          zIndex: 999,
          top: targetRect.top,
          left: targetRect.left,
          width: targetRect.width,
          height: targetRect.height,
          borderRadius: radius,
          backgroundColor: colors.card,
          border: `1px solid ${colors.border}`,
          boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          transition: panelTransition,
        }}
      >
        <div
          style={{
            opacity: phase === 'open' ? 1 : 0,
            transition: reducedMotion ? 'none' : `opacity 200ms ease ${phase === 'open' ? '120ms' : '0ms'}`,
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* ── Header ──────────────────────────────────────────────── */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 20px', borderBottom: `1px solid ${colors.border}`, flexShrink: 0,
          }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: colors.textMain }}>{monthLabel}</div>
            <button
              onClick={() => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              style={iconBtnStyle(colors)}
            >
              <FontAwesome name="chevron-left" size={12} color={colors.textMuted} />
            </button>
            <button
              onClick={() => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              style={iconBtnStyle(colors)}
            >
              <FontAwesome name="chevron-right" size={12} color={colors.textMuted} />
            </button>
            <button
              onClick={() => setMonthAnchor(startOfMonth(new Date()))}
              style={{
                padding: '5px 12px', borderRadius: 8, border: `1px solid ${colors.border}`,
                backgroundColor: 'transparent', color: colors.textMuted, fontSize: 11.5, fontWeight: 700,
                fontFamily: 'inherit', cursor: 'pointer',
              }}
            >
              Today
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={onClose} style={iconBtnStyle(colors)}>
              <FontAwesome name="times" size={14} color={colors.textMuted} />
            </button>
          </div>

          {/* ── Body: month grid + insights sidebar, footer filter bar below ── */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4, flexShrink: 0 }}>
                {WEEKDAY_LABELS.map((w) => (
                  <div key={w} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: colors.textDim, padding: '4px 0' }}>{w}</div>
                ))}
              </div>
              <div style={{
                flex: 1, minHeight: 0, overflowY: 'auto',
                display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridTemplateRows: 'repeat(6, minmax(72px, 1fr))', gap: 4,
              }}>
                {grid.map((d) => {
                  const key = toKey(d);
                  const inMonth = d.getMonth() === monthAnchor.getMonth();
                  const isToday = key === todayKey;
                  const dayTasksAll = tasksByDay.get(key) || [];
                  const dayTasks = dayTasksAll.filter((t) => !hiddenStages.has(t.stageName));
                  const chips = dayTasks.slice(0, MAX_CHIPS);
                  const extra = dayTasks.length - chips.length;
                  return (
                    <div
                      key={key}
                      style={{
                        borderRadius: 10,
                        border: `1px solid ${isToday ? colors.primary : colors.border}`,
                        backgroundColor: isToday ? `${colors.primary}14` : 'transparent',
                        padding: 6,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                        opacity: inMonth ? 1 : 0.45,
                        overflow: 'hidden',
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: isToday ? 800 : 600, color: isToday ? colors.primary : colors.textMain }}>
                        {d.getDate()}
                      </span>
                      {chips.map((t) => (
                        <div
                          key={t.id}
                          title={t.title}
                          onClick={() => goToTask(t.id)}
                          style={{
                            fontSize: 11,
                            color: colors.textMain,
                            backgroundColor: `${t.stageColor}33`,
                            borderLeft: `3px solid ${t.stageColor}`,
                            borderRadius: 4,
                            padding: '2px 5px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            cursor: 'pointer',
                          }}
                        >
                          {t.title}
                        </div>
                      ))}
                      {extra > 0 && (
                        <span
                          title={dayTasks.slice(MAX_CHIPS).map((t) => t.title).join('\n')}
                          style={{ fontSize: 10, fontWeight: 700, color: colors.textDim, padding: '0 5px' }}
                        >
                          +{extra} more
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <CalendarInsights
              colors={colors}
              monthAnchor={monthAnchor}
              monthTasks={monthTasks}
              unscheduledCount={unscheduledCount}
            />
          </div>

          <CalendarFilterBar
            colors={colors}
            stages={legendStages}
            hiddenStages={hiddenStages}
            onToggle={toggleStage}
            onReset={() => setHiddenStages(new Set())}
          />
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

// Doubles as the stage legend and a declutter filter: click a stage to hide
// its chips from the month grid (sidebar stats stay unfiltered — hiding a
// stage shouldn't make its deadlines invisible to the counts, just the view).
function CalendarFilterBar({
  colors, stages, hiddenStages, onToggle, onReset,
}: {
  colors: ReturnType<typeof useThemeColors>;
  stages: { name: string; color: string }[];
  hiddenStages: Set<string>;
  onToggle: (name: string) => void;
  onReset: () => void;
}) {
  if (stages.length === 0) return null;
  const anyHidden = hiddenStages.size > 0;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      padding: '10px 16px', borderTop: `1px solid ${colors.border}`, flexShrink: 0,
    }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.textDim, marginRight: 2 }}>
        Filter
      </span>
      {stages.map((s) => {
        const active = !hiddenStages.has(s.name);
        return (
          <button
            key={s.name}
            onClick={() => onToggle(s.name)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', borderRadius: 9999,
              border: `1px solid ${active ? s.color : colors.border}`,
              backgroundColor: active ? `${s.color}22` : 'transparent',
              color: active ? colors.textMain : colors.textDim,
              fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
              opacity: active ? 1 : 0.55,
              transition: 'opacity 120ms ease, background-color 120ms ease, border-color 120ms ease',
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 9999, backgroundColor: s.color, flexShrink: 0 }} />
            {s.name}
          </button>
        );
      })}
      {anyHidden && (
        <button
          onClick={onReset}
          style={{
            marginLeft: 4, padding: '4px 10px', borderRadius: 9999, border: 'none',
            backgroundColor: 'transparent', color: colors.textMuted, fontSize: 11.5, fontWeight: 700,
            fontFamily: 'inherit', cursor: 'pointer', textDecoration: 'underline',
          }}
        >
          Show all
        </button>
      )}
    </div>
  );
}

function iconBtnStyle(colors: ReturnType<typeof useThemeColors>): React.CSSProperties {
  return {
    width: 26, height: 26, borderRadius: 8, border: `1px solid ${colors.border}`,
    backgroundColor: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', flexShrink: 0,
  };
}

function relDue(dueDate: string): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate); due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return 'due today';
  if (diffDays === 1) return 'due tomorrow';
  return `due in ${diffDays}d`;
}

function CalendarInsights({
  colors, monthAnchor, monthTasks, unscheduledCount,
}: {
  colors: ReturnType<typeof useThemeColors>;
  monthAnchor: Date;
  monthTasks: UpcomingTask[];
  unscheduledCount: number;
}) {
  const { nextDeadline, overdue, heaviest } = useMemo(() => {
    const overdueList = monthTasks.filter((t) => t.overdue);
    const upcoming = monthTasks.filter((t) => !t.overdue).sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    const byDay = new Map<string, number>();
    for (const t of monthTasks) {
      const key = toKey(new Date(t.dueDate));
      byDay.set(key, (byDay.get(key) || 0) + 1);
    }
    let heaviestKey: string | null = null;
    let heaviestCount = 0;
    for (const [key, count] of byDay) {
      if (count > heaviestCount) { heaviestKey = key; heaviestCount = count; }
    }
    const heaviestDate = heaviestKey
      ? new Date(Number(heaviestKey.split('-')[0]), Number(heaviestKey.split('-')[1]), Number(heaviestKey.split('-')[2]))
      : null;

    return {
      nextDeadline: upcoming[0] || null,
      overdue: overdueList,
      heaviest: heaviestDate ? { date: heaviestDate, count: heaviestCount } : null,
    };
  }, [monthTasks]);

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.textDim, marginBottom: 6,
  };

  return (
    <div style={{
      width: 270, flexShrink: 0, borderLeft: `1px solid ${colors.border}`,
      overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 18,
    }}>
      {nextDeadline && (
        <div>
          <div style={labelStyle}>Next deadline</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: colors.textMain }}>{nextDeadline.title}</div>
          <div style={{ fontSize: 11.5, color: colors.textMuted, marginTop: 2 }}>{relDue(nextDeadline.dueDate)}</div>
        </div>
      )}

      {overdue.length > 0 && (
        <div>
          <div style={labelStyle}>Overdue</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: colors.danger, marginBottom: 4 }}>{overdue.length}</div>
          {overdue.slice(0, 3).map((t) => (
            <div key={t.id} style={{ fontSize: 11.5, color: colors.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {t.title}
            </div>
          ))}
        </div>
      )}

      {monthTasks.length > 0 && (
        <div>
          <div style={labelStyle}>This month</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: colors.textMain }}>{monthTasks.length} tasks due</div>
          {heaviest && (
            <div style={{ fontSize: 11.5, color: colors.textMuted, marginTop: 2 }}>
              Heaviest: {heaviest.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} — {heaviest.count} tasks
            </div>
          )}
        </div>
      )}

      {unscheduledCount > 0 && (
        <div style={{ opacity: 0.7 }}>
          <div style={labelStyle}>Unscheduled</div>
          <div style={{ fontSize: 11.5, color: colors.textDim }}>{unscheduledCount} tasks have no due date</div>
        </div>
      )}
    </div>
  );
}
