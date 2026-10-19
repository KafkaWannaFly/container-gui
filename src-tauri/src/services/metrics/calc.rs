//! Pure metric math: rates from consecutive readings, and downsampling.

use crate::models::dto::MetricSampleDto;
use crate::models::engine::StatsReading;

use super::INTERVAL_MS;

pub fn sample_of(
    ts: i64,
    cur: &StatsReading,
    prev: Option<&(i64, StatsReading)>,
) -> MetricSampleDto {
    // A counter going backwards means the container restarted between polls.
    let prev = prev.filter(|(_, before)| !counters_reset(before, cur));
    let elapsed_s = prev.and_then(|(prev_ts, before)| {
        let span = match (before.read_ms, cur.read_ms) {
            (Some(a), Some(b)) if b > a => b - a,
            _ => ts - prev_ts,
        };
        (span > 0).then_some(span as f64 / 1000.0)
    });
    let rate = |now: u64, before: fn(&StatsReading) -> u64| {
        let (_, prev) = prev?;
        Some(now.saturating_sub(before(prev)) as f64 / elapsed_s?)
    };
    MetricSampleDto {
        ts,
        cpu_percent: prev.and_then(|(_, before)| {
            cpu_percent(
                cur.cpu_total?,
                before.cpu_total?,
                cur.system_total?,
                before.system_total?,
                cur.online_cpus as f64,
            )
        }),
        online_cpus: cur.online_cpus,
        memory_usage: cur.memory_usage,
        memory_limit: cur.memory_limit,
        net_rx: cur.net_rx,
        net_tx: cur.net_tx,
        block_read: cur.block_read,
        block_write: cur.block_write,
        pids: cur.pids,
        net_rx_rate: rate(cur.net_rx, |r| r.net_rx),
        net_tx_rate: rate(cur.net_tx, |r| r.net_tx),
        block_read_rate: rate(cur.block_read, |r| r.block_read),
        block_write_rate: rate(cur.block_write, |r| r.block_write),
    }
}

fn counters_reset(before: &StatsReading, cur: &StatsReading) -> bool {
    cur.net_rx < before.net_rx
        || cur.net_tx < before.net_tx
        || cur.block_read < before.block_read
        || cur.block_write < before.block_write
        || matches!((before.cpu_total, cur.cpu_total), (Some(a), Some(b)) if b < a)
}

/// `docker stats` CPU formula: share of one core, scaled by core count.
/// `None` when the system counter didn't advance (e.g. Windows containers,
/// which report no `system_cpu_usage`).
fn cpu_percent(
    total: u64,
    prev_total: u64,
    system: u64,
    prev_system: u64,
    online_cpus: f64,
) -> Option<f64> {
    (system > prev_system && total >= prev_total).then(|| {
        ((total - prev_total) as f64 / (system - prev_system) as f64) * online_cpus * 100.0
    })
}

/// Point spacing that fits `span_ms` into `max_points`, rounded up to a
/// whole number of sampling intervals.
pub fn step_for(span_ms: i64, max_points: Option<usize>) -> i64 {
    match max_points {
        Some(points) if points > 0 => {
            let raw = (span_ms.max(0) + points as i64 - 1) / points as i64;
            ((raw + INTERVAL_MS - 1) / INTERVAL_MS).max(1) * INTERVAL_MS
        }
        _ => INTERVAL_MS,
    }
}

/// Average samples into absolute-time buckets of `step_ms`, so a sliding
/// window yields stable points. Totals and limits keep the bucket's last
/// value; the point takes the last sample's timestamp.
pub fn downsample(samples: Vec<MetricSampleDto>, step_ms: i64) -> Vec<MetricSampleDto> {
    if step_ms <= INTERVAL_MS {
        return samples;
    }
    let mut out = Vec::new();
    let mut bucket: Vec<&MetricSampleDto> = Vec::new();
    for sample in &samples {
        if bucket
            .last()
            .is_some_and(|last| last.ts / step_ms != sample.ts / step_ms)
        {
            out.push(merge(&bucket));
            bucket.clear();
        }
        bucket.push(sample);
    }
    if !bucket.is_empty() {
        out.push(merge(&bucket));
    }
    out
}

fn merge(bucket: &[&MetricSampleDto]) -> MetricSampleDto {
    let avg = |pick: fn(&MetricSampleDto) -> Option<f64>| {
        let values: Vec<f64> = bucket.iter().filter_map(|s| pick(s)).collect();
        (!values.is_empty()).then(|| values.iter().sum::<f64>() / values.len() as f64)
    };
    let last = bucket[bucket.len() - 1];
    MetricSampleDto {
        cpu_percent: avg(|s| s.cpu_percent),
        memory_usage: avg(|s| Some(s.memory_usage as f64)).unwrap_or(0.0).round() as i64,
        net_rx_rate: avg(|s| s.net_rx_rate),
        net_tx_rate: avg(|s| s.net_tx_rate),
        block_read_rate: avg(|s| s.block_read_rate),
        block_write_rate: avg(|s| s.block_write_rate),
        ..last.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_percent_scales_by_online_cores() {
        assert_eq!(cpu_percent(1_000, 0, 1_000, 0, 1.0), Some(100.0));
        assert_eq!(cpu_percent(500, 0, 1_000, 0, 1.0), Some(50.0));
        assert_eq!(cpu_percent(2_000, 0, 4_000, 0, 4.0), Some(200.0));
    }

    #[test]
    fn cpu_percent_guards_bad_samples() {
        assert_eq!(cpu_percent(5, 0, 0, 0, 4.0), None);
        assert_eq!(cpu_percent(0, 5, 10, 0, 4.0), None);
    }
}
