/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: 'rgba(var(--brand-primary), <alpha-value>)',
          'primary-hover': 'rgba(var(--brand-primary-hover), <alpha-value>)',
          'primary-active': 'rgba(var(--brand-primary-active), <alpha-value>)',
          'on-primary': 'var(--color-on-primary)',
        },
        surface: {
          background: 'rgba(var(--surface-background), <alpha-value>)',
          card: 'rgba(var(--surface-card), <alpha-value>)',
          border: 'rgba(var(--surface-border), <alpha-value>)',
        },
        typography: {
          main: 'rgba(var(--text-main), <alpha-value>)',
          muted: 'rgba(var(--text-muted), <alpha-value>)',
          dim: 'rgba(var(--text-dim), <alpha-value>)',
        },
      },
      borderRadius: {
        '2xl': 'var(--radius-base)',
        xl: 'var(--radius-button)',
        lg: 'var(--radius-input)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
      },
      maxWidth: {
        content: '1200px',
      },
    },
  },
  plugins: [],
};
