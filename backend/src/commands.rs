use serde::{Serialize, Deserialize};
use serde_json::json;
use std::{fs, collections::VecDeque, path::{Path, PathBuf}, time::UNIX_EPOCH};
use tauri::{Emitter, Window};

use trash;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScannedImageFile {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub size_bytes: u64,
    pub created_at: i64,
    pub modified_at: i64,
    pub content_hash: String,
}

fn is_image_file(path: &Path) -> bool {
    if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
        matches!(ext.to_lowercase().as_str(), "jpg" | "jpeg" | "png" | "heic" | "gif" | "webp" | "tiff")
    } else {
        false
    }
}

fn is_hidden_path(path: &Path) -> bool {
    for component in path.components() {
        if let Some(s) = component.as_os_str().to_str() {
            if s.starts_with('.') { return true; }
        }
    }
    false
}

fn compute_content_hash(path: &Path) -> String {
    use std::fs::File;
    use std::io::{BufReader, Read};
    const BUF_SIZE: usize = 1024 * 1024; // 1 MiB buffer

    let file = File::open(path);
    if file.is_err() { return String::new(); }
    let mut reader = BufReader::with_capacity(BUF_SIZE, file.unwrap());
    let mut hasher = blake3::Hasher::new();
    let mut buf = vec![0u8; BUF_SIZE];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => { hasher.update(&buf[..n]); }
            Err(_) => return String::new(),
        }
    }
    hasher.finalize().to_hex().to_string()
}

#[tauri::command]
pub async fn scan_folder(folder_path: String, window: Window) -> Result<Vec<ScannedImageFile>, String> {
    use tauri::async_runtime::spawn_blocking;

    let window_clone = window.clone();
    let root_path = folder_path.clone();

    let files = spawn_blocking(move || {
        let mut queue = VecDeque::new();
        queue.push_back(PathBuf::from(&root_path));
        let mut images: Vec<ScannedImageFile> = Vec::new();
        let mut scanned = 0usize;

        while let Some(path) = queue.pop_front() {
            if is_hidden_path(&path) {
                continue;
            }
            let Ok(read_dir) = fs::read_dir(&path) else { continue };
            for entry in read_dir {
                let Ok(entry) = entry else { continue };
                let entry_path = entry.path();
                if is_hidden_path(&entry_path) {
                    continue;
                }
                if entry_path.is_dir() {
                    queue.push_back(entry_path.clone());
                } else if entry_path.is_file() && is_image_file(&entry_path) {
                    let Ok(meta) = entry.metadata() else { continue };
                    let modified = meta.modified().ok()
                        .and_then(|mtime| mtime.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as i64)
                        .unwrap_or(0);
                    let created = meta.created().ok()
                        .and_then(|ctime| ctime.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as i64)
                        .unwrap_or(0);
                    let size = meta.len();
                    let name = entry_path.file_name().unwrap_or_default().to_string_lossy().to_string();
                    let extension = entry_path.extension().unwrap_or_default().to_string_lossy().to_string();
                    let content_hash = compute_content_hash(&entry_path);
                    images.push(ScannedImageFile {
                        path: entry_path.to_string_lossy().into_owned(),
                        name,
                        extension,
                        size_bytes: size,
                        created_at: created,
                        modified_at: modified,
                        content_hash,
                    });
                }

                scanned += 1;
                if scanned % 20 == 0 {
                    let _ = window_clone.emit(
                        "scan://progress",
                        json!({
                            "scanned": scanned,
                            "matched": images.len(),
                            "currentPath": entry_path.to_string_lossy(),
                        }),
                    );
                }
            }
        }

        let _ = window_clone.emit(
            "scan://progress",
            json!({
                "scanned": scanned,
                "matched": images.len(),
                "currentPath": "<done>",
            }),
        );

        images
    }).await.map_err(|e| format!("scan failed: {e}"))?;

    Ok(files)
}

// Delete files: Move to trash if possible, else hard delete (with side effect warning)
#[tauri::command]
pub async fn delete_files(paths: Vec<String>) -> Result<(), String> {
    use std::path::Path;
    let mut errors = vec![];
    for p in &paths {
        let as_path = Path::new(p);
        // Try trash first
        match trash::delete(as_path) {
            Ok(_) => {}
            Err(_) => {
                // Trash failed, fallback to permanent delete
                match fs::remove_file(as_path) {
                    Ok(_) => {}
                    Err(e) => {
                        errors.push(format!("{}: {}", p, e));
                    }
                }
            }
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!("Some files failed to delete:\n{}", errors.join("\n")))
    }
}
