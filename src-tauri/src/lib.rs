mod commands;
mod data;
mod error;
mod google;
mod models;
mod ssh;
mod state;
mod vault;
mod vpn;

use commands::app_commands::app_version;
use commands::backup_commands::{
    google_backup_now, google_login, google_login_cancel, google_logout, google_restore,
    google_status,
};
use commands::group_commands::{group_create, group_delete, group_list, group_update};
use commands::host_commands::{
    host_create, host_delete, host_export_csv, host_import_csv, host_list, host_set_favorite,
    host_update,
};
use commands::identity_commands::{
    identity_create, identity_delete, identity_list, identity_update,
};
use commands::key_commands::{key_delete, key_generate, key_import, key_list};
use commands::local_fs_commands::{
    local_delete, local_home_dir, local_list, local_mkdir, local_read_text_file, local_rename,
    local_write_text_file,
};
use commands::session_commands::{
    session_connect, session_disconnect, session_resize, session_write,
};
use commands::sftp_commands::{
    sftp_canonicalize, sftp_connect, sftp_disconnect, sftp_download, sftp_list, sftp_mkdir,
    sftp_remove_dir, sftp_remove_file, sftp_rename, sftp_upload,
};
use commands::snippet_commands::{
    snippet_create, snippet_delete, snippet_list, snippet_run_on_hosts, snippet_update,
};
use commands::stats_commands::host_stats;
use commands::vault_commands::vault_auto_unlock;
use commands::vpn_commands::{
    vpn_active_statuses, vpn_connect, vpn_disconnect, vpn_disconnect_all, vpn_ensure_host_route,
    vpn_profile_create, vpn_profile_delete, vpn_profile_list, vpn_profile_update,
    vpn_setup_install, vpn_setup_status, vpn_status,
};
use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState::new().expect("failed to initialize app state");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            app_version,
            vault_auto_unlock,
            group_list,
            group_create,
            group_update,
            group_delete,
            host_list,
            host_create,
            host_update,
            host_delete,
            host_set_favorite,
            host_export_csv,
            host_import_csv,
            host_stats,
            identity_list,
            identity_create,
            identity_update,
            identity_delete,
            key_list,
            key_generate,
            key_import,
            key_delete,
            session_connect,
            session_write,
            session_resize,
            session_disconnect,
            sftp_connect,
            sftp_canonicalize,
            sftp_list,
            sftp_mkdir,
            sftp_rename,
            sftp_remove_file,
            sftp_remove_dir,
            sftp_download,
            sftp_upload,
            sftp_disconnect,
            local_home_dir,
            local_list,
            local_read_text_file,
            local_write_text_file,
            local_mkdir,
            local_rename,
            local_delete,
            snippet_list,
            snippet_create,
            snippet_update,
            snippet_delete,
            snippet_run_on_hosts,
            google_status,
            google_login,
            google_login_cancel,
            google_logout,
            google_backup_now,
            google_restore,
            vpn_profile_list,
            vpn_profile_create,
            vpn_profile_update,
            vpn_profile_delete,
            vpn_setup_status,
            vpn_setup_install,
            vpn_connect,
            vpn_disconnect,
            vpn_status,
            vpn_active_statuses,
            vpn_disconnect_all,
            vpn_ensure_host_route,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Safety net: if the app is closing while a VPN is still up
            // (forgotten, or left over from a session the app didn't get a
            // chance to clean up after), signal every one of them to
            // disconnect rather than leaving it silently rerouting traffic
            // after the app itself is gone.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let state = app_handle.state::<AppState>();
                vpn::disconnect_all(&state.vpn_connections);
            }
        });
}
