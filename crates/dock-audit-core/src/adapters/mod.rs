//! Native inventory adapter boundaries.
//!
//! Platform adapters perform ordinary-user, read-only inventory and report
//! capability or scan failures instead of synthesizing observations.

pub mod macos;
pub mod windows;

use crate::{ClassScan, InventoryReport};

/// Read-only boundary implemented by each operating-system inventory adapter.
pub trait InventoryAdapter {
    fn scan(&self) -> InventoryReport;
}

/// Read-only boundary for one inventory class. It keeps class-specific native
/// APIs independently testable while preserving explicit scan health.
pub trait ClassInventoryAdapter {
    fn scan_class(&self) -> ClassScan;
}
