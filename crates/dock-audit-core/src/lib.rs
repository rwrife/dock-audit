//! UI-independent Dock Audit contracts.

pub mod adapters;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path};

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

/// The source and expected stability of an observed field.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Capability {
    pub source: String,
    pub stable: bool,
}

/// A normalized observation from a platform adapter. `identity_hashes` are keyed local
/// hashes; raw serial numbers must be hashed before constructing an observation.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Observation {
    pub class: DeviceClass,
    pub label: String,
    pub capabilities: BTreeMap<String, Capability>,
    pub identity_hashes: BTreeMap<String, String>,
}

/// A user-approved expected device. It contains no raw device serial or identifier.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProfileExpectation {
    pub id: String,
    pub class: DeviceClass,
    pub alias: String,
    pub required: bool,
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
            matches.push(MatchExplanation {
                kind: MatchKind::Exact,
                reason: "A stable local identity hash matched.".into(),
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
