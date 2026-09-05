//! Read-only macOS inventory adapters.
//!
//! The implementation uses documented user-space APIs only: IOKit for USB
//! topology, CoreGraphics for active displays, CoreAudio HAL for endpoint
//! metadata, and SystemConfiguration plus BSD interface flags for network link
//! state. It never opens media streams, captures traffic, requests additional
//! privacy permissions, or retains raw serial numbers and device UIDs.

#[cfg(any(target_os = "macos", test))]
use std::collections::BTreeMap;

use crate::adapters::InventoryAdapter;
#[cfg(any(target_os = "macos", test))]
use crate::{Capability, NormalizedField, Observation};
use crate::{
    CapabilityGap, CapabilityGapKind, ClassScan, DeviceClass, InventoryReport, RedactedDiagnostic,
    ScanHealth,
};

#[cfg(target_os = "macos")]
use crate::adapters::ClassInventoryAdapter;
#[cfg(target_os = "macos")]
use core_graphics::display::CGDisplay;
#[cfg(target_os = "macos")]
use coreaudio::{
    AudioObject, CoreAudioError, DEVICE_IS_ALIVE, DEVICE_IS_RUNNING, DEVICE_NAME,
    DEVICE_TRANSPORT_TYPE, DEVICE_UID, ErrorKind as CoreAudioErrorKind, Scope, System,
    TransportType,
};
#[cfg(target_os = "macos")]
use iokit::prelude::{
    CFValue, IoKitError, REGISTRY_ITERATE_PARENTS, REGISTRY_ITERATE_RECURSIVELY, SERVICE_PLANE,
    matching_services,
};
#[cfg(target_os = "macos")]
use std::collections::{BTreeSet, btree_map::Entry};

/// A keyed, local-only identity transformer. The caller owns persistent-key
/// storage; this type never exposes its key or raw input.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Clone)]
pub struct IdentityHasher {
    key: Option<[u8; blake3::KEY_LEN]>,
}

impl IdentityHasher {
    /// Creates an identity transformer that never yields matchable hashes.
    #[must_use]
    pub const fn without_persistent_key() -> Self {
        Self { key: None }
    }

    /// Creates an identity transformer from a caller-managed local key.
    #[must_use]
    pub const fn with_persistent_key(key: [u8; blake3::KEY_LEN]) -> Self {
        Self { key: Some(key) }
    }

    #[cfg(any(target_os = "macos", test))]
    fn hash(&self, namespace: &str, value: &str) -> String {
        let mut hasher = blake3::Hasher::new_keyed(
            self.key
                .as_ref()
                .expect("a hash is only requested with a persistent key"),
        );
        hasher.update(namespace.as_bytes());
        hasher.update(&[0]);
        hasher.update(value.as_bytes());
        hasher.finalize().to_hex().to_string()
    }
}

/// macOS adapter for OS-visible connected peripherals.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Clone)]
pub struct MacOsInventoryAdapter {
    identities: IdentityHasher,
}

impl MacOsInventoryAdapter {
    /// Creates an adapter using a caller-provided, local-only identity key.
    #[must_use]
    pub const fn with_persistent_identity_key(key: [u8; blake3::KEY_LEN]) -> Self {
        Self {
            identities: IdentityHasher::with_persistent_key(key),
        }
    }

    /// Creates an adapter that inspects hardware without retaining identities.
    #[must_use]
    pub const fn without_persistent_identity_key() -> Self {
        Self {
            identities: IdentityHasher::without_persistent_key(),
        }
    }

    /// Runs a deliberately non-identifying, opt-in diagnostic.
    ///
    /// Its result contains counts only; it never includes observations, labels,
    /// normalized values, raw identifiers, or identity hashes.
    #[must_use]
    pub fn redacted_diagnostic(&self) -> RedactedDiagnostic {
        self.scan().redacted_diagnostic()
    }

    #[cfg(any(target_os = "macos", test))]
    fn observation(
        &self,
        class: DeviceClass,
        label: &'static str,
        fields: &[(&'static str, String, &'static str, bool)],
        identity: Option<(&'static str, String, &'static str, bool)>,
    ) -> Observation {
        let mut attributes = BTreeMap::new();
        let mut capabilities = BTreeMap::new();

        for (name, value, source, stable) in fields {
            attributes.insert(
                (*name).to_owned(),
                NormalizedField {
                    value: value.clone(),
                    source: (*source).to_owned(),
                    stable: *stable,
                },
            );
            capabilities.insert(
                (*name).to_owned(),
                Capability {
                    source: (*source).to_owned(),
                    stable: *stable,
                },
            );
        }

        let mut identity_hashes = BTreeMap::new();
        if let Some((name, raw_value, source, stable)) = identity {
            if self.identities.key.is_some() && stable {
                identity_hashes.insert((*name).to_owned(), self.identities.hash(name, &raw_value));
                capabilities.insert(
                    (*name).to_owned(),
                    Capability {
                        source: (*source).to_owned(),
                        stable: true,
                    },
                );
            } else {
                capabilities.insert(
                    (*name).to_owned(),
                    Capability {
                        source: (*source).to_owned(),
                        stable: false,
                    },
                );
            }
        }

        Observation {
            class,
            label: label.to_owned(),
            attributes,
            capabilities,
            identity_hashes,
        }
    }

    #[cfg(target_os = "macos")]
    fn add_identity_key_gap(&self, class: DeviceClass, gaps: &mut Vec<CapabilityGap>) {
        if self.identities.key.is_none() {
            add_gap_once(
                gaps,
                CapabilityGap {
                    class,
                    capability: "persistent_identity_hashing".to_owned(),
                    kind: CapabilityGapKind::PrivacyLimited,
                    message: "No caller-managed protected local key is available, so durable identity hashes were omitted."
                        .to_owned(),
                    error_code: None,
                },
            );
        }
    }
}

impl InventoryAdapter for MacOsInventoryAdapter {
    fn scan(&self) -> InventoryReport {
        #[cfg(target_os = "macos")]
        {
            InventoryReport::from_class_scans([
                MacOsUsbScanner { adapter: self }.scan_class(),
                MacOsDisplayScanner { adapter: self }.scan_class(),
                MacOsAudioScanner {
                    adapter: self,
                    class: DeviceClass::AudioInput,
                }
                .scan_class(),
                MacOsAudioScanner {
                    adapter: self,
                    class: DeviceClass::AudioOutput,
                }
                .scan_class(),
                MacOsNetworkScanner { adapter: self }.scan_class(),
            ])
        }

        #[cfg(not(target_os = "macos"))]
        {
            InventoryReport::from_class_scans(DeviceClass::ALL.map(unsupported_scan))
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn unsupported_scan(class: DeviceClass) -> ClassScan {
    ClassScan {
        class,
        health: ScanHealth::Unsupported,
        observations: Vec::new(),
        capability_gaps: vec![CapabilityGap {
            class,
            capability: "native_macos_inventory".to_owned(),
            kind: CapabilityGapKind::ApiUnavailable,
            message: "macOS native inventory APIs are unavailable on this platform.".to_owned(),
            error_code: None,
        }],
    }
}

#[cfg(target_os = "macos")]
fn completed_scan(
    class: DeviceClass,
    observations: Vec<Observation>,
    capability_gaps: Vec<CapabilityGap>,
) -> ClassScan {
    let query_failed = capability_gaps
        .iter()
        .any(|gap| gap.kind != CapabilityGapKind::PrivacyLimited);
    let health = if !query_failed {
        ScanHealth::Complete
    } else if observations.is_empty() {
        ScanHealth::Failed
    } else {
        ScanHealth::Partial
    };
    ClassScan {
        class,
        health,
        observations,
        capability_gaps,
    }
}

#[cfg(target_os = "macos")]
struct MacOsUsbScanner<'a> {
    adapter: &'a MacOsInventoryAdapter,
}

#[cfg(target_os = "macos")]
impl ClassInventoryAdapter for MacOsUsbScanner<'_> {
    fn scan_class(&self) -> ClassScan {
        let class = DeviceClass::Usb;
        let services = match matching_services("IOUSBHostDevice") {
            Ok(services) => services,
            Err(error) => {
                return failed_scan_with_iokit_error(class, "iokit_usb_inventory", error);
            }
        };

        let mut observations = Vec::new();
        let mut capability_gaps = Vec::new();

        for service in services {
            let class_name = service
                .class_name()
                .unwrap_or_else(|_| "IOUSBHostDevice".to_owned());
            let registry_path = service.path(SERVICE_PLANE).ok();
            let registry_id = service.registry_entry_id().ok();

            let vendor_id = usb_property_integer(&service, "idVendor")
                .or_else(|| usb_property_integer(&service, "vendor-id"));
            let product_id = usb_property_integer(&service, "idProduct")
                .or_else(|| usb_property_integer(&service, "product-id"));
            let location_id = usb_property_integer(&service, "locationID")
                .or_else(|| usb_property_integer(&service, "location-id"));
            let device_class = usb_property_integer(&service, "bDeviceClass");

            let name = usb_property_string(&service, "USB Product Name")
                .or_else(|| usb_property_string(&service, "product-name"))
                .or_else(|| service.name().ok())
                .unwrap_or_else(|| "USB device".to_owned());
            let serial = usb_property_string(&service, "USB Serial Number")
                .or_else(|| usb_property_string(&service, "kUSBSerialNumberString"));
            let vendor_name = usb_property_string(&service, "USB Vendor Name")
                .or_else(|| usb_property_string(&service, "manufacturer"));

            let topology_role =
                if device_class == Some(9) || class_name.to_ascii_lowercase().contains("hub") {
                    "hub"
                } else {
                    "device"
                };

            let mut fields = vec![
                (
                    "friendly_name",
                    sanitize_text(&name, "USB device"),
                    "IOKit.IORegistryEntry",
                    false,
                ),
                (
                    "topology_role",
                    topology_role.to_owned(),
                    "IOKit.IORegistryEntry",
                    true,
                ),
                (
                    "service_class",
                    sanitize_text(&class_name, "IOUSBHostDevice"),
                    "IOKit.IOService",
                    true,
                ),
            ];

            if let Some(vendor_id) = vendor_id {
                fields.push((
                    "vendor_id",
                    format!("{:04x}", (vendor_id & 0xffff) as u16),
                    "IOKit.IORegistryEntry",
                    true,
                ));
            }
            if let Some(product_id) = product_id {
                fields.push((
                    "product_id",
                    format!("{:04x}", (product_id & 0xffff) as u16),
                    "IOKit.IORegistryEntry",
                    true,
                ));
            }
            if let Some(location_id) = location_id {
                fields.push((
                    "location_id",
                    format!("0x{location_id:08x}"),
                    "IOKit.IORegistryEntry",
                    false,
                ));
            }
            if let Some(vendor_name) = vendor_name {
                fields.push((
                    "manufacturer",
                    sanitize_text(&vendor_name, "Unknown vendor"),
                    "IOKit.IORegistryEntry",
                    false,
                ));
            }

            let identity = serial
                .map(|value| {
                    (
                        "usb_serial",
                        value,
                        "IOKit.IORegistryEntry:USB Serial Number",
                        true,
                    )
                })
                .or_else(|| {
                    registry_path
                        .clone()
                        .map(|value| ("service_path", value, "IOKit.IORegistryEntryGetPath", true))
                })
                .or_else(|| {
                    registry_id.map(|value| {
                        (
                            "registry_entry_id",
                            value.to_string(),
                            "IOKit.IORegistryEntryGetRegistryEntryID",
                            false,
                        )
                    })
                });

            observations.push(self.adapter.observation(
                class,
                if topology_role == "hub" {
                    "USB hub"
                } else {
                    "USB device"
                },
                &fields,
                identity,
            ));
        }

        self.adapter
            .add_identity_key_gap(class, &mut capability_gaps);
        completed_scan(class, observations, capability_gaps)
    }
}

#[cfg(target_os = "macos")]
struct MacOsDisplayScanner<'a> {
    adapter: &'a MacOsInventoryAdapter,
}

#[cfg(target_os = "macos")]
impl ClassInventoryAdapter for MacOsDisplayScanner<'_> {
    fn scan_class(&self) -> ClassScan {
        let class = DeviceClass::Display;
        let display_ids = match CGDisplay::active_displays() {
            Ok(ids) => ids,
            Err(error_code) => {
                return failed_scan(
                    class,
                    "coregraphics_active_displays",
                    CapabilityGapKind::QueryFailed,
                    Some(error_code),
                );
            }
        };

        let mut observations = Vec::new();
        let mut capability_gaps = Vec::new();

        for display_id in display_ids {
            let display = CGDisplay::new(display_id);
            let vendor = display.vendor_number();
            let model = display.model_number();
            let serial = display.serial_number();
            let unit = display.unit_number();
            let active_resolution = format!("{}x{}", display.pixels_wide(), display.pixels_high());

            let fields = [
                (
                    "active_resolution",
                    active_resolution,
                    "CoreGraphics.CGDisplayPixels",
                    false,
                ),
                (
                    "mirrored",
                    bool_string(display.is_in_mirror_set()),
                    "CoreGraphics.CGDisplayIsInMirrorSet",
                    false,
                ),
                (
                    "online",
                    bool_string(display.is_online()),
                    "CoreGraphics.CGDisplayIsOnline",
                    false,
                ),
                (
                    "built_in",
                    bool_string(display.is_builtin()),
                    "CoreGraphics.CGDisplayIsBuiltin",
                    true,
                ),
                (
                    "vendor_id",
                    format!("{vendor:04x}"),
                    "CoreGraphics.CGDisplayVendorNumber",
                    true,
                ),
                (
                    "model_id",
                    format!("{model:04x}"),
                    "CoreGraphics.CGDisplayModelNumber",
                    true,
                ),
            ];

            let identity = if serial != 0 {
                Some((
                    "edid_model",
                    format!("{vendor:04x}:{model:04x}:{serial}"),
                    "CoreGraphics.CGDisplaySerialNumber",
                    true,
                ))
            } else {
                Some((
                    "display_unit",
                    format!("{vendor:04x}:{model:04x}:unit:{unit}"),
                    "CoreGraphics.CGDisplayUnitNumber",
                    false,
                ))
            };

            observations.push(
                self.adapter
                    .observation(class, "Display", &fields, identity),
            );
        }

        self.adapter
            .add_identity_key_gap(class, &mut capability_gaps);
        completed_scan(class, observations, capability_gaps)
    }
}

#[cfg(target_os = "macos")]
struct MacOsAudioScanner<'a> {
    adapter: &'a MacOsInventoryAdapter,
    class: DeviceClass,
}

#[cfg(target_os = "macos")]
impl ClassInventoryAdapter for MacOsAudioScanner<'_> {
    fn scan_class(&self) -> ClassScan {
        let class = self.class;
        let scope = if class == DeviceClass::AudioInput {
            Scope::Input
        } else {
            Scope::Output
        };

        let system = AudioObject::<System>::default();
        let devices = match system.devices_with_scope(scope) {
            Ok(devices) => devices,
            Err(error) => {
                return failed_scan_with_coreaudio_error(
                    class,
                    if class == DeviceClass::AudioInput {
                        "coreaudio_input_devices"
                    } else {
                        "coreaudio_output_devices"
                    },
                    &error,
                );
            }
        };

        let mut observations = Vec::new();
        let mut capability_gaps = Vec::new();

        for device in devices {
            let device_name = device
                .get_property(DEVICE_NAME)
                .unwrap_or_else(|_| "Audio endpoint".to_owned());
            let uid = match device.get_property(DEVICE_UID) {
                Ok(uid) => Some(uid),
                Err(error) => {
                    add_gap_once(
                        &mut capability_gaps,
                        native_gap(
                            class,
                            "coreaudio_device_uid",
                            coreaudio_gap_kind(&error),
                            coreaudio_gap_code(&error),
                        ),
                    );
                    None
                }
            };
            let transport = match device.get_property(DEVICE_TRANSPORT_TYPE) {
                Ok(transport) => transport,
                Err(error) => {
                    add_gap_once(
                        &mut capability_gaps,
                        native_gap(
                            class,
                            "coreaudio_transport_type",
                            coreaudio_gap_kind(&error),
                            coreaudio_gap_code(&error),
                        ),
                    );
                    TransportType::Unknown(0)
                }
            };
            let alive = device.get_property(DEVICE_IS_ALIVE).unwrap_or(true);
            let running = device.get_property(DEVICE_IS_RUNNING).unwrap_or(false);
            let stream_count = device
                .streams_with_scope(scope)
                .map(|streams| streams.len())
                .unwrap_or(0);

            let fields = [
                (
                    "friendly_name",
                    sanitize_text(&device_name, "Audio endpoint"),
                    "CoreAudio.DEVICE_NAME",
                    false,
                ),
                (
                    "direction",
                    if class == DeviceClass::AudioInput {
                        "input".to_owned()
                    } else {
                        "output".to_owned()
                    },
                    "CoreAudio.Scope",
                    true,
                ),
                (
                    "transport",
                    audio_transport_name(transport),
                    "CoreAudio.DEVICE_TRANSPORT_TYPE",
                    true,
                ),
                (
                    "aggregate_group",
                    bool_string(is_aggregate_transport(transport)),
                    "CoreAudio.DEVICE_TRANSPORT_TYPE",
                    true,
                ),
                (
                    "stream_count",
                    stream_count.to_string(),
                    "CoreAudio.DEVICE_INPUT_STREAMS/OUTPUT_STREAMS",
                    false,
                ),
                (
                    "alive",
                    bool_string(alive),
                    "CoreAudio.DEVICE_IS_ALIVE",
                    false,
                ),
                (
                    "running",
                    bool_string(running),
                    "CoreAudio.DEVICE_IS_RUNNING",
                    false,
                ),
            ];

            observations.push(self.adapter.observation(
                class,
                if class == DeviceClass::AudioInput {
                    "Audio input endpoint"
                } else {
                    "Audio output endpoint"
                },
                &fields,
                uid.map(|value| ("coreaudio_uid", value, "CoreAudio.DEVICE_UID", true)),
            ));
        }

        self.adapter
            .add_identity_key_gap(class, &mut capability_gaps);
        completed_scan(class, observations, capability_gaps)
    }
}

#[cfg(target_os = "macos")]
struct MacOsNetworkScanner<'a> {
    adapter: &'a MacOsInventoryAdapter,
}

#[cfg(target_os = "macos")]
impl ClassInventoryAdapter for MacOsNetworkScanner<'_> {
    fn scan_class(&self) -> ClassScan {
        use system_configuration::network_configuration::get_interfaces;

        let class = DeviceClass::Network;
        let interfaces = get_interfaces();
        let mut observations = Vec::new();
        let mut capability_gaps = Vec::new();

        let flag_map = match bsd_interface_flags() {
            Ok(flags) => Some(flags),
            Err(code) => {
                add_gap_once(
                    &mut capability_gaps,
                    native_gap(
                        class,
                        "bsd_link_flags",
                        CapabilityGapKind::QueryFailed,
                        Some(code),
                    ),
                );
                None
            }
        };

        let mut seen = BTreeSet::new();
        for interface in interfaces.iter() {
            let Some(bsd_name) = interface.bsd_name().map(|name| name.to_string()) else {
                continue;
            };
            if !seen.insert(bsd_name.clone()) {
                continue;
            }
            if bsd_name.starts_with("lo") {
                continue;
            }

            let interface_type = interface.interface_type();
            if !relevant_network_interface(interface_type.as_ref()) {
                continue;
            }

            let link_state = flag_map
                .as_ref()
                .and_then(|flags| flags.get(&bsd_name).copied())
                .map(normalize_link_state)
                .unwrap_or_else(|| {
                    add_gap_once(
                        &mut capability_gaps,
                        native_gap(
                            class,
                            "bsd_link_state",
                            CapabilityGapKind::QueryFailed,
                            None,
                        ),
                    );
                    "unknown".to_owned()
                });

            let fields = [
                (
                    "bsd_name",
                    bsd_name.clone(),
                    "SystemConfiguration.SCNetworkInterfaceGetBSDName",
                    true,
                ),
                (
                    "interface_type",
                    network_type_name(interface_type.as_ref()),
                    "SystemConfiguration.SCNetworkInterfaceGetInterfaceType",
                    true,
                ),
                ("link_state", link_state, "BSD.getifaddrs", false),
                (
                    "display_name",
                    interface
                        .display_name()
                        .map(|name| sanitize_text(&name.to_string(), "Network interface"))
                        .unwrap_or_else(|| "Network interface".to_owned()),
                    "SystemConfiguration.SCNetworkInterfaceGetLocalizedDisplayName",
                    false,
                ),
            ];

            observations.push(self.adapter.observation(
                class,
                "Network interface",
                &fields,
                Some((
                    "bsd_name",
                    bsd_name,
                    "SystemConfiguration.SCNetworkInterfaceGetBSDName",
                    true,
                )),
            ));
        }

        self.adapter
            .add_identity_key_gap(class, &mut capability_gaps);
        completed_scan(class, observations, capability_gaps)
    }
}

#[cfg(target_os = "macos")]
fn sanitize_text(value: &str, fallback: &str) -> String {
    let normalized = value
        .split_whitespace()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if normalized.is_empty() {
        fallback.to_owned()
    } else {
        normalized
    }
}

#[cfg(target_os = "macos")]
fn bool_string(value: bool) -> String {
    if value {
        "true".to_owned()
    } else {
        "false".to_owned()
    }
}

#[cfg(target_os = "macos")]
fn audio_transport_name(transport: TransportType) -> String {
    match transport {
        TransportType::BuiltIn => "built_in",
        TransportType::Aggregate => "aggregate",
        TransportType::AutoAggregate => "auto_aggregate",
        TransportType::Virtual => "virtual",
        TransportType::PCIe => "pcie",
        TransportType::USB => "usb",
        TransportType::FireWire => "firewire",
        TransportType::Bluetooth => "bluetooth",
        TransportType::BluetoothLE => "bluetooth_le",
        TransportType::HDMI => "hdmi",
        TransportType::DisplayPort => "displayport",
        TransportType::AirPlay => "airplay",
        TransportType::AVB => "avb",
        TransportType::Thunderbolt => "thunderbolt",
        TransportType::ContinuityCapture => "continuity_capture",
        TransportType::ContinuityCaptureWired => "continuity_capture_wired",
        TransportType::ContinuityCaptureWireless => "continuity_capture_wireless",
        TransportType::Unknown(_) => "unknown",
    }
    .to_owned()
}

#[cfg(target_os = "macos")]
fn is_aggregate_transport(transport: TransportType) -> bool {
    matches!(
        transport,
        TransportType::Aggregate | TransportType::AutoAggregate | TransportType::Virtual
    )
}

#[cfg(target_os = "macos")]
fn failed_scan_with_iokit_error(
    class: DeviceClass,
    capability: &'static str,
    error: IoKitError,
) -> ClassScan {
    let (kind, code) = iokit_gap_kind_and_code(&error);
    failed_scan(class, capability, kind, code)
}

#[cfg(target_os = "macos")]
fn iokit_gap_kind_and_code(error: &IoKitError) -> (CapabilityGapKind, Option<i32>) {
    match error {
        IoKitError::IoReturn(_, code) if *code == 5 || *code == 13 => {
            (CapabilityGapKind::AccessDenied, Some(*code))
        }
        IoKitError::IoReturn(_, code) => (CapabilityGapKind::QueryFailed, Some(*code)),
        IoKitError::UnexpectedNull(_) | IoKitError::InvalidArgument(_) => {
            (CapabilityGapKind::QueryFailed, None)
        }
        _ => (CapabilityGapKind::QueryFailed, None),
    }
}

#[cfg(target_os = "macos")]
fn failed_scan_with_coreaudio_error(
    class: DeviceClass,
    capability: &'static str,
    error: &CoreAudioError,
) -> ClassScan {
    failed_scan(
        class,
        capability,
        coreaudio_gap_kind(error),
        coreaudio_gap_code(error),
    )
}

#[cfg(target_os = "macos")]
fn coreaudio_gap_kind(error: &CoreAudioError) -> CapabilityGapKind {
    if matches!(error.kind(), CoreAudioErrorKind::Permissions) {
        CapabilityGapKind::AccessDenied
    } else {
        CapabilityGapKind::QueryFailed
    }
}

#[cfg(target_os = "macos")]
fn coreaudio_gap_code(error: &CoreAudioError) -> Option<i32> {
    let code = error.code();
    (code != -1).then_some(code)
}

#[cfg(target_os = "macos")]
fn usb_property(service: &iokit::Service, key: &str) -> Option<CFValue> {
    service.property(key).ok().flatten().or_else(|| {
        service
            .search_property(
                SERVICE_PLANE,
                key,
                REGISTRY_ITERATE_PARENTS | REGISTRY_ITERATE_RECURSIVELY,
            )
            .ok()
            .flatten()
    })
}

#[cfg(target_os = "macos")]
fn usb_property_integer(service: &iokit::Service, key: &str) -> Option<i64> {
    match usb_property(service, key)? {
        CFValue::Integer(value) => Some(value),
        CFValue::String(value) => value.parse::<i64>().ok(),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn usb_property_string(service: &iokit::Service, key: &str) -> Option<String> {
    match usb_property(service, key)? {
        CFValue::String(value) => Some(value),
        CFValue::Integer(value) => Some(value.to_string()),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn relevant_network_interface(
    interface_type: Option<&system_configuration::network_configuration::SCNetworkInterfaceType>,
) -> bool {
    use system_configuration::network_configuration::SCNetworkInterfaceType;

    matches!(
        interface_type,
        Some(SCNetworkInterfaceType::Ethernet)
            | Some(SCNetworkInterfaceType::IEEE80211)
            | Some(SCNetworkInterfaceType::Bridge)
            | Some(SCNetworkInterfaceType::Bond)
            | Some(SCNetworkInterfaceType::Bluetooth)
            | Some(SCNetworkInterfaceType::FireWire)
            | Some(SCNetworkInterfaceType::WWAN)
            | Some(SCNetworkInterfaceType::VLAN)
            | Some(SCNetworkInterfaceType::IPSec)
            | Some(SCNetworkInterfaceType::L2TP)
            | Some(SCNetworkInterfaceType::PPP)
            | Some(SCNetworkInterfaceType::PPTP)
    )
}

#[cfg(target_os = "macos")]
fn network_type_name(
    interface_type: Option<&system_configuration::network_configuration::SCNetworkInterfaceType>,
) -> String {
    use system_configuration::network_configuration::SCNetworkInterfaceType;

    match interface_type {
        Some(SCNetworkInterfaceType::Ethernet) => "ethernet",
        Some(SCNetworkInterfaceType::IEEE80211) => "wifi",
        Some(SCNetworkInterfaceType::Bridge) => "bridge",
        Some(SCNetworkInterfaceType::Bond) => "bond",
        Some(SCNetworkInterfaceType::Bluetooth) => "bluetooth",
        Some(SCNetworkInterfaceType::FireWire) => "firewire",
        Some(SCNetworkInterfaceType::WWAN) => "wwan",
        Some(SCNetworkInterfaceType::VLAN) => "vlan",
        Some(SCNetworkInterfaceType::IPSec) => "ipsec",
        Some(SCNetworkInterfaceType::L2TP) => "l2tp",
        Some(SCNetworkInterfaceType::PPP) => "ppp",
        Some(SCNetworkInterfaceType::PPTP) => "pptp",
        Some(SCNetworkInterfaceType::SixToFour) => "6to4",
        Some(SCNetworkInterfaceType::Serial) => "serial",
        Some(SCNetworkInterfaceType::Modem) => "modem",
        Some(SCNetworkInterfaceType::IrDA) => "irda",
        Some(SCNetworkInterfaceType::IPv4) => "ipv4",
        None => "unknown",
    }
    .to_owned()
}

#[cfg(target_os = "macos")]
fn normalize_link_state(flags: u32) -> String {
    let up_mask = libc::IFF_UP as u32;
    let running_mask = libc::IFF_RUNNING as u32;

    if flags & up_mask == 0 {
        "down".to_owned()
    } else if flags & running_mask != 0 {
        "up".to_owned()
    } else {
        "dormant".to_owned()
    }
}

#[cfg(target_os = "macos")]
fn bsd_interface_flags() -> Result<BTreeMap<String, u32>, i32> {
    use std::ffi::CStr;

    let mut head = std::ptr::null_mut::<libc::ifaddrs>();
    // SAFETY: getifaddrs initializes `head` on success, and freeifaddrs is
    // called exactly once for the same pointer before returning.
    let rc = unsafe { libc::getifaddrs(&mut head) };
    if rc != 0 {
        return Err(std::io::Error::last_os_error().raw_os_error().unwrap_or(-1));
    }

    let mut flags = BTreeMap::new();
    let mut current = head;
    while !current.is_null() {
        // SAFETY: `current` iterates the linked list returned by getifaddrs
        // until a null `ifa_next` pointer.
        let entry = unsafe { &*current };
        if !entry.ifa_name.is_null() {
            // SAFETY: ifa_name is a NUL-terminated C string owned by libc for
            // the lifetime of the list.
            let name = unsafe { CStr::from_ptr(entry.ifa_name) }
                .to_string_lossy()
                .into_owned();
            match flags.entry(name) {
                Entry::Vacant(slot) => {
                    slot.insert(entry.ifa_flags as u32);
                }
                Entry::Occupied(mut slot) => {
                    *slot.get_mut() |= entry.ifa_flags as u32;
                }
            }
        }
        current = entry.ifa_next;
    }

    // SAFETY: `head` came from getifaddrs and has not been freed yet.
    unsafe { libc::freeifaddrs(head) };
    Ok(flags)
}

#[cfg(target_os = "macos")]
fn failed_scan(
    class: DeviceClass,
    capability: &'static str,
    kind: CapabilityGapKind,
    error_code: Option<i32>,
) -> ClassScan {
    ClassScan {
        class,
        health: ScanHealth::Failed,
        observations: Vec::new(),
        capability_gaps: vec![native_gap(class, capability, kind, error_code)],
    }
}

#[cfg(target_os = "macos")]
fn native_gap(
    class: DeviceClass,
    capability: &'static str,
    kind: CapabilityGapKind,
    error_code: Option<i32>,
) -> CapabilityGap {
    CapabilityGap {
        class,
        capability: capability.to_owned(),
        kind,
        message: if kind == CapabilityGapKind::AccessDenied {
            "The native API denied this read-only query; the affected class is unknown.".to_owned()
        } else {
            "The native API did not complete this read-only query; the affected class is unknown."
                .to_owned()
        },
        error_code,
    }
}

#[cfg(target_os = "macos")]
fn add_gap_once(gaps: &mut Vec<CapabilityGap>, gap: CapabilityGap) {
    if !gaps
        .iter()
        .any(|existing| existing.capability == gap.capability)
    {
        gaps.push(gap);
    }
}

#[cfg(test)]
mod tests {
    use super::{IdentityHasher, MacOsInventoryAdapter};
    use crate::DeviceClass;

    #[test]
    fn persistent_identity_hashes_are_namespaced_and_non_reversible() {
        let adapter = MacOsInventoryAdapter {
            identities: IdentityHasher::with_persistent_key([11; blake3::KEY_LEN]),
        };
        let usb = adapter.observation(
            DeviceClass::Usb,
            "USB device",
            &[],
            Some(("service_path", "IOService:/A/B/C".to_owned(), "test", true)),
        );
        let display = adapter.observation(
            DeviceClass::Display,
            "Display",
            &[],
            Some(("edid_model", "abcd:ef01:serial".to_owned(), "test", true)),
        );

        let json = serde_json::to_string(&usb).expect("observation is serializable");
        assert!(!json.contains("IOService:/A/B/C"));
        assert_ne!(usb.identity_hashes, display.identity_hashes);
    }

    #[test]
    fn transient_identity_mode_does_not_emit_matchable_hashes() {
        let adapter = MacOsInventoryAdapter::without_persistent_identity_key();
        let observation = adapter.observation(
            DeviceClass::AudioOutput,
            "Audio output endpoint",
            &[],
            Some((
                "coreaudio_uid",
                "private-device-uid".to_owned(),
                "test",
                true,
            )),
        );

        assert!(observation.identity_hashes.is_empty());
    }
}
