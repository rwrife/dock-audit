# Dock Audit

Local-first desktop utility for laptop users to save expected desk-peripheral profiles, compare them after connecting a dock, and export redacted troubleshooting snapshots without cloud accounts.

## Overview

Dock Audit answers a common question after plugging into a USB-C or Thunderbolt dock: **what failed to appear this time?** It captures a user-approved baseline of observable peripherals at a desk, compares the current connection against that profile, and explains missing, unexpected, or changed devices without changing system settings.

Dock Audit is a Tauri 2, Rust, TypeScript, and accessible HTML/CSS desktop app. It is offline-first and requires no account. The repository has no recorded real Windows hardware-lab validation run, so it makes no broad peripheral compatibility claim.

## Motivation

A partly connected dock can look healthy while one monitor, USB device, audio endpoint, or network adapter is absent. Checking several operating-system settings panes is slow, and support screenshots often expose serial numbers or machine details. Dock Audit provides one deterministic, privacy-conscious comparison.

## Target users

- Laptop users who move between home, office, and shared desks
- Remote workers troubleshooting intermittent docks, hubs, adapters, or cables
- IT helpers who need a user-generated, redacted snapshot before suggesting changes
- Makers with multi-device benches who want to notice a missing programmer or instrument

## Concrete use cases

1. Save a **Home desk** profile after confirming the expected monitor, keyboard, webcam, audio endpoint, and Ethernet adapter are present.
2. Reconnect the dock later and get a grouped result: present, missing, unexpected, or identity changed.
3. Compare two snapshots to see whether a device disappeared after a sleep/wake or cable reconnect.
4. Export a redacted JSON or Markdown report that omits raw serial numbers and user/device names by default.
5. Review a local event timeline while reproducing an intermittent disconnect.

## Intended workflow

1. Launch Dock Audit; it performs a read-only scan through OS-native adapters.
2. Review the discovered devices and explicitly choose which ones belong in a named desk profile.
3. On a later connection, select that profile and run **Check desk**.
4. Inspect non-color-only status rows with plain-language reasons and identity confidence.
5. Optionally save the snapshot locally or export a redacted support report.
6. Delete profiles, snapshots, or all app data at any time.

Dock Audit never enables, disables, resets, or reconfigures hardware. It does not promise to identify the physical cause of a failure; it reports observable differences and safe next checks.

## MVP features

- Read-only inventory adapters for:
  - USB devices and hubs using stable descriptors available to an ordinary user
  - connected displays using OS-provided identifiers and geometry
  - active audio endpoints by input/output direction
  - dock-associated network interfaces and link state
- Named profiles containing only user-selected expected devices
- Deterministic matching with exact, fallback, and ambiguous confidence states
- Present/missing/unexpected/changed comparison grouped by device class
- Local hot-plug timeline retained only when the app is running and the user enables capture
- Versioned local storage and schema migrations
- Redacted JSON and Markdown export; versioned JSON backup/restore
- Keyboard navigation, screen-reader labels, scalable text, reduced motion, high contrast, and icons/text in addition to color
- Clear adapter capability reporting when an OS cannot expose a field

## Non-goals

- Firmware updates, driver installation, device resets, or automatic repair
- USB protocol sniffing, packet capture, electrical testing, or cable certification
- Managing audio scenes or changing default endpoints (see the separate Audio Dock project)
- Restoring window layouts (see Window Recall)
- Testing disconnected passive cable conductors (see PinPath)
- Background surveillance, fleet management, remote administration, or cloud sync
- Treating a friendly device name, port path, or raw serial as universally stable

## Privacy, permissions, and storage

- **Local by default:** profiles, snapshots, settings, and the optional event timeline stay in the platform app-data directory.
- **No account or telemetry:** the MVP has no cloud service, analytics SDK, advertising, or subscription.
- **Read-only access:** baseline operation uses ordinary-user OS hardware APIs and does not request administrator/root access.
- **Minimized identity data:** raw serial numbers and other high-entropy identifiers are not shown or exported by default. The local model stores a keyed hash when a stable comparison needs one; users can inspect and remove captured fields.
- **Explicit exports:** JSON/Markdown reports and backup archives are created only at a path the user chooses. Support reports redact machine name, username, raw device serials, MAC addresses, and local paths by default.
- **No baseline microphone, camera, contacts, location, Bluetooth scanning, or network-capture permission.** Enumerating an already registered audio endpoint does not open the microphone. Platform-specific permission or capability gaps must be shown, never bypassed.
- **Deletion:** users can delete individual profiles/snapshots or erase all local app data from Settings.

See platform adapter boundaries and ordinary-user limits in
[WINDOWS_ADAPTERS.md](WINDOWS_ADAPTERS.md) and [MACOS_ADAPTERS.md](MACOS_ADAPTERS.md),
and planned privacy tests in [PLAN.md](PLAN.md).

## Architecture at a glance

```text
Tauri/TypeScript UI
        |
Tauri commands (narrow DTO boundary)
        |
Rust domain: inventory -> normalize -> match -> diff -> redact/export
        |
Windows adapters                     macOS adapters
SetupAPI/ConfigMgr, DisplayConfig,    IOKit, CoreGraphics,
Core Audio, IP Helper                 CoreAudio, SystemConfiguration
```

OS adapters return capability-tagged observations. The pure Rust domain layer owns normalization, matching, comparison, redaction, schemas, and tests. The UI never shells out with user-controlled strings.

## Current status and milestones

**Status: domain/local-storage foundation plus native Windows and macOS source adapters.** The repository contains capability-aware observations, deterministic comparison rules, and versioned SQLite profile/snapshot storage with validated transactional backup restore. It now includes read-only adapters for SetupAPI, DisplayConfig, Core Audio, and IP Helper on Windows, and IOKit, CoreGraphics, CoreAudio HAL, and SystemConfiguration on macOS. It has fixture contracts and CI native runs on both platforms, but still has no dedicated hardware-lab validation matrix. Treat current support claims as source/CI evidence, not broad peripheral compatibility guarantees.

1. Bootstrap the cross-platform app and CI.
2. Define normalized observations, local profile storage, and privacy/redaction rules.
3. Implement Windows and macOS read-only inventory adapters with fixtures.
4. Deliver profile capture and deterministic check-desk results.
5. Add timeline, export/backup, accessibility, and privacy controls.
6. Package tested Windows and macOS preview builds.

## Development quickstart

The supported versions are pinned: Rust 1.98.0, Node.js 22.23.1, pnpm 11.25.0, and Tauri 2.11.x. Windows 10 22H2/11 requires Visual Studio 2022 C++ Build Tools, a Windows SDK, and WebView2. macOS 13+ requires Xcode Command Line Tools. See [DEVELOPMENT.md](DEVELOPMENT.md) for exact platform prerequisites and evidence limits.

From a matching development host:

```text
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm test
pnpm build
pnpm tauri dev
pnpm tauri build --debug --no-bundle
```

The build is an unsigned development executable, not an installer or compatibility claim. CI is configured to run the same format, lint, Rust/UI test, web build, and unsigned application-build gates on Windows and macOS; configured CI does not substitute for a documented native diagnostic run.

## Contributing

Work is tracked as small GitHub issues and delivered PR-first. Reports should include the OS version, adapter capability summary, redacted fixture or export, and exact verification commands. Never post raw serial numbers, MAC addresses, usernames, or machine names.

## License

MIT; see [LICENSE](LICENSE).
