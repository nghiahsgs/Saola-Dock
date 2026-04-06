import { BrowserProfilesPanel } from "./components/browser-profiles-panel";
import { useAppStore, Theme } from "./store/app-store";

function ThemeToggle() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  const cycle: Record<Theme, Theme> = { light: "dark", dark: "system", system: "light" };

  const icons: Record<Theme, React.ReactNode> = {
    light: (
      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
        <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </svg>
    ),
    dark: (
      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
        <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
      </svg>
    ),
    system: (
      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
        <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  };

  return (
    <button
      onClick={() => setTheme(cycle[theme])}
      title={`Theme: ${theme}`}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 30, height: 30, borderRadius: 8,
        background: "transparent", border: "none",
        color: "var(--text-tertiary)", cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--surface-hover)";
        e.currentTarget.style.color = "var(--text-secondary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--text-tertiary)";
      }}
    >
      {icons[theme]}
    </button>
  );
}

export default function App() {
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "100vh",
      background: `var(--app-bg-gradient), var(--app-bg)`,
    }}>
      {/* Title bar — frosted glass */}
      <div
        data-tauri-drag-region
        style={{
          display: "flex", alignItems: "center",
          height: 44, userSelect: "none",
          padding: "0 16px",
          background: "var(--surface-base)",
          backdropFilter: "var(--backdrop)",
          WebkitBackdropFilter: "var(--backdrop)",
          borderBottom: "1px solid var(--border-hairline)",
          flexShrink: 0,
        }}
      >
        <div style={{ width: 72, flexShrink: 0 }} />
        <span style={{
          fontSize: 13, fontWeight: 600,
          color: "var(--text-secondary)",
          letterSpacing: "-0.01em",
        }}>
          Saola Dock
        </span>
        <div style={{ flex: 1 }} />
        <ThemeToggle />
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <BrowserProfilesPanel />
      </div>
    </div>
  );
}
