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
use futures_util::{Stream, StreamExt};
use tokio::io::AsyncWriteExt;

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

/* ------------------------------ tar reading ------------------------------ */

/// First real entry of a tar stream (extended headers already applied).
struct TarEntry {
    typeflag: u8,
    size: u64,
    mode: u32,
    mtime: i64,
    link: String,
}

/// Minimal streaming tar reader: enough to pull the single entry the
/// archive endpoint returns for a file path, without buffering it whole.
struct TarReader<S> {
    inner: S,
    buf: Vec<u8>,
}

fn octal(field: &[u8]) -> u64 {
    // GNU base-256 for values that overflow the octal field.
    if field.first().is_some_and(|b| b & 0x80 != 0) {
        return field[1..]
            .iter()
            .fold(0u64, |acc, b| (acc << 8) | u64::from(*b));
    }
    let text: String = field
        .iter()
        .take_while(|b| **b != 0)
        .map(|b| *b as char)
        .collect();
    u64::from_str_radix(text.trim(), 8).unwrap_or(0)
}

fn cstr(field: &[u8]) -> String {
    let end = field.iter().position(|b| *b == 0).unwrap_or(field.len());
    String::from_utf8_lossy(&field[..end]).to_string()
}

impl<S, B> TarReader<S>
where
    S: Stream<Item = Result<B, bollard::errors::Error>> + Unpin,
    B: AsRef<[u8]>,
{
    fn new(inner: S) -> Self {
        Self {
            inner,
            buf: Vec::new(),
        }
    }

    /// Ensure `n` bytes are buffered; false at end of stream.
    async fn fill(&mut self, n: usize) -> AppResult<bool> {
        while self.buf.len() < n {
            match self.inner.next().await {
                Some(chunk) => self.buf.extend_from_slice(chunk?.as_ref()),
                None => return Ok(false),
            }
        }
        Ok(true)
    }

    async fn take(&mut self, n: usize) -> AppResult<Vec<u8>> {
        if !self.fill(n).await? {
            return Err(AppError::Message("archive ended early".into()));
        }
        Ok(self.buf.drain(..n).collect())
    }

    async fn first_entry(&mut self) -> AppResult<TarEntry> {
        let mut pax_size = None;
        let mut long_link = None;
        loop {
            let header = self.take(512).await?;
            if header.iter().all(|b| *b == 0) {
                return Err(AppError::Message("archive is empty".into()));
            }
            let size = octal(&header[124..136]);
            let typeflag = header[156];
            match typeflag {
                // PAX extended / global headers: `len key=value\n` records.
                b'x' | b'g' | b'L' | b'K' => {
                    let data = self.take(size.div_ceil(512) as usize * 512).await?;
                    let data = &data[..size as usize];
                    if typeflag == b'K' {
                        long_link = Some(cstr(data));
                    }
                    if typeflag == b'x' {
                        for record in String::from_utf8_lossy(data).lines() {
                            let Some((_, kv)) = record.split_once(' ') else {
                                continue;
                            };
                            match kv.split_once('=') {
                                Some(("size", v)) => pax_size = v.parse().ok(),
                                Some(("linkpath", v)) => long_link = Some(v.to_string()),
                                _ => {}
                            }
                        }
                    }
                }
                _ => {
                    return Ok(TarEntry {
                        typeflag,
                        size: pax_size.unwrap_or(size),
                        mode: octal(&header[100..108]) as u32,
                        mtime: octal(&header[136..148]) as i64,
                        link: long_link.unwrap_or_else(|| cstr(&header[157..257])),
                    });
                }
            }
        }
    }

    /// Next piece of the current entry's data; `None` once `left` is spent.
    async fn next_chunk(&mut self, left: &mut u64) -> AppResult<Option<Vec<u8>>> {
        if *left == 0 {
            return Ok(None);
        }
        if self.buf.is_empty() && !self.fill(1).await? {
            return Err(AppError::Message("archive ended early".into()));
        }
        let n = (*left).min(self.buf.len() as u64) as usize;
        *left -= n as u64;
        Ok(Some(self.buf.drain(..n).collect()))
    }
}

fn kind_of_typeflag(flag: u8) -> &'static str {
    match flag {
        b'0' | 0 | b'7' => "file",
        b'1' => "hardlink",
        b'2' => "link",
        b'3' => "char",
        b'4' => "block",
        b'5' => "dir",
        b'6' => "fifo",
        _ => "other",
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

fn archive(
    client: &Docker,
    id: &str,
    path: &str,
) -> impl Stream<Item = Result<impl AsRef<[u8]>, bollard::errors::Error>> + Unpin {
    let options = DownloadFromContainerOptionsBuilder::new()
        .path(path)
        .build();
    client.download_from_container(id, Some(options)).boxed()
}

/// First `max_bytes` of a file. Binary is detected by a NUL byte in the
/// first 8 KiB, the same heuristic git and grep use.
pub async fn read_file(
    client: &Docker,
    id: &str,
    path: &str,
    max_bytes: u64,
) -> AppResult<FileContentDto> {
    let mut reader = TarReader::new(archive(client, id, path));
    let entry = reader.first_entry().await?;
    let kind = kind_of_typeflag(entry.typeflag);
    let mut dto = FileContentDto {
        path: path.to_string(),
        kind: kind.to_string(),
        size: entry.size,
        mode: mode_string(entry.mode, kind),
        mtime: entry.mtime,
        link_target: (kind == "link").then(|| entry.link.clone()),
        content: None,
        binary: false,
        truncated: entry.size > max_bytes,
    };
    if kind != "file" {
        return Ok(dto);
    }
    let mut data = Vec::new();
    let mut left = entry.size.min(max_bytes);
    while let Some(chunk) = reader.next_chunk(&mut left).await? {
        data.extend_from_slice(&chunk);
    }
    dto.binary = data.iter().take(8192).any(|b| *b == 0);
    if !dto.binary {
        dto.content = Some(String::from_utf8_lossy(&data).to_string());
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
    let file = tokio::fs::File::create(dest).await.map_err(io_err)?;
    let mut out = tokio::io::BufWriter::new(file);
    let mut stream = archive(client, id, path);
    if as_archive {
        while let Some(chunk) = stream.next().await {
            out.write_all(chunk?.as_ref()).await.map_err(io_err)?;
        }
    } else {
        let mut reader = TarReader::new(stream);
        let entry = reader.first_entry().await?;
        if kind_of_typeflag(entry.typeflag) != "file" {
            return Err(AppError::Message(format!("{path} is not a regular file")));
        }
        let mut left = entry.size;
        while let Some(chunk) = reader.next_chunk(&mut left).await? {
            out.write_all(&chunk).await.map_err(io_err)?;
        }
    }
    out.flush().await.map_err(io_err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(name: &str, size: u64, typeflag: u8, link: &str) -> Vec<u8> {
        let mut h = vec![0u8; 512];
        h[..name.len()].copy_from_slice(name.as_bytes());
        h[100..107].copy_from_slice(b"0000644");
        h[124..135].copy_from_slice(format!("{size:011o}").as_bytes());
        h[136..147].copy_from_slice(b"14677712345");
        h[156] = typeflag;
        h[157..157 + link.len()].copy_from_slice(link.as_bytes());
        h
    }

    fn padded(data: &[u8]) -> Vec<u8> {
        let mut v = data.to_vec();
        v.resize(data.len().div_ceil(512) * 512, 0);
        v
    }

    /// Split into uneven chunks so reads straddle chunk boundaries.
    fn stream_of(
        bytes: Vec<u8>,
    ) -> impl Stream<Item = Result<Vec<u8>, bollard::errors::Error>> + Unpin {
        let chunks: Vec<_> = bytes.chunks(300).map(|c| Ok(c.to_vec())).collect();
        futures_util::stream::iter(chunks)
    }

    #[tokio::test]
    async fn reads_first_file_across_chunks() {
        let body = b"hello tar\n".repeat(100);
        let mut tar = header("hello.txt", body.len() as u64, b'0', "");
        tar.extend(padded(&body));
        tar.extend(vec![0u8; 1024]);

        let mut reader = TarReader::new(stream_of(tar));
        let entry = reader.first_entry().await.unwrap();
        assert_eq!(entry.size, body.len() as u64);
        assert_eq!(entry.mode, 0o644);
        let mut left = entry.size;
        let mut data = Vec::new();
        while let Some(chunk) = reader.next_chunk(&mut left).await.unwrap() {
            data.extend(chunk);
        }
        assert_eq!(data, body);
    }

    #[tokio::test]
    async fn applies_pax_size_and_link() {
        let pax = b"20 linkpath=/a/long\n12 size=42\n";
        let mut tar = header("PaxHeader", pax.len() as u64, b'x', "");
        tar.extend(padded(pax));
        tar.extend(header("sh", 0, b'2', "busybox"));

        let mut reader = TarReader::new(stream_of(tar));
        let entry = reader.first_entry().await.unwrap();
        assert_eq!(kind_of_typeflag(entry.typeflag), "link");
        assert_eq!(entry.link, "/a/long");
        assert_eq!(entry.size, 42);
    }

    #[test]
    fn octal_handles_padding_and_base256() {
        assert_eq!(octal(b"00000000644\0"), 0o644);
        assert_eq!(octal(b"  777 \0"), 0o777);
        let mut big = [0u8; 12];
        big[0] = 0x80;
        big[11] = 5;
        assert_eq!(octal(&big), 5);
    }

    #[test]
    fn mode_string_matches_ls() {
        assert_eq!(mode_string(0o755, "dir"), "drwxr-xr-x");
        assert_eq!(mode_string(0o640, "file"), "-rw-r-----");
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
