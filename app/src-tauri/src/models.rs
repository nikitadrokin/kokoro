//! Kokoro model weights live outside the app bundle, in the app data
//! directory (`~/Library/Application Support/me.nkdr.kokoro/models` on macOS).
//! They are downloaded once on first launch and survive app updates, so
//! updates only ship the app itself.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State};

const MODELS_DIR: &str = "models";
const MODEL_DOWNLOAD_PROGRESS_EVENT: &str = "model-download-progress";
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(150);

pub(crate) struct ModelAsset {
    /// File name inside the app data `models/` directory.
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

#[derive(Default)]
pub(crate) struct ModelDownloadState {
    in_progress: AtomicBool,
}

struct DownloadGuard<'a>(&'a AtomicBool);

impl Drop for DownloadGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelStatus {
    installed: bool,
    downloading: bool,
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

fn installed_path(app: &AppHandle, asset: &ModelAsset) -> Result<PathBuf, String> {
    Ok(models_dir(app)?.join(asset.file_name))
}

/// A file counts as installed when it exists with the expected size. The full
/// SHA-256 check happens once, at download time, before the file is moved into
/// place, so it isn't repeated on every launch.
fn is_valid_file(path: &Path, asset: &ModelAsset) -> bool {
    fs::metadata(path)
        .map(|meta| meta.is_file() && meta.len() == asset.size)
        .unwrap_or(false)
}

fn dev_fallback_path(asset: &ModelAsset) -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let path = crate::repo_root().join(asset.dev_path);
    path.exists().then_some(path)
}

fn find_asset(app: &AppHandle, asset: &ModelAsset) -> Option<PathBuf> {
    if let Ok(path) = installed_path(app, asset) {
        if is_valid_file(&path, asset) {
            return Some(path);
        }
    }
    dev_fallback_path(asset)
}

/// Path to an installed model asset, or a user-facing error when it's missing.
pub(crate) fn resolve_asset_path(app: &AppHandle, asset: &ModelAsset) -> Result<PathBuf, String> {
    find_asset(app, asset).ok_or_else(|| {
        "The Kokoro voice model isn't installed yet. Download it from the setup screen, then try again."
            .to_string()
    })
}

#[tauri::command]
pub(crate) fn model_status(
    app: AppHandle,
    state: State<'_, ModelDownloadState>,
) -> Result<ModelStatus, String> {
    let missing_bytes = ALL_ASSETS
        .iter()
        .filter(|asset| find_asset(&app, asset).is_none())
        .map(|asset| asset.size)
        .sum::<u64>();

    Ok(ModelStatus {
        installed: missing_bytes == 0,
        downloading: state.in_progress.load(Ordering::SeqCst),
        missing_bytes,
        total_bytes: ALL_ASSETS.iter().map(|asset| asset.size).sum(),
        models_dir: models_dir(&app)?.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub(crate) async fn download_model(
    app: AppHandle,
    state: State<'_, ModelDownloadState>,
) -> Result<(), String> {
    if state
        .in_progress
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("The voice model is already downloading.".into());
    }
    let _guard = DownloadGuard(&state.in_progress);

    let dir = models_dir(&app)?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create the models folder: {error}"))?;

    let pending: Vec<&ModelAsset> = ALL_ASSETS
        .iter()
        .copied()
        .filter(|asset| find_asset(&app, asset).is_none())
        .collect();
    let total_bytes = pending.iter().map(|asset| asset.size).sum::<u64>();

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Could not start the download: {error}"))?;

    let mut completed_bytes = 0u64;
    for asset in pending {
        download_asset(&app, &client, &dir, asset, completed_bytes, total_bytes).await?;
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
