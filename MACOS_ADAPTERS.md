# macOS inventory adapters

`dock-audit-core` includes native, read-only macOS adapters for:

- USB / USB hubs (`IOKit` service graph)
- Displays (`CoreGraphics` active display set)
- Audio input/output endpoints (`CoreAudio` HAL)
- Network interfaces (`SystemConfiguration` + BSD `getifaddrs` flags)

## Privacy and identity handling

- Raw identifiers (serial numbers, CoreAudio UIDs, registry paths) are never emitted.
- Stable matching is done with keyed BLAKE3 hashes when a caller-managed identity key is available.
- `without_persistent_identity_key()` keeps scans functional but omits matchable durable identities and reports a `privacy_limited` capability gap.

## Health model and gaps

Each class scan reports:

- `complete`: query finished and observations are trustworthy.
- `partial`: some data was returned, but one or more capabilities failed.
- `failed`: no trustworthy observations for the class.
- `unsupported`: non-macOS host.

Capability gaps are explicit (`access_denied`, `query_failed`, `api_unavailable`, `privacy_limited`) so downstream comparison logic can return `unknown` rather than false `missing` results.

## Redacted diagnostic

The adapter exposes an opt-in redacted diagnostic:

- API: `MacOsInventoryAdapter::redacted_diagnostic()`
- Payload: capability counts only (no observations, labels, fields, or identity hashes)

Example command on macOS:

```bash
cargo run -p dock-audit-core --example macos_redacted_diagnostic
```

This command is also executed on the `macos-latest` CI matrix leg to capture a native run artifact in workflow logs.
