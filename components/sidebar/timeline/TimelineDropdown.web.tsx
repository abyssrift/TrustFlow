import { useThemeColors } from '@/hooks/useThemeColors';
import { formatRelativeDue, type UpcomingTask } from '@/hooks/useUpcomingTasks';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; // en-US order, Sun first
const MAX_DOTS = 3;

function toKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Hand-rolled month grid: leading/trailing days from adjacent months fill
// the 6x7 grid so the layout never jumps between months.
function buildMonthGrid(anchor: Date): Date[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay(); // 0=Sun
  const gridStart = new Date(year, month, 1 - startOffset);
  return Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
}

export default function TimelineDropdown({
  visible,
  tasks,
  onNavigate,
  onExpand,
  containerRef,
}: {
  visible: boolean;
  tasks: UpcomingTask[];
  onNavigate?: () => void;
  onExpand?: () => void;
  containerRef?: React.Ref<HTMLDivElement>;
}) {
  const colors = useThemeColors();
  const router = useRouter();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (!visible) return null;

  const today = new Date();
  const grid = buildMonthGrid(today);
  const monthLabel = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const todayKey = toKey(today);

  const tasksByDay = new Map<string, UpcomingTask[]>();
  for (const t of tasks) {
    const key = toKey(new Date(t.dueDate));
    const list = tasksByDay.get(key) || [];
    list.push(t);
    tasksByDay.set(key, list);
  }

  return (
    <div
      ref={containerRef}
      data-tf-dropdown
      style={{
        position: 'absolute',
        top: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 200,
        width: 340,
        maxHeight: 480,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 16,
        border: `1px solid ${colors.border}`,
        backgroundColor: colors.card,
        boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
        overflow: 'hidden',
        animation: 'tf-dropdown-in 120ms ease',
      }}
    >
      <style>{`
        @keyframes tf-dropdown-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-tf-dropdown] { animation: none !important; }
        }
      `}</style>

      {/* ── Mini month calendar ─────────────────────────────────────── */}
      <div onClick={() => onExpand?.()} style={{ padding: '12px 14px 8px', cursor: 'pointer' }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: colors.textMuted, marginBottom: 8, letterSpacing: 0.4 }}>
          {monthLabel}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 4 }}>
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} style={{ textAlign: 'center', fontSize: 9, fontWeight: 700, color: colors.textDim }}>{w}</div>
          ))}
          {grid.map((d) => {
            const key = toKey(d);
            const inMonth = d.getMonth() === today.getMonth();
            const isToday = key === todayKey;
            const dayTasks = tasksByDay.get(key) || [];
            const dots = dayTasks.slice(0, MAX_DOTS);
            const extra = dayTasks.length - dots.length;
            return (
              <div
                key={key}
                title={dayTasks.length ? dayTasks.map((t) => t.title).join('\n') : undefined}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  height: 30,
                  borderRadius: 8,
                  backgroundColor: isToday ? `${colors.primary}26` : 'transparent',
                  boxSizing: 'border-box',
                }}
              >
                <span style={{
                  fontSize: 11,
                  fontWeight: isToday ? 800 : 500,
                  color: isToday ? colors.primary : inMonth ? colors.textMain : colors.textDim,
                  opacity: inMonth ? 1 : 0.4,
                }}>
                  {d.getDate()}
                </span>
                {dots.length > 0 && (
                  <div style={{ display: 'flex', gap: 2, alignItems: 'center', height: 5 }}>
                    {dots.map((t) => (
                      <div key={t.id} style={{ width: 4, height: 4, borderRadius: 9999, backgroundColor: t.stageColor }} />
                    ))}
                    {extra > 0 && (
                      <span style={{ fontSize: 7, fontWeight: 800, color: colors.textDim, marginLeft: 1 }}>+{extra}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Task list ────────────────────────────────────────────────── */}
      <div style={{ borderTop: `1px solid ${colors.border}`, overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {tasks.length === 0 ? (
          <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: colors.textDim }}>
            No upcoming deadlines
          </div>
        ) : (
          tasks.map((t) => (
            <div
              key={t.id}
              onMouseEnter={() => setHoveredId(t.id)}
              onMouseLeave={() => setHoveredId((id) => (id === t.id ? null : id))}
              onClick={() => {
                onNavigate?.();
                router.push(`/task/${t.id}` as any);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 14px',
                cursor: 'pointer',
                backgroundColor: hoveredId === t.id ? colors.background : 'transparent',
              }}
            >
              <div style={{ width: 7, height: 7, borderRadius: 9999, flexShrink: 0, backgroundColor: t.stageColor }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12.5, fontWeight: 600, color: colors.textMain,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {t.title}
                </div>
                <div style={{
                  fontSize: 10.5, color: colors.textDim,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {t.pipelineName}
                </div>
              </div>
              <div style={{
                fontSize: 10.5, fontWeight: 700, flexShrink: 0,
                color: t.overdue ? colors.danger : colors.textDim,
              }}>
                {formatRelativeDue(t.dueDate, t.overdue)}
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <button
        onClick={() => onExpand?.()}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '10px 14px',
          border: 'none',
          borderTop: `1px solid ${colors.border}`,
          backgroundColor: 'transparent',
          color: colors.textMuted,
          fontSize: 11.5,
          fontWeight: 700,
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        <FontAwesome name="calendar" size={11} color={colors.textMuted} />
        Open calendar
      </button>
    </div>
  );
}
