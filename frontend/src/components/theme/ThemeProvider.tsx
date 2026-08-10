"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type Theme = "dawn" | "day" | "night";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("day");

  useEffect(() => {
    const syncTheme = window.setTimeout(() => {
      const active = document.documentElement.dataset.theme;
      setThemeState(active === "dawn" || active === "night" ? active : "day");
    }, 0);
    return () => window.clearTimeout(syncTheme);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme(nextTheme) {
        document.documentElement.dataset.theme = nextTheme;
        localStorage.setItem("flowlink-theme", nextTheme);
        setThemeState(nextTheme);
      },
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
