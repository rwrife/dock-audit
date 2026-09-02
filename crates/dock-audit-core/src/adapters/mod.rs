//! Native inventory adapter boundaries.
//!
//! Implementations remain intentionally absent in the bootstrap milestone. Future
//! Windows and macOS adapters must perform ordinary-user, read-only inventory and
//! report capability or scan failures instead of synthesizing observations.

pub mod macos;
pub mod windows;

use crate::AdapterStatus;

/// Read-only boundary implemented by each operating-system inventory adapter.
pub trait InventoryAdapter {
    fn scan(&self) -> AdapterStatus;
}
