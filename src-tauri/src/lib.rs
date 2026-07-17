mod commands;
mod data;
mod error;
mod google;
mod models;
mod ssh;
mod state;
mod vault;

use commands::backup_commands::{
    google_backup_now, google_login, google_logout, google_restore, google_status,
};
use commands::group_commands::{group_create, group_delete, group_list, group_update};
use commands::host_commands::{
    host_create, host_delete, host_export_csv, host_import_csv, host_list, host_update,
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
use commands::tunnel_commands::{tunnel_list, tunnel_start, tunnel_stop};
use commands::vault_commands::vault_auto_unlock;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState::new().expect("failed to initialize app state");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            vault_auto_unlock,
            group_list,
            group_create,
            group_update,
            group_delete,
            host_list,
            host_create,
            host_update,
            host_delete,
            host_export_csv,
            host_import_csv,
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
            tunnel_start,
            tunnel_stop,
            tunnel_list,
            snippet_list,
            snippet_create,
            snippet_update,
            snippet_delete,
            snippet_run_on_hosts,
            google_status,
            google_login,
            google_logout,
            google_backup_now,
            google_restore,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
