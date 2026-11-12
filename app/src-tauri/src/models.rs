//! Kokoro model weights live outside the app bundle, in the app data
//! directory (`~/Library/Application Support/me.nkdr.kokoro/models` on macOS),
//! so they survive app updates and updates only ship the app itself.
//!
//! Where a model asset is looked up, in order:
//! 1. The app data `models/` directory (downloaded or migrated copy).
//! 2. The app bundle's `models/` resources, for builds that still bundle the
//!    weights. On launch these are copied into app data, so a later update
//!    that drops them from the bundle doesn't need to download anything.
//! 3. The repo's `checkpoints/` and `data/` folders, in debug builds only.
//!
//! When none of these exist, the frontend triggers `download_model`.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State};

const MODELS_DIR: &str = "models";
const BUNDLED_MODELS_DIR: &str = "models";
const MODEL_DOWNLOAD_PROGRESS_EVENT: &str = "model-download-progress";
const MODEL_STATUS_CHANGED_EVENT: &str = "model-status-changed";
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(150);

pub(crate) struct ModelAsset {
    /// File name in the app data `models/` directory and in bundled resources.
    file_name: &'static str,
    /// Path relative to the repo root, used as a fallback in debug builds.
    dev_path: &'static str,
    url: &'static str,
    sha256: &'static str,
    size: u64,
}

pub(crate) const KOKORO_MODEL: ModelAsset = ModelAsset {
    file_name: "kokoro-v1.0-timestamped.onnx",
    dev_path: "checkpoints/kokoro-v1.0-timestamped.onnx",
    // Pinned to a specific commit so the weights can never change under us.
    url: "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped/resolve/dd4401a9add81ac692d20e240d22ec9dda82cc29/onnx/model.onnx",
    sha256: "651ea8291843a92276a4a003581a215cb07d15e47dde6fcfb1b768f9a1682054",
    size: 325_532_171,
};

pub(crate) const KOKORO_VOICES: ModelAsset = ModelAsset {
    file_name: "voices-v1.0.bin",
    dev_path: "data/voices-v1.0.bin",
    url: "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
    sha256: "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
    size: 28_214_398,
};

const ALL_ASSETS: [&ModelAsset; 2] = [&KOKORO_MODEL, &KOKORO_VOICES];

/// Guards against two model operations (download, migration, verify, delete)
/// touching the models folder at the same time.
#[derive(Default)]
pub(crate) struct ModelOperationState {
    busy: AtomicBool,
}

struct OperationGuard<'a>(&'a AtomicBool);

impl Drop for OperationGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn begin_operation(state: &ModelOperationState) -> Result<OperationGuard<'_>, String> {
    state
        .busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map(|_| OperationGuard(&state.busy))
        .map_err(|_| "Another voice model task is already running.".to_string())
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum ModelSource {
    Downloaded,
    Bundled,
    Development,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelStatus {
    installed: bool,
    /// Where the files in use come from; `None` when anything is missing.
    source: Option<ModelSource>,
    /// True while a download, migration, verification, or deletion runs.
    busy: bool,
    /// Bytes still to download for a complete install.
    missing_bytes: u64,
    total_bytes: u64,
    models_dir: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelDownloadProgress {
    downloaded_bytes: u64,
    total_bytes: u64,
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(MODELS_DIR))
        .map_err(|error| format!("Could not locate the app data folder: {error}"))
}

/// A file counts as present when it exists with the expected size. The full
/// SHA-256 check runs at download time (before the file is moved into place)
/// and on demand from Settings, so it isn't repeated on every launch.
fn has_expected_size(path: &Path, asset: &ModelAsset) -> bool {
    fs::metadata(path)
        .map(|meta| meta.is_file() && meta.len() == asset.size)
        .unwrap_or(false)
}

fn downloaded_path(app: &AppHandle, asset: &ModelAsset) -> Option<PathBuf> {
    let path = models_dir(app).ok()?.join(asset.file_name);
    has_expected_size(&path, asset).then_some(path)
}

fn bundled_path(app: &AppHandle, asset: &ModelAsset) -> Option<PathBuf> {
    let path = app
        .path()
        .resource_dir()
        .ok()?
        .join(BUNDLED_MODELS_DIR)
        .join(asset.file_name);
    has_expected_size(&path, asset).then_some(path)
}

fn dev_path(asset: &ModelAsset) -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let path = crate::repo_root().join(asset.dev_path);
    path.exists().then_some(path)
}

fn find_asset(app: &AppHandle, asset: &ModelAsset) -> Option<(PathBuf, ModelSource)> {
    downloaded_path(app, asset)
        .map(|path| (path, ModelSource::Downloaded))
        .or_else(|| bundled_path(app, asset).map(|path| (path, ModelSource::Bundled)))
        .or_else(|| dev_path(asset).map(|path| (path, ModelSource::Development)))
}

/// Path to a model asset, or a user-facing error when it's missing.
pub(crate) fn resolve_asset_path(app: &AppHandle, asset: &ModelAsset) -> Result<PathBuf, String> {
    find_asset(app, asset).map(|(path, _)| path).ok_or_else(|| {
        "The Kokoro voice model isn't downloaded yet. Wait for the download to finish, or start it from Settings."
            .to_string()
    })
}

fn current_status(app: &AppHandle, state: &ModelOperationState) -> Result<ModelStatus, String> {
    let found: Vec<Option<ModelSource>> = ALL_ASSETS
        .iter()
        .map(|asset| find_asset(app, asset).map(|(_, source)| source))
        .collect();

    let missing_bytes = ALL_ASSETS
        .iter()
        .zip(&found)
        .filter(|(_, source)| source.is_none())
        .map(|(asset, _)| asset.size)
        .sum::<u64>();

    // Report the "least permanent" source in use, so Settings reflects that
    // e.g. one file still comes from the bundle.
    let source = if missing_bytes > 0 {
        None
    } else if found.contains(&Some(ModelSource::Development)) {
        Some(ModelSource::Development)
    } else if found.contains(&Some(ModelSource::Bundled)) {
        Some(ModelSource::Bundled)
    } else {
        Some(ModelSource::Downloaded)
    };

    Ok(ModelStatus {
        installed: missing_bytes == 0,
        source,
        busy: state.busy.load(Ordering::SeqCst),
        missing_bytes,
        total_bytes: ALL_ASSETS.iter().map(|asset| asset.size).sum(),
        models_dir: models_dir(app)?.to_string_lossy().into_owned(),
    })
}

fn emit_status_changed(app: &AppHandle) {
    let _ = app.emit(MODEL_STATUS_CHANGED_EVENT, ());
}

#[tauri::command]
pub(crate) fn model_status(
    app: AppHandle,
    state: State<'_, ModelOperationState>,
) -> Result<ModelStatus, String> {
    current_status(&app, &state)
}

/// Copies weights bundled with the app into app data, so they survive an
/// update to a build that no longer bundles them. Runs once per launch in the
/// background; does nothing when app data already has them.
pub(crate) fn spawn_bundled_model_migration(app: AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ModelOperationState>();
        let pending: Vec<(&ModelAsset, PathBuf)> = ALL_ASSETS
            .iter()
            .copied()
            .filter(|asset| downloaded_path(&app, asset).is_none())
            .filter_map(|asset| bundled_path(&app, asset).map(|path| (asset, path)))
            .collect();
        if pending.is_empty() {
            return;
        }
        let Ok(_guard) = begin_operation(&state) else {
            return;
        };
        let Ok(dir) = models_dir(&app) else {
            return;
        };
        if let Err(error) = fs::create_dir_all(&dir) {
            log::warn!("Could not create the models folder: {error}");
            return;
        }

        for (asset, source) in pending {
            let part_path = dir.join(format!("{}.part", asset.file_name));
            let result = fs::copy(&source, &part_path)
                .and_then(|_| fs::rename(&part_path, dir.join(asset.file_name)));
            if let Err(error) = result {
                log::warn!("Could not copy bundled {}: {error}", asset.file_name);
                let _ = fs::remove_file(&part_path);
            }
        }
        drop(_guard);
        emit_status_changed(&app);
    });
}

#[tauri::command]
pub(crate) async fn download_model(
    app: AppHandle,
    state: State<'_, ModelOperationState>,
) -> Result<(), String> {
    let _guard = begin_operation(&state)?;
    emit_status_changed(&app);

    let result = download_missing_assets(&app).await;

    drop(_guard);
    emit_status_changed(&app);
    result
}

async fn download_missing_assets(app: &AppHandle) -> Result<(), String> {
    let dir = models_dir(app)?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create the models folder: {error}"))?;

    let pending: Vec<&ModelAsset> = ALL_ASSETS
        .iter()
        .copied()
        .filter(|asset| find_asset(app, asset).is_none())
        .collect();
    let total_bytes = pending.iter().map(|asset| asset.size).sum::<u64>();

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Could not start the download: {error}"))?;

    let mut completed_bytes = 0u64;
    for asset in pending {
        download_asset(app, &client, &dir, asset, completed_bytes, total_bytes).await?;
        completed_bytes += asset.size;
    }

    let _ = app.emit(
        MODEL_DOWNLOAD_PROGRESS_EVENT,
        ModelDownloadProgress {
            downloaded_bytes: total_bytes,
            total_bytes,
        },
    );
    Ok(())
}

async fn download_asset(
    app: &AppHandle,
    client: &reqwest::Client,
    dir: &Path,
    asset: &ModelAsset,
    completed_bytes: u64,
    total_bytes: u64,
) -> Result<(), String> {
    let final_path = dir.join(asset.file_name);
    let part_path = dir.join(format!("{}.part", asset.file_name));

    let mut response = client
        .get(asset.url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| format!("Could not download {}: {error}", asset.file_name))?;

    let mut file = fs::File::create(&part_path)
        .map_err(|error| format!("Could not write {}: {error}", asset.file_name))?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0u64;
    let mut last_emit = Instant::now();

    let result: Result<(), String> = async {
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("Download of {} was interrupted: {error}", asset.file_name))?
        {
            file.write_all(&chunk)
                .map_err(|error| format!("Could not write {}: {error}", asset.file_name))?;
            hasher.update(&chunk);
            downloaded += chunk.len() as u64;

            if last_emit.elapsed() >= PROGRESS_EMIT_INTERVAL {
                last_emit = Instant::now();
                let _ = app.emit(
                    MODEL_DOWNLOAD_PROGRESS_EVENT,
                    ModelDownloadProgress {
                        downloaded_bytes: completed_bytes + downloaded.min(asset.size),
                        total_bytes,
                    },
                );
            }
        }

        file.flush()
            .map_err(|error| format!("Could not write {}: {error}", asset.file_name))?;

        let digest = format!("{:x}", hasher.finalize_reset());
        if downloaded != asset.size || digest != asset.sha256 {
            return Err(format!(
                "{} didn't match the expected checksum. Please try the download again.",
                asset.file_name
            ));
        }
        Ok(())
    }
    .await;

    drop(file);
    if let Err(error) = result {
        let _ = fs::remove_file(&part_path);
        return Err(error);
    }

    fs::rename(&part_path, &final_path)
        .map_err(|error| format!("Could not install {}: {error}", asset.file_name))
}

fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Re-hashes the downloaded files. Corrupt ones are deleted so the next
/// download replaces them. Returns whether everything checked out.
#[tauri::command]
pub(crate) async fn verify_model(
    app: AppHandle,
    state: State<'_, ModelOperationState>,
) -> Result<bool, String> {
    let _guard = begin_operation(&state)?;
    emit_status_changed(&app);

    let task_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut all_valid = true;
        for asset in ALL_ASSETS {
            let Some((path, source)) = find_asset(&task_app, asset) else {
                all_valid = false;
                continue;
            };
            let valid = sha256_file(&path)
                .map(|digest| digest == asset.sha256)
                .unwrap_or(false);
            if !valid {
                all_valid = false;
                // Only ever delete our own copy, never bundle or repo files.
                if source == ModelSource::Downloaded {
                    let _ = fs::remove_file(&path);
                }
            }
        }
        all_valid
    })
    .await
    .map_err(|error| format!("Could not verify the voice model: {error}"));

    drop(_guard);
    emit_status_changed(&app);
    result
}

/// Deletes the downloaded copy from app data. Bundled and repo copies are
/// left alone.
#[tauri::command]
pub(crate) fn delete_downloaded_model(
    app: AppHandle,
    state: State<'_, ModelOperationState>,
) -> Result<(), String> {
    let guard = begin_operation(&state)?;
    let dir = models_dir(&app)?;
    let mut result = Ok(());
    for asset in ALL_ASSETS {
        for name in [asset.file_name.to_string(), format!("{}.part", asset.file_name)] {
            let path = dir.join(name);
            if path.exists() {
                if let Err(error) = fs::remove_file(&path) {
                    result = Err(format!("Could not delete {}: {error}", path.display()));
                }
            }
        }
    }
    drop(guard);
    emit_status_changed(&app);
    result
}

#[tauri::command]
pub(crate) fn reveal_models_dir(app: AppHandle) -> Result<(), String> {
    let dir = models_dir(&app)?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create the models folder: {error}"))?;
    crate::reveal_file_in_finder(&dir)
}
