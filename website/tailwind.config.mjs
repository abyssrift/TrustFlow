/** @type {import('tailwindcss').Config} */
export default {
  // Dark-first/only site; the class variant stays wired for parity with the app.
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      // Token-driven only — no raw Tailwind palette classes (DESIGN_SPEC §2).
      colors: {
        bg: {
          base: 'rgba(var(--bg-base), <alpha-value>)',
          raised: 'rgba(var(--bg-raised), <alpha-value>)',
        },
        surface: {
          card: 'rgba(var(--surface-card), <alpha-value>)',
        },
        text: {
          main: 'rgba(var(--text-main), <alpha-value>)',
          muted: 'rgba(var(--text-muted), <alpha-value>)',
          dim: 'rgba(var(--text-dim), <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgba(var(--accent), <alpha-value>)',
          hover: 'rgba(var(--accent-hover), <alpha-value>)',
          violet: 'rgba(var(--accent-violet), <alpha-value>)',
        },
        'on-accent': 'rgba(var(--on-accent), <alpha-value>)',
        // White-alpha hairlines (§2) — fixed alpha, so declared directly.
        hairline: {
          DEFAULT: 'var(--border-hairline)',
          strong: 'var(--border-strong)',
        },
      },
      borderColor: {
        DEFAULT: 'var(--border-hairline)',
      },
      borderRadius: {
        card: 'var(--radius-card)',
        button: 'var(--radius-button)',
        input: 'var(--radius-input)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      // Type scale · §3. [size, { line-height, letter-spacing, weight }]
      fontSize: {
        eyebrow: ['0.8125rem', { lineHeight: '1', letterSpacing: '0.08em', fontWeight: '560' }],
        h1: ['clamp(2.5rem, 5.5vw, 4rem)', { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '620' }],
        h2: ['clamp(2rem, 4vw, 2.5rem)', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '620' }],
        h3: ['1.25rem', { lineHeight: '1.3', letterSpacing: '-0.01em', fontWeight: '560' }],
        body: ['1.0625rem', { lineHeight: '1.6' }],
        'body-lg': ['1.1875rem', { lineHeight: '1.6' }],
        caption: ['0.875rem', { lineHeight: '1.5' }],
      },
      fontWeight: {
        normal: '400',
        medium: '450',
        semibold: '560',
        bold: '620',
      },
      maxWidth: {
        content: '1120px', // §4 narrative column
        prose: '640px', // §4 text blocks
      },
    },
  },
  plugins: [],
};
