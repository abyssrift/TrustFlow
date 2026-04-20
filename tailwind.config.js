/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "rgb(var(--brand-primary) / <alpha-value>)",
          "primary-hover": "rgb(var(--brand-primary-hover) / <alpha-value>)",
          "primary-active": "rgb(var(--brand-primary-active) / <alpha-value>)",
          "primary-dim": "rgb(var(--brand-primary-dim))",
          secondary: "rgb(var(--brand-secondary) / <alpha-value>)",
          "secondary-dim": "rgb(var(--brand-secondary-dim))",
          accent: "rgb(var(--brand-accent) / <alpha-value>)",
          "accent-dim": "rgb(var(--brand-accent-dim))",
          danger: "rgb(var(--brand-danger) / <alpha-value>)",
          "danger-dim": "rgb(var(--brand-danger-dim))",
        },
        surface: {
          background: "rgb(var(--surface-background) / <alpha-value>)",
          card: "rgb(var(--surface-card) / <alpha-value>)",
          overlay: "rgb(var(--surface-overlay) / <alpha-value>)",
          border: "rgb(var(--surface-border) / <alpha-value>)",
          glass: "rgb(var(--surface-glass) / <alpha-value>)",
        },
        typography: {
          main: "rgb(var(--text-main) / <alpha-value>)",
          muted: "rgb(var(--text-muted) / <alpha-value>)",
          label: "rgb(var(--text-label) / <alpha-value>)",
          dim: "rgb(var(--text-dim) / <alpha-value>)",
        },
        state: {
          success: "rgb(var(--state-success) / <alpha-value>)",
          "success-dim": "rgb(var(--state-success-dim))",
          warning: "rgb(var(--state-warning) / <alpha-value>)",
          "warning-dim": "rgb(var(--state-warning-dim))",
          danger: "rgb(var(--state-danger) / <alpha-value>)",
          "danger-dim": "rgb(var(--state-danger-dim))",
          info: "rgb(var(--state-info) / <alpha-value>)",
          "info-dim": "rgb(var(--state-info-dim))",
        }
      }
    },
  },
  plugins: [],
};
