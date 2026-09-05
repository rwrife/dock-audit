use dock_audit_core::{
    CapabilityGapKind, DeviceClass, InventoryReport, MatchKind, Profile, ProfileExpectation,
    compare,
};
use serde::de::DeserializeOwned;
use std::collections::BTreeMap;

fn fixture<T: DeserializeOwned>(name: &str) -> T {
    let source = match name {
        "duplicate_names" => include_str!("fixtures/macos/duplicate_names.json"),
        "hubs_with_child_changes" => include_str!("fixtures/macos/hubs_with_child_changes.json"),
        "mirrored_displays" => include_str!("fixtures/macos/mirrored_displays.json"),
        "aggregate_audio_endpoints" => {
            include_str!("fixtures/macos/aggregate_audio_endpoints.json")
        }
        "link_state_changes" => include_str!("fixtures/macos/link_state_changes.json"),
        "access_errors" => include_str!("fixtures/macos/access_errors.json"),
        "hot_plug_churn" => include_str!("fixtures/macos/hot_plug_churn.json"),
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
struct LinkStateFixture {
    before: InventoryReport,
    after: InventoryReport,
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
            BTreeMap::from([("service_path".to_owned(), "redacted-hub-hash".to_owned())]),
        ),
        expectation(
            "child",
            DeviceClass::Usb,
            BTreeMap::from([("service_path".to_owned(), "redacted-child-hash".to_owned())]),
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
fn mirrored_displays_preserve_mirror_state_without_fabricating_absence() {
    let report: InventoryReport = fixture("mirrored_displays");

    assert!(
        report
            .observations
            .iter()
            .all(|observation| observation.attributes["mirrored"].value == "true")
    );
    assert_eq!(
        report.scan_health[&DeviceClass::Display],
        dock_audit_core::ScanHealth::Complete
    );
}

#[test]
fn aggregate_audio_endpoints_keep_direction_and_aggregate_metadata() {
    let report: InventoryReport = fixture("aggregate_audio_endpoints");

    assert_eq!(report.observations[0].class, DeviceClass::AudioInput);
    assert_eq!(
        report.observations[0].attributes["direction"].value,
        "input"
    );
    assert_eq!(
        report.observations[1].attributes["aggregate_group"].value,
        "true"
    );
}

#[test]
fn link_state_changes_are_reported_after_a_stable_match() {
    let fixture: LinkStateFixture = fixture("link_state_changes");
    let profile = profile(vec![ProfileExpectation {
        expected_fields: BTreeMap::from([("link_state".to_owned(), "up".to_owned())]),
        ..expectation(
            "network",
            DeviceClass::Network,
            BTreeMap::from([("bsd_name".to_owned(), "redacted-network-hash".to_owned())]),
        )
    }]);

    let before = compare(
        &profile,
        &fixture.before.observations,
        &fixture.before.scan_health,
    );
    let after = compare(
        &profile,
        &fixture.after.observations,
        &fixture.after.scan_health,
    );

    assert_eq!(before.matches[0].kind, MatchKind::Exact);
    assert_eq!(after.matches[0].kind, MatchKind::Changed);
    assert!(after.matches[0].reason.contains("link_state"));
}

#[test]
fn access_errors_leave_expected_devices_unknown() {
    let report: InventoryReport = fixture("access_errors");
    let profile = profile(vec![expectation(
        "display",
        DeviceClass::Display,
        BTreeMap::from([("edid_model".to_owned(), "redacted-display-a".to_owned())]),
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
        BTreeMap::from([("service_path".to_owned(), "redacted-usb-hash".to_owned())]),
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
    let report: InventoryReport = fixture("aggregate_audio_endpoints");
    let diagnostic = report.redacted_diagnostic();
    let serialized = serde_json::to_string(&diagnostic).expect("diagnostic is serializable");

    assert_eq!(diagnostic.capability_counts["audio_output.observations"], 1);
    assert!(!serialized.contains("Audio output endpoint"));
    assert!(!serialized.contains("redacted-output-hash"));
    assert!(!serialized.contains("\"direction\""));
}
