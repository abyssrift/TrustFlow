/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "rgba(var(--brand-primary), <alpha-value>)",
          "primary-hover": "rgba(var(--brand-primary-hover), <alpha-value>)",
          "primary-active": "rgba(var(--brand-primary-active), <alpha-value>)",
          "primary-dim": "rgba(var(--brand-primary), 0.1)",
          secondary: "rgba(var(--brand-secondary), <alpha-value>)",
          "secondary-dim": "rgba(var(--brand-secondary), 0.1)",
          accent: "rgba(var(--brand-accent), <alpha-value>)",
          "accent-dim": "rgba(var(--brand-accent), 0.1)",
          danger: "rgba(var(--brand-danger), <alpha-value>)",
          "danger-dim": "rgba(var(--brand-danger), 0.1)",
          "on-primary": "var(--color-on-primary)",
        },
        surface: {
          background: "rgba(var(--surface-background), <alpha-value>)",
          card: "rgba(var(--surface-card), <alpha-value>)",
          overlay: "rgba(var(--surface-overlay), <alpha-value>)",
          border: "rgba(var(--surface-border), <alpha-value>)",
          glass: "rgba(var(--surface-glass), <alpha-value>)",
        },
        typography: {
          main: "rgba(var(--text-main), <alpha-value>)",
          muted: "rgba(var(--text-muted), <alpha-value>)",
          label: "rgba(var(--text-label), <alpha-value>)",
          dim: "rgba(var(--text-dim), <alpha-value>)",
        },
        state: {
          success: "rgba(var(--state-success), <alpha-value>)",
          "success-dim": "rgba(var(--state-success), 0.1)",
          warning: "rgba(var(--state-warning), <alpha-value>)",
          "warning-dim": "rgba(var(--state-warning), 0.1)",
          danger: "rgba(var(--state-danger), <alpha-value>)",
          "danger-dim": "rgba(var(--state-danger), 0.1)",
          info: "rgba(var(--state-info), <alpha-value>)",
          "info-dim": "rgba(var(--state-info), 0.1)",
        },
        icon: {
          primary: "rgba(var(--icon-primary), <alpha-value>)",
          muted: "rgba(var(--icon-muted), <alpha-value>)",
          accent: "rgba(var(--icon-accent), <alpha-value>)",
        }
      },
      borderRadius: {
        "2xl": "var(--radius-base)",
        "xl": "var(--radius-button)",
        "lg": "var(--radius-input)",
      }
    }
  },
  plugins: [],
};
