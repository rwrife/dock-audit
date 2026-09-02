//! UI-independent Dock Audit contracts.

pub mod adapters;

use serde::{Deserialize, Serialize};

/// Whether a platform inventory adapter can currently scan devices.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterAvailability {
    Unavailable,
}

/// Capability-aware status exposed by the bootstrap application shell.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AdapterStatus {
    pub availability: AdapterAvailability,
    pub observation_count: usize,
    pub message: String,
}

impl AdapterStatus {
    /// Returns the only honest status before native adapters are implemented.
    #[must_use]
    pub fn bootstrap() -> Self {
        Self {
            availability: AdapterAvailability::Unavailable,
            observation_count: 0,
            message: "Inventory adapters are not implemented yet. No devices were scanned."
                .to_owned(),
        }
    }
}
