use dock_audit_core::{
    CapabilityGapKind, DeviceClass, InventoryReport, MatchKind, Profile, ProfileExpectation,
    compare,
};
use serde::de::DeserializeOwned;
use std::collections::BTreeMap;

fn fixture<T: DeserializeOwned>(name: &str) -> T {
    let source = match name {
        "duplicate_names" => include_str!("fixtures/windows/duplicate_names.json"),
        "hubs_with_child_changes" => {
            include_str!("fixtures/windows/hubs_with_child_changes.json")
        }
        "display_changes" => include_str!("fixtures/windows/display_changes.json"),
        "audio_directions" => include_str!("fixtures/windows/audio_directions.json"),
        "link_state" => include_str!("fixtures/windows/link_state.json"),
        "access_errors" => include_str!("fixtures/windows/access_errors.json"),
        "hot_plug_churn" => include_str!("fixtures/windows/hot_plug_churn.json"),
        _ => panic!("unknown fixture"),
    };
    serde_json::from_str(source).expect("sanitized fixture follows the inventory contract")
}

fn expectation(
    id: &str,
    class: DeviceClass,
    identity_hashes: BTreeMap<String, String>,
) -> ProfileExpectation {
    ProfileExpectation {
        id: id.to_owned(),
        class,
        alias: id.to_owned(),
        required: true,
        expected_fields: BTreeMap::new(),
        identity_hashes,
        friendly_name: None,
    }
}

fn profile(expectations: Vec<ProfileExpectation>) -> Profile {
    Profile {
        id: "fixture-profile".to_owned(),
        name: "Fixture profile".to_owned(),
        expectations,
    }
}

#[derive(serde::Deserialize)]
struct HubFixture {
    before: InventoryReport,
    after_child_detach: InventoryReport,
}

#[derive(serde::Deserialize)]
struct ChurnFixture {
    before: InventoryReport,
    during: InventoryReport,
    after: InventoryReport,
}

#[test]
fn duplicate_names_are_ambiguous() {
    let report: InventoryReport = fixture("duplicate_names");
    let profile = profile(vec![ProfileExpectation {
        friendly_name: Some("Audio output endpoint".to_owned()),
        ..expectation("audio", DeviceClass::AudioOutput, BTreeMap::new())
    }]);

    let result = compare(&profile, &report.observations, &report.scan_health);

    assert_eq!(result.matches[0].kind, MatchKind::Ambiguous);
}

#[test]
fn hubs_with_child_changes_are_visible_without_misclassifying_the_hub() {
    let fixture: HubFixture = fixture("hubs_with_child_changes");
    let profile = profile(vec![
        expectation(
            "hub",
            DeviceClass::Usb,
            BTreeMap::from([("device_instance".to_owned(), "redacted-hub-hash".to_owned())]),
        ),
        expectation(
            "child",
            DeviceClass::Usb,
            BTreeMap::from([(
                "device_instance".to_owned(),
                "redacted-child-hash".to_owned(),
            )]),
        ),
    ]);

    let before = compare(
        &profile,
        &fixture.before.observations,
        &fixture.before.scan_health,
    );
    let after = compare(
        &profile,
        &fixture.after_child_detach.observations,
        &fixture.after_child_detach.scan_health,
    );

    assert!(
        before
            .matches
            .iter()
            .all(|entry| entry.kind == MatchKind::Exact)
    );
    assert_eq!(after.matches[0].kind, MatchKind::Missing);
    assert_eq!(after.matches[1].kind, MatchKind::Exact);
}

#[test]
fn display_changes_are_reported_after_a_stable_match() {
    let report: InventoryReport = fixture("display_changes");
    let profile = profile(vec![ProfileExpectation {
        expected_fields: BTreeMap::from([("active_resolution".to_owned(), "2560x1440".to_owned())]),
        ..expectation(
            "display",
            DeviceClass::Display,
            BTreeMap::from([("edid_model".to_owned(), "redacted-display-hash".to_owned())]),
        )
    }]);

    let result = compare(&profile, &report.observations, &report.scan_health);

    assert_eq!(result.matches[0].kind, MatchKind::Changed);
    assert!(result.matches[0].reason.contains("active_resolution"));
}

#[test]
fn input_and_output_audio_directions_remain_distinct() {
    let report: InventoryReport = fixture("audio_directions");

    assert_eq!(report.observations[0].class, DeviceClass::AudioInput);
    assert_eq!(
        report.observations[0].attributes["direction"].value,
        "input"
    );
    assert_eq!(report.observations[1].class, DeviceClass::AudioOutput);
    assert_eq!(
        report.observations[1].attributes["direction"].value,
        "output"
    );
}

#[test]
fn link_state_is_normalized_without_a_mac_address() {
    let report: InventoryReport = fixture("link_state");
    let serialized = serde_json::to_string(&report).expect("report is serializable");

    assert_eq!(
        report.observations[0].attributes["link_state"].value,
        "down"
    );
    assert!(!serialized.to_ascii_lowercase().contains("mac"));
    assert!(!serialized.to_ascii_lowercase().contains("serial"));
}

#[test]
fn access_errors_leave_expected_devices_unknown() {
    let report: InventoryReport = fixture("access_errors");
    let profile = profile(vec![expectation(
        "display",
        DeviceClass::Display,
        BTreeMap::from([("edid_model".to_owned(), "redacted-display-hash".to_owned())]),
    )]);

    let result = compare(&profile, &report.observations, &report.scan_health);

    assert_eq!(
        report.capability_gaps[0].kind,
        CapabilityGapKind::AccessDenied
    );
    assert_eq!(result.matches[0].kind, MatchKind::Unknown);
}

#[test]
fn hot_plug_churn_is_unknown_until_a_complete_scan_recovers() {
    let fixture: ChurnFixture = fixture("hot_plug_churn");
    let profile = profile(vec![expectation(
        "usb",
        DeviceClass::Usb,
        BTreeMap::from([("device_instance".to_owned(), "redacted-usb-hash".to_owned())]),
    )]);

    let before = compare(
        &profile,
        &fixture.before.observations,
        &fixture.before.scan_health,
    );
    let during = compare(
        &profile,
        &fixture.during.observations,
        &fixture.during.scan_health,
    );
    let after = compare(
        &profile,
        &fixture.after.observations,
        &fixture.after.scan_health,
    );

    assert_eq!(before.matches[0].kind, MatchKind::Exact);
    assert_eq!(during.matches[0].kind, MatchKind::Unknown);
    assert_eq!(after.matches[0].kind, MatchKind::Exact);
}

#[test]
fn diagnostic_contains_only_capability_counts() {
    let report: InventoryReport = fixture("audio_directions");
    let diagnostic = report.redacted_diagnostic();
    let serialized = serde_json::to_string(&diagnostic).expect("diagnostic is serializable");

    assert_eq!(diagnostic.capability_counts["audio_input.observations"], 1);
    assert!(!serialized.contains("Audio input endpoint"));
    assert!(!serialized.contains("redacted-input-hash"));
    assert!(!serialized.contains("\"direction\""));
}
