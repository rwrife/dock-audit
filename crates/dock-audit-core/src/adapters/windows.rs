//! Read-only Windows inventory adapters.
//!
//! The implementation only enumerates OS-visible state. It does not open media
//! streams, inspect packet traffic, write device settings, install drivers, or
//! retain raw serial numbers, endpoint IDs, or MAC addresses.

#[cfg(any(windows, test))]
use std::collections::BTreeMap;

#[cfg(windows)]
use crate::adapters::ClassInventoryAdapter;
use crate::adapters::InventoryAdapter;
#[cfg(any(windows, test))]
use crate::{Capability, NormalizedField, Observation};
use crate::{
    CapabilityGap, CapabilityGapKind, ClassScan, DeviceClass, InventoryReport, RedactedDiagnostic,
    ScanHealth,
};

/// A keyed, local-only identity transformer. The caller owns persistent-key
/// storage; this type never exposes its key or raw input.
#[cfg_attr(not(windows), allow(dead_code))]
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
    ///
    /// A caller may persist this key only in a platform-protected local store.
    #[must_use]
    pub const fn with_persistent_key(key: [u8; blake3::KEY_LEN]) -> Self {
        Self { key: Some(key) }
    }

    #[cfg(any(windows, test))]
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

/// Windows adapter for OS-visible connected peripherals.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Clone)]
pub struct WindowsInventoryAdapter {
    identities: IdentityHasher,
}

impl WindowsInventoryAdapter {
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

    #[cfg(any(windows, test))]
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

    #[cfg(windows)]
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

impl InventoryAdapter for WindowsInventoryAdapter {
    fn scan(&self) -> InventoryReport {
        #[cfg(windows)]
        {
            return InventoryReport::from_class_scans([
                WindowsUsbScanner { adapter: self }.scan_class(),
                WindowsDisplayScanner { adapter: self }.scan_class(),
                WindowsAudioScanner {
                    adapter: self,
                    class: DeviceClass::AudioInput,
                }
                .scan_class(),
                WindowsAudioScanner {
                    adapter: self,
                    class: DeviceClass::AudioOutput,
                }
                .scan_class(),
                WindowsNetworkScanner { adapter: self }.scan_class(),
            ]);
        }

        #[cfg(not(windows))]
        {
            InventoryReport::from_class_scans(DeviceClass::ALL.map(unsupported_scan))
        }
    }
}

#[cfg(not(windows))]
fn unsupported_scan(class: DeviceClass) -> ClassScan {
    ClassScan {
        class,
        health: ScanHealth::Unsupported,
        observations: Vec::new(),
        capability_gaps: vec![CapabilityGap {
            class,
            capability: "native_windows_inventory".to_owned(),
            kind: CapabilityGapKind::ApiUnavailable,
            message: "Windows native inventory APIs are unavailable on this platform.".to_owned(),
            error_code: None,
        }],
    }
}

#[cfg(windows)]
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

#[cfg(windows)]
use windows::{
    Win32::{
        Devices::{
            DeviceAndDriverInstallation::{
                DIGCF_ALLCLASSES, DIGCF_PRESENT, HDEVINFO, SP_DEVINFO_DATA, SPDRP_ENUMERATOR_NAME,
                SPDRP_SERVICE, SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInfo,
                SetupDiGetClassDevsW, SetupDiGetDeviceInstanceIdW,
                SetupDiGetDeviceRegistryPropertyW,
            },
            Display::{
                DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME, DISPLAYCONFIG_MODE_INFO,
                DISPLAYCONFIG_MODE_INFO_TYPE_TARGET, DISPLAYCONFIG_PATH_INFO,
                DISPLAYCONFIG_TARGET_DEVICE_NAME, DisplayConfigGetDeviceInfo,
                GetDisplayConfigBufferSizes, QDC_ONLY_ACTIVE_PATHS, QueryDisplayConfig,
            },
        },
        Foundation::{E_ACCESSDENIED, ERROR_INVALID_DATA, ERROR_NO_MORE_ITEMS},
        Media::Audio::{
            DEVICE_STATE_ACTIVE, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, eCapture,
            eRender,
        },
        NetworkManagement::{
            IpHelper::{FreeMibTable, GetIfTable2, IF_TYPE_ETHERNET_CSMACD, MIB_IF_TABLE2},
            Ndis::{
                IfOperStatusDormant, IfOperStatusDown, IfOperStatusLowerLayerDown,
                IfOperStatusNotPresent, IfOperStatusTesting, IfOperStatusUp,
            },
        },
        System::Com::{
            CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
            CoUninitialize,
        },
    },
    core::{Error as WindowsError, HRESULT, PCWSTR},
};

#[cfg(windows)]
struct WindowsUsbScanner<'a> {
    adapter: &'a WindowsInventoryAdapter,
}

#[cfg(windows)]
impl ClassInventoryAdapter for WindowsUsbScanner<'_> {
    fn scan_class(&self) -> ClassScan {
        let class = DeviceClass::Usb;
        let device_set = match unsafe {
            SetupDiGetClassDevsW(None, PCWSTR::null(), None, DIGCF_PRESENT | DIGCF_ALLCLASSES)
        } {
            Ok(value) => DeviceInfoSet(value),
            Err(error) => return failed_scan(class, "setupapi.present_devices", error.code().0),
        };
        let mut observations = Vec::new();
        let mut gaps = Vec::new();

        for index in 0.. {
            let mut device = SP_DEVINFO_DATA {
                cbSize: u32::try_from(std::mem::size_of::<SP_DEVINFO_DATA>())
                    .expect("SP_DEVINFO_DATA fits in u32"),
                ..Default::default()
            };
            match unsafe { SetupDiEnumDeviceInfo(device_set.0, index, &mut device) } {
                Ok(()) => {}
                Err(error) if error.code() == HRESULT::from_win32(ERROR_NO_MORE_ITEMS.0) => {
                    break;
                }
                Err(error) => {
                    gaps.push(native_gap(
                        class,
                        "setupapi.enumerate_present_devices",
                        error.code().0,
                    ));
                    break;
                }
            }

            let enumerator = match setupapi_string(device_set.0, &device, SPDRP_ENUMERATOR_NAME) {
                Ok(Some(value)) => value,
                Ok(None) => {
                    add_gap_once(&mut gaps, native_gap(class, "setupapi.enumerator_name", 0));
                    continue;
                }
                Err(error) => {
                    add_gap_once(
                        &mut gaps,
                        native_gap(class, "setupapi.enumerator_name", error.code().0),
                    );
                    continue;
                }
            };
            if !enumerator.eq_ignore_ascii_case("USB") {
                continue;
            }

            let service = setupapi_string(device_set.0, &device, SPDRP_SERVICE)
                .ok()
                .flatten()
                .unwrap_or_default();
            let is_hub =
                service.eq_ignore_ascii_case("USBHUB") || service.eq_ignore_ascii_case("USBHUB3");
            let identity = match setupapi_instance_id(device_set.0, &device) {
                Ok(value) => Some(("device_instance", value, "setupapi.instance_id", true)),
                Err(error) => {
                    add_gap_once(
                        &mut gaps,
                        native_gap(class, "setupapi.instance_id", error.code().0),
                    );
                    None
                }
            };

            observations.push(self.adapter.observation(
                class,
                if is_hub { "USB hub" } else { "USB device" },
                &[(
                    "topology_kind",
                    if is_hub { "hub" } else { "device" }.to_owned(),
                    "setupapi.service",
                    false,
                )],
                identity,
            ));
        }

        self.adapter.add_identity_key_gap(class, &mut gaps);
        completed_scan(class, observations, gaps)
    }
}

#[cfg(windows)]
struct WindowsDisplayScanner<'a> {
    adapter: &'a WindowsInventoryAdapter,
}

#[cfg(windows)]
impl ClassInventoryAdapter for WindowsDisplayScanner<'_> {
    fn scan_class(&self) -> ClassScan {
        let class = DeviceClass::Display;
        let mut path_count = 0;
        let mut mode_count = 0;
        let buffer_status = unsafe {
            GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut path_count, &mut mode_count)
        };
        if buffer_status.0 != 0 {
            return failed_scan(
                class,
                "displayconfig.active_path_buffer_sizes",
                buffer_status.0 as i32,
            );
        }
        let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); path_count as usize];
        let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); mode_count as usize];
        let query_status = unsafe {
            QueryDisplayConfig(
                QDC_ONLY_ACTIVE_PATHS,
                &mut path_count,
                paths.as_mut_ptr(),
                &mut mode_count,
                modes.as_mut_ptr(),
                None,
            )
        };
        if query_status.0 != 0 {
            return failed_scan(class, "displayconfig.active_paths", query_status.0 as i32);
        }

        let mut observations = Vec::new();
        let mut gaps = Vec::new();
        for path in paths.into_iter().take(path_count as usize) {
            let mut fields = display_path_fields(&path, &modes);
            let mut target_name = DISPLAYCONFIG_TARGET_DEVICE_NAME::default();
            target_name.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
            target_name.header.size =
                u32::try_from(std::mem::size_of::<DISPLAYCONFIG_TARGET_DEVICE_NAME>())
                    .expect("DISPLAYCONFIG_TARGET_DEVICE_NAME fits in u32");
            target_name.header.adapterId = path.targetInfo.adapterId;
            target_name.header.id = path.targetInfo.id;

            let target_status = unsafe { DisplayConfigGetDeviceInfo(&mut target_name.header) };
            let identity = if target_status == 0 {
                fields.push((
                    "edid_manufacturer_id",
                    target_name.edidManufactureId.to_string(),
                    "displayconfig.target_name",
                    true,
                ));
                fields.push((
                    "edid_product_code",
                    target_name.edidProductCodeId.to_string(),
                    "displayconfig.target_name",
                    true,
                ));
                Some((
                    "edid_model",
                    format!(
                        "{}:{}",
                        target_name.edidManufactureId, target_name.edidProductCodeId
                    ),
                    "displayconfig.target_name",
                    true,
                ))
            } else {
                add_gap_once(
                    &mut gaps,
                    native_gap(class, "displayconfig.target_name", target_status),
                );
                None
            };
            observations.push(self.adapter.observation(
                class,
                "Connected display",
                &fields,
                identity,
            ));
        }

        self.adapter.add_identity_key_gap(class, &mut gaps);
        completed_scan(class, observations, gaps)
    }
}

#[cfg(windows)]
struct WindowsAudioScanner<'a> {
    adapter: &'a WindowsInventoryAdapter,
    class: DeviceClass,
}

#[cfg(windows)]
impl ClassInventoryAdapter for WindowsAudioScanner<'_> {
    fn scan_class(&self) -> ClassScan {
        let apartment = match ComApartment::initialize() {
            Ok(apartment) => apartment,
            Err(code) => return failed_scan(self.class, "core_audio.com_apartment", code),
        };
        let flow = match self.class {
            DeviceClass::AudioInput => eCapture,
            DeviceClass::AudioOutput => eRender,
            _ => unreachable!("audio scanner only supports audio classes"),
        };
        let direction = match self.class {
            DeviceClass::AudioInput => "input",
            DeviceClass::AudioOutput => "output",
            _ => unreachable!("audio scanner only supports audio classes"),
        };
        let enumerator: IMMDeviceEnumerator = match unsafe {
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
        } {
            Ok(value) => value,
            Err(error) => {
                drop(apartment);
                return failed_scan(self.class, "core_audio.endpoint_enumerator", error.code().0);
            }
        };
        let collection = match unsafe { enumerator.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE) } {
            Ok(value) => value,
            Err(error) => {
                drop(apartment);
                return failed_scan(self.class, "core_audio.active_endpoints", error.code().0);
            }
        };
        let count = match unsafe { collection.GetCount() } {
            Ok(value) => value,
            Err(error) => {
                drop(apartment);
                return failed_scan(self.class, "core_audio.endpoint_count", error.code().0);
            }
        };
        let mut observations = Vec::new();
        let mut gaps = Vec::new();
        for index in 0..count {
            let endpoint = match unsafe { collection.Item(index) } {
                Ok(value) => value,
                Err(error) => {
                    add_gap_once(
                        &mut gaps,
                        native_gap(self.class, "core_audio.endpoint_item", error.code().0),
                    );
                    continue;
                }
            };
            let identity = match endpoint_id(&endpoint) {
                Ok(value) => Some(("endpoint_id", value, "core_audio.endpoint_id", true)),
                Err(code) => {
                    add_gap_once(
                        &mut gaps,
                        native_gap(self.class, "core_audio.endpoint_id", code),
                    );
                    None
                }
            };
            observations.push(self.adapter.observation(
                self.class,
                if self.class == DeviceClass::AudioInput {
                    "Audio input endpoint"
                } else {
                    "Audio output endpoint"
                },
                &[(
                    "direction",
                    direction.to_owned(),
                    "core_audio.data_flow",
                    true,
                )],
                identity,
            ));
        }
        drop(apartment);
        self.adapter.add_identity_key_gap(self.class, &mut gaps);
        completed_scan(self.class, observations, gaps)
    }
}

#[cfg(windows)]
struct WindowsNetworkScanner<'a> {
    adapter: &'a WindowsInventoryAdapter,
}

#[cfg(windows)]
impl ClassInventoryAdapter for WindowsNetworkScanner<'_> {
    fn scan_class(&self) -> ClassScan {
        let class = DeviceClass::Network;
        let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
        let status = unsafe { GetIfTable2(&mut table) };
        if status.0 != 0 {
            return failed_scan(class, "ip_helper.interface_table", status.0 as i32);
        }
        if table.is_null() {
            return failed_scan(class, "ip_helper.interface_table", 0);
        }

        let rows = unsafe {
            std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize)
        };
        let mut observations = Vec::new();
        for row in rows {
            if row.Type != IF_TYPE_ETHERNET_CSMACD {
                continue;
            }
            let identity = format!("{:032x}", row.InterfaceGuid.to_u128());
            observations.push(self.adapter.observation(
                class,
                "Ethernet interface",
                &[(
                    "link_state",
                    link_state(row.OperStatus),
                    "ip_helper.oper_status",
                    false,
                )],
                Some(("interface_guid", identity, "ip_helper.interface_guid", true)),
            ));
        }
        unsafe { FreeMibTable(table.cast()) };
        let mut gaps = Vec::new();
        self.adapter.add_identity_key_gap(class, &mut gaps);
        completed_scan(class, observations, gaps)
    }
}

#[cfg(windows)]
struct DeviceInfoSet(HDEVINFO);

#[cfg(windows)]
impl Drop for DeviceInfoSet {
    fn drop(&mut self) {
        let _ = unsafe { SetupDiDestroyDeviceInfoList(self.0) };
    }
}

#[cfg(windows)]
struct ComApartment {
    uninitialize: bool,
}

#[cfg(windows)]
impl ComApartment {
    fn initialize() -> Result<Self, i32> {
        let status = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if status.is_ok() {
            Ok(Self { uninitialize: true })
        } else if status == windows::Win32::Foundation::RPC_E_CHANGED_MODE {
            Ok(Self {
                uninitialize: false,
            })
        } else {
            Err(status.0)
        }
    }
}

#[cfg(windows)]
impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.uninitialize {
            unsafe { CoUninitialize() };
        }
    }
}

#[cfg(windows)]
fn setupapi_string(
    device_set: HDEVINFO,
    device: &SP_DEVINFO_DATA,
    property: windows::Win32::Devices::DeviceAndDriverInstallation::SETUP_DI_REGISTRY_PROPERTY,
) -> Result<Option<String>, WindowsError> {
    let mut required = 0;
    match unsafe {
        SetupDiGetDeviceRegistryPropertyW(
            device_set,
            device,
            property,
            None,
            None,
            Some(&mut required),
        )
    } {
        Ok(()) => return Ok(None),
        Err(error) if required == 0 => return Err(error),
        Err(_) => {}
    }
    let mut buffer = vec![0_u8; required as usize];
    unsafe {
        SetupDiGetDeviceRegistryPropertyW(
            device_set,
            device,
            property,
            None,
            Some(&mut buffer),
            Some(&mut required),
        )?
    };
    let wide: Vec<u16> = buffer
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .take_while(|character| *character != 0)
        .collect();
    Ok(Some(String::from_utf16_lossy(&wide)))
}

#[cfg(windows)]
fn setupapi_instance_id(
    device_set: HDEVINFO,
    device: &SP_DEVINFO_DATA,
) -> Result<String, WindowsError> {
    let mut required = 0;
    match unsafe { SetupDiGetDeviceInstanceIdW(device_set, device, None, Some(&mut required)) } {
        Ok(()) => return Ok(String::new()),
        Err(error) if required == 0 => return Err(error),
        Err(_) => {}
    }
    let mut buffer = vec![0_u16; required as usize];
    unsafe {
        SetupDiGetDeviceInstanceIdW(device_set, device, Some(&mut buffer), Some(&mut required))?
    };
    let end = buffer[..required as usize]
        .iter()
        .position(|character| *character == 0)
        .unwrap_or(required as usize);
    let value = String::from_utf16_lossy(&buffer[..end]);
    Ok(value)
}

#[cfg(windows)]
fn display_path_fields(
    path: &DISPLAYCONFIG_PATH_INFO,
    modes: &[DISPLAYCONFIG_MODE_INFO],
) -> Vec<(&'static str, String, &'static str, bool)> {
    let mut fields = vec![(
        "connection",
        display_connection(path.targetInfo.outputTechnology.0),
        "displayconfig.active_path",
        false,
    )];
    let refresh = path.targetInfo.refreshRate;
    if refresh.Denominator != 0 {
        fields.push((
            "refresh_millihertz",
            ((u64::from(refresh.Numerator) * 1_000) / u64::from(refresh.Denominator)).to_string(),
            "displayconfig.active_path",
            false,
        ));
    }
    let mode_index = unsafe { path.targetInfo.Anonymous.modeInfoIdx };
    if let Some(mode) = modes.get(mode_index as usize) {
        if mode.infoType == DISPLAYCONFIG_MODE_INFO_TYPE_TARGET {
            let signal = unsafe { mode.Anonymous.targetMode.targetVideoSignalInfo };
            fields.push((
                "active_resolution",
                format!("{}x{}", signal.activeSize.cx, signal.activeSize.cy),
                "displayconfig.target_mode",
                false,
            ));
        }
    }
    fields
}

#[cfg(windows)]
fn display_connection(output_technology: i32) -> String {
    match output_technology {
        5 => "hdmi",
        10 => "displayport",
        18 => "displayport_usb_tunnel",
        4 => "dvi",
        6 => "lvds",
        -2_147_483_648 => "internal",
        _ => "other",
    }
    .to_owned()
}

#[cfg(windows)]
fn endpoint_id(endpoint: &IMMDevice) -> Result<String, i32> {
    let identifier = match unsafe { endpoint.GetId() } {
        Ok(value) => value,
        Err(error) => return Err(error.code().0),
    };
    let result = unsafe { identifier.to_string() }.map_err(|_| ERROR_INVALID_DATA.0 as i32);
    unsafe { CoTaskMemFree(Some(identifier.0.cast())) };
    result
}

#[cfg(windows)]
fn link_state(status: windows::Win32::NetworkManagement::Ndis::IF_OPER_STATUS) -> String {
    if status == IfOperStatusUp {
        "up"
    } else if status == IfOperStatusDown {
        "down"
    } else if status == IfOperStatusDormant {
        "dormant"
    } else if status == IfOperStatusLowerLayerDown {
        "lower_layer_down"
    } else if status == IfOperStatusNotPresent {
        "not_present"
    } else if status == IfOperStatusTesting {
        "testing"
    } else {
        "unknown"
    }
    .to_owned()
}

#[cfg(windows)]
fn failed_scan(class: DeviceClass, capability: &'static str, error_code: i32) -> ClassScan {
    ClassScan {
        class,
        health: ScanHealth::Failed,
        observations: Vec::new(),
        capability_gaps: vec![native_gap(class, capability, error_code)],
    }
}

#[cfg(windows)]
fn native_gap(class: DeviceClass, capability: &'static str, error_code: i32) -> CapabilityGap {
    let kind = if error_code == E_ACCESSDENIED.0 || error_code == 5 {
        CapabilityGapKind::AccessDenied
    } else {
        CapabilityGapKind::QueryFailed
    };
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
        error_code: (error_code != 0).then_some(error_code),
    }
}

#[cfg(windows)]
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
    use super::{IdentityHasher, WindowsInventoryAdapter};
    use crate::DeviceClass;

    #[test]
    fn persistent_identity_hashes_are_namespaced_and_non_reversible() {
        let adapter = WindowsInventoryAdapter {
            identities: IdentityHasher::with_persistent_key([7; blake3::KEY_LEN]),
        };
        let usb = adapter.observation(
            DeviceClass::Usb,
            "USB device",
            &[],
            Some((
                "device_instance",
                "SERIAL-DO-NOT-EMIT".to_owned(),
                "test",
                true,
            )),
        );
        let network = adapter.observation(
            DeviceClass::Network,
            "Ethernet interface",
            &[],
            Some((
                "interface_guid",
                "SERIAL-DO-NOT-EMIT".to_owned(),
                "test",
                true,
            )),
        );

        let json = serde_json::to_string(&usb).expect("observation is serializable");
        assert!(!json.contains("SERIAL-DO-NOT-EMIT"));
        assert_ne!(usb.identity_hashes, network.identity_hashes);
    }

    #[test]
    fn transient_identity_does_not_create_matchable_hashes() {
        let adapter = WindowsInventoryAdapter::without_persistent_identity_key();
        let observation = adapter.observation(
            DeviceClass::Usb,
            "USB device",
            &[],
            Some(("device_instance", "not-retained".to_owned(), "test", true)),
        );

        assert!(observation.identity_hashes.is_empty());
    }
}
