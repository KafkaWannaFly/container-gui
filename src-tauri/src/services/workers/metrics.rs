//! Metrics collector loop. Runs for the app's lifetime; skips ticks when a
//! poll overruns the interval.

use std::sync::Arc;

use tokio::time::{MissedTickBehavior, interval};

use crate::services::metrics::{IMetricsService, INTERVAL};

pub fn spawn(metrics: Arc<dyn IMetricsService>) {
    tokio::spawn(async move {
        let mut ticker = interval(INTERVAL);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut tick: u64 = 0;
        loop {
            ticker.tick().await;
            tick += 1;
            metrics.collect(tick).await;
        }
    });
}
