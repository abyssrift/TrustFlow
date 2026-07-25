/** @type {import('tailwindcss').Config} */
export default {
  // Dark-first/only site; the class variant stays wired for parity with the app.
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      // Token-driven only — no raw Tailwind palette classes.
      colors: {
        bg: {
          base: 'rgba(var(--bg-base), <alpha-value>)',
        },
        surface: {
          card: 'rgba(var(--surface-card), <alpha-value>)',
          elevated: 'rgba(var(--surface-elevated), <alpha-value>)',
        },
        text: {
          heading: 'rgba(var(--text-heading), <alpha-value>)',
          main: 'rgba(var(--text-main), <alpha-value>)',
          muted: 'rgba(var(--text-muted), <alpha-value>)',
          subtle: 'rgba(var(--text-subtle), <alpha-value>)',
          dim: 'rgba(var(--text-dim), <alpha-value>)',
          faint: 'rgba(var(--text-faint), <alpha-value>)',
        },
        link: {
          DEFAULT: 'rgba(var(--link), <alpha-value>)',
          hover: 'rgba(var(--link-hover), <alpha-value>)',
        },
        'cta-arrow': 'rgba(var(--cta-arrow), <alpha-value>)',
        'accent-green': 'rgba(var(--accent-green), <alpha-value>)',
        'on-accent': 'rgba(var(--on-accent), <alpha-value>)',
        // White-alpha hairlines — fixed alpha, so declared directly.
        hairline: {
          DEFAULT: 'var(--border-hairline)',
          strong: 'var(--border-strong)',
          emphasis: 'var(--border-emphasis)',
        },
      },
      borderColor: {
        DEFAULT: 'var(--border-hairline)',
      },
      borderRadius: {
        card: 'var(--radius-card)',
        button: 'var(--radius-button)',
        pill: 'var(--radius-pill)',
        input: 'var(--radius-button)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        heading: ['var(--font-heading)'],
        mono: ['var(--font-mono)'],
      },
      // Type scale, per the handoff spec.
      fontSize: {
        eyebrow: ['0.75rem', { lineHeight: '1', letterSpacing: '0.08em', fontWeight: '700' }],
        h1: ['clamp(2rem, 3.6vw, 2.75rem)', { lineHeight: '1.12', letterSpacing: '-0.02em', fontWeight: '800' }],
        h2: ['clamp(1.75rem, 3.4vw, 2.375rem)', { lineHeight: '1.25', letterSpacing: '-0.01em', fontWeight: '700' }],
        h3: ['1.75rem', { lineHeight: '1.3', letterSpacing: '-0.01em', fontWeight: '700' }],
        body: ['1rem', { lineHeight: '1.65' }],
        'body-lg': ['1.03125rem', { lineHeight: '1.65' }],
        caption: ['0.875rem', { lineHeight: '1.5' }],
      },
      maxWidth: {
        content: '1200px',
        prose: '620px',
      },
      transitionTimingFunction: {
        spring: 'var(--ease-spring)',
      },
    },
  },
  plugins: [],
};
