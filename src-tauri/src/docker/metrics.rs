//! Background resource sampler. Every `INTERVAL` it takes a one-shot stats
//! reading of each live container and keeps a bounded history per
//! container, so charts survive page changes and the UI never talks to the
//! stats endpoint itself.
//!
//! One-shot readings carry no `precpu_stats`, so CPU% and I/O rates are
//! derived from the previous reading we took ourselves.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use bollard::Docker;
use bollard::models::{ContainerStatsResponse, ContainerSummaryStateEnum};
use bollard::query_parameters::{ListContainersOptionsBuilder, StatsOptionsBuilder};
use futures_util::{StreamExt, stream};
use tokio::time::{MissedTickBehavior, interval, timeout};

use crate::docker::state::DockerSessionManager;
use crate::error::AppResult;
use crate::models::dto::{ContainerSeriesDto, MetricSampleDto, MetricsLatestDto, MetricsSeriesDto};

pub const INTERVAL: Duration = Duration::from_secs(2);
const INTERVAL_MS: i64 = INTERVAL.as_millis() as i64;
const RETENTION_MS: i64 = 30 * 60 * 1000;
const CAPACITY: usize = (RETENTION_MS / INTERVAL_MS) as usize;
const CONCURRENCY: usize = 8;
const READ_TIMEOUT: Duration = Duration::from_millis(1_500);

/// Raw counters from one Docker stats response.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct Reading {
    /// Daemon-side sample time (epoch ms), used for precise rate spans.
    read_ms: Option<i64>,
    cpu_total: Option<u64>,
    system_total: Option<u64>,
    online_cpus: u32,
    memory_usage: i64,
    memory_limit: i64,
    net_rx: u64,
    net_tx: u64,
    block_read: u64,
    block_write: u64,
    pids: u64,
}

struct Series {
    samples: VecDeque<MetricSampleDto>,
    /// Last reading while the container stayed live; cleared when it stops
    /// so a restart never produces a rate across the downtime.
    prev: Option<(i64, Reading)>,
}

#[derive(Default)]
struct Inner {
    endpoint: Option<String>,
    series: HashMap<String, Series>,
    live: HashSet<String>,
}

/// In-memory history shared between the sampler task and the commands.
#[derive(Default)]
pub struct MetricsStore {
    inner: Mutex<Inner>,
}

impl MetricsStore {
    /// Drop all history when the Docker endpoint changes; a reconnect to
    /// the same endpoint keeps it.
    fn set_endpoint(&self, endpoint: String) {
        let mut inner = self.inner.lock().unwrap();
        if inner.endpoint.as_deref() != Some(endpoint.as_str()) {
            inner.series.clear();
            inner.live.clear();
            inner.endpoint = Some(endpoint);
        }
    }

    fn record(&self, ts: i64, live: HashSet<String>, readings: Vec<(String, Reading)>) {
        let mut inner = self.inner.lock().unwrap();
        for (id, series) in inner.series.iter_mut() {
            if !live.contains(id) {
                series.prev = None;
            }
        }
        for (id, reading) in readings {
            let series = inner.series.entry(id).or_insert_with(|| Series {
                samples: VecDeque::with_capacity(CAPACITY),
                prev: None,
            });
            let sample = sample_of(ts, &reading, series.prev.as_ref());
            series.samples.push_back(sample);
            while series.samples.len() > CAPACITY {
                series.samples.pop_front();
            }
            series.prev = Some((ts, reading));
        }
        let cutoff = ts - RETENTION_MS;
        inner.series.retain(|_, series| {
            while series.samples.front().is_some_and(|s| s.ts < cutoff) {
                series.samples.pop_front();
            }
            !series.samples.is_empty()
        });
        inner.live = live;
    }

    /// Newest sample of each live container, optionally limited to `ids`.
    pub fn latest(&self, ids: Option<&[String]>) -> Vec<MetricsLatestDto> {
        let inner = self.inner.lock().unwrap();
        let wanted: Box<dyn Iterator<Item = &String>> = match ids {
            Some(ids) => Box::new(ids.iter()),
            None => Box::new(inner.live.iter()),
        };
        wanted
            .filter(|id| inner.live.contains(*id))
            .filter_map(|id| {
                let sample = inner.series.get(id)?.samples.back()?.clone();
                Some(MetricsLatestDto {
                    id: id.clone(),
                    sample,
                })
            })
            .collect()
    }

    /// History for `ids` since `since` (epoch ms), bucket-averaged down to
    /// at most `max_points` per container.
    pub fn series(
        &self,
        ids: &[String],
        since: Option<i64>,
        max_points: Option<usize>,
        now: i64,
    ) -> MetricsSeriesDto {
        let since = since.unwrap_or(now - RETENTION_MS).max(now - RETENTION_MS);
        let step_ms = step_for(now - since, max_points);
        let inner = self.inner.lock().unwrap();
        let series = ids
            .iter()
            .map(|id| {
                let samples = inner
                    .series
                    .get(id)
                    .map(|series| {
                        let recent = series.samples.iter().filter(|s| s.ts >= since);
                        downsample(recent, step_ms)
                    })
                    .unwrap_or_default();
                ContainerSeriesDto {
                    id: id.clone(),
                    samples,
                }
            })
            .collect();
        MetricsSeriesDto { step_ms, series }
    }
}

/// Start the sampler. Runs for the app's lifetime; skips ticks while
/// disconnected and when a poll overruns the interval.
pub fn spawn(manager: Arc<DockerSessionManager>, store: Arc<MetricsStore>) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = interval(INTERVAL);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            store.set_endpoint(manager.endpoint().await);
            let ts = now_ms();
            let Some(client) = manager.client().await else {
                store.record(ts, HashSet::new(), Vec::new());
                continue;
            };
            match poll(&client).await {
                Ok((live, readings)) => store.record(ts, live, readings),
                Err(err) => log::debug!("[metrics] poll failed: {err}"),
            }
        }
    });
}

/// One tick: list live containers, then read each one concurrently. A
/// slow or failing container is skipped for this tick only.
async fn poll(client: &Docker) -> AppResult<(HashSet<String>, Vec<(String, Reading)>)> {
    let options = ListContainersOptionsBuilder::new().all(true).build();
    let live: HashSet<String> = client
        .list_containers(Some(options))
        .await?
        .into_iter()
        .filter(|ctr| {
            matches!(
                ctr.state,
                Some(ContainerSummaryStateEnum::RUNNING) | Some(ContainerSummaryStateEnum::PAUSED)
            )
        })
        .filter_map(|ctr| ctr.id)
        .collect();

    let readings = stream::iter(live.iter().cloned())
        .map(|id| async move {
            let reading = timeout(READ_TIMEOUT, read_once(client, &id)).await.ok()??;
            Some((id, reading))
        })
        .buffer_unordered(CONCURRENCY)
        .filter_map(|item| async move { item })
        .collect()
        .await;
    Ok((live, readings))
}

async fn read_once(client: &Docker, id: &str) -> Option<Reading> {
    let options = StatsOptionsBuilder::new()
        .stream(false)
        .one_shot(true)
        .build();
    match client.stats(id, Some(options)).next().await? {
        Ok(response) => Some(reading_of(&response)),
        Err(err) => {
            log::debug!("[metrics] stats for {id} failed: {err}");
            None
        }
    }
}

fn reading_of(response: &ContainerStatsResponse) -> Reading {
    let cpu = response.cpu_stats.as_ref();
    let memory = response.memory_stats.as_ref();
    let (net_rx, net_tx) = response
        .networks
        .iter()
        .flat_map(|networks| networks.values())
        .fold((0, 0), |(rx, tx), net| {
            (
                rx + net.rx_bytes.unwrap_or(0),
                tx + net.tx_bytes.unwrap_or(0),
            )
        });
    let (block_read, block_write) = response
        .blkio_stats
        .as_ref()
        .and_then(|blkio| blkio.io_service_bytes_recursive.as_ref())
        .into_iter()
        .flatten()
        .fold((0, 0), |(read, write), entry| {
            let value = entry.value.unwrap_or(0);
            match entry.op.as_deref() {
                Some(op) if op.eq_ignore_ascii_case("read") => (read + value, write),
                Some(op) if op.eq_ignore_ascii_case("write") => (read, write + value),
                _ => (read, write),
            }
        });
    Reading {
        read_ms: response
            .read
            .map(|read| read.timestamp_millis())
            .filter(|ms| *ms > 0),
        cpu_total: cpu
            .and_then(|stats| stats.cpu_usage.as_ref())
            .and_then(|usage| usage.total_usage),
        system_total: cpu.and_then(|stats| stats.system_cpu_usage),
        online_cpus: cpu.and_then(|stats| stats.online_cpus).unwrap_or(1),
        memory_usage: resident_memory(
            memory.and_then(|stats| stats.usage).unwrap_or(0),
            memory.and_then(|stats| stats.stats.as_ref()),
        ),
        memory_limit: memory.and_then(|stats| stats.limit).unwrap_or(0) as i64,
        net_rx,
        net_tx,
        block_read,
        block_write,
        pids: response
            .pids_stats
            .as_ref()
            .and_then(|pids| pids.current)
            .unwrap_or(0),
    }
}

fn sample_of(ts: i64, cur: &Reading, prev: Option<&(i64, Reading)>) -> MetricSampleDto {
    // A counter going backwards means the container restarted between polls.
    let prev = prev.filter(|(_, before)| !counters_reset(before, cur));
    let elapsed_s = prev.and_then(|(prev_ts, before)| {
        let span = match (before.read_ms, cur.read_ms) {
            (Some(a), Some(b)) if b > a => b - a,
            _ => ts - prev_ts,
        };
        (span > 0).then_some(span as f64 / 1000.0)
    });
    let rate = |now: u64, before: fn(&Reading) -> u64| {
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

fn counters_reset(before: &Reading, cur: &Reading) -> bool {
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

/// Resident memory, excluding page cache. cgroup v2 reports
/// `inactive_file`, v1 reports `cache`.
fn resident_memory(usage: u64, stats: Option<&HashMap<String, u64>>) -> i64 {
    let cache = stats
        .and_then(|stats| stats.get("inactive_file").or_else(|| stats.get("cache")))
        .copied()
        .unwrap_or(0);
    (usage as i64).saturating_sub(cache as i64).max(0)
}

/// Point spacing that fits `span_ms` into `max_points`, rounded up to a
/// whole number of sampling intervals.
fn step_for(span_ms: i64, max_points: Option<usize>) -> i64 {
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
fn downsample<'a>(
    samples: impl Iterator<Item = &'a MetricSampleDto>,
    step_ms: i64,
) -> Vec<MetricSampleDto> {
    if step_ms <= INTERVAL_MS {
        return samples.cloned().collect();
    }
    let mut out = Vec::new();
    let mut bucket: Vec<&MetricSampleDto> = Vec::new();
    for sample in samples {
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

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reading(cpu: u64, system: u64, net: u64) -> Reading {
        Reading {
            cpu_total: Some(cpu),
            system_total: Some(system),
            online_cpus: 2,
            memory_usage: 100,
            memory_limit: 1_000,
            net_rx: net,
            net_tx: net,
            ..Default::default()
        }
    }

    fn ids(list: &[&str]) -> HashSet<String> {
        list.iter().map(|id| id.to_string()).collect()
    }

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

    #[test]
    fn resident_memory_excludes_page_cache() {
        let v2 = HashMap::from([("inactive_file".to_string(), 400)]);
        assert_eq!(resident_memory(1_000, Some(&v2)), 600);
        let v1 = HashMap::from([("cache".to_string(), 250)]);
        assert_eq!(resident_memory(1_000, Some(&v1)), 750);
        assert_eq!(resident_memory(1_000, None), 1_000);
        assert_eq!(resident_memory(100, Some(&v1)), 0);
    }

    #[test]
    fn first_sample_has_no_deltas_then_rates_follow() {
        let store = MetricsStore::default();
        store.record(0, ids(&["a"]), vec![("a".into(), reading(0, 0, 0))]);
        store.record(
            2_000,
            ids(&["a"]),
            vec![("a".into(), reading(500, 1_000, 4_000))],
        );

        let series = store.series(&["a".into()], None, None, 2_000);
        let samples = &series.series[0].samples;
        assert_eq!(samples.len(), 2);
        assert_eq!(samples[0].cpu_percent, None);
        assert_eq!(samples[0].net_rx_rate, None);
        assert_eq!(samples[1].cpu_percent, Some(100.0));
        assert_eq!(samples[1].net_rx_rate, Some(2_000.0));
    }

    #[test]
    fn restart_and_downtime_never_produce_rates() {
        let store = MetricsStore::default();
        store.record(0, ids(&["a"]), vec![("a".into(), reading(0, 0, 5_000))]);
        // Counter went backwards: restarted between polls.
        store.record(2_000, ids(&["a"]), vec![("a".into(), reading(10, 100, 10))]);
        // Stopped for a tick, then back.
        store.record(4_000, ids(&[]), vec![]);
        store.record(6_000, ids(&["a"]), vec![("a".into(), reading(20, 200, 20))]);

        let samples = store
            .series(&["a".into()], None, None, 6_000)
            .series
            .remove(0)
            .samples;
        assert!(
            samples
                .iter()
                .all(|s| s.net_rx_rate.is_none() && s.cpu_percent.is_none())
        );
    }

    #[test]
    fn latest_only_reports_live_containers() {
        let store = MetricsStore::default();
        store.record(
            0,
            ids(&["a", "b"]),
            vec![
                ("a".into(), reading(0, 0, 0)),
                ("b".into(), reading(0, 0, 0)),
            ],
        );
        store.record(2_000, ids(&["a"]), vec![("a".into(), reading(0, 0, 0))]);
        let latest = store.latest(None);
        assert_eq!(latest.len(), 1);
        assert_eq!(latest[0].id, "a");
        assert!(store.latest(Some(&["b".into()])).is_empty());
    }

    #[test]
    fn history_is_bounded_and_endpoint_switch_clears_it() {
        let store = MetricsStore::default();
        store.set_endpoint("one".into());
        for tick in 0..(CAPACITY as i64 + 10) {
            store.record(
                tick * INTERVAL_MS,
                ids(&["a"]),
                vec![("a".into(), reading(0, 0, 0))],
            );
        }
        let now = (CAPACITY as i64 + 9) * INTERVAL_MS;
        assert!(
            store.series(&["a".into()], None, None, now).series[0]
                .samples
                .len()
                <= CAPACITY
        );

        store.set_endpoint("one".into());
        assert!(
            !store.series(&["a".into()], None, None, now).series[0]
                .samples
                .is_empty()
        );
        store.set_endpoint("two".into());
        assert!(
            store.series(&["a".into()], None, None, now).series[0]
                .samples
                .is_empty()
        );
    }

    #[test]
    fn downsample_averages_aligned_buckets() {
        let store = MetricsStore::default();
        for (tick, mem) in [(0, 100), (1, 300), (2, 500), (3, 700)] {
            let mut r = reading(0, 0, 0);
            r.memory_usage = mem;
            store.record(tick * INTERVAL_MS, ids(&["a"]), vec![("a".into(), r)]);
        }
        let now = 3 * INTERVAL_MS;
        // 8 s span into 2 points → 4 s buckets: [0,2s] and [4s,6s].
        let result = store.series(&["a".into()], Some(now - 8_000), Some(2), now);
        assert_eq!(result.step_ms, 4_000);
        let mems: Vec<i64> = result.series[0]
            .samples
            .iter()
            .map(|s| s.memory_usage)
            .collect();
        assert_eq!(mems, vec![200, 600]);
    }
}
