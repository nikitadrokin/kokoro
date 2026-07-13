mod gmail;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsString,
    fs,
    io::{Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::{
    process::{CommandEvent, Output},
    ShellExt,
};
use tauri_plugin_updater::{Update, UpdaterExt};

const KOKO_SIDECAR: &str = "koko";
const MODEL_RESOURCE_PATH: &str = "models/kokoro-v1.0.onnx";
const VOICES_RESOURCE_PATH: &str = "models/voices-v1.0.bin";
const DEV_MODEL_PATH: &str = "checkpoints/kokoro-v1.0.onnx";
const DEV_VOICES_PATH: &str = "data/voices-v1.0.bin";
const SPEECH_STREAM_CHUNK_EVENT: &str = "speech-stream-chunk";
const STREAM_SAMPLE_RATE: u32 = 24_000;
const STREAM_CHANNELS: u16 = 1;
const WAV_HEADER_BYTES: usize = 44;
const FLOAT_SAMPLE_BYTES: usize = 4;
const MAX_STREAM_CHUNK_CHARS: usize = 240;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SynthesizeSpeechRequest {
    text: String,
    language: Option<String>,
    style: Option<String>,
    speed: Option<f32>,
    model_path: Option<String>,
    data_path: Option<String>,
    output_path: Option<String>,
    output_label: Option<String>,
    output_subdir: Option<String>,
    save_to_disk: Option<bool>,
    initial_silence: Option<usize>,
    mono: bool,
    timestamps: bool,
    stream_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TimestampRow {
    word: String,
    start_sec: f32,
    end_sec: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SynthesizeSpeechResponse {
    audio_base64: Option<String>,
    sample_rate: u32,
    saved_output_path: Option<String>,
    saved_timestamps_path: Option<String>,
    timestamps: Vec<TimestampRow>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SynthesizeSpeechStreamResponse {
    sample_rate: u32,
    channels: u16,
    saved_output_path: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SpeechStreamChunkEvent {
    stream_id: String,
    audio_base64: String,
    sample_rate: u32,
    channels: u16,
    sample_format: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedAudioFile {
    name: String,
    path: String,
    modified_sec: Option<u64>,
    size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EpubFilePayload {
    id: Option<String>,
    file_name: String,
    file_path: String,
    imported_path: Option<String>,
    original_path: Option<String>,
    file_size: u64,
    file_last_modified: u64,
    bytes_base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedEpubPayload {
    id: String,
    file_name: String,
    file_path: String,
    imported_path: String,
    original_path: String,
    file_size: u64,
    file_last_modified: u64,
    bytes_base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedEpubBook {
    id: String,
    name: String,
    path: String,
    modified_sec: Option<u64>,
    size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateResponse {
    status: AppUpdateStatus,
    version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
enum AppUpdateStatus {
    Prepared,
    UpToDate,
    Restarting,
}

#[derive(Default)]
struct PreparedAppUpdateState {
    update: Mutex<Option<PreparedAppUpdate>>,
}

struct PreparedAppUpdate {
    version: String,
    update: Update,
    bytes: Vec<u8>,
}

#[tauri::command]
async fn synthesize_speech(
    request: SynthesizeSpeechRequest,
    app: AppHandle,
) -> Result<SynthesizeSpeechResponse, String> {
    let text = request.text.trim().to_string();
    if text.is_empty() {
        return Err("Enter some text before generating audio.".into());
    }

    let language = request
        .language
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("en-us")
        .to_string();
    let style = request
        .style
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("af_heart")
        .to_string();
    let speed = request.speed.unwrap_or(1.0);
    let timestamps_requested = request.timestamps;
    let mono = request.mono;
    let save_to_disk = request.save_to_disk.unwrap_or(false);

    let model_path = resolve_input_or_resource(
        &app,
        request.model_path.as_deref(),
        MODEL_RESOURCE_PATH,
        DEV_MODEL_PATH,
    )?;
    let data_path = resolve_input_or_resource(
        &app,
        request.data_path.as_deref(),
        VOICES_RESOURCE_PATH,
        DEV_VOICES_PATH,
    )?;

    let requested_output_path = request
        .output_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let should_keep_output = requested_output_path.is_some() || save_to_disk;
    let output_path = if let Some(path) = requested_output_path {
        resolve_output_path(&app, path)?
    } else if save_to_disk {
        create_saved_output_path(
            &app,
            request.output_label.as_deref(),
            request.output_subdir.as_deref(),
        )?
    } else {
        create_temp_output_path(&app)?
    };

    ensure_parent_dir(&output_path)?;

    let mut args = Vec::<OsString>::new();
    args.extend([
        OsString::from("--lan"),
        OsString::from(language),
        OsString::from("--model"),
        model_path.into_os_string(),
        OsString::from("--data"),
        data_path.into_os_string(),
        OsString::from("--style"),
        OsString::from(style),
        OsString::from("--speed"),
        OsString::from(speed.to_string()),
    ]);

    if mono {
        args.push(OsString::from("--mono"));
    }

    if let Some(initial_silence) = request.initial_silence {
        args.push(OsString::from("--initial-silence"));
        args.push(OsString::from(initial_silence.to_string()));
    }

    if timestamps_requested {
        args.push(OsString::from("--timestamps"));
    }

    args.push(OsString::from("text"));
    args.push(OsString::from("--output"));
    args.push(output_path.clone().into_os_string());
    args.push(OsString::from(text));

    let output = app
        .shell()
        .sidecar(KOKO_SIDECAR)
        .map_err(|error| error.to_string())?
        .args(args)
        .output()
        .await
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Err(format_command_failure(&output));
    }

    let audio_base64 = if should_keep_output {
        if !output_path.exists() {
            return Err(format!(
                "koko completed but did not create `{}`. {}",
                output_path.display(),
                command_log(&output)
            ));
        }
        None
    } else {
        let wav_bytes = fs::read(&output_path).map_err(|error| {
            format!(
                "Failed to read generated audio: {error}. {}",
                command_log(&output)
            )
        })?;
        Some(BASE64.encode(wav_bytes))
    };

    let tsv_path = derive_tsv_path_from_wav(&output_path);
    let timestamps = if timestamps_requested {
        read_timestamps(&tsv_path)?
    } else {
        Vec::new()
    };

    let saved_output_path = should_keep_output.then(|| output_path.display().to_string());
    let saved_timestamps_path = if timestamps_requested && should_keep_output {
        Some(tsv_path.display().to_string())
    } else {
        None
    };

    if !should_keep_output {
        let _ = fs::remove_file(&output_path);
        if timestamps_requested {
            let _ = fs::remove_file(&tsv_path);
        }
    }

    Ok(SynthesizeSpeechResponse {
        audio_base64,
        sample_rate: 24_000,
        saved_output_path,
        saved_timestamps_path,
        timestamps,
    })
}

#[tauri::command]
async fn synthesize_speech_stream(
    request: SynthesizeSpeechRequest,
    app: AppHandle,
) -> Result<SynthesizeSpeechStreamResponse, String> {
    let text = request.text.trim().to_string();
    if text.is_empty() {
        return Err("Enter some text before generating audio.".into());
    }

    if request.timestamps {
        return Err("Word timestamps are not supported while streaming.".into());
    }

    let language = request
        .language
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("en-us")
        .to_string();
    let style = request
        .style
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("af_heart")
        .to_string();
    let speed = request.speed.unwrap_or(1.0);
    let save_to_disk = request.save_to_disk.unwrap_or(false);
    let stream_id = request
        .stream_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("default")
        .to_string();

    let model_path = resolve_input_or_resource(
        &app,
        request.model_path.as_deref(),
        MODEL_RESOURCE_PATH,
        DEV_MODEL_PATH,
    )?;
    let data_path = resolve_input_or_resource(
        &app,
        request.data_path.as_deref(),
        VOICES_RESOURCE_PATH,
        DEV_VOICES_PATH,
    )?;

    let requested_output_path = request
        .output_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let should_keep_output = requested_output_path.is_some() || save_to_disk;
    let output_path = if let Some(path) = requested_output_path {
        Some(resolve_output_path(&app, path)?)
    } else if save_to_disk {
        Some(create_saved_output_path(
            &app,
            request.output_label.as_deref(),
            request.output_subdir.as_deref(),
        )?)
    } else {
        None
    };

    if let Some(path) = output_path.as_ref() {
        ensure_parent_dir(path)?;
    }

    let text_chunks = chunk_text_for_stream(&text);
    if text_chunks.is_empty() {
        return Err("Enter some text before generating audio.".into());
    }

    let mut args = Vec::<OsString>::new();
    args.extend([
        OsString::from("--lan"),
        OsString::from(language),
        OsString::from("--model"),
        model_path.into_os_string(),
        OsString::from("--data"),
        data_path.into_os_string(),
        OsString::from("--style"),
        OsString::from(style),
        OsString::from("--speed"),
        OsString::from(speed.to_string()),
    ]);

    if let Some(initial_silence) = request.initial_silence {
        args.push(OsString::from("--initial-silence"));
        args.push(OsString::from(initial_silence.to_string()));
    }

    args.push(OsString::from("stream"));

    let mut output_file = if let Some(path) = output_path.as_ref() {
        Some(fs::File::create(path).map_err(|error| {
            format!(
                "Failed to create streaming output `{}`: {error}",
                path.display()
            )
        })?)
    } else {
        None
    };

    let (mut rx, mut child) = app
        .shell()
        .sidecar(KOKO_SIDECAR)
        .map_err(|error| error.to_string())?
        .args(args)
        .set_raw_out(true)
        .spawn()
        .map_err(|error| error.to_string())?;

    let writer_task = tauri::async_runtime::spawn_blocking(move || {
        for chunk in text_chunks {
            child.write(format!("{chunk}\n").as_bytes())?;
        }

        Ok::<(), tauri_plugin_shell::Error>(())
    });

    let mut stderr = Vec::new();
    let mut wav_header = Vec::with_capacity(WAV_HEADER_BYTES);
    let mut pending_sample_bytes = Vec::with_capacity(FLOAT_SAMPLE_BYTES);
    let mut total_stdout_bytes = 0u64;
    let mut exit_code = None;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                if bytes.is_empty() {
                    continue;
                }

                total_stdout_bytes = total_stdout_bytes.saturating_add(bytes.len() as u64);
                if let Some(file) = output_file.as_mut() {
                    file.write_all(&bytes).map_err(|error| {
                        format!("Failed to write streamed audio to disk: {error}")
                    })?;
                }

                let audio_bytes = strip_stream_wav_header(&mut wav_header, &bytes)?;
                emit_stream_audio_bytes(&app, &stream_id, audio_bytes, &mut pending_sample_bytes)?;
            }
            CommandEvent::Stderr(bytes) => {
                append_limited_command_bytes(&mut stderr, &bytes);
            }
            CommandEvent::Error(error) => {
                return Err(format!("Failed while reading koko stream: {error}"));
            }
            CommandEvent::Terminated(payload) => {
                exit_code = payload.code;
                break;
            }
            _ => {}
        }
    }

    writer_task
        .await
        .map_err(|error| format!("Failed to finish sending text to koko: {error}"))?
        .map_err(|error| format!("Failed to send text to koko: {error}"))?;

    if !pending_sample_bytes.is_empty() {
        return Err("koko stream ended with a partial float sample.".to_string());
    }

    if let Some(file) = output_file.as_mut() {
        if total_stdout_bytes < WAV_HEADER_BYTES as u64 {
            return Err("koko stream ended before writing a complete WAV header.".to_string());
        }

        let data_bytes = total_stdout_bytes - WAV_HEADER_BYTES as u64;
        patch_stream_wav_header(file, data_bytes)?;
    }

    if exit_code != Some(0) {
        return Err(format_stream_command_failure(exit_code, &stderr));
    }

    Ok(SynthesizeSpeechStreamResponse {
        sample_rate: STREAM_SAMPLE_RATE,
        channels: STREAM_CHANNELS,
        saved_output_path: output_path
            .filter(|_| should_keep_output)
            .map(|path| path.display().to_string()),
    })
}

#[tauri::command]
fn list_saved_audio(app: AppHandle) -> Result<Vec<SavedAudioFile>, String> {
    let base_dir = saved_audio_dir(&app)?;

    if !base_dir.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    collect_saved_audio_files(&base_dir, &base_dir, &mut files)?;

    files.sort_by(|left, right| {
        right
            .modified_sec
            .cmp(&left.modified_sec)
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(files)
}

fn collect_saved_audio_files(
    base_dir: &Path,
    current_dir: &Path,
    files: &mut Vec<SavedAudioFile>,
) -> Result<(), String> {
    for entry in fs::read_dir(current_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let metadata = entry.metadata().map_err(|error| error.to_string())?;

        if metadata.is_dir() {
            collect_saved_audio_files(base_dir, &path, files)?;
            continue;
        }

        if !metadata.is_file() || path.extension().and_then(|value| value.to_str()) != Some("wav") {
            continue;
        }

        let modified_sec = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_secs());
        let name = path
            .strip_prefix(base_dir)
            .unwrap_or(&path)
            .display()
            .to_string();

        files.push(SavedAudioFile {
            name,
            path: path.display().to_string(),
            modified_sec,
            size_bytes: metadata.len(),
        });
    }

    Ok(())
}

#[tauri::command]
fn delete_saved_audio(path: String, app: AppHandle) -> Result<(), String> {
    let base_dir = saved_audio_dir(&app)?;
    let saved_path = resolve_saved_audio_path(&base_dir, &path)?;
    let timestamps_path = derive_tsv_path_from_wav(&saved_path);

    fs::remove_file(&saved_path).map_err(|error| {
        format!(
            "Failed to delete saved audio `{}`: {error}",
            saved_path.display()
        )
    })?;

    if timestamps_path.exists() {
        let _ = fs::remove_file(timestamps_path);
    }

    Ok(())
}

#[tauri::command]
fn reveal_saved_audio_in_finder(path: String, app: AppHandle) -> Result<(), String> {
    let base_dir = saved_audio_dir(&app)?;
    let saved_path = resolve_saved_audio_path(&base_dir, &path)?;

    reveal_file_in_finder(&saved_path)
}

fn validate_epub_path(path: &Path, label: &str) -> Result<(), String> {
    if !path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("epub"))
    {
        return Err(format!("The {label} book path is not an EPUB file."));
    }

    Ok(())
}

fn epub_file_payload(
    path: &Path,
    id: Option<String>,
    imported_path: Option<String>,
    original_path: Option<String>,
) -> Result<EpubFilePayload, String> {
    validate_epub_path(path, "saved")?;

    let metadata = fs::metadata(path)
        .map_err(|error| format!("Failed to inspect EPUB `{}`: {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("EPUB `{}` is not a file.", path.display()));
    }

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("book.epub")
        .to_string();
    let file_last_modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0);
    let bytes = fs::read(path)
        .map_err(|error| format!("Failed to read EPUB `{}`: {error}", path.display()))?;

    Ok(EpubFilePayload {
        id,
        file_name,
        file_path: path.display().to_string(),
        imported_path,
        original_path,
        file_size: metadata.len(),
        file_last_modified,
        bytes_base64: BASE64.encode(bytes),
    })
}

fn app_data_books_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("books"))
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))
}

fn resolve_imported_epub_path(app: &AppHandle, imported_path: &str) -> Result<PathBuf, String> {
    let imported_path = imported_path.trim();
    if imported_path.is_empty() {
        return Err("Imported EPUB path is empty.".to_string());
    }

    let relative_path = PathBuf::from(imported_path);
    if relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("Imported EPUB path must stay inside app data.".to_string());
    }

    Ok(app_data_books_dir(app)?.join(relative_path))
}

fn create_imported_book_id(source_path: &Path) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    let sanitized_stem = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("book")
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    let stem = sanitized_stem
        .split('-')
        .filter(|part| !part.is_empty())
        .take(4)
        .collect::<Vec<_>>()
        .join("-");

    let prefix = if stem.is_empty() { "book" } else { &stem };
    format!("{timestamp}-{prefix}")
}

#[tauri::command]
fn import_epub_file(path: String, app: AppHandle) -> Result<ImportedEpubPayload, String> {
    let path = PathBuf::from(path.trim());
    validate_epub_path(&path, "selected")?;

    let metadata = fs::metadata(&path).map_err(|error| {
        format!(
            "Failed to inspect selected EPUB `{}`: {error}",
            path.display()
        )
    })?;
    if !metadata.is_file() {
        return Err(format!("Selected EPUB `{}` is not a file.", path.display()));
    }

    let id = create_imported_book_id(&path);
    let imported_path = format!("{id}/book.epub");
    let destination = resolve_imported_epub_path(&app, &imported_path)?;
    ensure_parent_dir(&destination)?;
    fs::copy(&path, &destination).map_err(|error| {
        format!(
            "Failed to import EPUB `{}` into app data: {error}",
            path.display()
        )
    })?;

    let payload = epub_file_payload(
        &destination,
        Some(id.clone()),
        Some(imported_path.clone()),
        Some(path.display().to_string()),
    )?;

    Ok(ImportedEpubPayload {
        id,
        file_name: payload.file_name,
        file_path: payload.file_path,
        imported_path,
        original_path: path.display().to_string(),
        file_size: payload.file_size,
        file_last_modified: payload.file_last_modified,
        bytes_base64: payload.bytes_base64,
    })
}

#[tauri::command]
fn read_imported_epub_file(
    imported_path: String,
    app: AppHandle,
) -> Result<EpubFilePayload, String> {
    let path = resolve_imported_epub_path(&app, &imported_path)?;
    let id = Path::new(&imported_path)
        .components()
        .next()
        .and_then(|component| match component {
            std::path::Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .map(ToString::to_string);
    epub_file_payload(&path, id, Some(imported_path), None)
}

#[tauri::command]
fn list_imported_epub_books(app: AppHandle) -> Result<Vec<ImportedEpubBook>, String> {
    let base_dir = app_data_books_dir(&app)?;

    if !base_dir.exists() {
        return Ok(Vec::new());
    }

    let mut books = Vec::new();
    for entry in fs::read_dir(&base_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let book_dir = entry.path();
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        if !metadata.is_dir() {
            continue;
        }

        let Some(id) = book_dir
            .file_name()
            .and_then(|value| value.to_str())
            .map(ToString::to_string)
        else {
            continue;
        };
        let book_path = book_dir.join("book.epub");
        let Ok(book_metadata) = fs::metadata(&book_path) else {
            continue;
        };
        if !book_metadata.is_file() {
            continue;
        }

        let modified_sec = book_metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_secs());

        books.push(ImportedEpubBook {
            id: id.clone(),
            name: "book.epub".to_string(),
            path: format!("{id}/book.epub"),
            modified_sec,
            size_bytes: book_metadata.len(),
        });
    }

    books.sort_by(|left, right| {
        right
            .modified_sec
            .cmp(&left.modified_sec)
            .then_with(|| left.id.cmp(&right.id))
    });

    Ok(books)
}

#[tauri::command]
fn delete_imported_epub_book(imported_path: String, app: AppHandle) -> Result<(), String> {
    let path = resolve_imported_epub_path(&app, &imported_path)?;
    let books_dir = app_data_books_dir(&app)?;
    let book_dir = path.parent().ok_or_else(|| {
        format!(
            "Failed to resolve imported EPUB parent directory for `{}`.",
            path.display()
        )
    })?;

    if book_dir.parent() != Some(books_dir.as_path()) {
        return Err("Imported EPUB deletion must target one app-owned book.".to_string());
    }

    fs::remove_dir_all(book_dir).map_err(|error| {
        format!(
            "Failed to delete imported EPUB `{}`: {error}",
            book_dir.display()
        )
    })
}

#[cfg(target_os = "macos")]
fn reveal_file_in_finder(path: &Path) -> Result<(), String> {
    let output = std::process::Command::new("/usr/bin/open")
        .arg("-R")
        .arg(path)
        .output()
        .map_err(|error| format!("Failed to open Finder: {error}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(format!(
        "Failed to reveal `{}` in Finder: {}",
        path.display(),
        if stderr.is_empty() {
            "open exited without an error message".to_string()
        } else {
            stderr
        }
    ))
}

#[cfg(not(target_os = "macos"))]
fn reveal_file_in_finder(_path: &Path) -> Result<(), String> {
    Err("Reveal in Finder is only available on macOS.".to_string())
}

#[tauri::command]
async fn prepare_app_update(
    app: AppHandle,
    prepared_update: State<'_, PreparedAppUpdateState>,
) -> Result<AppUpdateResponse, String> {
    let update = app
        .updater()
        .map_err(|error| format!("Failed to initialize updater: {error}"))?
        .check()
        .await
        .map_err(|error| format!("Failed to check for updates: {error}"))?;

    let Some(update) = update else {
        return Ok(AppUpdateResponse {
            status: AppUpdateStatus::UpToDate,
            version: None,
        });
    };

    let version = update.version.clone();
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|error| format!("Failed to download update: {error}"))?;

    let mut prepared = prepared_update
        .update
        .lock()
        .map_err(|_| "Failed to lock prepared update state".to_string())?;
    *prepared = Some(PreparedAppUpdate {
        version: version.clone(),
        update,
        bytes,
    });

    Ok(AppUpdateResponse {
        status: AppUpdateStatus::Prepared,
        version: Some(version),
    })
}

#[tauri::command]
async fn install_prepared_app_update(
    app: AppHandle,
    prepared_update: State<'_, PreparedAppUpdateState>,
) -> Result<AppUpdateResponse, String> {
    let prepared = prepared_update
        .update
        .lock()
        .map_err(|_| "Failed to lock prepared update state".to_string())?
        .take()
        .ok_or_else(|| "No prepared update found. Check for updates again.".to_string())?;

    let version = prepared.version;
    let quarantine_target = app_quarantine_target()?;
    prepared
        .update
        .install(prepared.bytes)
        .map_err(|error| format!("Failed to install update: {error}"))?;

    clear_installed_app_quarantine(quarantine_target.as_deref())?;
    repair_installed_app_signature_if_needed(quarantine_target.as_deref())?;
    app.request_restart();

    Ok(AppUpdateResponse {
        status: AppUpdateStatus::Restarting,
        version: Some(version),
    })
}

#[cfg(target_os = "macos")]
fn app_quarantine_target() -> Result<Option<PathBuf>, String> {
    current_app_bundle_path().map(Some)
}

#[cfg(not(target_os = "macos"))]
fn app_quarantine_target() -> Result<Option<PathBuf>, String> {
    Ok(None)
}

#[cfg(target_os = "macos")]
fn clear_installed_app_quarantine(app_bundle: Option<&Path>) -> Result<(), String> {
    let app_bundle = app_bundle.ok_or_else(|| "Missing app bundle path".to_string())?;
    let output = std::process::Command::new("/usr/bin/xattr")
        .args(["-cr"])
        .arg(app_bundle)
        .output()
        .map_err(|error| format!("Failed to run xattr: {error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(format!(
            "Failed to clear quarantine on `{}`: {}",
            app_bundle.display(),
            if stderr.is_empty() {
                "xattr exited without an error message".to_string()
            } else {
                stderr
            }
        ))
    }
}

#[cfg(target_os = "macos")]
fn repair_installed_app_signature_if_needed(app_bundle: Option<&Path>) -> Result<(), String> {
    let app_bundle = app_bundle.ok_or_else(|| "Missing app bundle path".to_string())?;
    if verify_app_signature(app_bundle) {
        return Ok(());
    }

    let macos_dir = app_bundle.join("Contents").join("MacOS");
    let entries = fs::read_dir(&macos_dir)
        .map_err(|error| format!("Failed to read `{}`: {error}", macos_dir.display()))?;

    for entry in entries {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.is_file() {
            ad_hoc_codesign(&path)?;
        }
    }

    ad_hoc_codesign(app_bundle)?;

    if verify_app_signature(app_bundle) {
        Ok(())
    } else {
        Err(format!(
            "Installed app signature still failed verification after ad-hoc signing `{}`",
            app_bundle.display()
        ))
    }
}

#[cfg(target_os = "macos")]
fn verify_app_signature(app_bundle: &Path) -> bool {
    std::process::Command::new("/usr/bin/codesign")
        .args(["--verify", "--deep", "--strict"])
        .arg(app_bundle)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn ad_hoc_codesign(path: &Path) -> Result<(), String> {
    let output = std::process::Command::new("/usr/bin/codesign")
        .args(["--force", "--sign", "-", "--timestamp=none"])
        .arg(path)
        .output()
        .map_err(|error| format!("Failed to run codesign: {error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(format!(
            "Failed to ad-hoc sign `{}`: {}",
            path.display(),
            if stderr.is_empty() {
                "codesign exited without an error message".to_string()
            } else {
                stderr
            }
        ))
    }
}

#[cfg(not(target_os = "macos"))]
fn clear_installed_app_quarantine(_app_bundle: Option<&Path>) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn repair_installed_app_signature_if_needed(_app_bundle: Option<&Path>) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn current_app_bundle_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let macos_dir = exe
        .parent()
        .ok_or_else(|| format!("Could not find parent directory for `{}`", exe.display()))?;
    let contents_dir = macos_dir
        .parent()
        .ok_or_else(|| format!("Could not find Contents directory for `{}`", exe.display()))?;
    let app_bundle = contents_dir
        .parent()
        .ok_or_else(|| format!("Could not find app bundle for `{}`", exe.display()))?;

    Ok(app_bundle.to_path_buf())
}

fn resolve_input_or_resource(
    app: &AppHandle,
    input: Option<&str>,
    resource_path: &str,
    dev_path: &str,
) -> Result<PathBuf, String> {
    if let Some(value) = input.map(str::trim).filter(|value| !value.is_empty()) {
        let path = Path::new(value);
        if path.is_absolute() {
            return Ok(path.to_path_buf());
        }

        let repo_path = repo_root().join(path);
        if repo_path.exists() {
            return Ok(repo_path);
        }

        return std::env::current_dir()
            .map(|dir| dir.join(path))
            .map_err(|error| error.to_string());
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled_path = resource_dir.join(resource_path);
        if bundled_path.exists() {
            return Ok(bundled_path);
        }
    }

    let dev_path = repo_root().join(dev_path);
    if dev_path.exists() {
        return Ok(dev_path);
    }

    app.path()
        .resource_dir()
        .map(|dir| dir.join(resource_path))
        .map_err(|error| error.to_string())
}

fn resolve_output_path(app: &AppHandle, input: &str) -> Result<PathBuf, String> {
    let path = Path::new(input);
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }

    app.path()
        .app_data_dir()
        .map(|dir| dir.join(path))
        .map_err(|error| error.to_string())
}

fn create_temp_output_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("synthesis");
    fs::create_dir_all(&base_dir).map_err(|error| error.to_string())?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();

    Ok(base_dir.join(format!("speech-{}-{timestamp}.wav", std::process::id())))
}

fn create_saved_output_path(
    app: &AppHandle,
    output_label: Option<&str>,
    output_subdir: Option<&str>,
) -> Result<PathBuf, String> {
    let base_dir = saved_audio_dir(app)?;
    let base_dir = match output_subdir {
        Some(value) => base_dir.join(sanitize_output_subdir(value)?),
        None => base_dir,
    };
    fs::create_dir_all(&base_dir).map_err(|error| error.to_string())?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let stem = output_label
        .map(|value| sanitize_filename_stem(value, "speech"))
        .unwrap_or_else(|| "speech".to_string());

    Ok(base_dir.join(format!("{stem}-{}-{timestamp}.wav", std::process::id())))
}

fn saved_audio_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("synthesis"))
        .map_err(|error| error.to_string())
}

fn sanitize_output_subdir(input: &str) -> Result<PathBuf, String> {
    let mut path = PathBuf::new();

    for part in input.split(['/', '\\']) {
        let part = part.trim();
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return Err("Saved audio folder cannot include parent directory segments.".to_string());
        }
        path.push(sanitize_filename_stem(part, "audio"));
    }

    Ok(path)
}

fn sanitize_filename_stem(input: &str, fallback: &str) -> String {
    let mut output = String::with_capacity(input.len().min(96));
    let mut last_was_separator = false;

    for character in input.chars() {
        let next = if character.is_ascii_alphanumeric() {
            Some(character)
        } else if matches!(character, ' ' | '-' | '_' | '.') {
            Some(character)
        } else {
            Some(' ')
        };

        if let Some(character) = next {
            let is_separator = character.is_ascii_whitespace() || character == '-';
            if is_separator && last_was_separator {
                continue;
            }

            if output.len() >= 96 {
                break;
            }

            output.push(if character.is_ascii_whitespace() {
                '-'
            } else {
                character
            });
            last_was_separator = is_separator;
        }
    }

    let sanitized = output
        .trim_matches(|character| matches!(character, '-' | '_' | '.' | ' '))
        .to_string();

    if sanitized.is_empty() {
        fallback.to_string()
    } else {
        sanitized
    }
}

fn resolve_saved_audio_path(base_dir: &Path, input: &str) -> Result<PathBuf, String> {
    let input_path = Path::new(input);
    if input_path.extension().and_then(|value| value.to_str()) != Some("wav") {
        return Err("Only saved WAV files can be deleted.".to_string());
    }

    let base_dir = base_dir
        .canonicalize()
        .map_err(|error| format!("Failed to resolve saved audio directory: {error}"))?;
    let saved_path = input_path
        .canonicalize()
        .map_err(|error| format!("Failed to resolve saved audio path: {error}"))?;

    if !saved_path.starts_with(&base_dir) {
        return Err("Saved audio path is outside the synthesis folder.".to_string());
    }

    Ok(saved_path)
}

fn chunk_text_for_stream(text: &str) -> Vec<String> {
    let mut chunks = Vec::new();

    for line in text.lines() {
        let mut current = String::new();

        for word in line.split_whitespace() {
            if !current.is_empty() {
                current.push(' ');
            }
            current.push_str(word);

            let has_sentence_break = matches!(
                word.chars().last(),
                Some('.') | Some('!') | Some('?') | Some(';') | Some(':')
            );
            if has_sentence_break || current.len() >= MAX_STREAM_CHUNK_CHARS {
                chunks.push(std::mem::take(&mut current));
            }
        }

        if !current.is_empty() {
            chunks.push(current);
        }
    }

    chunks
}

fn strip_stream_wav_header<'a>(
    wav_header: &mut Vec<u8>,
    bytes: &'a [u8],
) -> Result<&'a [u8], String> {
    if wav_header.len() >= WAV_HEADER_BYTES {
        return Ok(bytes);
    }

    let header_bytes_needed = WAV_HEADER_BYTES - wav_header.len();
    let header_bytes_to_take = header_bytes_needed.min(bytes.len());
    wav_header.extend_from_slice(&bytes[..header_bytes_to_take]);

    if wav_header.len() == WAV_HEADER_BYTES
        && (wav_header.get(0..4) != Some(b"RIFF") || wav_header.get(8..12) != Some(b"WAVE"))
    {
        return Err("koko stream did not start with a WAV header.".to_string());
    }

    Ok(&bytes[header_bytes_to_take..])
}

fn emit_stream_audio_bytes(
    app: &AppHandle,
    stream_id: &str,
    audio_bytes: &[u8],
    pending_sample_bytes: &mut Vec<u8>,
) -> Result<(), String> {
    if audio_bytes.is_empty() {
        return Ok(());
    }

    pending_sample_bytes.extend_from_slice(audio_bytes);
    let aligned_len =
        pending_sample_bytes.len() - (pending_sample_bytes.len() % FLOAT_SAMPLE_BYTES);
    if aligned_len == 0 {
        return Ok(());
    }

    let aligned_bytes = pending_sample_bytes[..aligned_len].to_vec();
    pending_sample_bytes.drain(..aligned_len);

    app.emit(
        SPEECH_STREAM_CHUNK_EVENT,
        SpeechStreamChunkEvent {
            stream_id: stream_id.to_string(),
            audio_base64: BASE64.encode(aligned_bytes),
            sample_rate: STREAM_SAMPLE_RATE,
            channels: STREAM_CHANNELS,
            sample_format: "float32le",
        },
    )
    .map_err(|error| error.to_string())
}

fn patch_stream_wav_header(file: &mut fs::File, data_bytes: u64) -> Result<(), String> {
    let data_size = u32::try_from(data_bytes)
        .map_err(|_| "Generated audio is too large for a WAV file.".to_string())?;
    let riff_chunk_size = 36u32.saturating_add(data_size);

    file.flush()
        .map_err(|error| format!("Failed to flush streamed audio: {error}"))?;
    file.seek(SeekFrom::Start(4))
        .map_err(|error| format!("Failed to patch WAV header: {error}"))?;
    file.write_all(&riff_chunk_size.to_le_bytes())
        .map_err(|error| format!("Failed to patch WAV header: {error}"))?;
    file.seek(SeekFrom::Start(40))
        .map_err(|error| format!("Failed to patch WAV header: {error}"))?;
    file.write_all(&data_size.to_le_bytes())
        .map_err(|error| format!("Failed to patch WAV header: {error}"))?;
    file.seek(SeekFrom::End(0))
        .map_err(|error| format!("Failed to finalize streamed WAV: {error}"))?;
    file.flush()
        .map_err(|error| format!("Failed to finalize streamed WAV: {error}"))
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("repo root")
        .to_path_buf()
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn derive_tsv_path_from_wav(path: &Path) -> PathBuf {
    if let Some(stem) = path.file_stem().and_then(|value| value.to_str()) {
        let parent = path.parent().unwrap_or_else(|| Path::new(""));
        return parent.join(format!("{stem}.tsv"));
    }

    PathBuf::from(format!("{}.tsv", path.display()))
}

fn read_timestamps(path: &Path) -> Result<Vec<TimestampRow>, String> {
    let content = fs::read_to_string(path).map_err(|error| {
        format!(
            "Failed to read timestamp sidecar `{}`: {error}",
            path.display()
        )
    })?;
    let mut rows = Vec::new();

    for (line_index, line) in content.lines().enumerate().skip(1) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let mut columns = line.split('\t');
        let word = columns
            .next()
            .ok_or_else(|| format!("Malformed timestamp row {}", line_index + 1))?;
        let start_sec = columns
            .next()
            .ok_or_else(|| format!("Malformed timestamp row {}", line_index + 1))?
            .parse::<f32>()
            .map_err(|error| {
                format!("Invalid timestamp start on row {}: {error}", line_index + 1)
            })?;
        let end_sec = columns
            .next()
            .ok_or_else(|| format!("Malformed timestamp row {}", line_index + 1))?
            .parse::<f32>()
            .map_err(|error| format!("Invalid timestamp end on row {}: {error}", line_index + 1))?;

        rows.push(TimestampRow {
            word: word.to_string(),
            start_sec,
            end_sec,
        });
    }

    Ok(rows)
}

fn format_command_failure(output: &Output) -> String {
    let code = output
        .status
        .code()
        .map_or_else(|| "unknown".to_string(), |code| code.to_string());
    format!("koko exited with code {code}. {}", command_log(output))
}

fn format_stream_command_failure(code: Option<i32>, stderr: &[u8]) -> String {
    let code = code.map_or_else(|| "unknown".to_string(), |code| code.to_string());
    let stderr = String::from_utf8_lossy(stderr).trim().to_string();

    if stderr.is_empty() {
        format!("koko stream exited with code {code}. No stderr was captured.")
    } else {
        format!("koko stream exited with code {code}. stderr: {stderr}")
    }
}

fn append_limited_command_bytes(buffer: &mut Vec<u8>, bytes: &[u8]) {
    const MAX_COMMAND_LOG_BYTES: usize = 16 * 1024;

    if buffer.len() >= MAX_COMMAND_LOG_BYTES {
        return;
    }

    let remaining = MAX_COMMAND_LOG_BYTES - buffer.len();
    buffer.extend_from_slice(&bytes[..bytes.len().min(remaining)]);
}

fn command_log(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    match (stdout.is_empty(), stderr.is_empty()) {
        (true, true) => "No output was captured from koko.".to_string(),
        (false, true) => format!("stdout: {stdout}"),
        (true, false) => format!("stderr: {stderr}"),
        (false, false) => format!("stdout: {stdout}; stderr: {stderr}"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PreparedAppUpdateState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            synthesize_speech,
            synthesize_speech_stream,
            list_saved_audio,
            delete_saved_audio,
            reveal_saved_audio_in_finder,
            import_epub_file,
            read_imported_epub_file,
            list_imported_epub_books,
            delete_imported_epub_book,
            prepare_app_update,
            install_prepared_app_update,
            gmail::gmail_save_client_config,
            gmail::gmail_get_client_config,
            gmail::gmail_auth_status,
            gmail::gmail_logout,
            gmail::gmail_login,
            gmail::gmail_get_access_token
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
