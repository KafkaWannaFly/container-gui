//! Volume listing, removal and pruning. In-use detection counts the containers
//! (including stopped ones) that mount each named volume, matching the daemon's
//! refCount. Sizes come from a cache, because the engine's disk-usage walk is
//! slow.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use async_trait::async_trait;

use crate::error::{AppError, AppResult};
use crate::models::dto::{VolumeContainerDto, VolumeDetailDto, VolumeItemDto, VolumeMountDto};
use crate::models::engine::{ContainerQuery, ContainerRecord};
use crate::repositories::IVolumeSizeRepository;
use crate::services::now_ms;
use crate::services::session::IEngineSession;

#[async_trait]
pub trait IVolumeService: Send + Sync {
    async fn detail(&self, name: &str) -> AppResult<VolumeDetailDto>;
    /// Fast list: no disk-usage walk. Sizes come from the cache and are
    /// `None` for volumes never measured; a cache read failure degrades to
    /// unknown sizes.
    async fn list(&self) -> AppResult<Vec<VolumeItemDto>>;
    /// Slow disk-usage walk that overwrites the cached sizes. A call that
    /// arrives while one is running returns without doing anything.
    async fn refresh_sizes(&self) -> AppResult<()>;
    async fn remove(&self, name: &str, force: bool) -> AppResult<()>;
    async fn prune(&self) -> AppResult<i64>;
}

#[derive(bon::Builder)]
pub struct VolumeService {
    session: Arc<dyn IEngineSession>,
    sizes: Arc<dyn IVolumeSizeRepository>,
    #[builder(skip)]
    refreshing: AtomicBool,
}

/// Held while a refresh runs; releases the flag on drop, even on error.
struct RefreshGuard<'a>(&'a AtomicBool);

impl Drop for RefreshGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl VolumeService {
    /// `None` when a refresh is already running, so overlapping callers skip
    /// instead of stacking slow disk-usage walks.
    fn try_begin_refresh(&self) -> Option<RefreshGuard<'_>> {
        self.refreshing
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| RefreshGuard(&self.refreshing))
    }
}

#[async_trait]
impl IVolumeService for VolumeService {
    async fn detail(&self, name: &str) -> AppResult<VolumeDetailDto> {
        let engine = self.session.engine().await?;
        let query = ContainerQuery::builder()
            .all(true)
            .volume(name.to_string())
            .build();
        let (volume, containers) = tokio::try_join!(
            engine.volumes().inspect(name),
            engine.containers().list(&query),
        )?;
        Ok(VolumeDetailDto {
            containers: volume_containers(containers, &volume.name),
            name: volume.name,
            driver: volume.driver,
            mountpoint: volume.mountpoint,
            created_at: volume.created_at,
            scope: volume.scope,
            labels: volume.labels,
            options: volume.options,
        })
    }

    async fn list(&self) -> AppResult<Vec<VolumeItemDto>> {
        let engine = self.session.engine().await?;
        let endpoint = self.session.endpoint().await;
        let query = ContainerQuery::builder().all(true).build();
        let cached_fut = async {
            self.sizes.load(&endpoint).await.unwrap_or_else(|err| {
                log::warn!("[volumes] size cache read failed: {err}");
                HashMap::new()
            })
        };
        let (cached, daemon) = tokio::join!(cached_fut, async {
            tokio::try_join!(engine.volumes().list(), engine.containers().list(&query))
        },);
        let (volumes, containers) = daemon?;
        let ref_counts = volume_ref_counts(&containers);

        Ok(volumes
            .into_iter()
            .map(|volume| {
                let ref_count = ref_counts.get(&volume.name).copied().unwrap_or(0);
                let measured = cached.get(&volume.name);
                VolumeItemDto {
                    size_bytes: measured.map(|size| size.size_bytes),
                    size_measured_at: measured.map(|size| size.measured_at),
                    name: volume.name,
                    driver: volume.driver,
                    mountpoint: volume.mountpoint,
                    created_at: volume.created_at,
                    in_use: ref_count > 0,
                    ref_count,
                }
            })
            .collect())
    }

    async fn refresh_sizes(&self) -> AppResult<()> {
        let Some(_guard) = self.try_begin_refresh() else {
            return Ok(());
        };
        let engine = self.session.engine().await?;
        let endpoint = self.session.endpoint().await;
        let sizes = engine.volumes().sizes().await?;
        self.sizes
            .replace(&endpoint, &sizes, now_ms())
            .await
            .map_err(|err| AppError::Message(format!("saving volume sizes: {err}")))
    }

    async fn remove(&self, name: &str, force: bool) -> AppResult<()> {
        self.session
            .engine()
            .await?
            .volumes()
            .remove(name, force)
            .await
    }

    async fn prune(&self) -> AppResult<i64> {
        self.session.engine().await?.volumes().prune().await
    }
}

fn volume_containers(containers: Vec<ContainerRecord>, name: &str) -> Vec<VolumeContainerDto> {
    containers
        .into_iter()
        .filter_map(|container| {
            // The engine's volume filter also matches mount paths; match the
            // actual named volume.
            let mounts: Vec<_> = container
                .mounts
                .into_iter()
                .filter(|mount| {
                    mount.name.as_deref() == Some(name) && mount.kind.as_deref() == Some("volume")
                })
                .map(|mount| VolumeMountDto {
                    destination: mount.destination.unwrap_or_default(),
                    read_only: mount.rw.map(|rw| !rw),
                })
                .collect();
            if mounts.is_empty() {
                return None;
            }
            let id = container.id;
            Some(VolumeContainerDto {
                name: container
                    .names
                    .first()
                    .cloned()
                    .unwrap_or_else(|| id.chars().take(12).collect()),
                id,
                image: container.image,
                state: container.state,
                status: container.status,
                mounts,
            })
        })
        .collect()
}

/// Number of containers mounting each named volume. A container that mounts
/// the same volume twice counts once.
fn volume_ref_counts(containers: &[ContainerRecord]) -> HashMap<String, i64> {
    let mut counts = HashMap::new();
    for container in containers {
        let names: HashSet<&str> = container
            .mounts
            .iter()
            .filter(|mount| mount.kind.as_deref() == Some("volume"))
            .filter_map(|mount| mount.name.as_deref())
            .collect();
        for name in names {
            *counts.entry(name.to_string()).or_insert(0) += 1;
        }
    }
    counts
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::engine::{MountRecord, VolumeRecord};
    use crate::repositories::sqlite::{SqliteVolumeSizeRepository, pool};
    use crate::services::testing::{FakeEngine, FakeSession};

    fn mount(kind: &str, name: &str, destination: &str, rw: Option<bool>) -> MountRecord {
        MountRecord {
            kind: Some(kind.into()),
            name: Some(name.into()),
            destination: Some(destination.into()),
            rw,
        }
    }

    fn container(
        id: &str,
        names: &[&str],
        state: &str,
        mounts: Vec<MountRecord>,
    ) -> ContainerRecord {
        ContainerRecord {
            id: id.into(),
            names: names.iter().map(|name| name.to_string()).collect(),
            state: state.into(),
            mounts,
            ..Default::default()
        }
    }

    #[test]
    fn matches_exact_named_volumes_and_preserves_mount_access() {
        let containers = vec![
            container(
                "running-id",
                &["database"],
                "running",
                vec![
                    mount("volume", "data", "/data", Some(true)),
                    mount("volume", "data", "/backup", Some(false)),
                    mount("volume", "data-other", "/other", Some(true)),
                ],
            ),
            container(
                "stopped-id",
                &["stopped"],
                "exited",
                vec![mount("volume", "data", "/data", None)],
            ),
            container(
                "other-id",
                &[],
                "",
                vec![
                    mount("volume", "data-other", "/data", None),
                    mount("bind", "data", "/bind", None),
                ],
            ),
            container("no-mounts", &[], "", vec![]),
        ];
        let rows = volume_containers(containers, "data");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].name, "database");
        assert_eq!(rows[0].mounts.len(), 2);
        assert_eq!(rows[0].mounts[0].destination, "/data");
        assert_eq!(rows[0].mounts[0].read_only, Some(false));
        assert_eq!(rows[0].mounts[1].read_only, Some(true));
        assert_eq!(rows[1].state, "exited");
        assert_eq!(rows[1].mounts[0].read_only, None);
    }

    #[test]
    fn unnamed_container_uses_short_id() {
        let containers = vec![container(
            "1234567890123456",
            &[],
            "",
            vec![mount("volume", "data", "/data", Some(true))],
        )];
        let rows = volume_containers(containers, "data");
        assert_eq!(rows[0].name, "123456789012");
    }

    async fn service(engine: FakeEngine) -> (VolumeService, Arc<SqliteVolumeSizeRepository>) {
        let sizes = Arc::new(
            SqliteVolumeSizeRepository::builder()
                .pool(pool::memory().await)
                .build(),
        );
        let service = VolumeService::builder()
            .session(Arc::new(FakeSession::connected(engine)))
            .sizes(sizes.clone())
            .build();
        (service, sizes)
    }

    fn volume(name: &str) -> VolumeRecord {
        VolumeRecord {
            name: name.into(),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn list_joins_cached_sizes_and_ref_counts() {
        let engine = FakeEngine {
            volumes: vec![volume("data"), volume("idle")],
            containers: vec![
                container(
                    "a",
                    &["a"],
                    "running",
                    vec![mount("volume", "data", "/d", None)],
                ),
                container(
                    "b",
                    &["b"],
                    "exited",
                    vec![mount("volume", "data", "/d", None)],
                ),
            ],
            ..Default::default()
        };
        let (service, sizes) = service(engine).await;
        sizes
            .replace(FakeSession::ENDPOINT, &[("data".into(), 42)], 7)
            .await
            .unwrap();

        let list = service.list().await.unwrap();
        assert_eq!(list[0].ref_count, 2);
        assert!(list[0].in_use);
        assert_eq!(list[0].size_bytes, Some(42));
        assert_eq!(list[0].size_measured_at, Some(7));
        assert!(!list[1].in_use);
        assert_eq!(list[1].size_bytes, None);
    }

    #[tokio::test]
    async fn refresh_overwrites_the_cache_for_the_current_endpoint() {
        let engine = FakeEngine {
            sizes: vec![("data".into(), 99)],
            ..Default::default()
        };
        let (service, sizes) = service(engine).await;
        service.refresh_sizes().await.unwrap();
        let cached = sizes.load(FakeSession::ENDPOINT).await.unwrap();
        assert_eq!(cached["data"].size_bytes, 99);
    }

    #[tokio::test]
    async fn refresh_guard_rejects_overlap_and_releases_on_drop() {
        let (service, _) = service(FakeEngine::default()).await;
        let guard = service.try_begin_refresh().expect("first refresh starts");
        assert!(service.try_begin_refresh().is_none());
        drop(guard);
        assert!(service.try_begin_refresh().is_some());
    }

    #[tokio::test]
    async fn disconnected_session_reports_not_connected() {
        let service = VolumeService::builder()
            .session(Arc::new(FakeSession::disconnected()))
            .sizes(Arc::new(
                SqliteVolumeSizeRepository::builder()
                    .pool(pool::memory().await)
                    .build(),
            ))
            .build();
        assert!(matches!(service.list().await, Err(AppError::NotConnected)));
    }
}
