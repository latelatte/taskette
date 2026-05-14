// Slice 22-B: Google Drive v3 client for appDataFolder snapshot sync.
//
// All operations target the user's hidden appDataFolder (drive.appdata scope).
// File naming convention (flat, no subfolders — appDataFolder is well suited
// for shallow layout):
//   - current.json            — latest synced snapshot
//   - history-{gen}.json      — rolling backup, one per successful Push gen
//   - __smoketest__.json      — used only by drive_smoke_test, removed after
//
// CAS strategy: each GET returns the file's HTTP ETag. Writes pass it back
// as `If-Match`; mismatch yields 412 which the caller (22-C) handles by
// re-Pulling and retrying. Drive API does honor If-Match on both metadata
// and resumable/multipart uploads — drive_smoke_test verifies this in situ.
//
// Error encoding: Tauri commands return `Result<T, String>`. Errors are
// prefixed so the frontend can branch on category:
//   PRECONDITION_FAILED:  ETag mismatch (412) — caller restarts Pull/merge/Push
//   NOT_FOUND:            file missing (404)
//   UNAUTHORIZED:         expired/revoked token (401) — refresh + retry
//   FORBIDDEN:            scope missing or quota (403)
//   RATE_LIMITED:         429 — caller backs off
//   <other>:              generic network/server error

use std::sync::atomic::{AtomicU64, Ordering};

use reqwest::{header, Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::json;

const DRIVE_API: &str = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API: &str = "https://www.googleapis.com/upload/drive/v3";
const APP_DATA_FOLDER: &str = "appDataFolder";
const CURRENT_NAME: &str = "current.json";
const SMOKETEST_NAME: &str = "__smoketest__.json";

static BOUNDARY_COUNTER: AtomicU64 = AtomicU64::new(0);

fn build_client() -> Result<Client, String> {
    Client::builder()
        .user_agent("taskette-sync/0.5")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("reqwest build failed: {}", e))
}

fn http_error_prefix(status: StatusCode) -> &'static str {
    match status {
        StatusCode::PRECONDITION_FAILED => "PRECONDITION_FAILED",
        StatusCode::NOT_FOUND => "NOT_FOUND",
        StatusCode::UNAUTHORIZED => "UNAUTHORIZED",
        StatusCode::FORBIDDEN => "FORBIDDEN",
        StatusCode::TOO_MANY_REQUESTS => "RATE_LIMITED",
        _ => "HTTP_ERROR",
    }
}

async fn check_status(resp: reqwest::Response) -> Result<reqwest::Response, String> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let body = resp.text().await.unwrap_or_default();
    Err(format!(
        "{}: drive {}: {}",
        http_error_prefix(status),
        status.as_u16(),
        body.chars().take(500).collect::<String>()
    ))
}

/// Pull the `ETag` header out of a response. Drive returns one on every
/// successful read AND write, including multipart upload responses — see
/// drive_smoke_test for the in-situ verification. Missing ETag is a hard
/// error: we never want to silently lose CAS for a subsequent Push.
fn etag_from_response(resp: &reqwest::Response, ctx: &str) -> Result<String, String> {
    resp.headers()
        .get(header::ETAG)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("drive {} response missing ETag header", ctx))
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DriveSnapshot {
    pub content: String,
    pub etag: String,
    pub file_id: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DrivePutResult {
    pub file_id: String,
    pub etag: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DriveHistoryEntry {
    pub file_id: String,
    pub name: String,
    /// Always `None` for entries from `drive_list_history` — history files
    /// are read-only backups, so CAS tokens aren't fetched in the listing
    /// (would cost an extra HEAD per entry). `Option` makes the absence
    /// explicit rather than encoding it as an empty string.
    pub etag: Option<String>,
    pub modified_time: Option<String>,
    pub size: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DriveSmokeReport {
    pub created: bool,
    pub updated_with_correct_etag: bool,
    pub stale_etag_returned_412: bool,
    pub cleaned_up: bool,
    pub messages: Vec<String>,
}

#[derive(Deserialize)]
struct FilesListResponse {
    files: Vec<FileMetadata>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileMetadata {
    id: String,
    name: String,
    #[serde(default)]
    modified_time: Option<String>,
    #[serde(default)]
    size: Option<String>,
}

/// Escape a literal for inclusion inside a single-quoted Drive query value.
/// Drive's docs (Search for files and folders) specify that `\` is the
/// escape character; both `\` and `'` need escaping. Names with embedded
/// backslashes are unlikely in our fixed file set but cheap to handle.
fn escape_drive_query_literal(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "\\'")
}

/// Search appDataFolder for files matching `name`. Returns all matches,
/// newest first. Drive does not enforce name uniqueness, so callers must
/// be prepared for duplicates (created by concurrent first-Push from two
/// devices) — that race is reconciled in 22-C.
async fn find_all_by_name(
    client: &Client,
    access_token: &str,
    name: &str,
) -> Result<Vec<FileMetadata>, String> {
    let q = format!(
        "name = '{}' and trashed = false",
        escape_drive_query_literal(name)
    );
    let resp = client
        .get(format!("{}/files", DRIVE_API))
        .bearer_auth(access_token)
        .query(&[
            ("spaces", APP_DATA_FOLDER),
            ("q", &q),
            ("fields", "files(id,name,modifiedTime,size)"),
            ("orderBy", "modifiedTime desc"),
            ("pageSize", "10"),
        ])
        .send()
        .await
        .map_err(|e| format!("drive find_by_name request: {}", e))?;
    let resp = check_status(resp).await?;
    let body: FilesListResponse = resp
        .json()
        .await
        .map_err(|e| format!("drive find_by_name parse: {}", e))?;
    Ok(body.files)
}

async fn find_by_name(
    client: &Client,
    access_token: &str,
    name: &str,
) -> Result<Option<FileMetadata>, String> {
    Ok(find_all_by_name(client, access_token, name)
        .await?
        .into_iter()
        .next())
}

/// GET a file's contents along with its etag. Caller passes the etag back to
/// drive_put_current as the CAS token.
async fn get_file_content(
    client: &Client,
    access_token: &str,
    file_id: &str,
) -> Result<(String, String), String> {
    let resp = client
        .get(format!("{}/files/{}", DRIVE_API, file_id))
        .bearer_auth(access_token)
        .query(&[("alt", "media")])
        .send()
        .await
        .map_err(|e| format!("drive get_file_content request: {}", e))?;
    let resp = check_status(resp).await?;
    let etag = etag_from_response(&resp, "get_file_content")?;
    let content = resp
        .text()
        .await
        .map_err(|e| format!("drive get_file_content body: {}", e))?;
    Ok((content, etag))
}

fn build_multipart_body(metadata: &serde_json::Value, content: &str, boundary: &str) -> String {
    let metadata_str =
        serde_json::to_string(metadata).expect("serializing controlled metadata never fails");
    format!(
        "--{b}\r\n\
         Content-Type: application/json; charset=UTF-8\r\n\r\n\
         {m}\r\n\
         --{b}\r\n\
         Content-Type: application/json; charset=UTF-8\r\n\r\n\
         {c}\r\n\
         --{b}--",
        b = boundary,
        m = metadata_str,
        c = content
    )
}

/// Generate a multipart boundary that doesn't appear inside `content` or
/// `metadata_str`. Uses nanosecond timestamp + per-process counter + retry
/// suffix; statistically the first attempt always wins. Without this
/// check a snapshot payload containing the literal `--<boundary>` could
/// be parsed as a part terminator (RFC 2046 / Drive multipart-related).
fn generate_unique_boundary(content: &str, metadata_str: &str) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    for tries in 0u32..128 {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let counter = BOUNDARY_COUNTER.fetch_add(1, Ordering::Relaxed);
        let candidate = format!(
            "taskette_boundary_{:x}_{:x}_{:x}",
            nanos, counter, tries
        );
        let marker = format!("--{}", candidate);
        if !content.contains(&marker) && !metadata_str.contains(&marker) {
            return candidate;
        }
    }
    // Statistically unreachable; bail with a deliberately ugly emergency
    // boundary that callers should still try.
    format!(
        "taskette_boundary_emergency_{:x}",
        BOUNDARY_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

async fn upload_create(
    client: &Client,
    access_token: &str,
    name: &str,
    content: &str,
) -> Result<DrivePutResult, String> {
    let metadata = json!({
        "name": name,
        "parents": [APP_DATA_FOLDER],
    });
    let metadata_str = serde_json::to_string(&metadata)
        .expect("serializing controlled metadata never fails");
    let boundary = generate_unique_boundary(content, &metadata_str);
    let body = build_multipart_body(&metadata, content, &boundary);

    let resp = client
        .post(format!("{}/files", DRIVE_UPLOAD_API))
        .bearer_auth(access_token)
        .query(&[("uploadType", "multipart"), ("fields", "id")])
        .header(
            header::CONTENT_TYPE,
            format!("multipart/related; boundary={}", boundary),
        )
        .body(body)
        .send()
        .await
        .map_err(|e| format!("drive upload_create request: {}", e))?;
    let resp = check_status(resp).await?;

    // Read ETag from the upload response itself — a separate post-write
    // GET would race against concurrent updates by another device. Drive's
    // upload endpoint sets ETag on the response; drive_smoke_test
    // (Critical from design review) verifies this contract per release.
    let etag = etag_from_response(&resp, "upload_create")?;
    #[derive(Deserialize)]
    struct CreateResp {
        id: String,
    }
    let create: CreateResp = resp
        .json()
        .await
        .map_err(|e| format!("drive upload_create parse: {}", e))?;
    Ok(DrivePutResult {
        file_id: create.id,
        etag,
    })
}

async fn upload_update_with_cas(
    client: &Client,
    access_token: &str,
    file_id: &str,
    content: &str,
    if_match_etag: &str,
) -> Result<DrivePutResult, String> {
    let metadata = json!({});
    let metadata_str = serde_json::to_string(&metadata)
        .expect("serializing controlled metadata never fails");
    let boundary = generate_unique_boundary(content, &metadata_str);
    let body = build_multipart_body(&metadata, content, &boundary);

    let resp = client
        .patch(format!("{}/files/{}", DRIVE_UPLOAD_API, file_id))
        .bearer_auth(access_token)
        .query(&[("uploadType", "multipart"), ("fields", "id")])
        .header(
            header::CONTENT_TYPE,
            format!("multipart/related; boundary={}", boundary),
        )
        .header(header::IF_MATCH, if_match_etag)
        .body(body)
        .send()
        .await
        .map_err(|e| format!("drive upload_update request: {}", e))?;
    let resp = check_status(resp).await?;

    let etag = etag_from_response(&resp, "upload_update")?;
    #[derive(Deserialize)]
    struct UpdateResp {
        id: String,
    }
    let updated: UpdateResp = resp
        .json()
        .await
        .map_err(|e| format!("drive upload_update parse: {}", e))?;
    Ok(DrivePutResult {
        file_id: updated.id,
        etag,
    })
}

async fn delete_by_id(client: &Client, access_token: &str, file_id: &str) -> Result<(), String> {
    let resp = client
        .delete(format!("{}/files/{}", DRIVE_API, file_id))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("drive delete request: {}", e))?;
    // 204 No Content is the success path.
    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }
    let body = resp.text().await.unwrap_or_default();
    Err(format!(
        "{}: drive delete {}: {}",
        http_error_prefix(status),
        status.as_u16(),
        body.chars().take(500).collect::<String>()
    ))
}

// =========================
// Tauri commands
// =========================

#[tauri::command]
pub async fn drive_get_current(access_token: String) -> Result<Option<DriveSnapshot>, String> {
    let client = build_client()?;
    let matches = find_all_by_name(&client, &access_token, CURRENT_NAME).await?;
    // Two devices racing on first-Push can each create a separate
    // `current.json` (Drive does not enforce name uniqueness). Refuse to
    // pick one silently — the caller (22-C) reconciles by merging both
    // and deleting the loser, then retries.
    if matches.len() > 1 {
        let ids: Vec<String> = matches.iter().map(|m| m.id.clone()).collect();
        return Err(format!(
            "DUPLICATE_NAME: {} files named {} in appDataFolder: {:?}",
            matches.len(),
            CURRENT_NAME,
            ids
        ));
    }
    let Some(meta) = matches.into_iter().next() else {
        return Ok(None);
    };
    let (content, etag) = get_file_content(&client, &access_token, &meta.id).await?;
    Ok(Some(DriveSnapshot {
        content,
        etag,
        file_id: meta.id,
    }))
}

// `file_id`: from a prior drive_get_current. Pass None on first publish
//   (no existing current.json on Drive).
// `if_match_etag`: from a prior drive_get_current. Required when `file_id` is
//   supplied; the update aborts with PRECONDITION_FAILED if Drive's etag no
//   longer matches (another device updated current.json in between). Passing
//   None alongside Some(file_id) is rejected — that would be an unguarded
//   overwrite and silently bypass CAS.
#[tauri::command]
pub async fn drive_put_current(
    access_token: String,
    content: String,
    file_id: Option<String>,
    if_match_etag: Option<String>,
) -> Result<DrivePutResult, String> {
    let client = build_client()?;
    match (file_id, if_match_etag) {
        (None, _) => upload_create(&client, &access_token, CURRENT_NAME, &content).await,
        (Some(id), Some(etag)) => {
            upload_update_with_cas(&client, &access_token, &id, &content, &etag).await
        }
        (Some(_), None) => Err(
            "PRECONDITION_REQUIRED: drive_put_current requires if_match_etag \
             when file_id is provided; an unguarded overwrite would bypass CAS"
                .to_string(),
        ),
    }
}

#[tauri::command]
pub async fn drive_create_history(
    access_token: String,
    generation: i64,
    content: String,
) -> Result<DrivePutResult, String> {
    let client = build_client()?;
    let name = format!("history-{}.json", generation);
    upload_create(&client, &access_token, &name, &content).await
}

#[tauri::command]
pub async fn drive_list_history(
    access_token: String,
) -> Result<Vec<DriveHistoryEntry>, String> {
    let client = build_client()?;
    let resp = client
        .get(format!("{}/files", DRIVE_API))
        .bearer_auth(&access_token)
        .query(&[
            ("spaces", APP_DATA_FOLDER),
            ("q", "name contains 'history-' and trashed = false"),
            ("fields", "files(id,name,modifiedTime,size)"),
            ("orderBy", "modifiedTime desc"),
            ("pageSize", "50"),
        ])
        .send()
        .await
        .map_err(|e| format!("drive list_history request: {}", e))?;
    let resp = check_status(resp).await?;
    let body: FilesListResponse = resp
        .json()
        .await
        .map_err(|e| format!("drive list_history parse: {}", e))?;

    let mut out = Vec::with_capacity(body.files.len());
    for f in body.files {
        out.push(DriveHistoryEntry {
            file_id: f.id,
            name: f.name,
            etag: None,
            modified_time: f.modified_time,
            size: f.size.and_then(|s| s.parse().ok()),
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn drive_delete_file(access_token: String, file_id: String) -> Result<(), String> {
    let client = build_client()?;
    delete_by_id(&client, &access_token, &file_id).await
}

/// Inner body of drive_smoke_test. Returns the file id that needs cleanup
/// (None if the test never created anything). Errors are accumulated into
/// `report.messages` so a single cleanup path can fire regardless of which
/// step failed.
async fn run_smoke_test_steps(
    client: &Client,
    access_token: &str,
    report: &mut DriveSmokeReport,
) -> Option<String> {
    // Wipe any leftover from a prior aborted run.
    if let Ok(Some(prev)) = find_by_name(client, access_token, SMOKETEST_NAME).await {
        let _ = delete_by_id(client, access_token, &prev.id).await;
    }

    // 1) Create.
    let created = match upload_create(client, access_token, SMOKETEST_NAME, "{\"smoke\":1}").await {
        Ok(c) => c,
        Err(e) => {
            report.messages.push(format!("create failed: {}", e));
            return None;
        }
    };
    report.created = true;
    report.messages.push(format!("created id={}", created.file_id));
    let first_etag = created.etag.clone();
    let file_id = created.file_id.clone();

    // 2) Update with the correct (fresh) etag — must succeed.
    match upload_update_with_cas(client, access_token, &file_id, "{\"smoke\":2}", &first_etag).await
    {
        Ok(u) => {
            report.updated_with_correct_etag = true;
            report
                .messages
                .push(format!("fresh-etag update ok, new etag={}", u.etag));
        }
        Err(e) => {
            report
                .messages
                .push(format!("fresh-etag update unexpectedly failed: {}", e));
            return Some(file_id);
        }
    }

    // 3) Update with the now-stale etag — must 412.
    match upload_update_with_cas(client, access_token, &file_id, "{\"smoke\":3}", &first_etag).await
    {
        Err(e) if e.starts_with("PRECONDITION_FAILED:") => {
            report.stale_etag_returned_412 = true;
            report
                .messages
                .push("stale-etag update correctly returned 412".to_string());
        }
        Ok(_) => {
            report
                .messages
                .push("stale-etag update unexpectedly succeeded — CAS NOT enforced".to_string());
        }
        Err(e) => {
            report
                .messages
                .push(format!("stale-etag update errored (not 412): {}", e));
        }
    }

    Some(file_id)
}

/// In-situ smoke test for the If-Match (412) contract on the multipart
/// upload endpoint. Creates `__smoketest__.json`, updates it with the
/// current etag (must succeed), then updates again with a stale etag (must
/// 412), then deletes. Each step's outcome is reported.
///
/// Caller (22-C) must treat `staleEtagReturned412 == false` as a hard
/// failure and refuse to enable Drive sync — that would mean the entire
/// CAS strategy is unenforced on this Drive deployment.
#[tauri::command]
pub async fn drive_smoke_test(access_token: String) -> Result<DriveSmokeReport, String> {
    let client = build_client()?;
    let mut report = DriveSmokeReport::default();

    // Run the test steps and capture the file id (if any) that needs
    // cleanup. Centralizing cleanup here guarantees no exit path leaks
    // __smoketest__.json into appDataFolder.
    let leftover = run_smoke_test_steps(&client, &access_token, &mut report).await;

    if let Some(file_id) = leftover {
        match delete_by_id(&client, &access_token, &file_id).await {
            Ok(()) => {
                report.cleaned_up = true;
                report.messages.push("cleanup ok".to_string());
            }
            Err(e) => {
                report.messages.push(format!("cleanup failed: {}", e));
            }
        }
    } else if !report.created {
        // We never created the file, so there is nothing to clean up.
        report.cleaned_up = true;
    }

    Ok(report)
}
