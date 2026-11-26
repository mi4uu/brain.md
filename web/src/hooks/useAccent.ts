import { useState } from "react";

export const ACCENTS = [
  { id: "ink", label: "Ink", light: "#2f5bb7", dark: "#8aaef0" },
  { id: "violet", label: "Violet", light: "#6e56cf", dark: "#9b87f5" },
  { id: "teal", label: "Teal", light: "#0f766e", dark: "#4fb8ac" },
  { id: "rust", label: "Rust", light: "#b4531f", dark: "#e39a67" },
  { id: "graphite", label: "Graphite", light: "#3a3a3f", dark: "#d6d6d9" },
] as const;

export type Accent = (typeof ACCENTS)[number]["id"];
const KEY = "brain.accent";
const DEFAULT: Accent = "ink";

function readStored(): Accent {
  try {
    const raw = localStorage.getItem(KEY);
    if (ACCENTS.some((a) => a.id === raw)) return raw as Accent;
  } catch {
    // ignore
  }
  return DEFAULT;
}

function apply(accent: Accent) {
  document.documentElement.setAttribute("data-accent", accent);
}

// Runs before React mounts so the first paint already has the right accent.
export function applyStoredAccent() {
  apply(readStored());
}

export function useAccent(): { accent: Accent; setAccent: (a: Accent) => void } {
  const [accent, setAccentState] = useState<Accent>(() => readStored());

  const setAccent = (a: Accent) => {
    try {
      localStorage.setItem(KEY, a);
    } catch {
      // ignore
    }
    apply(a);
    setAccentState(a);
  };

  return { accent, setAccent };
}
