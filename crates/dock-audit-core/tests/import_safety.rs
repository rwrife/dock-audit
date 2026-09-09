//! Deterministic import-safety checks for backup archives.
//!
//! These tests exercise the backup importer/parser boundaries the release
//! checklist requires: malformed, truncated, injected, and adversarial payloads
//! must either fail cleanly or restore exactly, and a failed restore must never
//! mutate live data. Mutations are derived from a fixed-seed PRNG so every run
//! reproduces the exact same corpus.

use dock_audit_core::{Backup, DeviceClass, Profile, ScanHealth, Snapshot, Store};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

struct Rng(u64);

impl Rng {
    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    fn below(&mut self, bound: usize) -> usize {
        usize::try_from(self.next_u64() % u64::try_from(bound).expect("small bound"))
            .expect("bounded")
    }
}

fn baseline_profile(id: &str, name: &str) -> Profile {
    Profile {
        id: id.to_owned(),
        name: name.to_owned(),
        expectations: Vec::new(),
    }
}

fn baseline_snapshot(profile_id: &str) -> Snapshot {
    Snapshot {
        id: "snap-1".to_owned(),
        profile_id: profile_id.to_owned(),
        observations: Vec::new(),
        scan_health: BTreeMap::from([(DeviceClass::Usb, ScanHealth::Complete)]),
    }
}

fn store_path(tag: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!(
        "dock-audit-import-safety-{}-{tag}.sqlite",
        std::process::id()
    ));
    path
}

fn seeded_store(tag: &str) -> (Store, PathBuf) {
    let path = store_path(tag);
    let _ = fs::remove_file(&path);
    let store = Store::open(&path).expect("store opens");
    store
        .save_profile(&baseline_profile("home", "Home"))
        .expect("seed profile");
    store
        .save_snapshot(&baseline_snapshot("home"))
        .expect("seed snapshot");
    (store, path)
}

fn baseline_backup() -> Backup {
    Backup {
        version: 1,
        profiles: vec![baseline_profile("home", "Home")],
        snapshots: vec![baseline_snapshot("home")],
    }
}

fn valid_archive_text() -> String {
    serde_json::to_string(&baseline_backup()).expect("serializable")
}

fn mutate(text: &str, rng: &mut Rng) -> String {
    const CHARSET: &[u8] = b"\"{}[]0az<>:,";
    let mut bytes = text.as_bytes().to_vec();
    let position = rng.below(bytes.len().max(1));
    match rng.below(4) {
        0 => bytes.truncate(position),
        1 => bytes.insert(position, CHARSET[rng.below(CHARSET.len())]),
        2 => {
            if !bytes.is_empty() {
                let target = position % bytes.len();
                let replacement = CHARSET[rng.below(CHARSET.len())];
                bytes[target] = replacement;
            }
        }
        _ => {
            if !bytes.is_empty() {
                bytes.remove(position);
            }
        }
    }
    String::from_utf8(bytes).expect("fixture and mutation charset are ASCII")
}

fn cleanup(path: &Path) {
    let _ = fs::remove_file(path);
}

#[test]
fn malformed_mutations_never_panic_or_mutate_live_data() {
    let valid = valid_archive_text();
    let mut rng = Rng(0x2545_F491_4F6C_DD1D);
    for index in 0..320u32 {
        let mutated = mutate(&valid, &mut rng);
        let (mut store, path) = seeded_store(&format!("mut-{index}"));

        match serde_json::from_str::<Backup>(&mutated) {
            Err(_) => {
                // Parser failures must leave the live store byte-identical.
                let live = store.backup().expect("live backup readable");
                assert_eq!(live, baseline_backup(), "live data changed for {mutated:?}");
            }
            Ok(candidate) => match store.restore(&candidate) {
                Err(_) => {
                    let live = store.backup().expect("live backup readable");
                    assert_eq!(live, baseline_backup(), "live data changed for {mutated:?}");
                }
                Ok(()) => {
                    let mut expected = candidate.profiles;
                    expected.sort_by(|left, right| left.id.cmp(&right.id));
                    let mut actual = store.backup().expect("restored backup readable").profiles;
                    actual.sort_by(|left, right| left.id.cmp(&right.id));
                    assert_eq!(
                        actual, expected,
                        "restore must apply exactly what validated"
                    );
                }
            },
        }
        cleanup(&path);
    }
}

#[test]
fn degenerate_payloads_fail_cleanly_without_touching_live_data() {
    for (index, payload) in [
        "",
        "   ",
        "null",
        "[]",
        "\"a string\"",
        &"[".repeat(100_000),
        r#"{"version":2,"profiles":[],"snapshots":[]}"#,
        r#"{"version":1,"profiles":[{"id":"","name":"X","expectations":[]}],"snapshots":[]}"#,
        r#"{"version":1,"profiles":[],"snapshots":[{"id":"s","profile_id":"missing","observations":[],"scan_health":{}}]}"#,
    ]
    .iter()
    .enumerate()
    {
        let (mut store, path) = seeded_store(&format!("degenerate-{index}"));
        let rejected = match serde_json::from_str::<Backup>(payload) {
            Err(_) => true,
            Ok(candidate) => store.restore(&candidate).is_err(),
        };
        assert!(rejected, "payload unexpectedly accepted: {payload:?}");
        assert_eq!(
            store.backup().expect("live backup readable"),
            baseline_backup(),
            "live data changed after rejecting {payload:?}"
        );
        cleanup(&path);
    }
}

#[test]
fn hostile_identifier_strings_round_trip_as_inert_data() {
    let hostile = "<script>alert(1)</script> `whoami` $(rm -rf /) ; HOME=$HOME";
    let archive = Backup {
        version: 1,
        profiles: vec![baseline_profile("desk", hostile)],
        snapshots: Vec::new(),
    };
    let (mut store, path) = seeded_store("hostile");
    store.restore(&archive).expect("valid archive restores");

    let restored = store.backup().expect("backup readable");
    assert_eq!(restored.profiles[0].name, hostile);

    // Reopening must observe exactly the same inert string.
    drop(store);
    let reopened = Store::open(&path).expect("store reopens");
    let profile = reopened
        .profile("desk")
        .expect("query ok")
        .expect("profile persisted");
    assert_eq!(profile.name, hostile);
    cleanup(&path);
}
