//! Local Gmail OAuth (PKCE + loopback) and token storage for the desktop app.
//!
//! Tokens live under `$APPDATA/gmail/`. Access tokens are refreshed in-process;
//! the frontend never needs a backend for Gmail auth.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    sync::mpsc,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const GMAIL_DIR: &str = "gmail";
const CONFIG_FILE: &str = "oauth-client.json";
const SESSION_FILE: &str = "session.json";
const OAUTH_SCOPES: &str = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v3/userinfo";
const OAUTH_TIMEOUT: Duration = Duration::from_secs(300);
/// Fixed loopback port so the redirect URI can be registered in Google Cloud Console.
pub const OAUTH_LOOPBACK_PORT: u16 = 17_890;
/// Must match the Authorized redirect URI registered for this OAuth client.
const OAUTH_REDIRECT_URI: &str = "http://127.0.0.1:17890/oauth/callback";
const OAUTH_LOOPBACK_ADDR: &str = "127.0.0.1:17890";

/// OAuth client credentials configured by the user (Desktop app type).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailClientConfig {
    pub client_id: String,
    #[serde(default)]
    pub client_secret: Option<String>,
}

/// Persisted Google session for local Gmail access.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailSession {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at_sec: u64,
    pub email: String,
    pub name: Option<String>,
    pub scope: Option<String>,
}

/// Connection status returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailAuthStatus {
    pub connected: bool,
    pub email: Option<String>,
    pub name: Option<String>,
    pub has_client_config: bool,
}

/// Access token payload for authenticated Gmail REST calls from the webview.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailAccessToken {
    pub access_token: String,
    pub email: String,
    pub expires_at_sec: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    scope: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Deserialize)]
struct UserInfoResponse {
    email: Option<String>,
    name: Option<String>,
}

fn gmail_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data dir: {error}"))?
        .join(GMAIL_DIR);
    fs::create_dir_all(&dir).map_err(|error| format!("Failed to create gmail dir: {error}"))?;
    Ok(dir)
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(gmail_dir(app)?.join(CONFIG_FILE))
}

fn session_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(gmail_dir(app)?.join(SESSION_FILE))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn read_json_file<T: for<'de> Deserialize<'de>>(path: &PathBuf) -> Result<Option<T>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let value = serde_json::from_str(&raw)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))?;
    Ok(Some(value))
}

fn write_json_file<T: Serialize>(path: &PathBuf, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }
    let raw = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Failed to serialize {}: {error}", path.display()))?;
    fs::write(path, raw).map_err(|error| format!("Failed to write {}: {error}", path.display()))
}

fn random_url_safe(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).expect("getrandom should be available");
    URL_SAFE_NO_PAD.encode(buffer)
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn open_browser(url: &str) -> Result<(), String> {
    let result = {
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open").arg(url).spawn()
        }
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("cmd")
                .args(["/C", "start", "", url])
                .spawn()
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            std::process::Command::new("xdg-open").arg(url).spawn()
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
        {
            Err(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                format!("Cannot open browser on this platform for URL: {url}"),
            ))
        }
    };

    result.map(|_| ()).map_err(|error| format!("Failed to open browser: {error}"))
}

fn html_response(title: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n<!doctype html><html><head><meta charset=\"utf-8\"><title>{title}</title></head><body style=\"font-family:system-ui;padding:2rem;max-width:32rem\"><h1>{title}</h1><p>{body}</p></body></html>"
    )
}

fn wait_for_oauth_code(listener: TcpListener) -> Result<String, String> {
    listener
        .set_nonblocking(false)
        .map_err(|error| format!("Failed to configure OAuth listener: {error}"))?;

    let (mut stream, _) = listener
        .accept()
        .map_err(|error| format!("OAuth callback accept failed: {error}"))?;

    let mut buffer = [0u8; 4096];
    let bytes_read = stream
        .read(&mut buffer)
        .map_err(|error| format!("Failed to read OAuth callback: {error}"))?;
    let request = String::from_utf8_lossy(&buffer[..bytes_read]);
    let request_line = request.lines().next().unwrap_or("");

    if request_line.contains("error=") {
        let _ = stream.write_all(
            html_response(
                "Gmail sign-in failed",
                "Google returned an error. You can close this tab and return to Kokoro.",
            )
            .as_bytes(),
        );
        return Err("Google OAuth returned an error. Try again.".into());
    }

    let code = request_line
        .split_whitespace()
        .nth(1)
        .and_then(|path| {
            path.split('?')
                .nth(1)?
                .split('&')
                .find_map(|pair| pair.strip_prefix("code="))
        })
        .map(|value| value.to_string())
        .ok_or_else(|| "OAuth callback did not include an authorization code.".to_string())?;

    let _ = stream.write_all(
        html_response(
            "Signed in to Gmail",
            "You can close this tab and return to Kokoro.",
        )
        .as_bytes(),
    );

    Ok(code)
}

async fn exchange_code(
    client: &reqwest::Client,
    config: &GmailClientConfig,
    code: &str,
    redirect_uri: &str,
    code_verifier: &str,
) -> Result<TokenResponse, String> {
    let mut form = vec![
        ("code", code.to_string()),
        ("client_id", config.client_id.clone()),
        ("redirect_uri", redirect_uri.to_string()),
        ("grant_type", "authorization_code".to_string()),
        ("code_verifier", code_verifier.to_string()),
    ];
    if let Some(secret) = config.client_secret.as_ref().filter(|value| !value.is_empty()) {
        form.push(("client_secret", secret.clone()));
    }

    let response = client
        .post(TOKEN_URL)
        .form(&form)
        .send()
        .await
        .map_err(|error| format!("Token exchange request failed: {error}"))?;

    let token: TokenResponse = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse token response: {error}"))?;

    if let Some(error) = token.error {
        let description = token.error_description.unwrap_or_default();
        return Err(format!("Token exchange failed: {error} {description}").trim().into());
    }

    Ok(token)
}

async fn refresh_access_token(
    client: &reqwest::Client,
    config: &GmailClientConfig,
    refresh_token: &str,
) -> Result<TokenResponse, String> {
    let mut form = vec![
        ("client_id", config.client_id.clone()),
        ("grant_type", "refresh_token".to_string()),
        ("refresh_token", refresh_token.to_string()),
    ];
    if let Some(secret) = config.client_secret.as_ref().filter(|value| !value.is_empty()) {
        form.push(("client_secret", secret.clone()));
    }

    let response = client
        .post(TOKEN_URL)
        .form(&form)
        .send()
        .await
        .map_err(|error| format!("Token refresh request failed: {error}"))?;

    let token: TokenResponse = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse refresh response: {error}"))?;

    if let Some(error) = token.error {
        let description = token.error_description.unwrap_or_default();
        return Err(format!("Token refresh failed: {error} {description}").trim().into());
    }

    Ok(token)
}

async fn fetch_userinfo(
    client: &reqwest::Client,
    access_token: &str,
) -> Result<UserInfoResponse, String> {
    client
        .get(USERINFO_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|error| format!("Userinfo request failed: {error}"))?
        .json::<UserInfoResponse>()
        .await
        .map_err(|error| format!("Failed to parse userinfo: {error}"))
}

fn load_config(app: &AppHandle) -> Result<Option<GmailClientConfig>, String> {
    read_json_file(&config_path(app)?)
}

fn load_session(app: &AppHandle) -> Result<Option<GmailSession>, String> {
    read_json_file(&session_path(app)?)
}

fn save_session(app: &AppHandle, session: &GmailSession) -> Result<(), String> {
    write_json_file(&session_path(app)?, session)
}

/// Saves the Google OAuth Desktop client id/secret for local sign-in.
#[tauri::command]
pub fn gmail_save_client_config(
    app: AppHandle,
    client_id: String,
    client_secret: Option<String>,
) -> Result<GmailClientConfig, String> {
    let trimmed_id = client_id.trim().to_string();
    if trimmed_id.is_empty() {
        return Err("Google OAuth client ID is required.".into());
    }
    let config = GmailClientConfig {
        client_id: trimmed_id,
        client_secret: client_secret
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    };
    write_json_file(&config_path(&app)?, &config)?;
    Ok(config)
}

/// Returns the saved OAuth client configuration, if any.
#[tauri::command]
pub fn gmail_get_client_config(app: AppHandle) -> Result<Option<GmailClientConfig>, String> {
    load_config(&app)
}

/// Returns whether Gmail is connected and whether client credentials exist.
#[tauri::command]
pub fn gmail_auth_status(app: AppHandle) -> Result<GmailAuthStatus, String> {
    let config = load_config(&app)?;
    let session = load_session(&app)?;
    Ok(GmailAuthStatus {
        connected: session
            .as_ref()
            .map(|value| !value.access_token.is_empty() || value.refresh_token.is_some())
            .unwrap_or(false),
        email: session.as_ref().map(|value| value.email.clone()),
        name: session.and_then(|value| value.name),
        has_client_config: config.is_some(),
    })
}

/// Clears the local Gmail session (does not revoke the Google grant remotely).
#[tauri::command]
pub fn gmail_logout(app: AppHandle) -> Result<(), String> {
    let path = session_path(&app)?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("Failed to remove Gmail session: {error}"))?;
    }
    Ok(())
}

/// Runs the desktop OAuth loopback flow and stores the resulting session.
#[tauri::command]
pub async fn gmail_login(app: AppHandle) -> Result<GmailAuthStatus, String> {
    let config = load_config(&app)?.ok_or_else(|| {
        "Save a Google OAuth client ID before signing in.".to_string()
    })?;

    let listener = TcpListener::bind(OAUTH_LOOPBACK_ADDR).map_err(|error| {
        format!(
            "Failed to bind OAuth loopback on {OAUTH_LOOPBACK_ADDR}: {error}. \
             Close anything using port {OAUTH_LOOPBACK_PORT}, then try again."
        )
    })?;
    let redirect_uri = OAUTH_REDIRECT_URI.to_string();

    let code_verifier = random_url_safe(32);
    let code_challenge = pkce_challenge(&code_verifier);
    let state = random_url_safe(16);

    let auth_url = format!(
        "{AUTH_URL}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent",
        urlencoding::encode(&config.client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(OAUTH_SCOPES),
        urlencoding::encode(&state),
        urlencoding::encode(&code_challenge),
    );

    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    thread::spawn(move || {
        let _ = tx.send(wait_for_oauth_code(listener));
    });

    open_browser(&auth_url)?;

    let code = rx
        .recv_timeout(OAUTH_TIMEOUT)
        .map_err(|_| {
            format!(
                "Timed out waiting for Google sign-in. Confirm this exact redirect URI is listed \
                 in Google Cloud Console → Authorized redirect URIs: {OAUTH_REDIRECT_URI}"
            )
        })??;

    let http = reqwest::Client::new();
    let token = exchange_code(&http, &config, &code, &redirect_uri, &code_verifier).await?;
    let userinfo = fetch_userinfo(&http, &token.access_token).await?;
    let email = userinfo
        .email
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Google did not return an email for this account.".to_string())?;

    let expires_at_sec = now_secs() + token.expires_in.unwrap_or(3600).saturating_sub(60);
    let existing = load_session(&app)?;
    let refresh_token = token
        .refresh_token
        .or_else(|| existing.and_then(|session| session.refresh_token));

    let session = GmailSession {
        access_token: token.access_token,
        refresh_token,
        expires_at_sec,
        email,
        name: userinfo.name,
        scope: token.scope,
    };
    save_session(&app, &session)?;

    Ok(GmailAuthStatus {
        connected: true,
        email: Some(session.email),
        name: session.name,
        has_client_config: true,
    })
}

/// Returns a valid access token, refreshing it when close to expiry.
#[tauri::command]
pub async fn gmail_get_access_token(app: AppHandle) -> Result<GmailAccessToken, String> {
    let config = load_config(&app)?.ok_or_else(|| {
        "Save a Google OAuth Desktop client ID before using Gmail.".to_string()
    })?;
    let mut session = load_session(&app)?.ok_or_else(|| {
        "Connect a Gmail account before requesting an access token.".to_string()
    })?;

    let needs_refresh = session.expires_at_sec <= now_secs().saturating_add(30);
    if needs_refresh {
        let refresh_token = session.refresh_token.clone().ok_or_else(|| {
            "Gmail session is missing a refresh token. Sign in again.".to_string()
        })?;
        let http = reqwest::Client::new();
        let token = refresh_access_token(&http, &config, &refresh_token).await?;
        session.access_token = token.access_token;
        session.expires_at_sec =
            now_secs() + token.expires_in.unwrap_or(3600).saturating_sub(60);
        if let Some(scope) = token.scope {
            session.scope = Some(scope);
        }
        if let Some(new_refresh) = token.refresh_token {
            session.refresh_token = Some(new_refresh);
        }
        save_session(&app, &session)?;
    }

    Ok(GmailAccessToken {
        access_token: session.access_token,
        email: session.email,
        expires_at_sec: session.expires_at_sec,
    })
}
