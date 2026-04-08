use serde::{Deserialize, Serialize};
use std::io::BufRead;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserProfile {
    pub id: String,
    pub name: String,
    pub tags: Vec<String>,
}

static ACTIVE_PORT: std::sync::LazyLock<std::sync::Mutex<Option<u16>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(None));

static ACTIVE_PROFILE_ID: std::sync::LazyLock<std::sync::Mutex<Option<String>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(None));

// --- Paths ---

fn profiles_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home)
        .join(".saola-dock")
        .join("browser-profiles")
        .join("profiles.json")
}

fn user_data_dir(id: &str) -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home)
        .join(".saola-dock")
        .join("browser-profiles")
        .join(id)
}

fn server_state_file(id: &str) -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home)
        .join(".saola-dock")
        .join("browser-profiles")
        .join(format!(".server-{}.json", id))
}

/// Find scripts/browser-server.js relative to the executable.
fn find_browser_server_js() -> Option<String> {
    let exe_path = std::env::current_exe().ok()?;
    let exe_dir = exe_path.parent()?;

    let candidates = vec![
        // Dev mode: exe is at src-tauri/target/debug/ -> go up 3 to project root
        exe_dir.join("../../../scripts/browser-server.js"),
        // macOS .app bundle
        exe_dir.join("../Resources/scripts/browser-server.js"),
        // Portable / Linux
        exe_dir.join("scripts/browser-server.js"),
        // CWD fallback
        PathBuf::from("scripts/browser-server.js"),
    ];

    for path in candidates {
        if let Ok(canonical) = path.canonicalize() {
            if canonical.exists() {
                return Some(canonical.to_string_lossy().to_string());
            }
        }
    }
    None
}

/// Find node binary — handles NVM, homebrew, and system paths
fn find_node_binary() -> String {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());

    if let Ok(out) = std::process::Command::new("sh")
        .args(["-c", "which node 2>/dev/null || command -v node 2>/dev/null"])
        .output()
    {
        let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !path.is_empty() && PathBuf::from(&path).exists() {
            return path;
        }
    }

    let candidates = vec![
        format!("{}/.volta/bin/node", home),
        "/opt/homebrew/bin/node".to_string(),
        "/usr/local/bin/node".to_string(),
        "/usr/bin/node".to_string(),
    ];

    for path in &candidates {
        if PathBuf::from(path).exists() {
            return path.clone();
        }
    }

    // Try NVM glob
    let nvm_base = PathBuf::from(&home).join(".nvm/versions/node");
    if nvm_base.exists() {
        if let Ok(entries) = std::fs::read_dir(&nvm_base) {
            let mut versions: Vec<_> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            versions.sort_by(|a, b| b.cmp(a));
            for version_dir in versions {
                let node_bin = version_dir.join("bin/node");
                if node_bin.exists() {
                    return node_bin.to_string_lossy().to_string();
                }
            }
        }
    }

    "node".to_string()
}

// --- Profile CRUD ---

fn load_profiles() -> Vec<BrowserProfile> {
    let path = profiles_path();
    let data = std::fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&data).unwrap_or_default()
}

fn save_profiles(profiles: &[BrowserProfile]) -> Result<(), String> {
    let path = profiles_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(profiles).map_err(|e| e.to_string())?;
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_profiles_list() -> Vec<BrowserProfile> {
    load_profiles()
}

#[tauri::command]
pub fn browser_profile_create(name: String, tags: Vec<String>) -> Result<BrowserProfile, String> {
    let id = format!(
        "{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );

    let data_dir = user_data_dir(&id);
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let profile = BrowserProfile { id, name, tags };
    let mut profiles = load_profiles();
    profiles.push(profile.clone());
    save_profiles(&profiles)?;
    Ok(profile)
}

#[tauri::command]
pub fn browser_profile_get_path(id: String) -> String {
    user_data_dir(&id).to_string_lossy().to_string()
}

#[tauri::command]
pub fn browser_profile_update(id: String, name: String, tags: Vec<String>) -> Result<(), String> {
    let mut profiles = load_profiles();
    let profile = profiles
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Profile not found: {}", id))?;
    profile.name = name;
    profile.tags = tags;
    save_profiles(&profiles)
}

#[tauri::command]
pub fn browser_profile_delete(id: String) -> Result<(), String> {
    let mut profiles = load_profiles();
    profiles.retain(|p| p.id != id);
    save_profiles(&profiles)?;
    let _ = std::fs::remove_dir_all(user_data_dir(&id));
    Ok(())
}

#[tauri::command]
pub fn browser_profile_launch(id: String) -> Result<String, String> {
    browser_profile_connect(id)
}

// --- Puppeteer server connect/disconnect ---

#[tauri::command]
pub fn browser_profile_get_port(id: String) -> Result<u16, String> {
    let state_file = server_state_file(&id);
    if !state_file.exists() {
        return Err("not running".into());
    }
    let data = std::fs::read_to_string(&state_file).map_err(|_| "not running")?;
    let info: serde_json::Value = serde_json::from_str(&data).map_err(|_| "not running")?;
    let port = info["port"].as_u64().ok_or("not running")? as u16;
    Ok(port)
}

#[tauri::command]
pub fn browser_profile_connect_check(id: String) -> Result<(), String> {
    let state_file = server_state_file(&id);
    if !state_file.exists() {
        return Err("not running".into());
    }
    let data = std::fs::read_to_string(&state_file).map_err(|_| "not running")?;
    let info: serde_json::Value = serde_json::from_str(&data).map_err(|_| "not running")?;
    let port = info["port"].as_u64().ok_or("not running")?;

    let alive = std::process::Command::new("curl")
        .args([
            "-s",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            "-X",
            "POST",
            "-H",
            "Content-Type: application/json",
            "-d",
            r#"{"action":"current_url"}"#,
            "--max-time",
            "2",
            &format!("http://127.0.0.1:{}/action", port),
        ])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("200"))
        .unwrap_or(false);

    if alive {
        set_active(id, port as u16);
        Ok(())
    } else {
        let _ = std::fs::remove_file(&state_file);
        Err("not running".into())
    }
}

#[tauri::command]
pub fn browser_profile_connect(id: String) -> Result<String, String> {
    let state_file = server_state_file(&id);

    // Check if server already running
    if state_file.exists() {
        if let Ok(data) = std::fs::read_to_string(&state_file) {
            if let Ok(info) = serde_json::from_str::<serde_json::Value>(&data) {
                if let Some(port) = info["port"].as_u64() {
                    let alive = std::process::Command::new("curl")
                        .args([
                            "-s",
                            "-o",
                            "/dev/null",
                            "-w",
                            "%{http_code}",
                            "-X",
                            "POST",
                            "-H",
                            "Content-Type: application/json",
                            "-d",
                            r#"{"action":"current_url"}"#,
                            "--max-time",
                            "2",
                            &format!("http://127.0.0.1:{}/action", port),
                        ])
                        .output()
                        .map(|o| String::from_utf8_lossy(&o.stdout).contains("200"))
                        .unwrap_or(false);

                    if alive {
                        set_active(id.clone(), port as u16);
                        let profiles = load_profiles();
                        let name = profiles
                            .iter()
                            .find(|p| p.id == id)
                            .map(|p| p.name.as_str())
                            .unwrap_or("unknown");
                        return Ok(format!(
                            "Already connected to profile: {} (port {})",
                            name, port
                        ));
                    }
                }
            }
        }
        let _ = std::fs::remove_file(&state_file);
    }

    let server_js = find_browser_server_js().ok_or_else(|| {
        "scripts/browser-server.js not found. Make sure it exists in the project.".to_string()
    })?;

    let profiles = load_profiles();
    let profile = profiles
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Profile not found: {}", id))?;

    let profile_dir = user_data_dir(&id);
    let node_bin = find_node_binary();

    let mut child = std::process::Command::new(&node_bin)
        .arg(&server_js)
        .arg(profile_dir.to_string_lossy().as_ref())
        .arg(&id)
        .arg(&profile.name)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start browser server. node='{}', error: {}", node_bin, e))?;

    let stderr = child.stderr.take();
    let stdout = child.stdout.take().ok_or("No stdout from browser server")?;
    let mut reader = std::io::BufReader::new(stdout);
    let mut line = String::new();
    reader.read_line(&mut line).map_err(|e| e.to_string())?;

    if line.trim().is_empty() {
        let mut err_msg = String::new();
        if let Some(mut err) = stderr {
            use std::io::Read;
            let _ = err.read_to_string(&mut err_msg);
        }
        return Err(format!(
            "Browser server exited without output. stderr: {}",
            if err_msg.trim().is_empty() { "(empty)" } else { err_msg.trim() }
        ));
    }

    let info: serde_json::Value = serde_json::from_str(line.trim())
        .map_err(|e| format!("Bad server output '{}': {}", line.trim(), e))?;

    if info["ready"].as_bool() != Some(true) {
        return Err(info["error"]
            .as_str()
            .unwrap_or("Server failed to start")
            .to_string());
    }

    let port = info["port"].as_u64().ok_or("No port in server output")? as u16;

    // Server runs in background
    std::mem::forget(child);

    set_active(id.clone(), port);
    Ok(format!(
        "Connected to profile: {} (port {})",
        profile.name, port
    ))
}

#[tauri::command]
pub fn browser_profile_disconnect(profile_id: String) -> Result<(), String> {
    let state_file = server_state_file(&profile_id);
    if let Ok(data) = std::fs::read_to_string(&state_file) {
        if let Ok(info) = serde_json::from_str::<serde_json::Value>(&data) {
            if let Some(pid) = info["pid"].as_u64() {
                let _ = std::process::Command::new("kill")
                    .arg(pid.to_string())
                    .output();
            }
        }
    }
    let _ = std::fs::remove_file(&state_file);

    if let Ok(mut active_id) = ACTIVE_PROFILE_ID.lock() {
        if active_id.as_deref() == Some(&profile_id) {
            *active_id = None;
            if let Ok(mut port) = ACTIVE_PORT.lock() {
                *port = None;
            }
        }
    }
    Ok(())
}

fn set_active(id: String, port: u16) {
    if let Ok(mut p) = ACTIVE_PORT.lock() {
        *p = Some(port);
    }
    if let Ok(mut i) = ACTIVE_PROFILE_ID.lock() {
        *i = Some(id);
    }
}
