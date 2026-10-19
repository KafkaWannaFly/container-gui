//! Docker CLI contexts read from `~/.docker`: `config.json` names the current
//! context and `contexts/meta/<sha256(name)>/meta.json` holds each one.

use std::path::{Path, PathBuf};

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::models::dto::DockerContextDto;
use crate::repositories::IDockerContextRepository;

#[derive(bon::Builder)]
pub struct FsDockerContextRepository {
    /// The `.docker` directory; `None` when the home directory is unknown.
    docker_dir: Option<PathBuf>,
}

/// `~/.docker` for the current user.
pub fn default_docker_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let home = std::env::var_os("USERPROFILE");
    #[cfg(not(windows))]
    let home = std::env::var_os("HOME");
    home.map(|home| PathBuf::from(home).join(".docker"))
}

fn read_json(path: &Path) -> Option<Value> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

impl FsDockerContextRepository {
    fn meta_dir(&self) -> Option<PathBuf> {
        Some(self.docker_dir.as_ref()?.join("contexts").join("meta"))
    }
}

impl IDockerContextRepository for FsDockerContextRepository {
    fn current_context(&self) -> Option<String> {
        let value = read_json(&self.docker_dir.as_ref()?.join("config.json"))?;
        value.get("currentContext")?.as_str().map(str::to_string)
    }

    fn context_host(&self, name: &str) -> Option<String> {
        // Docker names context metadata directories by the SHA-256 of the
        // context name.
        let hash: String = Sha256::digest(name.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let meta = read_json(&self.meta_dir()?.join(hash).join("meta.json"))?;
        meta.pointer("/Endpoints/docker/Host")?
            .as_str()
            .map(str::to_string)
    }

    fn list(&self) -> Vec<DockerContextDto> {
        let Some(entries) = self.meta_dir().and_then(|dir| std::fs::read_dir(dir).ok()) else {
            return Vec::new();
        };
        entries
            .flatten()
            .filter_map(|entry| {
                let value = read_json(&entry.path().join("meta.json"))?;
                let name = value.get("Name").and_then(Value::as_str)?;
                if name == "default" {
                    return None;
                }
                let host = value
                    .pointer("/Endpoints/docker/Host")
                    .and_then(Value::as_str)?;
                Some(DockerContextDto {
                    name: name.to_string(),
                    host: host.to_string(),
                    description: value
                        .pointer("/Metadata/Description")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .filter(|d| !d.is_empty()),
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_current_context_and_hosts() {
        let dir = std::env::temp_dir().join(format!("cgui-contexts-{}", std::process::id()));
        let docker = dir.join(".docker");
        let hash: String = Sha256::digest(b"remote")
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let meta = docker.join("contexts").join("meta").join(hash);
        std::fs::create_dir_all(&meta).unwrap();
        std::fs::write(docker.join("config.json"), r#"{"currentContext":"remote"}"#).unwrap();
        std::fs::write(
            meta.join("meta.json"),
            r#"{"Name":"remote","Metadata":{"Description":"box"},"Endpoints":{"docker":{"Host":"tcp://box:2375"}}}"#,
        )
        .unwrap();

        let repo = FsDockerContextRepository::builder()
            .docker_dir(docker)
            .build();
        assert_eq!(repo.current_context().as_deref(), Some("remote"));
        assert_eq!(
            repo.context_host("remote").as_deref(),
            Some("tcp://box:2375")
        );
        let list = repo.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].description.as_deref(), Some("box"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn missing_home_yields_nothing() {
        let repo = FsDockerContextRepository::builder().build();
        assert!(repo.current_context().is_none());
        assert!(repo.list().is_empty());
    }
}
