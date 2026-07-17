use serde::Deserialize;

use crate::error::{AppError, AppResult};

const FILES_ENDPOINT: &str = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_ENDPOINT: &str = "https://www.googleapis.com/upload/drive/v3/files";

#[derive(Deserialize)]
struct FileList {
    files: Vec<DriveFile>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct DriveFile {
    pub id: String,
}

// `drive.appdata` tokens can only see files this app created, so a plain
// name filter (rather than tracking IDs ourselves) is enough to find them
// again on any device signed into the same Google account.
pub async fn find_file(access_token: &str, name: &str) -> AppResult<Option<DriveFile>> {
    let query = format!("name = '{name}' and trashed = false");
    let resp = reqwest::Client::new()
        .get(FILES_ENDPOINT)
        .bearer_auth(access_token)
        .query(&[
            ("q", query.as_str()),
            ("spaces", "appDataFolder"),
            ("fields", "files(id,name)"),
        ])
        .send()
        .await
        .map_err(|e| AppError::Google(format!("Drive file lookup failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Google(format!(
            "Drive file lookup failed: {}",
            resp.status()
        )));
    }
    let list: FileList = resp
        .json()
        .await
        .map_err(|e| AppError::Google(format!("invalid Drive response: {e}")))?;
    Ok(list.files.into_iter().next())
}

pub async fn upload_new(access_token: &str, name: &str, bytes: Vec<u8>) -> AppResult<DriveFile> {
    let metadata = serde_json::json!({ "name": name, "parents": ["appDataFolder"] });
    let form = reqwest::multipart::Form::new()
        .part(
            "metadata",
            reqwest::multipart::Part::text(metadata.to_string())
                .mime_str("application/json; charset=UTF-8")
                .expect("static mime type is valid"),
        )
        .part(
            "file",
            reqwest::multipart::Part::bytes(bytes)
                .mime_str("application/octet-stream")
                .expect("static mime type is valid"),
        );

    let resp = reqwest::Client::new()
        .post(format!("{UPLOAD_ENDPOINT}?uploadType=multipart"))
        .bearer_auth(access_token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::Google(format!("Drive upload failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Google(format!("Drive upload failed: {}", resp.status())));
    }
    resp.json()
        .await
        .map_err(|e| AppError::Google(format!("invalid Drive response: {e}")))
}

pub async fn update_content(access_token: &str, file_id: &str, bytes: Vec<u8>) -> AppResult<()> {
    let resp = reqwest::Client::new()
        .patch(format!("{UPLOAD_ENDPOINT}/{file_id}?uploadType=media"))
        .bearer_auth(access_token)
        .header("Content-Type", "application/octet-stream")
        .body(bytes)
        .send()
        .await
        .map_err(|e| AppError::Google(format!("Drive update failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Google(format!("Drive update failed: {}", resp.status())));
    }
    Ok(())
}

pub async fn download_content(access_token: &str, file_id: &str) -> AppResult<Vec<u8>> {
    let resp = reqwest::Client::new()
        .get(format!("{FILES_ENDPOINT}/{file_id}?alt=media"))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| AppError::Google(format!("Drive download failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Google(format!("Drive download failed: {}", resp.status())));
    }
    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| AppError::Google(format!("Drive download failed: {e}")))
}

// Uploads `bytes` as `name`, creating the file on first use and updating it
// on every call after - the one primitive both backup and (implicitly,
// via re-upload after restore) re-sync need.
pub async fn upsert(access_token: &str, name: &str, bytes: Vec<u8>) -> AppResult<()> {
    match find_file(access_token, name).await? {
        Some(existing) => update_content(access_token, &existing.id, bytes).await,
        None => upload_new(access_token, name, bytes).await.map(|_| ()),
    }
}
