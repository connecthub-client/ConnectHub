use serde::Serialize;
use std::time::UNIX_EPOCH;

use crate::error::{AppError, AppResult};

#[derive(Debug, Serialize, Clone)]
pub struct LocalEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<i64>,
}

#[tauri::command]
pub fn local_home_dir() -> AppResult<String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| {
            AppError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "could not determine home directory",
            ))
        })
}

#[tauri::command]
pub fn local_list(path: String) -> AppResult<Vec<LocalEntry>> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        entries.push(LocalEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified: metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64),
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

#[tauri::command]
pub fn local_read_text_file(path: String) -> AppResult<String> {
    Ok(std::fs::read_to_string(&path)?)
}

#[tauri::command]
pub fn local_write_text_file(path: String, contents: String) -> AppResult<()> {
    std::fs::write(&path, contents)?;
    Ok(())
}

#[tauri::command]
pub fn local_mkdir(path: String) -> AppResult<()> {
    std::fs::create_dir(&path)?;
    Ok(())
}

#[tauri::command]
pub fn local_rename(from: String, to: String) -> AppResult<()> {
    std::fs::rename(&from, &to)?;
    Ok(())
}

#[tauri::command]
pub fn local_delete(path: String, is_dir: bool) -> AppResult<()> {
    if is_dir {
        std::fs::remove_dir(&path)?;
    } else {
        std::fs::remove_file(&path)?;
    }
    Ok(())
}
