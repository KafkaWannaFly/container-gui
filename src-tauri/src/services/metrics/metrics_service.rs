use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use futures_util::{StreamExt, stream};
use tokio::time::timeout;

use super::calc::{downsample, sample_of, step_for};
use super::{IMetricsService, RETENTION_MS};
use crate::error::AppResult;
use crate::models::dto::{ContainerSeriesDto, MetricSampleDto, MetricsLatestDto, MetricsSeriesDto};
use crate::models::engine::{ContainerQuery, StatsReading};
use crate::repositories::{IMetricsHistoryRepository, IMetricsRepository};
use crate::services::engine::IEngine;
use crate::services::now_ms;
use crate::services::session::IEngineSession;

const CONCURRENCY: usize = 8;
const READ_TIMEOUT: Duration = Duration::from_millis(1_500);
/// Prune expired rows from disk about once a minute.
const PRUNE_EVERY_TICKS: u64 = 30;

#[derive(bon::Builder)]
pub struct MetricsService {
    session: Arc<dyn IEngineSession>,
    /// The read path: in-memory series.
    live: Arc<dyn IMetricsRepository>,
    /// Write-through copy that survives restarts.
    history: Arc<dyn IMetricsHistoryRepository>,
}

impl MetricsService {
    /// Append one tick; returns the new samples so they can be persisted.
    fn record(
        &self,
        ts: i64,
        live: HashSet<String>,
        readings: Vec<(String, StatsReading)>,
    ) -> Vec<(String, MetricSampleDto)> {
        let ids: Vec<String> = readings.iter().map(|(id, _)| id.clone()).collect();
        let previous = self.live.previous(&ids);
        let mut added = Vec::with_capacity(readings.len());
        let mut entries = Vec::with_capacity(readings.len());
        for (id, reading) in readings {
            let sample = sample_of(ts, &reading, previous.get(&id));
            entries.push((id.clone(), sample.clone(), (ts, reading)));
            added.push((id, sample));
        }
        self.live.append(live, entries, ts - RETENTION_MS);
        added
    }

    fn series_at(
        &self,
        ids: &[String],
        since: Option<i64>,
        max_points: Option<usize>,
        now: i64,
    ) -> MetricsSeriesDto {
        let since = since.unwrap_or(now - RETENTION_MS).max(now - RETENTION_MS);
        let step_ms = step_for(now - since, max_points);
        let series = self
            .live
            .samples_since(ids, since)
            .into_iter()
            .map(|(id, samples)| ContainerSeriesDto {
                id,
                samples: downsample(samples, step_ms),
            })
            .collect();
        MetricsSeriesDto { step_ms, series }
    }
}

/// One tick: list live containers, then read each one concurrently. A slow
/// or failing container is skipped for this tick only.
async fn poll(engine: &dyn IEngine) -> AppResult<(HashSet<String>, Vec<(String, StatsReading)>)> {
    let query = ContainerQuery::builder().all(true).build();
    let live: HashSet<String> = engine
        .containers()
        .list(&query)
        .await?
        .into_iter()
        .filter(|ctr| matches!(ctr.state.as_str(), "running" | "paused"))
        .map(|ctr| ctr.id)
        .filter(|id| !id.is_empty())
        .collect();

    let readings = stream::iter(live.iter().cloned())
        .map(|id| async move {
            match timeout(READ_TIMEOUT, engine.containers().stats_once(&id)).await {
                Ok(Ok(Some(reading))) => Some((id, reading)),
                Ok(Err(err)) => {
                    log::debug!("[metrics] stats for {id} failed: {err}");
                    None
                }
                _ => None,
            }
        })
        .buffer_unordered(CONCURRENCY)
        .filter_map(|item| async move { item })
        .collect()
        .await;
    Ok((live, readings))
}

#[async_trait]
impl IMetricsService for MetricsService {
    fn latest(&self, ids: Option<&[String]>) -> Vec<MetricsLatestDto> {
        self.live.latest(ids)
    }

    fn series(
        &self,
        ids: &[String],
        since: Option<i64>,
        max_points: Option<usize>,
    ) -> MetricsSeriesDto {
        self.series_at(ids, since, max_points, now_ms())
    }

    /// Each tick is written through to history, and history is reloaded when
    /// the endpoint changes (including the first tick after launch).
    async fn collect(&self, tick: u64) {
        let endpoint = self.session.endpoint().await;
        if self.live.set_endpoint(&endpoint) {
            match self.history.load(&endpoint, now_ms() - RETENTION_MS).await {
                Ok(history) => self.live.restore(history),
                Err(err) => log::warn!("[metrics] loading history failed: {err}"),
            }
        }
        let ts = now_ms();
        let added = match self.session.current().await {
            Some(engine) => match poll(engine.as_ref()).await {
                Ok((live, readings)) => self.record(ts, live, readings),
                Err(err) => {
                    log::debug!("[metrics] poll failed: {err}");
                    return;
                }
            },
            None => self.record(ts, HashSet::new(), Vec::new()),
        };
        if let Err(err) = self.history.insert(&endpoint, &added).await {
            log::warn!("[metrics] writing history failed: {err}");
        }
        if tick.is_multiple_of(PRUNE_EVERY_TICKS)
            && let Err(err) = self.history.prune(ts - RETENTION_MS).await
        {
            log::warn!("[metrics] pruning history failed: {err}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::{CAPACITY, INTERVAL_MS};
    use super::*;
    use crate::models::engine::ContainerRecord;
    use crate::repositories::memory::InMemoryMetricsRepository;
    use crate::repositories::sqlite::{SqliteMetricsHistoryRepository, pool};
    use crate::services::testing::{FakeEngine, FakeSession};

    fn reading(cpu: u64, system: u64, net: u64) -> StatsReading {
        StatsReading {
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

    async fn history() -> Arc<SqliteMetricsHistoryRepository> {
        Arc::new(
            SqliteMetricsHistoryRepository::builder()
                .pool(pool::memory().await)
                .build(),
        )
    }

    fn service_with(
        session: FakeSession,
        history: Arc<SqliteMetricsHistoryRepository>,
    ) -> MetricsService {
        MetricsService::builder()
            .session(Arc::new(session))
            .live(Arc::new(
                InMemoryMetricsRepository::builder()
                    .capacity(CAPACITY)
                    .build(),
            ))
            .history(history)
            .build()
    }

    async fn service() -> MetricsService {
        service_with(FakeSession::disconnected(), history().await)
    }

    #[tokio::test]
    async fn first_sample_has_no_deltas_then_rates_follow() {
        let store = service().await;
        store.record(0, ids(&["a"]), vec![("a".into(), reading(0, 0, 0))]);
        store.record(
            2_000,
            ids(&["a"]),
            vec![("a".into(), reading(500, 1_000, 4_000))],
        );

        let series = store.series_at(&["a".into()], None, None, 2_000);
        let samples = &series.series[0].samples;
        assert_eq!(samples.len(), 2);
        assert_eq!(samples[0].cpu_percent, None);
        assert_eq!(samples[0].net_rx_rate, None);
        assert_eq!(samples[1].cpu_percent, Some(100.0));
        assert_eq!(samples[1].net_rx_rate, Some(2_000.0));
    }

    #[tokio::test]
    async fn restart_and_downtime_never_produce_rates() {
        let store = service().await;
        store.record(0, ids(&["a"]), vec![("a".into(), reading(0, 0, 5_000))]);
        // Counter went backwards: restarted between polls.
        store.record(2_000, ids(&["a"]), vec![("a".into(), reading(10, 100, 10))]);
        // Stopped for a tick, then back.
        store.record(4_000, ids(&[]), vec![]);
        store.record(6_000, ids(&["a"]), vec![("a".into(), reading(20, 200, 20))]);

        let samples = store
            .series_at(&["a".into()], None, None, 6_000)
            .series
            .remove(0)
            .samples;
        assert!(
            samples
                .iter()
                .all(|s| s.net_rx_rate.is_none() && s.cpu_percent.is_none())
        );
    }

    #[tokio::test]
    async fn latest_only_reports_live_containers() {
        let store = service().await;
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

    #[tokio::test]
    async fn restored_history_is_readable_but_never_used_for_deltas() {
        let db = history().await;
        let first = service_with(FakeSession::disconnected(), db.clone());
        first.live.set_endpoint("one");
        let mut added = first.record(0, ids(&["a"]), vec![("a".into(), reading(0, 0, 0))]);
        added.extend(first.record(
            2_000,
            ids(&["a"]),
            vec![("a".into(), reading(500, 1_000, 4_000))],
        ));
        db.insert("one", &added).await.unwrap();

        // Simulated app restart.
        let second = service_with(FakeSession::disconnected(), db.clone());
        assert!(second.live.set_endpoint("one"));
        second.live.restore(db.load("one", 0).await.unwrap());
        second.record(
            60_000,
            ids(&["a"]),
            vec![("a".into(), reading(900, 2_000, 9_000))],
        );

        let samples = second
            .series_at(&["a".into()], None, None, 60_000)
            .series
            .remove(0)
            .samples;
        assert_eq!(samples.len(), 3);
        assert_eq!(samples[1].cpu_percent, Some(100.0));
        assert_eq!(samples[2].cpu_percent, None, "no delta across the restart");
        assert!(second.latest(None)[0].sample.ts == 60_000);
    }

    #[tokio::test]
    async fn history_is_bounded_and_endpoint_switch_clears_it() {
        let store = service().await;
        store.live.set_endpoint("one");
        for tick in 0..(CAPACITY as i64 + 10) {
            store.record(
                tick * INTERVAL_MS,
                ids(&["a"]),
                vec![("a".into(), reading(0, 0, 0))],
            );
        }
        let now = (CAPACITY as i64 + 9) * INTERVAL_MS;
        assert!(
            store.series_at(&["a".into()], None, None, now).series[0]
                .samples
                .len()
                <= CAPACITY
        );

        store.live.set_endpoint("one");
        assert!(
            !store.series_at(&["a".into()], None, None, now).series[0]
                .samples
                .is_empty()
        );
        store.live.set_endpoint("two");
        assert!(
            store.series_at(&["a".into()], None, None, now).series[0]
                .samples
                .is_empty()
        );
    }

    #[tokio::test]
    async fn downsample_averages_aligned_buckets() {
        let store = service().await;
        for (tick, mem) in [(0, 100), (1, 300), (2, 500), (3, 700)] {
            let mut r = reading(0, 0, 0);
            r.memory_usage = mem;
            store.record(tick * INTERVAL_MS, ids(&["a"]), vec![("a".into(), r)]);
        }
        let now = 3 * INTERVAL_MS;
        // 8 s span into 2 points → 4 s buckets: [0,2s] and [4s,6s].
        let result = store.series_at(&["a".into()], Some(now - 8_000), Some(2), now);
        assert_eq!(result.step_ms, 4_000);
        let mems: Vec<i64> = result.series[0]
            .samples
            .iter()
            .map(|s| s.memory_usage)
            .collect();
        assert_eq!(mems, vec![200, 600]);
    }

    #[tokio::test]
    async fn collect_polls_live_containers_and_writes_history() {
        let engine = FakeEngine {
            containers: vec![
                ContainerRecord {
                    id: "up".into(),
                    state: "running".into(),
                    ..Default::default()
                },
                ContainerRecord {
                    id: "down".into(),
                    state: "exited".into(),
                    ..Default::default()
                },
            ],
            stats: [("up".to_string(), reading(0, 0, 0))].into(),
            ..Default::default()
        };
        let db = history().await;
        let service = service_with(FakeSession::connected(engine), db.clone());
        service.collect(1).await;

        let latest = service.latest(None);
        assert_eq!(latest.len(), 1);
        assert_eq!(latest[0].id, "up");
        let stored = db.load(FakeSession::ENDPOINT, 0).await.unwrap();
        assert_eq!(stored["up"].len(), 1);
        assert!(!stored.contains_key("down"));
    }
}
