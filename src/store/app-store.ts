import { create } from "zustand";

export interface BrowserProfile {
  id: string;
  name: string;
  tags: string[];
}

export type Theme = "light" | "dark" | "system";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialTheme(): Theme {
  return (localStorage.getItem("saola-theme") as Theme) || "system";
}

function applyTheme(theme: Theme) {
  const resolved = theme === "system" ? getSystemTheme() : theme;
  document.documentElement.setAttribute("data-theme", resolved);
  localStorage.setItem("saola-theme", theme);
}

interface AppState {
  browserProfiles: BrowserProfile[];
  setBrowserProfiles: (profiles: BrowserProfile[]) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useAppStore = create<AppState>((set) => {
  const initial = getInitialTheme();
  applyTheme(initial);

  // Listen for system theme changes
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const current = useAppStore.getState().theme;
    if (current === "system") applyTheme("system");
  });

  return {
    browserProfiles: [],
    setBrowserProfiles: (profiles) => set({ browserProfiles: profiles }),
    theme: initial,
    setTheme: (theme) => {
      applyTheme(theme);
      set({ theme });
    },
  };
});
