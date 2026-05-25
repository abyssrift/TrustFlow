type NativePalette = {
  primary: string;
  secondary: string;
  accent: string;
  muted: string;
  background: string;
  card: string;
  border: string;
  textMain: string;
  textMuted: string;
  textDim: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
};

const VAR_TO_PALETTE_KEY: Record<string, keyof NativePalette> = {
  '--brand-primary': 'primary',
  '--brand-secondary': 'secondary',
  '--brand-accent': 'accent',
  '--surface-background': 'background',
  '--surface-card': 'card',
  '--surface-border': 'border',
  '--surface-overlay': 'border',
  '--text-main': 'textMain',
  '--text-muted': 'textMuted',
  '--text-dim': 'textDim',
  '--state-success': 'success',
  '--state-warning': 'warning',
  '--state-danger': 'danger',
  '--state-info': 'info',

  '--color-primary': 'primary',
  '--color-secondary': 'secondary',
  '--color-accent': 'accent',
  '--color-brand-primary': 'primary',
  '--color-brand-secondary': 'secondary',
  '--color-brand-accent': 'accent',
  '--color-brand-on-primary': 'textMain',
  '--color-background': 'background',
  '--color-card': 'card',
  '--color-border': 'border',
  '--color-surface-border': 'border',
  '--color-surface-overlay': 'border',
  '--color-text-main': 'textMain',
  '--color-text-muted': 'textMuted',
  '--color-text-dim': 'textDim',
  '--color-success': 'success',
  '--color-warning': 'warning',
  '--color-danger': 'danger',
  '--color-info': 'info',
  '--color-state-success': 'success',
  '--color-state-warning': 'warning',
  '--color-state-danger': 'danger',
  '--color-state-info': 'info',
};

export function resolveNativeColorToken(value: string | undefined | null, palette: NativePalette): string {
  if (!value) return palette.textDim;

  const normalized = value.trim();
  if (!normalized) return palette.textDim;

  // Already concrete color values that React Native can render.
  if (
    normalized.startsWith('#') ||
    (normalized.startsWith('rgb(') && !normalized.includes('var(')) ||
    (normalized.startsWith('rgba(') && !normalized.includes('var(')) ||
    (normalized.startsWith('hsl(') && !normalized.includes('var(')) ||
    (normalized.startsWith('hsla(') && !normalized.includes('var('))
  ) {
    return normalized;
  }

  const varMatch = normalized.match(/--[a-z0-9-]+/i);
  if (varMatch) {
    const key = VAR_TO_PALETTE_KEY[varMatch[0].toLowerCase()];
    if (key) return palette[key];
  }

  return normalized;
}
