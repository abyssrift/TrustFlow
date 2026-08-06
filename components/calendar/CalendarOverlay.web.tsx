import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { rangeKeysBetween } from '@/lib/calendarRange';
import { toastError } from '@/lib/toast';
import { positionTooltip } from '@/lib/tooltipPosition';
import { fetchCompletedTasks, fetchDeadlineTasks, fetchUnscheduledTasks, subscribeDeadlineChanges, type CompletedTask, type UnscheduledTask, type UpcomingTask } from '@/hooks/useUpcomingTasks';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const TRANSITION_MS = 320;
const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_CHIPS = 3;

type Rect = { top: number; left: number; width: number; height: number };
type Phase = 'opening' | 'open' | 'closing';

type RangeSummary = {
  total: number;
  due: number;
  done: number;
  points: number;
  days: number;
  start: Date;
  end: Date;
  byStage: { name: string; color: string; count: number }[];
  byBoard: { name: string; count: number; points: number }[];
};

function toKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function keyToDate(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m, d);
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
  const [unscheduledTasks, setUnscheduledTasks] = useState<UnscheduledTask[]>([]);
  const [hiddenStages, setHiddenStages] = useState<Set<string>>(new Set());
  const [showCompleted, setShowCompleted] = useState(false);
  const [completedTasks, setCompletedTasks] = useState<CompletedTask[]>([]);

  // Range select, two-click: click a day to anchor, hover to preview the span
  // in a cursor-following readout, click again to commit it. A committed range
  // (rangeEnd set) stops following the mouse and docks into the sidebar, where
  // it can actually be interacted with — the floating readout is
  // pointer-events:none and vanishes on mouse-out, so it can never hold an
  // action. Desktop-web only: hover has no touch equivalent.
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);
  const [rangeHover, setRangeHover] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const pinned = rangeEnd !== null;

  const clearRange = useCallback(() => {
    setRangeAnchor(null);
    setRangeEnd(null);
    setRangeHover(null);
    setCursor(null);
  }, []);

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
      clearRange();
      // showCompleted deliberately persists across opens — it's a viewing
      // preference, and resetting it made the toggle look broken (turn it on,
      // close, reopen, completed tasks gone again).
    }
  }, [open, clearRange]);

  // A range only makes sense against the currently visible grid.
  useEffect(() => {
    clearRange();
  }, [monthAnchor, clearRange]);

  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mounted]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape unwinds one level at a time: drop an active range first, only
      // close the overlay once there's no range to clear.
      if (e.key === 'Escape') {
        if (rangeAnchor) clearRange();
        else onClose();
        return;
      }
      if (e.key === 'ArrowLeft') { setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1)); return; }
      if (e.key === 'ArrowRight') { setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1)); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, rangeAnchor, clearRange]);

  // Shift+scroll (or a trackpad horizontal swipe) pages months. One month per
  // gesture — a short cooldown stops a single scroll from flipping through many.
  const wheelCooldown = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open) return;
    const onWheel = (e: WheelEvent) => {
      const delta = e.shiftKey ? e.deltaY : e.deltaX;
      if (Math.abs(delta) < 24 || wheelCooldown.current) return;
      setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() + (delta > 0 ? 1 : -1), 1));
      wheelCooldown.current = setTimeout(() => { wheelCooldown.current = null; }, 350);
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.removeEventListener('wheel', onWheel);
      if (wheelCooldown.current) clearTimeout(wheelCooldown.current);
    };
  }, [open]);

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

  // Personal unscheduled-tasks list (nudge in the sidebar so undated work assigned to me isn't forgotten).
  const refetchUnscheduled = useCallback(async () => {
    if (!userId) return;
    try {
      const tasks = await fetchUnscheduledTasks(userId);
      setUnscheduledTasks(tasks);
    } catch {
      // ignore
    }
  }, [userId]);

  // Completed (+ archived) tasks for the "show completed" toggle — fetched
  // lazily, only once the toggle is on, since it costs a second query plus
  // an archive lookup that most calendar visits never need.
  const refetchCompleted = useCallback(async () => {
    if (!userId) return;
    try {
      const nextMonthStart = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1);
      const tasks = await fetchCompletedTasks(userId, {
        gte: monthAnchor.toISOString(),
        lt: nextMonthStart.toISOString(),
      });
      setCompletedTasks(tasks);
    } catch (e: any) {
      // Unlike the deadline fetches (which have prior data to fall back on),
      // this one runs because the user just asked for completed tasks — a
      // silent failure here looks identical to "you completed nothing".
      setCompletedTasks([]);
      toastError(e?.message || 'Could not load completed tasks.', 'Calendar');
    }
  }, [userId, monthAnchor]);

  useEffect(() => {
    if (!open) return;
    refetchMonth();
  }, [open, refetchMonth]);

  useEffect(() => {
    if (!open) return;
    refetchUnscheduled();
  }, [open, refetchUnscheduled]);

  useEffect(() => {
    if (!open || !showCompleted) return;
    refetchCompleted();
  }, [open, showCompleted, refetchCompleted]);

  // Live updates while the overlay is open — a task created/edited/assigned
  // by anyone should show up here without waiting for a reopen.
  useEffect(() => {
    if (!open || !userId) return;
    return subscribeDeadlineChanges(() => {
      refetchMonth();
      refetchUnscheduled();
      if (showCompleted) refetchCompleted();
    });
  }, [open, userId, refetchMonth, refetchUnscheduled, showCompleted, refetchCompleted]);

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

  const completedByDay = new Map<string, CompletedTask[]>();
  if (showCompleted) {
    for (const t of completedTasks) {
      const key = toKey(new Date(t.completedDate));
      const list = completedByDay.get(key) || [];
      list.push(t);
      completedByDay.set(key, list);
    }
  }

  // Range select: [min(anchor, hover), max(anchor, hover)] by day key, so
  // hovering "backwards" from the anchor still previews correctly.
  // A committed range ignores hover; an in-progress one previews to the cursor.
  const rangeEndKey = pinned ? rangeEnd : (rangeHover || rangeAnchor);
  const rangeKeys = rangeAnchor && rangeEndKey
    ? rangeKeysBetween(grid.map(toKey), rangeAnchor, rangeEndKey)
    : [];
  const rangeKeySet = new Set(rangeKeys);

  let rangeSummary: RangeSummary | null = null;
  if (rangeKeySet.size > 0) {
    const byStage = new Map<string, { color: string; count: number }>();
    // "Where the work lives" — grouped by pipeline/board, not project:
    // project_id is populated on a tiny fraction of tasks, so a project
    // grouping would read as "No project" for nearly everything.
    const byBoard = new Map<string, { count: number; points: number }>();
    let due = 0;
    let done = 0;
    let points = 0;
    // A task reopened out of a terminal stage keeps its completed_at, so it can
    // land in both the due and completed buckets — count it once.
    const seen = new Set<string>();
    const tally = (t: { stageName: string; stageColor: string; pipelineName: string; points: number }) => {
      const s = byStage.get(t.stageName) || { color: t.stageColor, count: 0 };
      s.count++;
      byStage.set(t.stageName, s);
      const b = byBoard.get(t.pipelineName) || { count: 0, points: 0 };
      b.count++;
      b.points += t.points;
      byBoard.set(t.pipelineName, b);
      points += t.points;
    };
    for (const key of rangeKeySet) {
      for (const t of tasksByDay.get(key) || []) {
        if (hiddenStages.has(t.stageName) || seen.has(t.id)) continue;
        seen.add(t.id);
        due++;
        tally(t);
      }
      if (showCompleted) {
        for (const t of completedByDay.get(key) || []) {
          if (hiddenStages.has(t.stageName) || seen.has(t.id)) continue;
          seen.add(t.id);
          done++;
          tally(t);
        }
      }
    }
    // rangeKeys is a grid slice, so it is already chronological — no re-sort.
    rangeSummary = {
      total: due + done,
      due,
      done,
      points,
      days: rangeKeys.length,
      start: keyToDate(rangeKeys[0]),
      end: keyToDate(rangeKeys[rangeKeys.length - 1]),
      byStage: Array.from(byStage.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count),
      byBoard: Array.from(byBoard.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count),
    };
  }

  // Two-click range. Cursor is seeded from the click itself so the floating
  // readout appears immediately rather than waiting for the first mousemove.
  const startRange = (key: string, e: React.MouseEvent) => {
    setRangeAnchor(key);
    setRangeEnd(null);
    setRangeHover(null);
    setCursor({ x: e.clientX, y: e.clientY });
  };
  const handleDayClick = (key: string, e: React.MouseEvent) => {
    if (pinned) { startRange(key, e); return; }        // committed → begin a new one
    if (!rangeAnchor) { startRange(key, e); return; }  // nothing selected yet
    if (rangeAnchor === key) { clearRange(); return; } // clicked the anchor again
    setRangeEnd(key);                                  // commit [anchor, key]
    setRangeHover(null);
    setCursor(null);
  };
  const handleDayHover = (key: string) => {
    if (rangeAnchor && !pinned) setRangeHover(key);
  };

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
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 20px rgba(0,0,0,0.3), 0 24px 64px rgba(0,0,0,0.45)',
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
            boxShadow: '0 1px 0 rgba(0,0,0,0.15)', position: 'relative', zIndex: 1,
          }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: colors.textMain }}>{monthLabel}</div>
            <button
              title="Previous month (←)"
              onClick={() => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              style={iconBtnStyle(colors)}
            >
              <FontAwesome name="chevron-left" size={12} color={colors.textMuted} />
            </button>
            <button
              title="Next month (→)"
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
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', backgroundColor: colors.background }}>
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4, flexShrink: 0 }}>
                {WEEKDAY_LABELS.map((w) => (
                  <div key={w} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: colors.textDim, padding: '4px 0' }}>{w}</div>
                ))}
              </div>
              <div
                onMouseMove={(e) => { if (rangeAnchor && !pinned) setCursor({ x: e.clientX, y: e.clientY }); }}
                onMouseLeave={() => setCursor(null)}
                style={{
                  flex: 1, minHeight: 0, overflowY: 'auto',
                  display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridTemplateRows: 'repeat(6, minmax(72px, 1fr))', gap: 4,
                }}
              >
                {grid.map((d) => {
                  const key = toKey(d);
                  const inMonth = d.getMonth() === monthAnchor.getMonth();
                  const isToday = key === todayKey;
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  const dayTasksAll = tasksByDay.get(key) || [];
                  const dayTasks = dayTasksAll.filter((t) => !hiddenStages.has(t.stageName));
                  const dayCompletedAll = completedByDay.get(key) || [];
                  const dayCompleted = dayCompletedAll.filter((t) => !hiddenStages.has(t.stageName));
                  const combined = [
                    ...dayTasks.map((t) => ({ id: t.id, title: t.title, color: t.stageColor, kind: 'due' as const })),
                    ...dayCompleted.map((t) => ({ id: t.id, title: t.title, color: t.stageColor, kind: (t.archived ? 'archived' : 'completed') as 'archived' | 'completed' })),
                  ];
                  const chips = combined.slice(0, MAX_CHIPS);
                  const extra = combined.length - chips.length;
                  const inRange = rangeKeySet.has(key);
                  const isEndpoint = key === rangeAnchor || (pinned && key === rangeEnd);
                  return (
                    <div
                      key={key}
                      onClick={(e) => handleDayClick(key, e)}
                      onMouseEnter={() => handleDayHover(key)}
                      style={{
                        borderRadius: 10,
                        border: `1px solid ${isEndpoint || isToday ? colors.primary : colors.border}`,
                        backgroundColor: inRange ? `${colors.primary}22` : (isToday ? `${colors.primary}14` : (isWeekend ? colors.background : colors.card)),
                        boxShadow: isEndpoint
                          ? `0 0 0 2px ${colors.primary}66`
                          : (isToday ? `0 0 0 1px ${colors.primary}33, 0 2px 8px ${colors.primary}22` : '0 1px 2px rgba(0,0,0,0.12)'),
                        padding: 6,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                        opacity: inMonth ? 1 : 0.45,
                        overflow: 'hidden',
                        cursor: 'pointer',
                        transition: 'background-color 100ms ease, border-color 100ms ease',
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: isToday ? 800 : 600, color: isToday ? colors.primary : colors.textMain }}>
                        {d.getDate()}
                      </span>
                      {chips.map((t) => (
                        <div
                          key={`${t.kind}-${t.id}`}
                          title={t.kind === 'archived' ? `${t.title} (archived)` : t.title}
                          onClick={t.kind !== 'archived' ? (e) => { e.stopPropagation(); goToTask(t.id); } : (e) => e.stopPropagation()}
                          style={{
                            fontSize: 11,
                            color: colors.textMain,
                            backgroundColor: `${t.color}33`,
                            borderLeft: `3px solid ${t.color}`,
                            borderRadius: 4,
                            padding: '2px 5px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            cursor: t.kind !== 'archived' ? 'pointer' : 'default',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                            opacity: t.kind === 'due' ? 1 : 0.65,
                          }}
                        >
                          {t.kind !== 'due' && (t.kind === 'archived' ? '\u{1F4E6} ' : '✓ ')}{t.title}
                        </div>
                      ))}
                      {extra > 0 && (
                        <span
                          title={combined.slice(MAX_CHIPS).map((t) => t.title).join('\n')}
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
              unscheduledTasks={unscheduledTasks}
              goToTask={goToTask}
              pinnedRange={pinned ? rangeSummary : null}
              onClearRange={clearRange}
              reducedMotion={reducedMotion}
            />
          </div>

          <CalendarFilterBar
            colors={colors}
            stages={legendStages}
            hiddenStages={hiddenStages}
            onToggle={toggleStage}
            onReset={() => setHiddenStages(new Set())}
            showCompleted={showCompleted}
            onToggleCompleted={() => setShowCompleted((v) => !v)}
          />
          </div>
        </div>
      </div>

      {/* Floating readout only while the range is still being dragged out —
          once committed it lives in the sidebar, where it can be clicked. */}
      {rangeSummary && cursor && !pinned && phase === 'open' && (
        <RangeTooltip colors={colors} summary={rangeSummary} cursor={cursor} />
      )}
    </>,
    document.body
  );
}

// Cursor-following readout for the active range. Rendered as a portal sibling
// (not inside the panel, which clips via overflow: hidden) and pinned with
// position: fixed, so it can sit anywhere in the viewport. Placement reuses
// the shared positionTooltip() flip-then-clamp math with a zero-size target
// rect standing in for the cursor point, so edge behaviour matches the rest
// of the app's tooltips instead of being hand-rolled here.
const TIP_MAX_ROWS = 5;
const TIP_WIDTH = 250;

function RangeTooltip({
  colors, summary, cursor,
}: {
  colors: ReturnType<typeof useThemeColors>;
  summary: RangeSummary;
  cursor: { x: number; y: number };
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: TIP_WIDTH, height: 150 });

  // Measure after paint so the flip decision uses the real box. Guarded by a
  // 1px threshold — setState on every measure would loop forever.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.width - size.width) > 1 || Math.abs(r.height - size.height) > 1) {
      setSize({ width: r.width, height: r.height });
    }
  });

  const { left, top } = positionTooltip(
    { x: cursor.x, y: cursor.y, width: 0, height: 0 },
    size,
    { width: window.innerWidth, height: window.innerHeight },
    'right',
  );

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top,
        left,
        zIndex: 1000,
        // Must never eat the mousemove/hover events driving the range itself.
        pointerEvents: 'none',
        width: TIP_WIDTH,
        maxHeight: '70vh',
        overflow: 'hidden',
        padding: 12,
        borderRadius: 12,
        border: `1px solid ${colors.border}`,
        backgroundColor: colors.card,
        boxShadow: '0 8px 20px rgba(0,0,0,0.35), 0 20px 48px rgba(0,0,0,0.45)',
      }}
    >
      <RangeBody colors={colors} summary={summary} hint="Click again to keep this range" />
    </div>
  );
}

function fmtDay(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Shared content for both range surfaces — the cursor-following readout and
// the docked sidebar panel show the same numbers, so the markup lives once.
function RangeBody({
  colors, summary, hint,
}: {
  colors: ReturnType<typeof useThemeColors>;
  summary: RangeSummary;
  hint?: string;
}) {
  const extraStages = summary.byStage.length - TIP_MAX_ROWS;
  const extraBoards = summary.byBoard.length - TIP_MAX_ROWS;
  const sectionLabel: React.CSSProperties = {
    fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase',
    color: colors.textDim, marginTop: 10, marginBottom: 4,
  };
  const row: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: colors.textMuted, marginTop: 3,
  };
  const rowName: React.CSSProperties = {
    flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  };

  return (
    <>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.textDim }}>
        {fmtDay(summary.start)} – {fmtDay(summary.end)} · {summary.days} day{summary.days === 1 ? '' : 's'}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: colors.textMain, lineHeight: 1.1 }}>{summary.total}</span>
        <span style={{ fontSize: 11.5, color: colors.textMuted }}>task{summary.total === 1 ? '' : 's'}</span>
        <div style={{ flex: 1 }} />
        <span style={{
          fontSize: 11, fontWeight: 800, color: colors.primary,
          backgroundColor: `${colors.primary}1f`, borderRadius: 9999, padding: '2px 8px',
        }}>
          {summary.points} pts
        </span>
      </div>
      {summary.done > 0 && (
        <div style={{ fontSize: 11.5, color: colors.textMuted }}>{summary.due} due · {summary.done} done</div>
      )}

      {summary.byBoard.length > 0 && (
        <>
          <div style={sectionLabel}>Boards</div>
          {summary.byBoard.slice(0, TIP_MAX_ROWS).map((b) => (
            <div key={b.name} style={row}>
              <span style={rowName}>{b.name || 'No board'}</span>
              <span style={{ fontSize: 10.5, color: colors.textDim }}>{b.points} pts</span>
              <span style={{ fontWeight: 700, color: colors.textMain, minWidth: 16, textAlign: 'right' }}>{b.count}</span>
            </div>
          ))}
          {extraBoards > 0 && (
            <div style={{ fontSize: 11, color: colors.textDim, marginTop: 4 }}>+{extraBoards} more board{extraBoards === 1 ? '' : 's'}</div>
          )}
        </>
      )}

      {summary.byStage.length > 0 && (
        <>
          <div style={sectionLabel}>Stages</div>
          {summary.byStage.slice(0, TIP_MAX_ROWS).map((s) => (
            <div key={s.name} style={row}>
              <span style={{ width: 7, height: 7, borderRadius: 9999, backgroundColor: s.color, flexShrink: 0 }} />
              <span style={rowName}>{s.name || 'Uncategorized'}</span>
              <span style={{ fontWeight: 700, color: colors.textMain, minWidth: 16, textAlign: 'right' }}>{s.count}</span>
            </div>
          ))}
          {extraStages > 0 && (
            <div style={{ fontSize: 11, color: colors.textDim, marginTop: 4 }}>+{extraStages} more stage{extraStages === 1 ? '' : 's'}</div>
          )}
        </>
      )}

      {hint && (
        <div style={{ fontSize: 10.5, color: colors.textDim, marginTop: 10, fontStyle: 'italic' }}>{hint}</div>
      )}
    </>
  );
}

// Doubles as the stage legend and a declutter filter: click a stage to hide
// its chips from the month grid (sidebar stats stay unfiltered — hiding a
// stage shouldn't make its deadlines invisible to the counts, just the view).
function CalendarFilterBar({
  colors, stages, hiddenStages, onToggle, onReset, showCompleted, onToggleCompleted,
}: {
  colors: ReturnType<typeof useThemeColors>;
  stages: { name: string; color: string }[];
  hiddenStages: Set<string>;
  onToggle: (name: string) => void;
  onReset: () => void;
  showCompleted: boolean;
  onToggleCompleted: () => void;
}) {
  const anyHidden = hiddenStages.size > 0;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      padding: '10px 16px', borderTop: `1px solid ${colors.border}`, flexShrink: 0,
      backgroundColor: colors.card, boxShadow: '0 -1px 0 rgba(0,0,0,0.1)',
    }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.textDim, marginRight: 2 }}>
        Filter
      </span>
      <button
        onClick={onToggleCompleted}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: 9999,
          border: `1px solid ${showCompleted ? colors.primary : colors.border}`,
          backgroundColor: showCompleted ? `${colors.primary}22` : 'transparent',
          color: showCompleted ? colors.textMain : colors.textDim,
          fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
        }}
      >
        Show completed
      </button>
      {stages.length > 0 && <span style={{ width: 1, height: 16, backgroundColor: colors.border }} />}
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
  colors, monthAnchor, monthTasks, unscheduledTasks, goToTask, pinnedRange, onClearRange, reducedMotion,
}: {
  colors: ReturnType<typeof useThemeColors>;
  monthAnchor: Date;
  monthTasks: UpcomingTask[];
  unscheduledTasks: UnscheduledTask[];
  goToTask: (id: string) => void;
  pinnedRange: RangeSummary | null;
  onClearRange: () => void;
  reducedMotion: boolean;
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

  // Every section below is gated independently, so with no data at all the
  // sidebar used to render as a bordered 270px void. nextDeadline/overdue are
  // both derived from monthTasks, so those two checks are already implied.
  // A pinned range counts as content — it's the question the user just asked.
  const isEmpty = !pinnedRange && monthTasks.length === 0 && unscheduledTasks.length === 0;

  return (
    <div style={{
      width: 270, flexShrink: 0, borderLeft: `1px solid ${colors.border}`,
      minHeight: 0, padding: 16, display: 'flex', flexDirection: 'column', gap: 18,
    }}>
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* A committed range takes over the top of the sidebar — it's what the
            user just asked a question about, so it outranks the standing stats. */}
        {pinnedRange && (
          <div style={{
            padding: 12, borderRadius: 12,
            border: `1px solid ${colors.primary}55`, backgroundColor: `${colors.primary}14`,
          }}>
            <RangeBody colors={colors} summary={pinnedRange} />
            <button
              onClick={onClearRange}
              style={{
                marginTop: 10, width: '100%', padding: '6px 10px', borderRadius: 8,
                border: `1px solid ${colors.border}`, backgroundColor: 'transparent',
                color: colors.textMuted, fontSize: 11.5, fontWeight: 700,
                fontFamily: 'inherit', cursor: 'pointer',
              }}
            >
              Clear range
            </button>
          </div>
        )}

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
      </div>

      {unscheduledTasks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
          <div style={labelStyle}>Unscheduled ({unscheduledTasks.length})</div>
          <div style={{ fontSize: 11, color: colors.textDim, marginBottom: 6 }}>Assigned to you, no due date</div>
          <div style={{ overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {unscheduledTasks.map((t) => (
              <div
                key={t.id}
                title={t.title}
                onClick={() => goToTask(t.id)}
                style={{
                  fontSize: 11.5,
                  color: colors.textMain,
                  backgroundColor: `${t.stageColor}22`,
                  borderLeft: `3px solid ${t.stageColor}`,
                  borderRadius: 4,
                  padding: '4px 6px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                {t.title}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Keyed on the month so navigating between two empty months re-prints
          the dot field — the shape of the month actually changes. */}
      {isEmpty && (
        <EmptyInsights
          key={monthAnchor.getTime()}
          colors={colors}
          monthAnchor={monthAnchor}
          reducedMotion={reducedMotion}
        />
      )}
    </div>
  );
}

// The empty sidebar's mark is a miniature of the month you're looking at —
// buildMonthGrid's real 42-cell grid, rendered as dots, with today's dot the
// only lit one (and only when you're actually on the current month). It reads
// as "this page of the calendar has nothing on it" rather than a generic
// "all done" checkmark, and it stays honest when you browse to an empty
// future month, which is not an achievement.
//
// Animation: plain CSS transitions with a per-dot delay. This whole component
// tree is real DOM (createPortal to document.body, inline CSSProperties), not
// react-native-web — so per animation-consistency.md §1 neither reanimated nor
// LayoutAnimation applies here, and WAAPI would only buy us measurement we
// don't need. Reduced motion follows the same `reducedMotion ? 'none' : ...`
// mechanism the FLIP panel above already uses, and starts fully revealed.
function EmptyInsights({
  colors, monthAnchor, reducedMotion,
}: {
  colors: ReturnType<typeof useThemeColors>;
  monthAnchor: Date;
  reducedMotion: boolean;
}) {
  const [revealed, setRevealed] = useState(reducedMotion);
  useEffect(() => {
    if (reducedMotion) return;
    const raf = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);

  const now = new Date();
  const sameYear = monthAnchor.getFullYear() === now.getFullYear();
  const isCurrentMonth = sameYear && monthAnchor.getMonth() === now.getMonth();
  const monthName = monthAnchor.toLocaleDateString('en-US', sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' });
  const todayKey = toKey(now);

  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', paddingBottom: 48,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 6px)', gap: 8, marginBottom: 24 }}>
        {buildMonthGrid(monthAnchor).map((d, i) => {
          const inMonth = d.getMonth() === monthAnchor.getMonth();
          const isToday = isCurrentMonth && toKey(d) === todayKey;
          return (
            <div
              key={i}
              style={{
                width: 6, height: 6, borderRadius: 3,
                backgroundColor: isToday ? colors.primary : `${colors.textDim}${inMonth ? '66' : '1f'}`,
                boxShadow: isToday && revealed ? `0 0 0 4px ${colors.primary}24` : `0 0 0 0 ${colors.primary}00`,
                opacity: revealed ? 1 : 0,
                transform: revealed ? 'scale(1)' : 'scale(0.35)',
                transition: reducedMotion ? 'none' : [
                  `opacity 420ms ease ${120 + i * 10}ms`,
                  `transform 420ms ${EASING} ${120 + i * 10}ms`,
                  'box-shadow 520ms ease 720ms',
                ].join(', '),
              }}
            />
          );
        })}
      </div>

      <div style={{
        textAlign: 'center', maxWidth: 200,
        opacity: revealed ? 1 : 0,
        transform: revealed ? 'translateY(0)' : 'translateY(5px)',
        transition: reducedMotion ? 'none' : `opacity 380ms ease 540ms, transform 380ms ${EASING} 540ms`,
      }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: colors.textMain, letterSpacing: -0.1 }}>
          {isCurrentMonth ? `${monthName} is clear` : `Nothing due in ${monthName}`}
        </div>
        <div style={{ fontSize: 11.5, color: colors.textMuted, marginTop: 7, lineHeight: 1.55 }}>
          Tasks appear here when they&apos;re due, overdue, or waiting on a date.
        </div>
      </div>
    </div>
  );
}
