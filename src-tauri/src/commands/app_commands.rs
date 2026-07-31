#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Whether the in-app updater can actually apply a downloaded update on this install.
///
/// `tauri-plugin-updater`'s Linux install step picks a code path from the
/// *currently installed* package format (`bundle_type()`), not from anything we
/// control at release time: a `.deb`/`.rpm` install expects the downloaded bytes to
/// themselves be a `.deb`/`.rpm`, while our release process only ever publishes a
/// single AppImage-format artifact. Feeding that AppImage to the deb/rpm code path
/// fails its magic-byte check and surfaces as the confusing "invalid updater binary
/// format" error. The AppImage runtime sets the `APPIMAGE` env var on itself, which
/// is the standard way to detect "currently running as a mounted AppImage".
#[tauri::command]
pub fn app_update_installable() -> bool {
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("APPIMAGE").is_some()
    }
    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}
