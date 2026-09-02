use dock_audit_core::{
    DeviceClass, MatchKind, Observation, Profile, ProfileExpectation, ScanHealth, Store, compare,
};
use std::collections::BTreeMap;

fn profile() -> Profile {
    Profile {
        id: "home".into(),
        name: "Home".into(),
        expectations: vec![ProfileExpectation {
            id: "display".into(),
            class: DeviceClass::Display,
            alias: "Desk display".into(),
            required: true,
            identity_hashes: BTreeMap::from([("edid".into(), "keyed-hash".into())]),
            friendly_name: Some("Display".into()),
        }],
    }
}
fn observation() -> Observation {
    Observation {
        class: DeviceClass::Display,
        label: "Display".into(),
        capabilities: BTreeMap::new(),
        identity_hashes: BTreeMap::from([("edid".into(), "keyed-hash".into())]),
    }
}

#[test]
fn stable_hash_is_exact_and_name_is_only_fallback() {
    let exact = compare(&profile(), &[observation()], &BTreeMap::new());
    assert_eq!(exact.matches[0].kind, MatchKind::Exact);
    let fallback = compare(
        &profile(),
        &[Observation {
            identity_hashes: BTreeMap::new(),
            ..observation()
        }],
        &BTreeMap::new(),
    );
    assert_eq!(fallback.matches[0].kind, MatchKind::Fallback);
}
#[test]
fn incomplete_scan_never_claims_missing() {
    let result = compare(
        &profile(),
        &[],
        &BTreeMap::from([(DeviceClass::Display, ScanHealth::Partial)]),
    );
    assert_eq!(result.matches[0].kind, MatchKind::Unknown);
}
#[test]
fn invalid_restore_does_not_change_live_data() {
    let path = std::env::temp_dir().join(format!("dock-audit-{}.sqlite", std::process::id()));
    let mut store = Store::open(&path).unwrap();
    store.save_profile(&profile()).unwrap();
    let invalid = dock_audit_core::Backup {
        version: 1,
        profiles: vec![],
        snapshots: vec![dock_audit_core::Snapshot {
            id: "x".into(),
            profile_id: "missing".into(),
            observations: vec![],
            scan_health: BTreeMap::new(),
        }],
    };
    assert!(store.restore(&invalid).is_err());
    assert_eq!(store.profile("home").unwrap(), Some(profile()));
    std::fs::remove_file(path).unwrap();
}
