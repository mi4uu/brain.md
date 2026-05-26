import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";
const KEY = "brain.theme";

function readStored(): Theme {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // ignore
  }
  return "system";
}

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void; resolved: "light" | "dark" } {
  const [theme, setThemeState] = useState<Theme>(() => readStored());
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    apply(theme);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function compute() {
      if (theme === "dark") return setResolved("dark");
      if (theme === "light") return setResolved("light");
      setResolved(mq.matches ? "dark" : "light");
    }
    compute();
    mq.addEventListener("change", compute);
    return () => mq.removeEventListener("change", compute);
  }, [theme]);

  const setTheme = (t: Theme) => {
    try {
      localStorage.setItem(KEY, t);
    } catch {
      // ignore
    }
    setThemeState(t);
  };

  return { theme, setTheme, resolved };
}
