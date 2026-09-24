//! Container filesystem access: directory listings via exec, file
//! contents and downloads via the archive endpoint (which also works on
//! stopped containers), and the diff against the image.

use std::path::Path;
use std::time::Duration;

use bollard::Docker;
use bollard::container::LogOutput;
use bollard::exec::{CreateExecOptions, StartExecOptions, StartExecResults};
use bollard::models::ChangeType;
use bollard::query_parameters::DownloadFromContainerOptionsBuilder;
use futures_util::StreamExt;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio_tar::{Archive, EntryType};
use tokio_util::io::StreamReader;

use crate::error::{AppError, AppResult};
use crate::models::dto::{DirListingDto, FileContentDto, FsChangeDto, FsEntryDto};

const EXEC_TIMEOUT: Duration = Duration::from_secs(20);
/// Cap on listing output so a runaway directory can't flood memory.
const LISTING_MAX_BYTES: usize = 8 * 1024 * 1024;

/// Lists one directory without recursing. `stat` per batch of entries
/// (`-exec … {} +`) works with both GNU coreutils and BusyBox; `head`
/// stops `find` early in huge directories. Symlink targets come in a
/// second pass because `%N` quoting differs between implementations.
const LIST_SCRIPT: &str = r#"cd -- "$1" 2>/dev/null || { echo "cannot open directory $1" >&2; exit 3; }
find . -mindepth 1 -maxdepth 1 -exec stat -c '%F|%s|%A|%U|%Y|%n' {} + 2>/dev/null | head -n "$2"
find . -mindepth 1 -maxdepth 1 -type l -exec sh -c 'for f; do printf "L|%s|%s\n" "$f" "$(readlink "$f")"; done' sh {} + 2>/dev/null | head -n "$2""#;

pub struct ExecOutput {
    pub stdout: Vec<u8>,
    pub stderr: String,
    pub exit_code: Option<i64>,
}

/// Run a non-interactive command as root and collect its output.
pub async fn run_exec(client: &Docker, id: &str, cmd: Vec<String>) -> AppResult<ExecOutput> {
    let exec = client
        .create_exec(
            id,
            CreateExecOptions {
                cmd: Some(cmd),
                attach_stdout: Some(true),
                attach_stderr: Some(true),
                user: Some("0".to_string()),
                ..Default::default()
            },
        )
        .await?;
    let started = client
        .start_exec(
            &exec.id,
            Some(StartExecOptions {
                detach: false,
                tty: false,
                output_capacity: None,
            }),
        )
        .await?;
    let StartExecResults::Attached { mut output, .. } = started else {
        return Err(AppError::Message("exec did not attach".into()));
    };

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let collect = async {
        while let Some(item) = output.next().await {
            match item? {
                LogOutput::StdOut { message } | LogOutput::Console { message } => {
                    if stdout.len() < LISTING_MAX_BYTES {
                        stdout.extend_from_slice(&message);
                    }
                }
                LogOutput::StdErr { message } => stderr.extend_from_slice(&message),
                LogOutput::StdIn { .. } => {}
            }
        }
        Ok::<_, AppError>(())
    };
    tokio::time::timeout(EXEC_TIMEOUT, collect)
        .await
        .map_err(|_| AppError::Message("command timed out".into()))??;

    let exit_code = client.inspect_exec(&exec.id).await?.exit_code;
    Ok(ExecOutput {
        stdout,
        stderr: String::from_utf8_lossy(&stderr).trim().to_string(),
        exit_code,
    })
}

fn kind_of(file_type: &str) -> &'static str {
    match file_type {
        "directory" => "dir",
        "regular file" | "regular empty file" => "file",
        "symbolic link" => "link",
        "character special file" => "char",
        "block special file" => "block",
        "fifo" => "fifo",
        "socket" => "socket",
        _ => "other",
    }
}

/// Parse the listing script's output. Names are the last field so a `|`
/// inside a name survives; lines that don't fit are skipped.
fn parse_listing(out: &str, limit: usize) -> (Vec<FsEntryDto>, bool) {
    let mut entries = Vec::new();
    let mut targets = std::collections::HashMap::new();
    for line in out.lines() {
        if let Some(rest) = line.strip_prefix("L|") {
            if let Some((name, target)) = rest.split_once('|') {
                targets.insert(
                    name.trim_start_matches("./").to_string(),
                    target.to_string(),
                );
            }
            continue;
        }
        let mut parts = line.splitn(6, '|');
        let (Some(ft), Some(size), Some(mode), Some(owner), Some(mtime), Some(name)) = (
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
        ) else {
            continue;
        };
        entries.push(FsEntryDto {
            name: name.trim_start_matches("./").to_string(),
            kind: kind_of(ft).to_string(),
            size: size.parse().unwrap_or(0),
            mode: mode.to_string(),
            owner: owner.to_string(),
            mtime: mtime.parse().unwrap_or(0),
            target: None,
        });
    }
    let truncated = entries.len() > limit;
    entries.truncate(limit);
    for entry in &mut entries {
        entry.target = targets.remove(&entry.name);
    }
    (entries, truncated)
}

pub async fn list_dir(
    client: &Docker,
    id: &str,
    path: &str,
    limit: usize,
) -> AppResult<DirListingDto> {
    let cmd = vec![
        "sh".into(),
        "-c".into(),
        LIST_SCRIPT.into(),
        "sh".into(),
        path.into(),
        (limit + 1).to_string(),
    ];
    let out = run_exec(client, id, cmd).await?;
    // 126/127: no usable `sh` (distroless, scratch or single-binary images).
    if matches!(out.exit_code, Some(126 | 127)) {
        return list_dir_archive(client, id, path, limit).await;
    }
    if out.exit_code != Some(0) {
        let reason = if out.stderr.is_empty() {
            format!("listing failed (exit {:?})", out.exit_code)
        } else {
            out.stderr
        };
        return Err(AppError::Message(reason));
    }
    let (entries, truncated) = parse_listing(&String::from_utf8_lossy(&out.stdout), limit);
    Ok(DirListingDto {
        path: path.to_string(),
        entries,
        truncated,
    })
}

pub async fn changes(client: &Docker, id: &str) -> AppResult<Vec<FsChangeDto>> {
    let changes = client.container_changes(id).await?.unwrap_or_default();
    Ok(changes
        .into_iter()
        .map(|change| FsChangeDto {
            path: change.path,
            kind: match change.kind {
                ChangeType::_0 => "C",
                ChangeType::_1 => "A",
                ChangeType::_2 => "D",
            }
            .to_string(),
        })
        .collect())
}

/* ------------------------------ archive ------------------------------ */

fn kind_of_entry(kind: EntryType) -> &'static str {
    if kind.is_file() || kind == EntryType::Continuous {
        "file"
    } else if kind.is_dir() {
        "dir"
    } else if kind.is_symlink() {
        "link"
    } else if kind.is_hard_link() {
        "hardlink"
    } else if kind.is_character_special() {
        "char"
    } else if kind.is_block_special() {
        "block"
    } else if kind.is_fifo() {
        "fifo"
    } else {
        "other"
    }
}

fn mode_string(mode: u32, kind: &str) -> String {
    let lead = match kind {
        "dir" => 'd',
        "link" => 'l',
        "char" => 'c',
        "block" => 'b',
        "fifo" => 'p',
        _ => '-',
    };
    let bits = ['r', 'w', 'x'];
    std::iter::once(lead)
        .chain((0..9).map(|i| {
            if mode & (1 << (8 - i)) != 0 {
                bits[i % 3]
            } else {
                '-'
            }
        }))
        .collect()
}

/// The archive endpoint as an `AsyncRead` tar stream.
fn archive(client: &Docker, id: &str, path: &str) -> Archive<impl AsyncRead + Unpin> {
    let options = DownloadFromContainerOptionsBuilder::new()
        .path(path)
        .build();
    let body = client
        .download_from_container(id, Some(options))
        .map(|chunk| chunk.map_err(std::io::Error::other));
    Archive::new(StreamReader::new(body.boxed()))
}

fn tar_err(err: std::io::Error) -> AppError {
    AppError::Message(format!("Could not read archive: {err}"))
}

/// Stop reading a listing archive past this; the rest is reported as truncated.
const ARCHIVE_LIST_MAX_BYTES: u64 = 512 * 1024 * 1024;

/// `name` relative to `base`, if it is a direct child. Archive names are
/// `base/child` (`/`, `./` prefixes and trailing `/` vary by path).
fn direct_child<'a>(base: &str, name: &'a str) -> Option<&'a str> {
    let rest = if base.is_empty() {
        name
    } else {
        name.strip_prefix(base)?.strip_prefix('/')?
    };
    (!rest.is_empty() && !rest.contains('/')).then_some(rest)
}

fn normalize_tar_name(raw: &[u8]) -> String {
    let name = String::from_utf8_lossy(raw);
    let name = name.trim_start_matches("./").trim_start_matches('/');
    name.trim_end_matches('/').to_string()
}

/// Listing through the archive endpoint, for images without a shell. The
/// whole subtree streams through, so it's slower than `find` but needs
/// nothing inside the container.
async fn list_dir_archive(
    client: &Docker,
    id: &str,
    path: &str,
    limit: usize,
) -> AppResult<DirListingDto> {
    let mut archive = archive(client, id, path);
    let mut entries = archive.entries().map_err(tar_err)?;
    let mut base: Option<String> = None;
    let mut listed = Vec::new();
    let mut truncated = false;
    let mut read: u64 = 0;
    let walk = async {
        while let Some(entry) = entries.next().await {
            let entry = entry.map_err(tar_err)?;
            let name = normalize_tar_name(&entry.path_bytes().map_err(tar_err)?);
            // The first entry is the directory itself.
            let Some(base) = base.as_deref() else {
                base = Some(name);
                continue;
            };
            read += entry.effective_size() + 512;
            if read > ARCHIVE_LIST_MAX_BYTES {
                truncated = true;
                break;
            }
            let Some(child) = direct_child(base, &name) else {
                continue;
            };
            if listed.len() == limit {
                truncated = true;
                break;
            }
            let header = entry.header();
            let kind = kind_of_entry(header.entry_type());
            listed.push(FsEntryDto {
                name: child.to_string(),
                kind: kind.to_string(),
                size: if kind == "file" { entry.effective_size() } else { 0 },
                mode: mode_string(header.mode().unwrap_or(0), kind),
                owner: match header.username() {
                    Ok(Some(user)) if !user.is_empty() => user.to_string(),
                    _ => match header.uid() {
                        Ok(0) => "root".to_string(),
                        Ok(uid) => uid.to_string(),
                        Err(_) => String::new(),
                    },
                },
                mtime: header.mtime().unwrap_or(0) as i64,
                target: entry
                    .link_name_bytes()
                    .ok()
                    .flatten()
                    .map(|target| String::from_utf8_lossy(&target).into_owned()),
            });
        }
        Ok::<_, AppError>(())
    };
    tokio::time::timeout(EXEC_TIMEOUT, walk)
        .await
        .map_err(|_| AppError::Message("listing timed out".into()))??;
    if base.is_none() {
        return Err(AppError::Message(format!("cannot open directory {path}")));
    }
    Ok(DirListingDto {
        path: path.to_string(),
        entries: listed,
        truncated,
    })
}

/// First `max_bytes` of a path. Binary is detected by a NUL byte in the
/// first 8 KiB, the same heuristic git and grep use.
pub async fn read_file(
    client: &Docker,
    id: &str,
    path: &str,
    max_bytes: u64,
) -> AppResult<FileContentDto> {
    let mut archive = archive(client, id, path);
    let mut entries = archive.entries().map_err(tar_err)?;
    let entry = entries
        .next()
        .await
        .ok_or_else(|| AppError::Message("archive is empty".into()))?
        .map_err(tar_err)?;
    let header = entry.header();
    let kind = kind_of_entry(header.entry_type());
    let size = entry.effective_size();
    let mut dto = FileContentDto {
        path: path.to_string(),
        kind: kind.to_string(),
        size,
        mode: mode_string(header.mode().unwrap_or(0), kind),
        mtime: header.mtime().unwrap_or(0) as i64,
        link_target: entry
            .link_name()
            .ok()
            .flatten()
            .map(|p| p.to_string_lossy().replace('\\', "/")),
        content: None,
        binary: false,
        truncated: size > max_bytes,
    };
    if kind != "file" {
        return Ok(dto);
    }
    let mut data = Vec::new();
    entry
        .take(max_bytes)
        .read_to_end(&mut data)
        .await
        .map_err(tar_err)?;
    dto.binary = data.iter().take(8192).any(|b| *b == 0);
    if !dto.binary {
        dto.content = Some(String::from_utf8_lossy(&data).into_owned());
    }
    Ok(dto)
}

/// Save a path into `dest`: a file's bytes as-is, anything else (a
/// directory) as the tar archive Docker produced.
pub async fn save_path(
    client: &Docker,
    id: &str,
    path: &str,
    dest: &Path,
    as_archive: bool,
) -> AppResult<()> {
    let io_err = |err: std::io::Error| {
        AppError::Message(format!("Could not write {}: {err}", dest.display()))
    };
    let mut out = tokio::fs::File::create(dest).await.map_err(io_err)?;
    if as_archive {
        let options = DownloadFromContainerOptionsBuilder::new()
            .path(path)
            .build();
        let body = client
            .download_from_container(id, Some(options))
            .map(|chunk| chunk.map_err(std::io::Error::other));
        let mut reader = StreamReader::new(body.boxed());
        tokio::io::copy(&mut reader, &mut out)
            .await
            .map_err(io_err)?;
    } else {
        let mut archive = archive(client, id, path);
        let mut entries = archive.entries().map_err(tar_err)?;
        let mut entry = entries
            .next()
            .await
            .ok_or_else(|| AppError::Message("archive is empty".into()))?
            .map_err(tar_err)?;
        if kind_of_entry(entry.header().entry_type()) != "file" {
            return Err(AppError::Message(format!("{path} is not a regular file")));
        }
        tokio::io::copy(&mut entry, &mut out)
            .await
            .map_err(io_err)?;
    }
    out.flush().await.map_err(io_err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mode_string_matches_ls() {
        assert_eq!(mode_string(0o755, "dir"), "drwxr-xr-x");
        assert_eq!(mode_string(0o640, "file"), "-rw-r-----");
    }

    #[test]
    fn archive_names_match_direct_children() {
        assert_eq!(normalize_tar_name(b"./"), "");
        assert_eq!(normalize_tar_name(b"/etc/"), "etc");
        assert_eq!(direct_child("", "etc"), Some("etc"));
        assert_eq!(direct_child("", "etc/hosts"), None);
        assert_eq!(direct_child("etc", "etc/hosts"), Some("hosts"));
        assert_eq!(direct_child("etc", "etc/ssl/certs"), None);
        assert_eq!(direct_child("etc", "etcetera/x"), None);
    }

    #[test]
    fn listing_parses_stat_lines_and_links() {
        let out = "directory|4096|drwxr-xr-x|root|1700000000|./etc\n\
                   regular file|12|-rw-r--r--|root|1700000001|./a|b.txt\n\
                   symbolic link|7|lrwxrwxrwx|root|1700000002|./sh\n\
                   garbage line\n\
                   L|./sh|busybox\n";
        let (entries, truncated) = parse_listing(out, 10);
        assert!(!truncated);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].kind, "dir");
        assert_eq!(entries[1].name, "a|b.txt");
        assert_eq!(entries[2].target.as_deref(), Some("busybox"));

        let (entries, truncated) = parse_listing(out, 2);
        assert!(truncated);
        assert_eq!(entries.len(), 2);
    }
}
