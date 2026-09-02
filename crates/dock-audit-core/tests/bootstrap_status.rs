use dock_audit_core::{AdapterAvailability, AdapterStatus};

#[test]
fn bootstrap_status_reports_inventory_adapters_as_unavailable() {
    let status = AdapterStatus::bootstrap();

    assert_eq!(status.availability, AdapterAvailability::Unavailable);
    assert_eq!(status.observation_count, 0);
    assert_eq!(
        status.message,
        "Inventory adapters are not implemented yet. No devices were scanned."
    );
}
