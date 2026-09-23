use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

/// Pick a free path in the user's Downloads folder: `name`, then
/// `name (1)`, `name (2)`, … so an earlier export is never overwritten.
pub fn downloads_target(app: &AppHandle, filename: &str) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .download_dir()
        .map_err(|err| AppError::Message(format!("Downloads folder unavailable: {err}")))?;
    Ok(unique_path(&dir, &sanitize(filename)))
}

fn sanitize(filename: &str) -> String {
    let cleaned: String = filename
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed.to_string()
    }
}

fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match filename.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem, format!(".{ext}")),
        _ => (filename, String::new()),
    };
    (1..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|path| !path.exists())
        .expect("unbounded range always finds a free name")
}

/// Write text the UI already holds (env export, Dockerfile, file preview)
/// into Downloads. Returns the full path written.
#[tauri::command]
pub async fn save_text_to_downloads(
    app: AppHandle,
    filename: String,
    contents: String,
) -> AppResult<String> {
    let path = downloads_target(&app, &filename)?;
    tokio::fs::write(&path, contents)
        .await
        .map_err(|err| AppError::Message(format!("Could not write {}: {err}", path.display())))?;
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_path_separators() {
        assert_eq!(sanitize("../etc/passwd"), "_etc_passwd");
        assert_eq!(sanitize("a:b*c?.log"), "a_b_c_.log");
        assert_eq!(sanitize("  ..  "), "download");
    }

    #[test]
    fn unique_path_appends_counter() {
        let dir = std::env::temp_dir().join(format!("cgui-unique-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("app.log"), "").unwrap();
        std::fs::write(dir.join("app (1).log"), "").unwrap();
        assert_eq!(unique_path(&dir, "app.log"), dir.join("app (2).log"));
        assert_eq!(unique_path(&dir, "fresh.log"), dir.join("fresh.log"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
