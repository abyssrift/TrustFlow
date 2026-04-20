/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "rgb(var(--brand-primary) / <alpha-value>)",
          secondary: "rgb(var(--brand-secondary) / <alpha-value>)",
          accent: "rgb(var(--brand-accent) / <alpha-value>)",
          danger: "rgb(var(--brand-danger) / <alpha-value>)",
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
        }
      }
    },
  },
  plugins: [],
};
