// Slice 14-C: Tauri-side Google OAuth 2.0 Authorization Code Flow with PKCE.
//
// - Loopback redirect on a random 127.0.0.1 port (Desktop client policy)
// - PKCE + CSRF state validation
// - Refresh token persisted in OS Keychain (`ai.latelatte.taskette.google`)
// - Single-flight mutex prevents parallel silent_refresh
// - `invalid_grant` from refresh => clear credential + return None (user re-consents)

use std::{
    net::TcpListener,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use oauth2::{
    basic::{BasicClient, BasicErrorResponseType},
    reqwest::async_http_client,
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge,
    RedirectUrl, RefreshToken, RequestTokenError, Scope, TokenResponse, TokenUrl,
};
use serde::Serialize;
use tiny_http::{Header, Response, Server};
use tokio::sync::Mutex as AsyncMutex;
use url::Url;

const KEYRING_SERVICE: &str = "ai.latelatte.taskette.google";
const KEYRING_ACCOUNT: &str = "default";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const SCOPE_CALENDAR_READONLY: &str = "https://www.googleapis.com/auth/calendar.readonly";
const SCOPE_DRIVE_APPDATA: &str = "https://www.googleapis.com/auth/drive.appdata";

// Allowlist guards against a compromised renderer requesting unexpected
// scopes (e.g. full Drive, Gmail). Any scope outside this set is rejected
// in `gcal_oauth_connect` before reaching Google's consent screen.
const ALLOWED_SCOPES: &[&str] = &[SCOPE_CALENDAR_READONLY, SCOPE_DRIVE_APPDATA];
const LOOPBACK_TIMEOUT_SECS: u64 = 180;

pub struct OAuthState {
    pub refresh_lock: AsyncMutex<()>,
}

impl OAuthState {
    pub fn new() -> Self {
        Self {
            refresh_lock: AsyncMutex::new(()),
        }
    }
}

impl Default for OAuthState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Serialize, Clone)]
pub struct OAuthTokens {
    pub access_token: String,
    pub expires_at: i64, // Unix epoch seconds
    /// Scopes Google actually granted (parsed from token response `scope` field).
    /// Empty when the server omits the field (rare). Frontend uses this to know
    /// whether Drive sync is available without a fresh consent flow.
    pub granted_scopes: Vec<String>,
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn make_client(
    client_id: String,
    client_secret: Option<String>,
    redirect: Option<String>,
) -> Result<BasicClient, String> {
    // Google Desktop OAuth clients still ship with a client_secret that the
    // token endpoint requires, even with PKCE. Pass it through if provided.
    let mut client = BasicClient::new(
        ClientId::new(client_id),
        client_secret.filter(|s| !s.is_empty()).map(ClientSecret::new),
        AuthUrl::new(AUTH_URL.to_string()).map_err(|e| e.to_string())?,
        Some(TokenUrl::new(TOKEN_URL.to_string()).map_err(|e| e.to_string())?),
    );
    if let Some(redirect) = redirect {
        client = client.set_redirect_uri(RedirectUrl::new(redirect).map_err(|e| e.to_string())?);
    }
    Ok(client)
}

fn format_token_error<E: std::fmt::Debug + std::error::Error>(
    prefix: &str,
    e: RequestTokenError<E, oauth2::StandardErrorResponse<BasicErrorResponseType>>,
) -> String {
    match e {
        RequestTokenError::ServerResponse(err) => {
            let kind = format!("{:?}", err.error());
            let desc = err
                .error_description()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "(no description)".to_string());
            format!("{}: server response: {} - {}", prefix, kind, desc)
        }
        other => format!("{}: {}", prefix, other),
    }
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|e| e.to_string())
}

fn scopes_from_token<TT, TF>(tr: &oauth2::StandardTokenResponse<TF, TT>) -> Vec<String>
where
    TT: oauth2::TokenType,
    TF: oauth2::ExtraTokenFields,
{
    tr.scopes()
        .map(|s| s.iter().map(|sc| sc.to_string()).collect())
        .unwrap_or_default()
}

// `scopes` is optional: None/empty defaults to calendar.readonly only,
// preserving existing call sites that don't yet ask for Drive.
#[tauri::command]
pub async fn gcal_oauth_connect(
    client_id: String,
    client_secret: Option<String>,
    scopes: Option<Vec<String>>,
) -> Result<OAuthTokens, String> {
    // Reserve a free loopback port. Drop the listener immediately and let
    // tiny_http rebind below — there is a small race window but it is the
    // standard installed-app idiom (Google's docs).
    let port = {
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = listener
            .local_addr()
            .map_err(|e| e.to_string())?
            .port();
        drop(listener);
        port
    };

    let redirect_url = format!("http://127.0.0.1:{}", port);
    let client = make_client(client_id, client_secret, Some(redirect_url.clone()))?;

    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

    let requested_scopes: Vec<String> = match scopes {
        Some(s) if !s.is_empty() => s,
        _ => vec![SCOPE_CALENDAR_READONLY.to_string()],
    };
    // Reject anything outside the allowlist before opening a browser
    // session. A renderer asking for `drive` or `gmail` is a security
    // event, not a request to be helpfully forwarded.
    for scope in &requested_scopes {
        if !ALLOWED_SCOPES.iter().any(|allowed| allowed == scope) {
            return Err(format!(
                "scope not permitted by app: {} (allowed: {})",
                scope,
                ALLOWED_SCOPES.join(", ")
            ));
        }
    }

    let mut auth_req = client
        .authorize_url(CsrfToken::new_random)
        .set_pkce_challenge(pkce_challenge)
        .add_extra_param("access_type", "offline")
        .add_extra_param("prompt", "consent")
        // Preserve previously consented scopes when re-consenting for an
        // expanded set (e.g. user enables Drive sync after Calendar-only setup).
        .add_extra_param("include_granted_scopes", "true");
    for scope in &requested_scopes {
        auth_req = auth_req.add_scope(Scope::new(scope.clone()));
    }
    let (auth_url, csrf_token) = auth_req.url();

    webbrowser::open(auth_url.as_str()).map_err(|e| format!("failed to open browser: {}", e))?;

    let expected_state = csrf_token.secret().clone();

    // Run the blocking loopback HTTP server on a tokio blocking thread so we
    // do not block the async runtime.
    let (code, returned_state) = tokio::task::spawn_blocking(
        move || -> Result<(String, String), String> {
            let server = Server::http(("127.0.0.1", port))
                .map_err(|e| format!("loopback bind failed: {}", e))?;

            let request = server
                .recv_timeout(Duration::from_secs(LOOPBACK_TIMEOUT_SECS))
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "OAuth callback timed out".to_string())?;

            let full_url = format!("http://127.0.0.1{}", request.url());
            let parsed = Url::parse(&full_url).map_err(|e| e.to_string())?;

            let mut code: Option<String> = None;
            let mut state: Option<String> = None;
            let mut error: Option<String> = None;
            for (k, v) in parsed.query_pairs() {
                match k.as_ref() {
                    "code" => code = Some(v.into_owned()),
                    "state" => state = Some(v.into_owned()),
                    "error" => error = Some(v.into_owned()),
                    _ => {}
                }
            }

            let html_body = if error.is_some() || code.is_none() {
                "<html><body style=\"font-family: -apple-system, sans-serif; padding: 2em;\"><h2>接続に失敗しました</h2><p>Taskette に戻って再試行してくださいませ。</p></body></html>"
            } else {
                "<html><body style=\"font-family: -apple-system, sans-serif; padding: 2em;\"><h2>接続が完了しました</h2><p>このタブを閉じて Taskette にお戻りくださいませ。</p></body></html>"
            };
            let header: Header = "Content-Type: text/html; charset=utf-8"
                .parse()
                .map_err(|_| "header parse failed".to_string())?;
            let response = Response::from_string(html_body).with_header(header);
            let _ = request.respond(response);

            if let Some(err) = error {
                return Err(format!("OAuth provider returned error: {}", err));
            }
            let code = code.ok_or_else(|| "missing code in callback".to_string())?;
            let state = state.ok_or_else(|| "missing state in callback".to_string())?;
            Ok((code, state))
        },
    )
    .await
    .map_err(|e| format!("loopback task join failed: {}", e))??;

    if returned_state != expected_state {
        return Err("CSRF state mismatch — possible interception".to_string());
    }

    let token_result = client
        .exchange_code(AuthorizationCode::new(code))
        .set_pkce_verifier(pkce_verifier)
        .request_async(async_http_client)
        .await
        .map_err(|e| format!("token exchange failed: {}", e))?;

    let access_token = token_result.access_token().secret().clone();
    let expires_in = token_result
        .expires_in()
        .map(|d| d.as_secs() as i64)
        .unwrap_or(3600);
    let expires_at = now_unix() + expires_in;
    let granted_scopes = scopes_from_token(&token_result);

    // Google does not guarantee a refresh_token on every consent response,
    // particularly on incremental consent (e.g. user adding `drive.appdata`
    // to an existing `calendar.readonly` install). Persist only when one is
    // actually returned; otherwise keep whatever the keyring already holds
    // — it remains valid for both old and newly-granted scopes.
    let entry = keyring_entry()?;
    match token_result.refresh_token() {
        Some(rt) => entry
            .set_password(rt.secret())
            .map_err(|e| format!("keyring save failed: {}", e))?,
        None => {
            let has_existing = matches!(entry.get_password(), Ok(_));
            if !has_existing {
                return Err(
                    "no refresh_token returned and no prior token in keyring \
                     (verify access_type=offline + prompt=consent)"
                        .to_string(),
                );
            }
        }
    }

    Ok(OAuthTokens {
        access_token,
        expires_at,
        granted_scopes,
    })
}

#[tauri::command]
pub async fn gcal_oauth_silent_refresh(
    client_id: String,
    client_secret: Option<String>,
    state: tauri::State<'_, OAuthState>,
) -> Result<Option<OAuthTokens>, String> {
    let _guard = state.refresh_lock.lock().await;

    let entry = keyring_entry()?;
    let refresh_token = match entry.get_password() {
        Ok(rt) => rt,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => return Err(format!("keyring read failed: {}", e)),
    };

    let client = make_client(client_id, client_secret, None)?;

    let result = client
        .exchange_refresh_token(&RefreshToken::new(refresh_token))
        .request_async(async_http_client)
        .await;

    match result {
        Ok(tr) => {
            let access_token = tr.access_token().secret().clone();
            let expires_in = tr
                .expires_in()
                .map(|d| d.as_secs() as i64)
                .unwrap_or(3600);
            let expires_at = now_unix() + expires_in;
            let granted_scopes = scopes_from_token(&tr);

            // Google may rotate refresh tokens; persist the new one if returned.
            if let Some(new_rt) = tr.refresh_token() {
                let _ = entry.set_password(new_rt.secret());
            }

            Ok(Some(OAuthTokens {
                access_token,
                expires_at,
                granted_scopes,
            }))
        }
        Err(RequestTokenError::ServerResponse(err)) => {
            // invalid_grant => user revoked / refresh token expired => clear and signal disconnect
            if matches!(err.error(), BasicErrorResponseType::InvalidGrant) {
                let _ = entry.delete_credential();
                Ok(None)
            } else {
                Err(format!("oauth server error: {:?}", err.error()))
            }
        }
        Err(e) => Err(format!("refresh request failed: {}", e)),
    }
}

#[tauri::command]
pub async fn gcal_oauth_disconnect() -> Result<(), String> {
    let entry = keyring_entry()?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keyring delete failed: {}", e)),
    }
}

#[tauri::command]
pub async fn gcal_oauth_has_refresh_token() -> Result<bool, String> {
    let entry = keyring_entry()?;
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("keyring read failed: {}", e)),
    }
}
