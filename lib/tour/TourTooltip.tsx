import React from 'react';

type Colors = { card: string; border: string; textMain: string; textMuted: string; primary: string };

export default function TourTooltip({
  title,
  body,
  index,
  total,
  isFirst,
  isLast,
  onBack,
  onNext,
  onSkip,
  colors,
}: {
  title?: string;
  body: string;
  index: number;
  total: number;
  isFirst: boolean;
  isLast: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  colors: Colors;
}) {
  return (
    <div
      role="dialog"
      style={{
        maxWidth: 280,
        backgroundColor: colors.card,
        color: colors.textMain,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: '14px 16px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 13,
        lineHeight: '19px',
        boxShadow: '0 6px 24px rgba(0,0,0,0.32)',
        zIndex: 10001,
      }}
    >
      {title && <div style={{ fontWeight: 800, marginBottom: 6 }}>{title}</div>}
      <div style={{ opacity: 0.85, marginBottom: 12 }}>{body}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          type="button"
          onClick={onBack}
          disabled={isFirst}
          style={{
            background: 'none',
            border: `1px solid ${colors.border}`,
            color: colors.textMain,
            borderRadius: 6,
            padding: '4px 10px',
            cursor: isFirst ? 'default' : 'pointer',
            opacity: isFirst ? 0.3 : 0.85,
            fontSize: 12,
          }}
        >
          Back
        </button>
        <span style={{ fontSize: 11, opacity: 0.5 }}>{index + 1} / {total}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={onSkip}
            style={{ background: 'none', border: 'none', color: colors.textMuted, fontSize: 11, opacity: 0.6, cursor: 'pointer' }}
          >
            Skip
          </button>
          <button
            type="button"
            onClick={onNext}
            style={{
              background: colors.primary,
              border: 'none',
              color: '#fff',
              borderRadius: 6,
              padding: '4px 12px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
