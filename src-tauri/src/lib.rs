mod browser_profiles;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Fix PATH for GUI apps on macOS
    if let Err(e) = fix_path_env::fix() {
        eprintln!("fix_path_env warning: {e}");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            browser_profiles::browser_profiles_list,
            browser_profiles::browser_profile_create,
            browser_profiles::browser_profile_get_path,
            browser_profiles::browser_profile_update,
            browser_profiles::browser_profile_delete,
            browser_profiles::browser_profile_launch,
            browser_profiles::browser_profile_get_port,
            browser_profiles::browser_profile_connect_check,
            browser_profiles::browser_profile_connect,
            browser_profiles::browser_profile_disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
