//! Composition root: the shared state handed to commands and the code that
//! wires every repository and service together at startup.

pub mod bootstrap;
pub mod state;

pub use state::AppState;
