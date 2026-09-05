#[cfg(target_os = "macos")]
use dock_audit_core::adapters::macos::MacOsInventoryAdapter;

#[cfg(target_os = "macos")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let adapter = MacOsInventoryAdapter::without_persistent_identity_key();
    let diagnostic = adapter.redacted_diagnostic();
    println!("{}", serde_json::to_string_pretty(&diagnostic)?);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn main() {
    println!("macOS-only diagnostic example");
}
