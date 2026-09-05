use dock_audit_core::{
    AdapterAvailability, AdapterStatus, ClassScan, DeviceClass, InventoryReport, ScanHealth,
};

#[test]
fn bootstrap_status_reports_inventory_adapters_as_unavailable() {
    let status = AdapterStatus::bootstrap();

    assert_eq!(status.availability, AdapterAvailability::Unavailable);
    assert_eq!(status.observation_count, 0);
    assert_eq!(
        status.message,
        "No native inventory adapter is available on this platform. No devices were scanned."
    );
    assert!(
        status
            .scan_health
            .values()
            .all(|health| *health == dock_audit_core::ScanHealth::Unsupported)
    );
}

#[test]
fn incomplete_class_coverage_cannot_report_available_inventory() {
    let report = InventoryReport::from_class_scans([ClassScan {
        class: DeviceClass::Usb,
        health: ScanHealth::Complete,
        observations: Vec::new(),
        capability_gaps: Vec::new(),
    }]);

    assert_eq!(
        AdapterStatus::from_report(&report).availability,
        AdapterAvailability::Degraded
    );
}
