//! UI-independent Dock Audit contracts.

pub mod adapters;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path};

/// Whether a platform inventory adapter can currently scan devices.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterAvailability {
    Available,
    Degraded,
    Unavailable,
}

/// Capability-aware status exposed by the bootstrap application shell.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AdapterStatus {
    pub availability: AdapterAvailability,
    pub observation_count: usize,
    pub message: String,
    pub scan_health: BTreeMap<DeviceClass, ScanHealth>,
    pub capability_gaps: Vec<CapabilityGap>,
}

impl AdapterStatus {
    /// Returns the only honest status where no platform adapter is compiled.
    #[must_use]
    pub fn bootstrap() -> Self {
        Self {
            availability: AdapterAvailability::Unavailable,
            observation_count: 0,
            message: "No native inventory adapter is available on this platform. No devices were scanned."
                .to_owned(),
            scan_health: BTreeMap::from([
                (DeviceClass::Usb, ScanHealth::Unsupported),
                (DeviceClass::Display, ScanHealth::Unsupported),
                (DeviceClass::AudioInput, ScanHealth::Unsupported),
                (DeviceClass::AudioOutput, ScanHealth::Unsupported),
                (DeviceClass::Network, ScanHealth::Unsupported),
            ]),
            capability_gaps: Vec::new(),
        }
    }

    /// Builds a concise shell status without exposing individual observations.
    #[must_use]
    pub fn from_report(report: &InventoryReport) -> Self {
        let availability = if DeviceClass::ALL
            .iter()
            .all(|class| report.scan_health.get(class) == Some(&ScanHealth::Complete))
            && report.capability_gaps.is_empty()
        {
            AdapterAvailability::Available
        } else {
            AdapterAvailability::Degraded
        };
        let message = if availability == AdapterAvailability::Available {
            "Read-only native inventory completed. Observations do not establish hardware compatibility."
                .to_owned()
        } else {
            "Read-only native inventory completed with capability gaps. Unobserved devices are not treated as missing."
                .to_owned()
        };

        Self {
            availability,
            observation_count: report.observations.len(),
            message,
            scan_health: report.scan_health.clone(),
            capability_gaps: report.capability_gaps.clone(),
        }
    }
}

/// A peripheral category. Ordering is deliberately stable for deterministic reports.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceClass {
    Usb,
    Display,
    AudioInput,
    AudioOutput,
    Network,
}

/// Whether an adapter established absence, failed, or cannot support a device class.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanHealth {
    Complete,
    Partial,
    Failed,
    Unsupported,
}

/// The reason a read-only inventory capability could not produce a result.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityGapKind {
    AccessDenied,
    ApiUnavailable,
    QueryFailed,
    PrivacyLimited,
}

/// A device-class capability that could not be observed. Messages and codes are
/// adapter-defined constants and must not include device-provided values.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CapabilityGap {
    pub class: DeviceClass,
    pub capability: String,
    pub kind: CapabilityGapKind,
    pub message: String,
    pub error_code: Option<i32>,
}

/// The source and expected stability of an observed field.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Capability {
    pub source: String,
    pub stable: bool,
}

/// A normalized, allow-listed value observed by a platform adapter.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct NormalizedField {
    pub value: String,
    pub source: String,
    pub stable: bool,
}

/// A normalized observation from a platform adapter. `identity_hashes` are keyed local
/// hashes; raw serial numbers must be hashed before constructing an observation.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Observation {
    pub class: DeviceClass,
    pub label: String,
    #[serde(default)]
    pub attributes: BTreeMap<String, NormalizedField>,
    #[serde(default)]
    pub capabilities: BTreeMap<String, Capability>,
    #[serde(default)]
    pub identity_hashes: BTreeMap<String, String>,
}

/// A user-approved expected device. It contains no raw device serial or identifier.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProfileExpectation {
    pub id: String,
    pub class: DeviceClass,
    pub alias: String,
    pub required: bool,
    #[serde(default)]
    pub expected_fields: BTreeMap<String, String>,
    #[serde(default)]
    pub identity_hashes: BTreeMap<String, String>,
    pub friendly_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub expectations: Vec<ProfileExpectation>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchKind {
    Exact,
    Fallback,
    Ambiguous,
    Changed,
    Missing,
    Unexpected,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct MatchExplanation {
    pub kind: MatchKind,
    pub reason: String,
    pub expectation_id: Option<String>,
    pub observation_index: Option<usize>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ComparisonResult {
    pub matches: Vec<MatchExplanation>,
}

/// The result of a single device-class scan.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ClassScan {
    pub class: DeviceClass,
    pub health: ScanHealth,
    pub observations: Vec<Observation>,
    pub capability_gaps: Vec<CapabilityGap>,
}

/// A complete inventory attempt. Every supported class must have a health entry;
/// callers use it to avoid treating an unobserved device as absent.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct InventoryReport {
    pub observations: Vec<Observation>,
    pub scan_health: BTreeMap<DeviceClass, ScanHealth>,
    pub capability_gaps: Vec<CapabilityGap>,
}

/// An opt-in diagnostic payload containing counts only. It deliberately carries
/// no labels, normalized values, or identity hashes.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RedactedDiagnostic {
    pub capability_counts: BTreeMap<String, usize>,
}

impl InventoryReport {
    /// Merges device-class results deterministically.
    #[must_use]
    pub fn from_class_scans(scans: impl IntoIterator<Item = ClassScan>) -> Self {
        let mut observations = Vec::new();
        let mut scan_health = BTreeMap::new();
        let mut capability_gaps = Vec::new();

        for scan in scans {
            scan_health.insert(scan.class, scan.health);
            observations.extend(scan.observations);
            capability_gaps.extend(scan.capability_gaps);
        }
        observations.sort_by(|left, right| {
            left.class
                .cmp(&right.class)
                .then_with(|| left.label.cmp(&right.label))
                .then_with(|| left.identity_hashes.cmp(&right.identity_hashes))
        });
        capability_gaps.sort_by(|left, right| {
            left.class
                .cmp(&right.class)
                .then_with(|| left.capability.cmp(&right.capability))
                .then_with(|| left.error_code.cmp(&right.error_code))
        });

        Self {
            observations,
            scan_health,
            capability_gaps,
        }
    }

    /// Produces a deliberately non-identifying diagnostic summary.
    #[must_use]
    pub fn redacted_diagnostic(&self) -> RedactedDiagnostic {
        let mut capability_counts = BTreeMap::new();
        for class in DeviceClass::ALL {
            let class_name = class.as_str();
            let observation_count = self
                .observations
                .iter()
                .filter(|observation| observation.class == class)
                .count();
            capability_counts.insert(format!("{class_name}.observations"), observation_count);
            let health = self
                .scan_health
                .get(&class)
                .copied()
                .unwrap_or(ScanHealth::Unsupported);
            *capability_counts
                .entry(format!("{class_name}.health.{}", health.as_str()))
                .or_insert(0) += 1;
        }
        for gap in &self.capability_gaps {
            *capability_counts
                .entry(format!(
                    "{}.gap.{}.{}",
                    gap.class.as_str(),
                    gap.capability,
                    gap.kind.as_str()
                ))
                .or_insert(0) += 1;
        }
        RedactedDiagnostic { capability_counts }
    }
}

impl DeviceClass {
    pub const ALL: [Self; 5] = [
        Self::Usb,
        Self::Display,
        Self::AudioInput,
        Self::AudioOutput,
        Self::Network,
    ];

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Usb => "usb",
            Self::Display => "display",
            Self::AudioInput => "audio_input",
            Self::AudioOutput => "audio_output",
            Self::Network => "network",
        }
    }
}

impl ScanHealth {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Complete => "complete",
            Self::Partial => "partial",
            Self::Failed => "failed",
            Self::Unsupported => "unsupported",
        }
    }
}

impl CapabilityGapKind {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AccessDenied => "access_denied",
            Self::ApiUnavailable => "api_unavailable",
            Self::QueryFailed => "query_failed",
            Self::PrivacyLimited => "privacy_limited",
        }
    }
}

/// Deterministically compares a profile to observations without allowing a friendly
/// name to become an exact identity match.
#[must_use]
pub fn compare(
    profile: &Profile,
    observations: &[Observation],
    health: &BTreeMap<DeviceClass, ScanHealth>,
) -> ComparisonResult {
    let mut used = vec![false; observations.len()];
    let mut matches = Vec::new();
    let mut expectations = profile.expectations.clone();
    expectations.sort_by(|a, b| a.id.cmp(&b.id));
    for expected in expectations {
        let candidates: Vec<usize> = observations
            .iter()
            .enumerate()
            .filter(|(i, observed)| {
                !used[*i]
                    && observed.class == expected.class
                    && expected
                        .identity_hashes
                        .iter()
                        .any(|(key, value)| observed.identity_hashes.get(key) == Some(value))
            })
            .map(|(i, _)| i)
            .collect();
        if candidates.len() == 1 {
            let index = candidates[0];
            used[index] = true;
            let changed_fields: Vec<&str> = expected
                .expected_fields
                .iter()
                .filter_map(|(field, expected_value)| {
                    (observations[index]
                        .attributes
                        .get(field)
                        .map(|observed| &observed.value)
                        != Some(expected_value))
                    .then_some(field.as_str())
                })
                .collect();
            matches.push(MatchExplanation {
                kind: if changed_fields.is_empty() {
                    MatchKind::Exact
                } else {
                    MatchKind::Changed
                },
                reason: if changed_fields.is_empty() {
                    "A stable local identity hash matched.".into()
                } else {
                    format!(
                        "A stable local identity hash matched, but expected fields changed or were unavailable: {}.",
                        changed_fields.join(", ")
                    )
                },
                expectation_id: Some(expected.id),
                observation_index: Some(index),
            });
        } else if candidates.len() > 1 {
            matches.push(MatchExplanation {
                kind: MatchKind::Ambiguous,
                reason: "More than one observation shared a stable identity signal.".into(),
                expectation_id: Some(expected.id),
                observation_index: None,
            });
        } else {
            let names: Vec<usize> = observations
                .iter()
                .enumerate()
                .filter(|(i, observed)| {
                    !used[*i]
                        && observed.class == expected.class
                        && Some(&observed.label) == expected.friendly_name.as_ref()
                })
                .map(|(i, _)| i)
                .collect();
            if names.len() == 1 {
                let index = names[0];
                used[index] = true;
                matches.push(MatchExplanation {
                    kind: MatchKind::Fallback,
                    reason:
                        "Only a friendly-name signal matched; this is not an exact identity match."
                            .into(),
                    expectation_id: Some(expected.id),
                    observation_index: Some(index),
                });
            } else if names.len() > 1 {
                matches.push(MatchExplanation {
                    kind: MatchKind::Ambiguous,
                    reason: "More than one observation shared a friendly-name signal.".into(),
                    expectation_id: Some(expected.id),
                    observation_index: None,
                });
            } else if matches!(
                health.get(&expected.class),
                Some(ScanHealth::Failed | ScanHealth::Partial | ScanHealth::Unsupported)
            ) {
                matches.push(MatchExplanation {
                    kind: MatchKind::Unknown,
                    reason: "This device class was not scanned completely, so absence is unknown."
                        .into(),
                    expectation_id: Some(expected.id),
                    observation_index: None,
                });
            } else {
                matches.push(MatchExplanation {
                    kind: MatchKind::Missing,
                    reason: "No matching observation was found in a complete scan.".into(),
                    expectation_id: Some(expected.id),
                    observation_index: None,
                });
            }
        }
    }
    for (index, observed) in observations.iter().enumerate() {
        if !used[index] {
            matches.push(MatchExplanation {
                kind: MatchKind::Unexpected,
                reason: format!("Unexpected {:?} observation.", observed.class),
                expectation_id: None,
                observation_index: Some(index),
            });
        }
    }
    ComparisonResult { matches }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Snapshot {
    pub id: String,
    pub profile_id: String,
    pub observations: Vec<Observation>,
    pub scan_health: BTreeMap<DeviceClass, ScanHealth>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Backup {
    pub version: u32,
    pub profiles: Vec<Profile>,
    pub snapshots: Vec<Snapshot>,
}

/// Local SQLite storage with an injectable app-data location.
pub struct Store {
    connection: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, rusqlite::Error> {
        let connection = Connection::open(path)?;
        connection.execute_batch("BEGIN; CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, payload TEXT NOT NULL); PRAGMA user_version = 1; COMMIT;")?;
        Ok(Self { connection })
    }
    pub fn save_profile(&self, profile: &Profile) -> Result<(), rusqlite::Error> {
        let payload = serde_json::to_string(profile).expect("Profile is serializable");
        self.connection.execute("INSERT INTO profiles(id,payload) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", params![profile.id, payload])?;
        Ok(())
    }
    pub fn profile(&self, id: &str) -> Result<Option<Profile>, rusqlite::Error> {
        self.connection
            .query_row("SELECT payload FROM profiles WHERE id=?1", [id], |row| {
                row.get::<_, String>(0)
            })
            .optional()?
            .map(|json| {
                serde_json::from_str(&json)
                    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
            })
            .transpose()
    }
    pub fn save_snapshot(&self, snapshot: &Snapshot) -> Result<(), rusqlite::Error> {
        let payload = serde_json::to_string(snapshot).expect("Snapshot is serializable");
        self.connection.execute("INSERT INTO snapshots(id,profile_id,payload) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", params![snapshot.id, snapshot.profile_id, payload])?;
        Ok(())
    }
    pub fn backup(&self) -> Result<Backup, rusqlite::Error> {
        Ok(Backup {
            version: 1,
            profiles: self.rows("profiles")?,
            snapshots: self.rows("snapshots")?,
        })
    }
    fn rows<T: for<'a> Deserialize<'a>>(&self, table: &str) -> Result<Vec<T>, rusqlite::Error> {
        let mut statement = self
            .connection
            .prepare(&format!("SELECT payload FROM {table} ORDER BY id"))?;
        statement
            .query_map([], |row| row.get::<_, String>(0))?
            .map(|entry| {
                serde_json::from_str(&entry?)
                    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
            })
            .collect()
    }
    /// Validates all content before a transaction replaces local data.
    pub fn restore(&mut self, backup: &Backup) -> Result<(), String> {
        if backup.version != 1
            || backup
                .profiles
                .iter()
                .any(|p| p.id.is_empty() || p.name.is_empty())
            || backup
                .snapshots
                .iter()
                .any(|s| s.id.is_empty() || !backup.profiles.iter().any(|p| p.id == s.profile_id))
        {
            return Err("Backup is not a valid version 1 archive.".into());
        }
        let transaction = self.connection.transaction().map_err(|e| e.to_string())?;
        transaction
            .execute("DELETE FROM snapshots", [])
            .map_err(|e| e.to_string())?;
        transaction
            .execute("DELETE FROM profiles", [])
            .map_err(|e| e.to_string())?;
        for profile in &backup.profiles {
            transaction
                .execute(
                    "INSERT INTO profiles(id,payload) VALUES(?1,?2)",
                    params![
                        profile.id,
                        serde_json::to_string(profile).expect("serializable")
                    ],
                )
                .map_err(|e| e.to_string())?;
        }
        for snapshot in &backup.snapshots {
            transaction
                .execute(
                    "INSERT INTO snapshots(id,profile_id,payload) VALUES(?1,?2,?3)",
                    params![
                        snapshot.id,
                        snapshot.profile_id,
                        serde_json::to_string(snapshot).expect("serializable")
                    ],
                )
                .map_err(|e| e.to_string())?;
        }
        transaction.commit().map_err(|e| e.to_string())
    }
}
