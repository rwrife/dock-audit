# Windows native inventory boundary

The Windows implementation in `crates/dock-audit-core/src/adapters/windows.rs`
is a read-only source implementation, not a compatibility promise. It has no
recorded execution on a real Windows host as of this revision. In particular,
there is no checked-in diagnostic output from a physical dock or peripheral.
Do not claim Windows, API-version, dock, or device compatibility until an
ordinary-user real-Windows run is recorded and reviewed.

## API scope

The adapter uses the Rust projections from `windows` 0.62.2 for these documented
native APIs:

| Class                | APIs                                                                                                                | Returned allow-listed fields                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| USB devices and hubs | `SetupDiGetClassDevsW`, `SetupDiEnumDeviceInfo`, `SetupDiGetDeviceRegistryPropertyW`, `SetupDiGetDeviceInstanceIdW` | Present USB enumeration, generic `USB device`/`USB hub` label, hub/device kind    |
| Active displays      | `GetDisplayConfigBufferSizes`, `QueryDisplayConfig`, `DisplayConfigGetDeviceInfo`                                   | Connection kind, active resolution, refresh rate, EDID manufacturer/product codes |
| Audio endpoints      | `CoInitializeEx`, `CoCreateInstance`, `IMMDeviceEnumerator::EnumAudioEndpoints`                                     | Active endpoint direction (`input` or `output`)                                   |
| Ethernet interfaces  | `GetIfTable2`, `FreeMibTable`                                                                                       | Ethernet interface type and OS operational link state                             |

Every emitted normalized field includes the documented adapter source and a
stability flag. A field that cannot be read is absent. Per-class `complete`,
`partial`, `failed`, or `unsupported` health and capability gaps are returned
with constant capability codes and an HRESULT/Win32 error number where available.
A partial, failed, or unsupported class produces `unknown` rather than a
missing-device result.

`SetupDiGetDeviceInstanceIdW`, Core Audio endpoint IDs, IP Helper interface
GUIDs, and the non-serial display EDID manufacturer/product pair are used only
in memory as input to a BLAKE3 keyed hash when the embedding application supplies
a protected local key. The display model hash is stable but not unique: identical
models correctly produce an ambiguous match. The current application supplies no
such key and emits no durable identity hashes. Display path identifiers are
intentionally not used as identity hashes.

## Privacy and safety limits

- The adapter never requests elevation or writes registry, device, driver,
  display, audio, or network settings.
- It never opens microphone or camera streams, creates audio clients, captures
  network traffic, installs drivers, resets hardware, or configures hardware.
- It does not read, preserve, display, or diagnose raw serial values, endpoint
  IDs, MAC addresses, interface aliases, display device paths, or friendly
  device names. Generic labels intentionally make weak-name matching ambiguous.
- It does not infer that an Ethernet interface belongs to a dock. It only lists
  OS-visible Ethernet interfaces and their reported operational state.
- It does not represent a topology tree or physical USB port truth. A child
  disappearing during a complete scan is an observed inventory difference, not
  a diagnosis of the hub, cable, driver, or power path.
- It makes no network request and has no telemetry.

The APIs expose only what Windows makes available to an ordinary user. Group
policy, device drivers, remote sessions, protected endpoints, service state, and
hot-plug races can prevent a complete result. Those conditions are reported as
health/capability gaps; they are not converted to absence claims.

## Opt-in diagnostic

The UI's **Run redacted native diagnostic** control calls the Tauri command
`native_inventory_diagnostic` with explicit approval. The command returns a
single map of counts such as `usb.observations` and
`display.gap.displayconfig.target_name.access_denied`. It contains no
observations, labels, field values, names, raw identifiers, or hashes. The
control does not run automatically.

No real-Windows diagnostic output is included here. A future compatibility claim
requires retaining the exact count-only output from at least one ordinary-user
real-Windows run, alongside its Windows version and API capability summary,
without adding device data.
