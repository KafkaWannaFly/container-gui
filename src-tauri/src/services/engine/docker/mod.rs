//! Docker Engine adapter: the only module that talks bollard. Each file
//! implements one gateway trait on [`DockerEngine`] and maps bollard's wire
//! types into `models::engine` records.

mod connector;
mod containers;
mod events;
mod exec;
mod images;
mod system;
mod volumes;

use bollard::Docker;
use bollard::container::LogOutput;
pub use connector::DockerConnector;
use futures_util::{Stream, StreamExt};

use crate::models::engine::{OutputChunk, OutputKind};
use crate::services::engine::{
    IContainerGateway, IEngine, IEventSource, IExecGateway, IImageGateway, ISystemGateway,
    IVolumeGateway, OutputStream,
};

/// A connected Docker client plus the endpoint it reached, for error
/// messages.
#[derive(bon::Builder)]
pub struct DockerEngine {
    client: Docker,
    endpoint: String,
}

impl IEngine for DockerEngine {
    fn containers(&self) -> &dyn IContainerGateway {
        self
    }

    fn images(&self) -> &dyn IImageGateway {
        self
    }

    fn volumes(&self) -> &dyn IVolumeGateway {
        self
    }

    fn exec(&self) -> &dyn IExecGateway {
        self
    }

    fn system(&self) -> &dyn ISystemGateway {
        self
    }

    fn events(&self) -> &dyn IEventSource {
        self
    }
}

/// Map bollard's multiplexed output; TTY `Console` output counts as stdout
/// and echoed stdin is dropped.
fn output_stream(
    stream: impl Stream<Item = Result<LogOutput, bollard::errors::Error>> + Send + 'static,
) -> OutputStream {
    stream
        .filter_map(|item| async move {
            match item {
                Ok(LogOutput::StdErr { message }) => Some(Ok(OutputChunk {
                    kind: OutputKind::Stderr,
                    data: message,
                })),
                Ok(LogOutput::StdOut { message } | LogOutput::Console { message }) => {
                    Some(Ok(OutputChunk {
                        kind: OutputKind::Stdout,
                        data: message,
                    }))
                }
                Ok(LogOutput::StdIn { .. }) => None,
                Err(err) => Some(Err(err.into())),
            }
        })
        .boxed()
}
