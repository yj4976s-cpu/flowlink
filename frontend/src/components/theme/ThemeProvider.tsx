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
    const root = document.documentElement;
    const syncTheme = () => {
      const active = document.documentElement.dataset.theme;
      setThemeState(active === "dawn" || active === "night" ? active : "day");
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
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
