//! Bounded per-container sample series shared between the metrics collector
//! and the query commands.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Mutex;

use crate::models::dto::{MetricSampleDto, MetricsLatestDto};
use crate::models::engine::StatsReading;
use crate::repositories::IMetricsRepository;

struct Series {
    samples: VecDeque<MetricSampleDto>,
    /// Last reading while the container stayed live; cleared when it stops
    /// so a restart never produces a rate across the downtime.
    prev: Option<(i64, StatsReading)>,
}

#[derive(Default)]
struct Inner {
    endpoint: Option<String>,
    series: HashMap<String, Series>,
    live: HashSet<String>,
}

#[derive(bon::Builder)]
pub struct InMemoryMetricsRepository {
    /// Most samples kept per container.
    capacity: usize,
    #[builder(skip)]
    inner: Mutex<Inner>,
}

impl InMemoryMetricsRepository {
    fn trim(&self, samples: &mut VecDeque<MetricSampleDto>) {
        while samples.len() > self.capacity {
            samples.pop_front();
        }
    }
}

impl IMetricsRepository for InMemoryMetricsRepository {
    fn set_endpoint(&self, endpoint: &str) -> bool {
        let mut inner = self.inner.lock().unwrap();
        if inner.endpoint.as_deref() == Some(endpoint) {
            return false;
        }
        inner.series.clear();
        inner.live.clear();
        inner.endpoint = Some(endpoint.to_string());
        true
    }

    fn restore(&self, history: HashMap<String, Vec<MetricSampleDto>>) {
        let mut inner = self.inner.lock().unwrap();
        for (id, samples) in history {
            let mut samples: VecDeque<_> = samples.into();
            self.trim(&mut samples);
            inner.series.insert(
                id,
                Series {
                    samples,
                    prev: None,
                },
            );
        }
    }

    fn previous(&self, ids: &[String]) -> HashMap<String, (i64, StatsReading)> {
        let inner = self.inner.lock().unwrap();
        ids.iter()
            .filter_map(|id| Some((id.clone(), inner.series.get(id)?.prev?)))
            .collect()
    }

    fn append(
        &self,
        live: HashSet<String>,
        entries: Vec<(String, MetricSampleDto, (i64, StatsReading))>,
        cutoff: i64,
    ) {
        let mut inner = self.inner.lock().unwrap();
        for (id, series) in inner.series.iter_mut() {
            if !live.contains(id) {
                series.prev = None;
            }
        }
        for (id, sample, reading) in entries {
            let series = inner.series.entry(id).or_insert_with(|| Series {
                samples: VecDeque::with_capacity(self.capacity),
                prev: None,
            });
            series.samples.push_back(sample);
            self.trim(&mut series.samples);
            series.prev = Some(reading);
        }
        inner.series.retain(|_, series| {
            while series.samples.front().is_some_and(|s| s.ts < cutoff) {
                series.samples.pop_front();
            }
            !series.samples.is_empty()
        });
        inner.live = live;
    }

    fn latest(&self, ids: Option<&[String]>) -> Vec<MetricsLatestDto> {
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

    fn samples_since(&self, ids: &[String], since: i64) -> Vec<(String, Vec<MetricSampleDto>)> {
        let inner = self.inner.lock().unwrap();
        ids.iter()
            .map(|id| {
                let samples = inner
                    .series
                    .get(id)
                    .map(|series| {
                        series
                            .samples
                            .iter()
                            .filter(|s| s.ts >= since)
                            .cloned()
                            .collect()
                    })
                    .unwrap_or_default();
                (id.clone(), samples)
            })
            .collect()
    }
}
