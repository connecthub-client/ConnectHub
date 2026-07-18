use std::time::Duration;

use base64::Engine;
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use crate::error::{AppError, AppResult};

// Google's own docs state that for the "Desktop app" OAuth client type, the
// client secret is not treated as confidential and is expected to be
// embedded in distributed source:
// https://developers.google.com/identity/protocols/oauth2#installed
// The actual security boundary for this flow is PKCE (see pkce_challenge
// below), not secrecy of this value - a fresh, random code_verifier is
// generated on every sign-in and never leaves this machine except as a
// one-way hash, so having this client_id/secret alone isn't enough to
// complete or intercept a sign-in.
//
// These belong to this project's own registered OAuth client (Desktop app
// type, Drive API enabled) - every user still signs in with their own
// Google account; this is only the shared "identity" the sign-in flow
// runs through. Forking this project and want a separate one (your own
// API quota, your own name on the consent screen)? Create your own at
// https://console.cloud.google.com -> APIs & Services -> Credentials ->
// Create Credentials -> OAuth client ID -> Desktop app, and swap these two
// values for yours.
pub const CLIENT_ID: &str = "949498803538-qhkcshubqo35o7sgvdbkjobfunuf0k15.apps.googleusercontent.com";
pub const CLIENT_SECRET: &str = "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";

const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT: &str = "https://www.googleapis.com/oauth2/v2/userinfo";
// `drive.appdata` is Google's "non-sensitive scope" hidden-storage area:
// files created there don't show up in the user's normal Drive UI and
// aren't visible to any other app, only ones this OAuth client created.
const SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata email";
// A secondary safety net - the primary way to get unstuck if the browser
// gets closed mid-flow is the explicit cancel path (see login's cancel_rx),
// not this timeout. Kept well above how long a normal sign-in takes rather
// than cut aggressively, since 2FA/slow typing shouldn't false-positive.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(180);

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
// exchanges the resulting code for tokens. `cancel_rx` lets a caller abort
// the wait early (e.g. the user closed the browser tab without finishing) -
// there's no way to detect that from the loopback server side directly,
// since nothing connects to it until the flow actually completes, so an
// explicit cancel is the only real way to get unstuck short of the
// LOGIN_TIMEOUT safety net.
pub async fn login(cancel_rx: oneshot::Receiver<()>) -> AppResult<TokenResponse> {
    let verifier = generate_url_safe_token(64);
    let challenge = pkce_challenge(&verifier);
    let expected_state = generate_url_safe_token(16);

    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(AppError::Io)?;
    let port = listener.local_addr().map_err(AppError::Io)?.port();
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

    let code = await_redirect(listener, &expected_state, cancel_rx).await?;

    exchange_code(&code, &verifier, &redirect_uri).await
}

async fn await_redirect(
    listener: TcpListener,
    expected_state: &str,
    mut cancel_rx: oneshot::Receiver<()>,
) -> AppResult<String> {
    let sleep = tokio::time::sleep(LOGIN_TIMEOUT);
    tokio::pin!(sleep);

    let (mut stream, _addr) = tokio::select! {
        accepted = listener.accept() => accepted.map_err(AppError::Io)?,
        _ = &mut cancel_rx => return Err(AppError::Google("sign-in was cancelled".into())),
        _ = &mut sleep => {
            return Err(AppError::Google(
                "timed out waiting for Google sign-in to complete".into(),
            ));
        }
    };

    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).await.unwrap_or(0);
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
    let _ = stream.write_all(response.as_bytes()).await;

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
    params
        .get("code")
        .cloned()
        .ok_or_else(|| AppError::Google("no authorization code in redirect".into()))
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

    // Regression test for the "browser closed mid-flow" hang: cancelling
    // must unblock await_redirect immediately rather than waiting out
    // LOGIN_TIMEOUT - nothing ever connects to the listener in this test,
    // so if cancellation didn't work this would hang for LOGIN_TIMEOUT.
    #[tokio::test]
    async fn await_redirect_returns_promptly_when_cancelled() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (cancel_tx, cancel_rx) = oneshot::channel();
        cancel_tx.send(()).unwrap();

        let result = tokio::time::timeout(
            Duration::from_secs(5),
            await_redirect(listener, "some-state", cancel_rx),
        )
        .await
        .expect("await_redirect did not return promptly after cancellation");

        assert!(matches!(result, Err(AppError::Google(msg)) if msg.contains("cancelled")));
    }
}
