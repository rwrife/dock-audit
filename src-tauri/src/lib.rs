use dock_audit_core::AdapterStatus;

#[tauri::command]
fn adapter_status() -> AdapterStatus {
    AdapterStatus::bootstrap()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![adapter_status])
        .run(tauri::generate_context!())
        .expect("failed to run Dock Audit");
}
