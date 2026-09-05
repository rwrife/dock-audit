#[cfg(any(windows, target_os = "macos"))]
use dock_audit_core::adapters::InventoryAdapter;
#[cfg(target_os = "macos")]
use dock_audit_core::adapters::macos::MacOsInventoryAdapter;
#[cfg(windows)]
use dock_audit_core::adapters::windows::WindowsInventoryAdapter;
use dock_audit_core::{AdapterStatus, RedactedDiagnostic};

#[tauri::command]
fn adapter_status() -> AdapterStatus {
    #[cfg(windows)]
    {
        let adapter = WindowsInventoryAdapter::without_persistent_identity_key();
        AdapterStatus::from_report(&adapter.scan())
    }

    #[cfg(target_os = "macos")]
    {
        let adapter = MacOsInventoryAdapter::without_persistent_identity_key();
        AdapterStatus::from_report(&adapter.scan())
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        AdapterStatus::bootstrap()
    }
}

#[tauri::command]
fn native_inventory_diagnostic(approved: bool) -> Result<RedactedDiagnostic, String> {
    if !approved {
        return Err("Native diagnostic requires explicit approval and was not run.".to_owned());
    }

    #[cfg(windows)]
    {
        let adapter = WindowsInventoryAdapter::without_persistent_identity_key();
        Ok(adapter.redacted_diagnostic())
    }

    #[cfg(target_os = "macos")]
    {
        let adapter = MacOsInventoryAdapter::without_persistent_identity_key();
        Ok(adapter.redacted_diagnostic())
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Err("A native inventory diagnostic is unavailable on this platform.".to_owned())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            adapter_status,
            native_inventory_diagnostic
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Dock Audit");
}
