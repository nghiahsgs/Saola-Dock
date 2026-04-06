import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore, BrowserProfile } from "../store/app-store";

// Deterministic color from profile id for avatar
const AVATAR_COLORS = [
  ["#6366f1", "#818cf8"], ["#8b5cf6", "#a78bfa"], ["#ec4899", "#f472b6"],
  ["#f43f5e", "#fb7185"], ["#f97316", "#fb923c"], ["#eab308", "#facc15"],
  ["#22c55e", "#4ade80"], ["#14b8a6", "#2dd4bf"], ["#06b6d4", "#22d3ee"],
  ["#3b82f6", "#60a5fa"],
];

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  const pair = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  return { from: pair[0], to: pair[1] };
}

function ProfileAvatar({ profile, size = 36 }: { profile: BrowserProfile; size?: number }) {
  const { from, to } = avatarColor(profile.name);
  const initials = profile.name.split(/[\s-]+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: 10, flexShrink: 0,
      background: `linear-gradient(135deg, ${from}, ${to})`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.36, fontWeight: 700, color: "#fff",
      letterSpacing: "-0.02em",
    }}>
      {initials}
    </div>
  );
}

const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  ready: { bg: "rgba(234,179,8,0.12)", text: "#d97706" },
  "new account": { bg: "rgba(34,197,94,0.12)", text: "#16a34a" },
  logged_in: { bg: "rgba(99,102,241,0.12)", text: "#818cf8" },
};

function tagStyle(tag: string) {
  return TAG_COLORS[tag.toLowerCase()] ?? { bg: "var(--accent-soft)", text: "var(--accent)" };
}

function TagPill({ tag }: { tag: string }) {
  const { bg, text } = tagStyle(tag);
  return (
    <span style={{
      background: bg, color: text,
      fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20,
      display: "inline-block", lineHeight: 1.4, letterSpacing: "0.01em",
      textTransform: "capitalize",
    }}>
      {tag}
    </span>
  );
}

type EditState = { name: string; tags: string };

export function BrowserProfilesPanel() {
  const profiles = useAppStore((s) => s.browserProfiles);
  const setProfiles = useAppStore((s) => s.setBrowserProfiles);
  const [launching, setLaunching] = useState<string | null>(null);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [ports, setPorts] = useState<Record<string, number>>({});
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newProfile, setNewProfile] = useState<EditState>({ name: "", tags: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ name: "", tags: "" });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleCopyPrompt = async (profile: BrowserProfile) => {
    try {
      let port = ports[profile.id];
      if (!port) {
        port = await invoke<number>("browser_profile_get_port", { id: profile.id });
        setPorts((prev) => ({ ...prev, [profile.id]: port }));
      }
      const prompt = `You have access to a running Chrome browser via HTTP API.

**Browser:** ${profile.name} (port ${port})
**Endpoint:** POST http://127.0.0.1:${port}/action
**Content-Type:** application/json

Available actions:
- \`{"action":"navigate","url":"https://example.com"}\` — Go to URL
- \`{"action":"click","selector":"#btn"}\` — Click element
- \`{"action":"type","selector":"input","value":"text"}\` — Type into input
- \`{"action":"screenshot"}\` — Take screenshot (returns base64 JPEG)
- \`{"action":"get_text","selector":"body"}\` — Get text content
- \`{"action":"get_html"}\` — Get page HTML (cleaned)
- \`{"action":"scroll","value":"500"}\` — Scroll down by pixels
- \`{"action":"wait","selector":".loading"}\` — Wait for element
- \`{"action":"wait","value":"2000"}\` — Wait ms
- \`{"action":"evaluate","value":"document.title"}\` — Run JS
- \`{"action":"current_url"}\` — Get current URL + title

The browser is visible (not headless) and operates on the user's active tab.`;

      await navigator.clipboard.writeText(prompt);
      setCopiedId(profile.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError("Failed to copy — browser not running?");
    }
  };

  useEffect(() => {
    invoke<BrowserProfile[]>("browser_profiles_list")
      .then((list) => {
        setProfiles(list);
        list.forEach((p) => {
          invoke<string>("browser_profile_get_path", { id: p.id })
            .then((path) => setPaths((prev) => ({ ...prev, [p.id]: path })))
            .catch(() => {});
          invoke<string>("browser_profile_connect_check", { id: p.id })
            .then(() => {
              setRunning((prev) => new Set(prev).add(p.id));
              invoke<number>("browser_profile_get_port", { id: p.id })
                .then((port) => setPorts((prev) => ({ ...prev, [p.id]: port })))
                .catch(() => {});
            })
            .catch(() => {});
        });
      })
      .catch(() => {});
  }, []);

  const reload = async () => {
    const list = await invoke<BrowserProfile[]>("browser_profiles_list");
    setProfiles(list);
    list.forEach((p) => {
      if (!paths[p.id]) {
        invoke<string>("browser_profile_get_path", { id: p.id })
          .then((path) => setPaths((prev) => ({ ...prev, [p.id]: path })))
          .catch(() => {});
      }
    });
  };

  const handleLaunch = async (id: string) => {
    setLaunching(id);
    setError(null);
    try {
      await invoke("browser_profile_launch", { id });
      setRunning((prev) => new Set(prev).add(id));
      invoke<number>("browser_profile_get_port", { id })
        .then((port) => setPorts((prev) => ({ ...prev, [id]: port })))
        .catch(() => {});
    } catch (e) {
      setError(String(e));
    } finally {
      setLaunching(null);
    }
  };

  const handleStop = async (id: string) => {
    try {
      await invoke("browser_profile_disconnect", { profileId: id });
      setRunning((prev) => { const s = new Set(prev); s.delete(id); return s; });
    } catch (e) {
      setError(String(e));
    }
  };

  const handleAdd = async () => {
    if (!newProfile.name.trim()) return;
    const tags = newProfile.tags.split(",").map((t) => t.trim()).filter(Boolean);
    await invoke("browser_profile_create", { name: newProfile.name.trim(), tags });
    setNewProfile({ name: "", tags: "" });
    setAdding(false);
    reload();
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId) return;
    await invoke("browser_profile_delete", { id: confirmDeleteId });
    setConfirmDeleteId(null);
    reload();
  };

  const startEdit = (p: BrowserProfile) => {
    setEditingId(p.id);
    setEditState({ name: p.name, tags: p.tags.join(", ") });
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const tags = editState.tags.split(",").map((t) => t.trim()).filter(Boolean);
    await invoke("browser_profile_update", { id: editingId, name: editState.name.trim(), tags });
    setEditingId(null);
    reload();
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--surface-elevated)",
    border: "1px solid var(--border-hairline)",
    borderRadius: 10, padding: "10px 14px",
    fontSize: 13, color: "var(--text-primary)", outline: "none",
    transition: "box-shadow 0.15s ease, border-color 0.15s ease",
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: `var(--app-bg-gradient), var(--app-bg)`,
    }}>
      {/* Header section */}
      <div style={{ padding: "28px 32px 20px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <h1 style={{
              fontSize: 20, fontWeight: 700, color: "var(--text-primary)",
              letterSpacing: "-0.025em", margin: 0, lineHeight: 1.2,
            }}>
              Browser Profiles
            </h1>
            <p style={{
              fontSize: 13, color: "var(--text-tertiary)", marginTop: 4,
              fontWeight: 400,
            }}>
              Manage your Chromium profiles and sessions
            </p>
          </div>
          <button
            onClick={() => setAdding(true)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 13, fontWeight: 600, color: "#fff",
              background: "var(--accent-gradient)",
              border: "none", borderRadius: 10, padding: "9px 18px",
              cursor: "pointer", boxShadow: "0 2px 8px rgba(99,102,241,0.25)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 4px 16px rgba(99,102,241,0.35)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(99,102,241,0.25)"; }}
          >
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Profile
          </button>
        </div>
      </div>

      {/* Add profile form */}
      {adding && (
        <div style={{
          margin: "0 32px 16px", padding: 20,
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
          borderRadius: 14, boxShadow: "var(--card-shadow)",
          backdropFilter: "var(--backdrop)",
          display: "flex", flexDirection: "column", gap: 12,
          animation: "slide-up 0.2s ease",
        }}>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              autoFocus
              placeholder="Profile name (e.g. Google - Bobby D)"
              value={newProfile.name}
              onChange={(e) => setNewProfile((s) => ({ ...s, name: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setAdding(false); }}
              style={{ ...inputStyle, flex: 2 }}
              onFocus={(e) => { e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-glow)"; e.currentTarget.style.borderColor = "var(--accent)"; }}
              onBlur={(e) => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.borderColor = "var(--border-hairline)"; }}
            />
            <input
              placeholder="Tags (comma separated)"
              value={newProfile.tags}
              onChange={(e) => setNewProfile((s) => ({ ...s, tags: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setAdding(false); }}
              style={{ ...inputStyle, flex: 1 }}
              onFocus={(e) => { e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-glow)"; e.currentTarget.style.borderColor = "var(--accent)"; }}
              onBlur={(e) => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.borderColor = "var(--border-hairline)"; }}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleAdd}
              disabled={!newProfile.name.trim()}
              style={{
                padding: "9px 22px", borderRadius: 10,
                background: "var(--accent-gradient)", color: "#fff",
                border: "none", fontSize: 13, fontWeight: 600,
                cursor: newProfile.name.trim() ? "pointer" : "not-allowed",
                opacity: newProfile.name.trim() ? 1 : 0.4,
              }}
            >
              Create Profile
            </button>
            <button
              onClick={() => setAdding(false)}
              style={{
                padding: "9px 16px", borderRadius: 10,
                background: "transparent", color: "var(--text-tertiary)",
                border: "1px solid var(--border-hairline)",
                fontSize: 13, cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div style={{
          margin: "0 32px 12px", padding: "12px 16px",
          background: "var(--error-muted)", borderRadius: 10,
          border: "1px solid rgba(239,68,68,0.15)",
          display: "flex", alignItems: "center", gap: 10,
          animation: "fade-in 0.2s ease",
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--error)", flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: "var(--error)", flex: 1 }}>{error}</span>
          <button onClick={() => setError(null)} style={{
            background: "none", border: "none", color: "var(--error)",
            cursor: "pointer", padding: "2px 4px", borderRadius: 4,
          }}>
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Profile list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 32px 32px" }}>
        {profiles.length === 0 && !adding && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", height: "100%", gap: 16,
            animation: "fade-in 0.3s ease",
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: 16,
              background: "var(--card-bg)", border: "1px solid var(--card-border)",
              boxShadow: "var(--card-shadow)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth={1.2}>
                <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
              </svg>
            </div>
            <div style={{ textAlign: "center" }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                No profiles yet
              </p>
              <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 260 }}>
                Create your first browser profile to get started
              </p>
            </div>
            <button
              onClick={() => setAdding(true)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 13, fontWeight: 600, color: "#fff",
                background: "var(--accent-gradient)",
                border: "none", borderRadius: 10, padding: "10px 22px",
                cursor: "pointer", boxShadow: "0 2px 8px rgba(99,102,241,0.25)",
                marginTop: 4,
              }}
            >
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Profile
            </button>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {profiles.map((profile, idx) => {
            const isRunning = running.has(profile.id);
            const isEditing = editingId === profile.id;
            return (
              <div
                key={profile.id}
                style={{
                  background: "var(--card-bg)",
                  border: "1px solid var(--card-border)",
                  borderRadius: 14, padding: 16,
                  boxShadow: "var(--card-shadow)",
                  backdropFilter: "var(--backdrop)",
                  transition: "all 0.2s ease",
                  animation: `slide-up 0.25s ease ${idx * 0.04}s both`,
                }}
                onMouseEnter={(e) => {
                  if (!isEditing) {
                    e.currentTarget.style.background = "var(--card-hover)";
                    e.currentTarget.style.boxShadow = "var(--card-shadow-hover)";
                    e.currentTarget.style.transform = "translateY(-1px)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isEditing) {
                    e.currentTarget.style.background = "var(--card-bg)";
                    e.currentTarget.style.boxShadow = "var(--card-shadow)";
                    e.currentTarget.style.transform = "translateY(0)";
                  }
                }}
              >
                {isEditing ? (
                  /* Edit mode */
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      autoFocus
                      value={editState.name}
                      onChange={(e) => setEditState((s) => ({ ...s, name: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(); if (e.key === "Escape") setEditingId(null); }}
                      style={{ ...inputStyle, flex: 1, padding: "8px 12px" }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-hairline)"; }}
                    />
                    <input
                      value={editState.tags}
                      onChange={(e) => setEditState((s) => ({ ...s, tags: e.target.value }))}
                      placeholder="tags"
                      onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(); if (e.key === "Escape") setEditingId(null); }}
                      style={{ ...inputStyle, flex: 1, padding: "8px 12px", fontSize: 12 }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-hairline)"; }}
                    />
                    <button onClick={handleSaveEdit} style={{
                      background: "var(--accent-gradient)", color: "#fff", border: "none",
                      borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                    }}>Save</button>
                    <button onClick={() => setEditingId(null)} style={{
                      background: "transparent", border: "1px solid var(--border-hairline)",
                      color: "var(--text-tertiary)", borderRadius: 8, padding: "7px 12px",
                      cursor: "pointer", fontSize: 12,
                    }}>Cancel</button>
                  </div>
                ) : (
                  /* Display mode */
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      {/* Avatar */}
                      <div style={{ position: "relative" }}>
                        <ProfileAvatar profile={profile} />
                        {isRunning && (
                          <span style={{
                            position: "absolute", bottom: -2, right: -2,
                            width: 10, height: 10, borderRadius: "50%",
                            background: "var(--success)",
                            border: "2px solid var(--app-bg)",
                            animation: "pulse-dot 2s ease-in-out infinite",
                          }} />
                        )}
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{
                            fontSize: 14, fontWeight: 600, color: "var(--text-primary)",
                            letterSpacing: "-0.01em",
                          }}>
                            {profile.name}
                          </span>
                          {isRunning && (
                            <span style={{
                              fontSize: 10, fontWeight: 600, color: "var(--success)",
                              background: "var(--success-muted)",
                              padding: "1px 7px", borderRadius: 20,
                            }}>
                              Running
                            </span>
                          )}
                          {profile.tags.map((tag) => <TagPill key={tag} tag={tag} />)}
                        </div>
                        {paths[profile.id] && (
                          <span style={{
                            fontSize: 11, color: "var(--text-muted)", marginTop: 3,
                            display: "block", overflow: "hidden", textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                          }}>
                            {paths[profile.id]}
                          </span>
                        )}
                      </div>

                      {/* Actions */}
                      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                        {isRunning && (
                          <IconButton
                            onClick={() => handleCopyPrompt(profile)}
                            title="Copy automation prompt"
                            active={copiedId === profile.id}
                          >
                            {copiedId === profile.id ? (
                              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth={2.5} strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                            ) : (
                              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                            )}
                          </IconButton>
                        )}
                        <IconButton onClick={() => startEdit(profile)} title="Edit">
                          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </IconButton>

                        <IconButton onClick={() => setConfirmDeleteId(profile.id)} title="Delete" danger>
                          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          </svg>
                        </IconButton>

                        {/* Primary Run/Stop */}
                        <button
                          onClick={() => isRunning ? handleStop(profile.id) : handleLaunch(profile.id)}
                          disabled={launching === profile.id}
                          style={{
                            padding: "7px 18px", borderRadius: 8, marginLeft: 6,
                            fontSize: 12, fontWeight: 600,
                            background: launching === profile.id
                              ? "var(--surface-hover)"
                              : isRunning
                                ? "var(--error-muted)"
                                : "var(--accent-gradient)",
                            color: launching === profile.id
                              ? "var(--text-tertiary)"
                              : isRunning
                                ? "var(--error)"
                                : "#fff",
                            border: isRunning ? "1px solid rgba(239,68,68,0.2)" : "none",
                            cursor: launching === profile.id ? "default" : "pointer",
                            boxShadow: !isRunning && launching !== profile.id
                              ? "0 2px 6px rgba(99,102,241,0.2)" : "none",
                          }}
                        >
                          {launching === profile.id ? "Starting..." : isRunning ? "Stop" : "Run"}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      {profiles.length > 0 && (
        <div style={{
          padding: "10px 32px", fontSize: 11, color: "var(--text-muted)",
          borderTop: "1px solid var(--border-subtle)",
          background: "var(--surface-base)",
          backdropFilter: "var(--backdrop)",
          letterSpacing: "0.01em",
        }}>
          Click <strong style={{ color: "var(--text-tertiary)", fontWeight: 600 }}>Run</strong> to launch Chromium with a saved profile. Login manually, then close to persist session.
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDeleteId && (
        <div
          onClick={() => setConfirmDeleteId(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(8px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "fade-in 0.15s ease",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface-elevated)",
              border: "1px solid var(--border-hairline)",
              borderRadius: 16, padding: 24,
              width: 360, maxWidth: "90vw",
              boxShadow: "0 16px 48px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.03) inset",
              animation: "slide-up 0.2s ease",
            }}
          >
            {/* Icon */}
            <div style={{
              width: 44, height: 44, borderRadius: 12, marginBottom: 16,
              background: "var(--error-muted)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth={1.5} strokeLinecap="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </div>

            {/* Text */}
            <h3 style={{
              fontSize: 16, fontWeight: 700, color: "var(--text-primary)",
              marginBottom: 6, letterSpacing: "-0.02em",
            }}>
              Delete Profile
            </h3>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 6 }}>
              Are you sure you want to delete{" "}
              <strong style={{ color: "var(--text-primary)" }}>
                {profiles.find(p => p.id === confirmDeleteId)?.name}
              </strong>
              ?
            </p>
            <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 20 }}>
              This will permanently remove the profile and all its browser data (cookies, cache, sessions).
            </p>

            {/* Buttons */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setConfirmDeleteId(null)}
                style={{
                  padding: "9px 18px", borderRadius: 10,
                  background: "transparent", color: "var(--text-secondary)",
                  border: "1px solid var(--border-hairline)",
                  fontSize: 13, fontWeight: 500, cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                style={{
                  padding: "9px 18px", borderRadius: 10,
                  background: "var(--error)", color: "#fff",
                  border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer",
                  boxShadow: "0 2px 8px rgba(239,68,68,0.3)",
                }}
              >
                Delete Profile
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* Reusable icon button */
function IconButton({ children, onClick, title, danger, active }: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 30, height: 30, borderRadius: 8,
        background: "transparent",
        border: "1px solid transparent",
        color: active ? "var(--success)" : "var(--text-tertiary)",
        cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.15s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? "var(--error-muted)" : "var(--surface-hover)";
        e.currentTarget.style.borderColor = danger ? "rgba(239,68,68,0.15)" : "var(--border-hairline)";
        e.currentTarget.style.color = danger ? "var(--error)" : "var(--text-secondary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderColor = "transparent";
        e.currentTarget.style.color = active ? "var(--success)" : "var(--text-tertiary)";
      }}
    >
      {children}
    </button>
  );
}
