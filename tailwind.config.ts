import type { Config } from "tailwindcss";

/**
 * APSIS design system.
 * A mission-control palette: near-black vacuum, instrument cyan, hazard amber,
 * and a single alert magenta reserved exclusively for active collision risk.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        vacuum: {
          DEFAULT: "#05070d",
          900: "#05070d",
          800: "#0a0e18",
          700: "#111726",
          600: "#1a2235",
          500: "#262f47",
        },
        instrument: {
          DEFAULT: "#4fd6ff",
          soft: "#7ee4ff",
          dim: "#2b7f99",
        },
        signal: {
          safe: "#43e08a",
          watch: "#ffc94d",
          hazard: "#ff8a3d",
          critical: "#ff3d71",
        },
        plasma: "#b06bff",
      },
      fontFamily: {
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        panel: "0 1px 0 rgba(255,255,255,0.04) inset, 0 0 0 1px rgba(79,214,255,0.08)",
        glow: "0 0 24px -4px rgba(79,214,255,0.45)",
        hazard: "0 0 28px -4px rgba(255,61,113,0.55)",
      },
      backgroundImage: {
        grid: "linear-gradient(rgba(79,214,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(79,214,255,0.06) 1px, transparent 1px)",
      },
      keyframes: {
        sweep: {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        pulseRing: {
          "0%": { transform: "scale(0.6)", opacity: "0.9" },
          "100%": { transform: "scale(2.2)", opacity: "0" },
        },
        flicker: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.65" },
        },
      },
      animation: {
        sweep: "sweep 4s linear infinite",
        pulseRing: "pulseRing 1.8s ease-out infinite",
        flicker: "flicker 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
