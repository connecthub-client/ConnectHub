use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

use base64::Engine;
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

// Google's own docs state that for the "Desktop app" OAuth client type, the
// client secret is not treated as confidential and is expected to be
// embedded in distributed source:
// https://developers.google.com/identity/protocols/oauth2#installed
//
// Replace both of these with your own values from
// https://console.cloud.google.com -> APIs & Services -> Credentials
// -> Create Credentials -> OAuth client ID -> Desktop app (after enabling
// the Google Drive API for the project). Until replaced, Google sign-in
// will fail with an "invalid_client" error - everything else in the app
// works normally without it.
pub const CLIENT_ID: &str = "REPLACE_WITH_YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com";
pub const CLIENT_SECRET: &str = "REPLACE_WITH_YOUR_GOOGLE_OAUTH_CLIENT_SECRET";

const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT: &str = "https://www.googleapis.com/oauth2/v2/userinfo";
// `drive.appdata` is Google's "non-sensitive scope" hidden-storage area:
// files created there don't show up in the user's normal Drive UI and
// aren't visible to any other app, only ones this OAuth client created.
const SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata email";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct RawTokenResponse {
    #[serde(default)]
    access_token: String,
    refresh_token: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    error_description: Option<String>,
}

fn generate_url_safe_token(byte_len: usize) -> String {
    let mut bytes = vec![0u8; byte_len];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn pkce_challenge(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

// Full interactive sign-in: opens the system browser to Google's consent
// screen, runs a one-shot local HTTP listener to catch the redirect, then
// exchanges the resulting code for tokens. Blocking (run via
// tokio::task::spawn_blocking for the listener portion) since it waits on
// real user interaction in the browser.
pub async fn login() -> AppResult<TokenResponse> {
    let verifier = generate_url_safe_token(64);
    let challenge = pkce_challenge(&verifier);
    let expected_state = generate_url_safe_token(16);

    let listener = TcpListener::bind("127.0.0.1:0").map_err(AppError::Io)?;
    let port = listener
        .local_addr()
        .map_err(AppError::Io)?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let auth_url = format!(
        "{AUTH_ENDPOINT}?client_id={client_id}&redirect_uri={redirect_uri}&response_type=code\
         &scope={scope}&code_challenge={challenge}&code_challenge_method=S256&state={state}\
         &access_type=offline&prompt=consent",
        client_id = urlencoding::encode(CLIENT_ID),
        redirect_uri = urlencoding::encode(&redirect_uri),
        scope = urlencoding::encode(SCOPE),
        challenge = urlencoding::encode(&challenge),
        state = urlencoding::encode(&expected_state),
    );

    tauri_plugin_opener::open_url(&auth_url, None::<&str>)
        .map_err(|e| AppError::Google(format!("could not open the system browser: {e}")))?;

    let code = tokio::task::spawn_blocking(move || await_redirect(listener, &expected_state))
        .await
        .map_err(|e| AppError::Google(format!("sign-in task panicked: {e}")))??;

    exchange_code(&code, &verifier, &redirect_uri).await
}

fn await_redirect(listener: TcpListener, expected_state: &str) -> AppResult<String> {
    listener.set_nonblocking(true).map_err(AppError::Io)?;
    let deadline = Instant::now() + LOGIN_TIMEOUT;

    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_nonblocking(false).ok();
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);
                let query = request
                    .lines()
                    .next()
                    .unwrap_or("")
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("")
                    .split_once('?')
                    .map(|(_, q)| q)
                    .unwrap_or("")
                    .to_string();

                let body = "<html><body style=\"font-family:sans-serif;padding:2rem\">\
                             <h3>ConnectHub sign-in complete</h3>\
                             <p>You can close this tab and return to the app.</p></body></html>";
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());

                let params = parse_query(&query);
                if params.get("state").map(String::as_str) != Some(expected_state) {
                    return Err(AppError::Google(
                        "sign-in response failed a security check (state mismatch) - please try again".into(),
                    ));
                }
                if let Some(err) = params.get("error") {
                    return Err(AppError::Google(format!(
                        "Google sign-in was cancelled or denied ({err})"
                    )));
                }
                return params
                    .get("code")
                    .cloned()
                    .ok_or_else(|| AppError::Google("no authorization code in redirect".into()));
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() > deadline {
                    return Err(AppError::Google(
                        "timed out waiting for Google sign-in to complete".into(),
                    ));
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(AppError::Io(e)),
        }
    }
}

fn parse_query(query: &str) -> std::collections::HashMap<String, String> {
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .map(|(k, v)| {
            (
                k.to_string(),
                urlencoding::decode(v).map(|s| s.into_owned()).unwrap_or_else(|_| v.to_string()),
            )
        })
        .collect()
}

async fn exchange_code(code: &str, verifier: &str, redirect_uri: &str) -> AppResult<TokenResponse> {
    let client = reqwest::Client::new();
    let resp = client
        .post(TOKEN_ENDPOINT)
        .form(&[
            ("client_id", CLIENT_ID),
            ("client_secret", CLIENT_SECRET),
            ("code", code),
            ("code_verifier", verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ])
        .send()
        .await
        .map_err(|e| AppError::Google(format!("token exchange request failed: {e}")))?;
    parse_token_response(resp).await
}

pub async fn refresh_access_token(refresh_token: &str) -> AppResult<String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(TOKEN_ENDPOINT)
        .form(&[
            ("client_id", CLIENT_ID),
            ("client_secret", CLIENT_SECRET),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| AppError::Google(format!("token refresh request failed: {e}")))?;
    Ok(parse_token_response(resp).await?.access_token)
}

async fn parse_token_response(resp: reqwest::Response) -> AppResult<TokenResponse> {
    let status = resp.status();
    let raw: RawTokenResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Google(format!("invalid response from Google: {e}")))?;

    if let Some(err) = raw.error {
        let desc = raw.error_description.unwrap_or_default();
        return Err(AppError::Google(format!("Google rejected the request: {err} {desc}")));
    }
    if !status.is_success() {
        return Err(AppError::Google(format!("Google token endpoint returned {status}")));
    }

    Ok(TokenResponse {
        access_token: raw.access_token,
        refresh_token: raw.refresh_token,
    })
}

pub async fn fetch_email(access_token: &str) -> AppResult<Option<String>> {
    #[derive(Deserialize)]
    struct UserInfo {
        email: Option<String>,
    }

    let client = reqwest::Client::new();
    let resp = client
        .get(USERINFO_ENDPOINT)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| AppError::Google(format!("userinfo request failed: {e}")))?;

    if !resp.status().is_success() {
        return Ok(None);
    }
    let info: UserInfo = resp.json().await.unwrap_or(UserInfo { email: None });
    Ok(info.email)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_is_deterministic_and_url_safe() {
        let verifier = generate_url_safe_token(64);
        let a = pkce_challenge(&verifier);
        let b = pkce_challenge(&verifier);
        assert_eq!(a, b);
        assert!(!a.contains('+') && !a.contains('/') && !a.contains('='));
    }

    #[test]
    fn generated_tokens_are_unique() {
        let a = generate_url_safe_token(16);
        let b = generate_url_safe_token(16);
        assert_ne!(a, b);
    }

    #[test]
    fn parse_query_decodes_percent_encoded_values() {
        let params = parse_query("code=abc%2Fdef&state=xyz&error=access_denied");
        assert_eq!(params.get("code"), Some(&"abc/def".to_string()));
        assert_eq!(params.get("state"), Some(&"xyz".to_string()));
        assert_eq!(params.get("error"), Some(&"access_denied".to_string()));
    }
}
