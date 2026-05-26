import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: "var(--bg-app)",
        surface: {
          DEFAULT: "var(--bg-surface)",
          alt: "var(--bg-surface-2)",
          elev: "var(--bg-elev)",
        },
        hover: "var(--bg-hover)",
        active: "var(--bg-active)",
        selected: "var(--bg-selected)",
        border: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
        },
        fg: {
          1: "var(--text-1)",
          2: "var(--text-2)",
          3: "var(--text-3)",
          4: "var(--text-4)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          strong: "var(--accent-strong)",
          soft: "var(--accent-soft)",
        },
        link: {
          DEFAULT: "var(--link)",
          broken: "var(--link-broken)",
        },
        code: "var(--code-bg)",
        tag: {
          DEFAULT: "var(--tag-bg)",
          fg: "var(--tag-fg)",
        },
        callout: {
          note: "var(--callout-note)",
          warn: "var(--callout-warn)",
          danger: "var(--callout-danger)",
          tip: "var(--callout-tip)",
          info: "var(--callout-info)",
        },
      },
      borderRadius: {
        1: "var(--radius-1)",
        2: "var(--radius-2)",
        3: "var(--radius-3)",
      },
      fontFamily: {
        sans: "var(--font-sans)",
        mono: "var(--font-mono)",
        serif: "var(--font-serif)",
      },
      fontSize: {
        xs: "var(--text-xs)",
        sm: "var(--text-sm)",
        base: "var(--text-base)",
        md: "var(--text-md)",
        lg: "var(--text-lg)",
        xl: "var(--text-xl)",
        "2xl": "var(--text-2xl)",
      },
      spacing: {
        1: "var(--space-1)",
        2: "var(--space-2)",
        3: "var(--space-3)",
        4: "var(--space-4)",
        5: "var(--space-5)",
        6: "var(--space-6)",
        7: "var(--space-7)",
        tap: "var(--tap)",
      },
      boxShadow: {
        1: "var(--shadow-1)",
        2: "var(--shadow-2)",
      },
      zIndex: {
        drawer: "var(--z-drawer)",
        modal: "var(--z-modal)",
        toast: "var(--z-toast)",
      },
      transitionTimingFunction: {
        out: "var(--ease)",
      },
      transitionDuration: {
        fast: "var(--dur-fast)",
        base: "var(--dur-base)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-out": {
          from: { opacity: "1" },
          to: { opacity: "0" },
        },
        "slide-in-from-top": {
          from: { transform: "translateY(-4px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        "slide-in-from-bottom": {
          from: { transform: "translateY(4px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        "slide-in-from-left": {
          from: { transform: "translateX(-4px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        "slide-in-from-right": {
          from: { transform: "translateX(4px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        "zoom-in": {
          from: { transform: "scale(0.96)", opacity: "0" },
          to: { transform: "scale(1)", opacity: "1" },
        },
        "zoom-out": {
          from: { transform: "scale(1)", opacity: "1" },
          to: { transform: "scale(0.96)", opacity: "0" },
        },
      },
      animation: {
        "fade-in": "fade-in var(--dur-fast) var(--ease)",
        "fade-out": "fade-out var(--dur-fast) var(--ease)",
        "slide-in-top": "slide-in-from-top var(--dur-fast) var(--ease)",
        "slide-in-bottom": "slide-in-from-bottom var(--dur-fast) var(--ease)",
        "slide-in-left": "slide-in-from-left var(--dur-fast) var(--ease)",
        "slide-in-right": "slide-in-from-right var(--dur-fast) var(--ease)",
        "zoom-in": "zoom-in var(--dur-fast) var(--ease)",
        "zoom-out": "zoom-out var(--dur-fast) var(--ease)",
      },
    },
  },
  plugins: [animate],
};

export default config;
