//! Reassembly of whole log lines from chunked engine output.

use crate::models::dto::LogLineDto;

/// Reassembles whole lines from the engine's chunked output. Chunks are not
/// line-aligned, so each stream keeps its unterminated tail until the next
/// chunk (or the end of the stream) completes it.
#[derive(Default)]
pub struct LineSplitter {
    stdout: String,
    stderr: String,
}

impl LineSplitter {
    pub fn push(&mut self, stream: &'static str, text: &str, out: &mut Vec<LogLineDto>) {
        let buf = if stream == "stderr" {
            &mut self.stderr
        } else {
            &mut self.stdout
        };
        // Docker splits entries over 16 KiB and stamps every piece; drop the
        // repeated stamp so the rejoined line (often JSON) stays intact.
        let text = match text.split_once(' ') {
            Some((head, rest)) if !buf.is_empty() && looks_like_timestamp(head) => rest,
            _ => text,
        };
        buf.push_str(text);
        while let Some(pos) = buf.find('\n') {
            let line: String = buf.drain(..=pos).collect();
            out.push(parse_log_line(stream, &line));
        }
    }

    pub fn flush(&mut self, out: &mut Vec<LogLineDto>) {
        for (stream, buf) in [("stdout", &mut self.stdout), ("stderr", &mut self.stderr)] {
            if !buf.is_empty() {
                out.push(parse_log_line(stream, buf));
                buf.clear();
            }
        }
    }
}

/// Split Docker's `timestamps=true` prefix (`2026-09-23T08:12:03.123456789Z `)
/// from the message.
fn parse_log_line(stream: &str, line: &str) -> LogLineDto {
    let line = line.trim_end_matches(['\n', '\r']);
    let (ts, text) = match line.split_once(' ') {
        Some((head, rest)) if looks_like_timestamp(head) => (head, rest),
        _ if looks_like_timestamp(line) => (line, ""),
        _ => ("", line),
    };
    LogLineDto {
        stream: stream.to_string(),
        ts: ts.to_string(),
        text: text.to_string(),
    }
}

fn looks_like_timestamp(token: &str) -> bool {
    let bytes = token.as_bytes();
    bytes.len() >= 20
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b'T'
        && bytes[..4].iter().all(u8::is_ascii_digit)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splitter_joins_partial_chunks_per_stream() {
        let mut splitter = LineSplitter::default();
        let mut out = Vec::new();
        splitter.push("stdout", "2026-09-23T08:00:00.1Z hel", &mut out);
        splitter.push("stderr", "2026-09-23T08:00:00.2Z oops\n", &mut out);
        splitter.push(
            "stdout",
            "lo\r\n2026-09-23T08:00:00.3Z second\n2026-09-23T08:00:00.4Z tail",
            &mut out,
        );
        assert_eq!(
            out.iter()
                .map(|l| (l.stream.as_str(), l.text.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("stderr", "oops"),
                ("stdout", "hello"),
                ("stdout", "second")
            ]
        );
        assert_eq!(out[1].ts, "2026-09-23T08:00:00.1Z");
        splitter.flush(&mut out);
        assert_eq!(out[3].text, "tail");
        assert_eq!(out.len(), 4);
    }

    #[test]
    fn splitter_drops_stamps_on_split_long_lines() {
        let mut splitter = LineSplitter::default();
        let mut out = Vec::new();
        splitter.push("stdout", "2026-09-23T08:00:00.1Z {\"a\":\"xx", &mut out);
        splitter.push("stdout", "2026-09-23T08:00:00.1Z yy\"}\n", &mut out);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].text, "{\"a\":\"xxyy\"}");
    }

    #[test]
    fn log_line_without_timestamp_keeps_text() {
        let line = parse_log_line("stdout", "plain message here\n");
        assert_eq!(line.ts, "");
        assert_eq!(line.text, "plain message here");
        let empty = parse_log_line("stdout", "2026-09-23T08:00:00.123456789Z\n");
        assert_eq!(empty.ts, "2026-09-23T08:00:00.123456789Z");
        assert_eq!(empty.text, "");
    }
}
