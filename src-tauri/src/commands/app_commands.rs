use crate::error::{AppError, AppResult};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};
use semver::Version;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;

const RELEASE_BASE_URL: &str = "https://github.com/connecthub-client/ConnectHub/releases/download";
const UPDATE_PUBLIC_KEY: &str = "RWRu33PwK5vDAnijgqnhefBlbphSVe5z8zI6WLKZnIaNPJI4hPJIUtVb";
const MAX_PACKAGE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_SIGNATURE_BYTES: u64 = 64 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AppUpdateMethod {
    Native,
    Deb,
    Rpm,
    Unsupported,
}

#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn app_update_method() -> AppUpdateMethod {
    detect_update_method()
}

#[tauri::command]
pub async fn app_package_update_install(version: String) -> AppResult<()> {
    let version = validate_update_version(&version)?;
    let method = detect_update_method();
    let asset = package_asset(method, &version)?;
    let package_url = format!("{RELEASE_BASE_URL}/v{version}/{asset}");
    let signature_url = format!("{package_url}.sig");
    let client = reqwest::Client::builder()
        .user_agent(format!("ConnectHub/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| AppError::Update(format!("could not start the download: {error}")))?;

    let package = download_limited(&client, &package_url, MAX_PACKAGE_BYTES).await?;
    let signature = download_limited(&client, &signature_url, MAX_SIGNATURE_BYTES).await?;
    verify_package_signature(&package, &signature)?;

    let extension = match method {
        AppUpdateMethod::Deb => "deb",
        AppUpdateMethod::Rpm => "rpm",
        _ => {
            return Err(AppError::Update(
                "this installation is not package-managed".to_string(),
            ))
        }
    };
    let package_path = std::env::temp_dir().join(format!(
        "connecthub-update-{}-{version}.{extension}",
        uuid::Uuid::new_v4()
    ));
    if let Err(error) = write_package(&package_path, &package).await {
        let _ = tokio::fs::remove_file(&package_path).await;
        return Err(error);
    }

    let result = install_package(method, &package_path).await;
    let _ = tokio::fs::remove_file(&package_path).await;
    result
}

fn detect_update_method() -> AppUpdateMethod {
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("APPIMAGE").is_some() {
            return AppUpdateMethod::Native;
        }
        if std::env::consts::ARCH != "x86_64" {
            return AppUpdateMethod::Unsupported;
        }
        if package_is_installed(
            "dpkg-query",
            &["-W", "-f=${db:Status-Status}", "connect-hub"],
        ) {
            return AppUpdateMethod::Deb;
        }
        if package_is_installed("rpm", &["-q", "connect-hub"]) {
            return AppUpdateMethod::Rpm;
        }
        AppUpdateMethod::Unsupported
    }
    #[cfg(not(target_os = "linux"))]
    {
        AppUpdateMethod::Native
    }
}

fn validate_update_version(candidate: &str) -> AppResult<Version> {
    let candidate = Version::parse(candidate)
        .map_err(|_| AppError::Update("the release version is invalid".to_string()))?;
    let current = Version::parse(env!("CARGO_PKG_VERSION"))
        .map_err(|_| AppError::Update("the installed version is invalid".to_string()))?;
    if candidate <= current {
        return Err(AppError::Update(
            "the selected release is not newer than the installed version".to_string(),
        ));
    }
    Ok(candidate)
}

#[cfg(target_os = "linux")]
fn package_is_installed(program: &str, args: &[&str]) -> bool {
    std::process::Command::new(program)
        .args(args)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn package_asset(method: AppUpdateMethod, version: &Version) -> AppResult<String> {
    match method {
        AppUpdateMethod::Deb => Ok(format!("ConnectHub_{version}_amd64.deb")),
        AppUpdateMethod::Rpm => Ok(format!("ConnectHub-{version}-1.x86_64.rpm")),
        _ => Err(AppError::Update(
            "automatic package installation is unavailable for this installation".to_string(),
        )),
    }
}

async fn download_limited(
    client: &reqwest::Client,
    url: &str,
    max_bytes: u64,
) -> AppResult<Vec<u8>> {
    let response = client
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| AppError::Update(format!("download failed: {error}")))?;
    if response
        .content_length()
        .is_some_and(|size| size > max_bytes)
    {
        return Err(AppError::Update(
            "the downloaded update is unexpectedly large".to_string(),
        ));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| AppError::Update(format!("download failed: {error}")))?;
    if bytes.len() as u64 > max_bytes {
        return Err(AppError::Update(
            "the downloaded update is unexpectedly large".to_string(),
        ));
    }
    Ok(bytes.to_vec())
}

fn verify_package_signature(package: &[u8], encoded_signature: &[u8]) -> AppResult<()> {
    let encoded_signature = std::str::from_utf8(encoded_signature)
        .map_err(|_| AppError::Update("the update signature is invalid".to_string()))?;
    let signature_bytes = STANDARD
        .decode(encoded_signature.trim())
        .map_err(|_| AppError::Update("the update signature is invalid".to_string()))?;
    let signature_text = std::str::from_utf8(&signature_bytes)
        .map_err(|_| AppError::Update("the update signature is invalid".to_string()))?;
    let signature = Signature::decode(signature_text)
        .map_err(|_| AppError::Update("the update signature is invalid".to_string()))?;
    let public_key = PublicKey::from_base64(UPDATE_PUBLIC_KEY)
        .map_err(|_| AppError::Update("the embedded update key is invalid".to_string()))?;
    public_key
        .verify(package, &signature, false)
        .map_err(|_| AppError::Update("the update signature could not be verified".to_string()))
}

async fn write_package(path: &Path, package: &[u8]) -> AppResult<()> {
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .await?;
    file.write_all(package).await?;
    file.flush().await?;
    Ok(())
}

async fn install_package(method: AppUpdateMethod, package_path: &PathBuf) -> AppResult<()> {
    let mut command = tokio::process::Command::new("pkexec");
    match method {
        AppUpdateMethod::Deb => {
            command.args(["/usr/bin/dpkg", "--install"]);
        }
        AppUpdateMethod::Rpm => {
            command.args(["/usr/bin/rpm", "--upgrade", "--replacepkgs"]);
        }
        _ => return Err(AppError::Update("unsupported package type".to_string())),
    }
    let status = command.arg(package_path).status().await.map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            AppError::Update(
                "the system authorization service (pkexec) is not installed".to_string(),
            )
        } else {
            AppError::Update(format!("could not start the installer: {error}"))
        }
    })?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::Update(match status.code() {
            Some(126) | Some(127) => "administrator authorization was cancelled".to_string(),
            Some(code) => format!("the system installer exited with status {code}"),
            None => "the system installer was interrupted".to_string(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_names_match_release_assets() {
        let version = Version::parse("2.2.3").unwrap();
        assert_eq!(
            package_asset(AppUpdateMethod::Deb, &version).unwrap(),
            "ConnectHub_2.2.3_amd64.deb"
        );
        assert_eq!(
            package_asset(AppUpdateMethod::Rpm, &version).unwrap(),
            "ConnectHub-2.2.3-1.x86_64.rpm"
        );
    }

    #[test]
    fn native_and_unknown_installs_cannot_use_package_installer() {
        let version = Version::parse("2.2.3").unwrap();
        assert!(package_asset(AppUpdateMethod::Native, &version).is_err());
        assert!(package_asset(AppUpdateMethod::Unsupported, &version).is_err());
    }

    #[test]
    fn update_version_must_be_newer_and_valid_semver() {
        let current = Version::parse(env!("CARGO_PKG_VERSION")).unwrap();
        let newer = Version::new(current.major, current.minor, current.patch + 1);
        assert!(validate_update_version(&newer.to_string()).is_ok());
        assert!(validate_update_version(&current.to_string()).is_err());
        assert!(validate_update_version("../../package").is_err());
    }

    #[tokio::test]
    #[ignore = "downloads a published GitHub release"]
    async fn verifies_a_published_deb_signature_and_rejects_tampering() {
        let client = reqwest::Client::new();
        let package_url = format!("{RELEASE_BASE_URL}/v2.2.2/ConnectHub_2.2.2_amd64.deb");
        let package = download_limited(&client, &package_url, MAX_PACKAGE_BYTES)
            .await
            .unwrap();
        let signature =
            download_limited(&client, &format!("{package_url}.sig"), MAX_SIGNATURE_BYTES)
                .await
                .unwrap();
        verify_package_signature(&package, &signature).unwrap();

        let mut tampered = package;
        tampered[0] ^= 1;
        assert!(verify_package_signature(&tampered, &signature).is_err());
    }
}
