# Dock Audit implementation plan

## Product scope

Dock Audit is a read-only Windows 10/11 and macOS desktop utility that compares the peripherals currently visible to the operating system with a named, user-approved desk profile. Its primary value is a deterministic, privacy-conscious answer to “what is missing or different after I connected this dock?”

The MVP covers already connected USB devices/hubs, displays, audio endpoints, and dock-associated network interfaces. It records capability-aware observations, not electrical truth. It will not install drivers, reconfigure endpoints, reset devices, sniff traffic, certify cables, or run as an enterprise management agent.

## Architecture

### Components

1. **`dock-audit-core` (Rust library)**
   - `Observation`, `DeviceClass`, `IdentityClaim`, `Capability`, and `Snapshot` models
   - normalization and schema migration
   - deterministic profile matching and diff classification
   - redaction/export and backup/restore validation
   - no UI or OS-native dependencies
2. **Platform adapter crates/modules**
   - Windows: SetupAPI/Configuration Manager for USB, DisplayConfig for displays, Windows Core Audio for endpoints, IP Helper for interfaces
   - macOS: IOKit for USB, CoreGraphics for displays, CoreAudio for endpoints, SystemConfiguration/Network framework boundaries for interfaces
   - adapters return explicit unsupported/permission/error capabilities rather than synthetic values
3. **Tauri 2 command layer**
   - narrow serializable DTOs and cancellable scan operations
   - no command construction from user strings
   - event stream for app-session hot-plug observations
4. **TypeScript UI**
   - capture/review profile flow
   - check-desk results grouped by present, missing, unexpected, changed, and ambiguous
   - snapshot timeline, privacy preview, export/backup, retention/deletion settings
5. **Persistence**
   - SQLite via Rust with migrations for profiles, selected identity claims, snapshots, events, and settings
   - app-private paths; atomic export/backup writes

### Matching rules

Matching is explainable and conservative. Candidate signals are ordered by reliability: OS persistent identifier where documented, user-approved keyed hash of a hardware serial, vendor/product plus stable location hint, then descriptive fallback. A weak signal cannot silently produce an exact match. Ambiguity is a first-class result requiring user review.

A profile stores only selected expectations, not every observed device. Each expectation records which identity claims the user approved and which are display-only. Match explanations are retained with results.

## Technology choices

- **Tauri 2:** small cross-platform shell with direct Rust/native integration; avoids an always-running server.
- **Rust stable:** memory-safe native adapters and a pure, fixture-testable domain core.
- **TypeScript + Vite:** productive UI implementation with strong DTO typing.
- **SQLite:** local transactional storage and explicit migrations without an account or service.
- **Vitest + Testing Library:** UI and accessibility behavior tests.
- **Rust unit/integration tests:** matching, normalization, redaction, migrations, adapter fixture contracts.
- **GitHub Actions:** Windows and macOS matrix for formatting, linting, tests, and unsigned preview packaging.

Native API choices remain behind traits until small capability spikes confirm OS/version behavior. Shelling out to `system_profiler`, PowerShell, or other commands is not the primary architecture.

## Milestones and dependency order

### M1 — Reproducible skeleton and contracts

- Create Tauri/Rust/TypeScript workspace and pin toolchains.
- Add CI on Windows and macOS.
- Define capability-aware observation DTOs and sanitized fixtures.
- Establish threat model, data inventory, and redaction policy.

### M2 — Domain and persistence

- Implement normalized snapshot/profile models and SQLite migrations.
- Implement deterministic matcher with explainable confidence states.
- Add profile/snapshot CRUD, retention, and deletion.
- Verify backup/restore rejects incompatible or malformed input without changing live data.

### M3 — Read-only inventory adapters

- Implement Windows adapters and fixture-based contract tests.
- Implement macOS adapters and fixture-based contract tests.
- Document field stability, ordinary-user access, OS limitations, and unsupported states.
- Test adapter failures and partial scans without converting absence of evidence into a missing-device claim.

### M4 — Primary workflow

- Build capture/review/save profile flow.
- Build check-desk result view with matching explanations and re-scan.
- Add profile editing for aliases, required/optional expectations, and identity-claim selection.
- Validate keyboard-only and screen-reader flow.

### M5 — Timeline, portability, and privacy

- Add opt-in, app-session hot-plug timeline.
- Add redacted JSON/Markdown support reports with privacy preview.
- Add versioned backup/restore and deterministic export fixtures.
- Add retention controls, per-record deletion, and erase-all.

### M6 — Packaging and release readiness

- Build Windows portable/installer candidates and macOS universal app/DMG candidates.
- Add clean-machine smoke checklist, update/recovery documentation, licenses, SBOM, and checksums.
- Document unsigned development-build warnings; signing/notarization is separate work requiring owner credentials.

## Testing strategy

### Core tests

- Table-driven matching cases: exact, fallback, changed, ambiguous, and no match
- Property tests for deterministic ordering and redaction idempotence
- Snapshot/profile schema migration fixtures
- Backup/restore atomicity and malformed archive rejection
- Export golden files asserting default removal of raw serials, MAC addresses, machine/user names, and local paths

### Adapter tests

- Sanitized captured fixtures for each OS/version and device class
- Contract tests for partial data, duplicate friendly names, hubs with child changes, sleep/wake, hot-plug churn, and access-denied/unsupported fields
- Native integration tests on real CI runners only where APIs expose meaningful hardware; no fabricated device-success claims
- Manual compatibility matrix using ordinary-user accounts and explicitly listed docks/peripherals

### UI and accessibility tests

- Component tests for capture, selection, comparison, privacy preview, restore conflict, and deletion
- Keyboard traversal, visible focus, semantic headings/tables/status, accessible names, and non-color-only state
- 200% text scaling, high contrast, reduced motion, and narrow-window layouts
- Screen-reader smoke checks with Narrator and VoiceOver before release

### Security/privacy tests

- Fuzz or property-test importer/parser boundaries
- Ensure user-controlled names are rendered as text, not HTML
- Ensure no shell command is built from observed or imported values
- Verify telemetry/network calls are absent from baseline flows
- Inspect exported artifacts before release and document residual identifiers

## Packaging and distribution

- Windows 10 22H2/11: unsigned CI artifacts first; later portable ZIP and installer/MSIX candidate
- macOS 13+: unsigned universal `.app`/DMG candidate in CI; signing and notarization only with owner-provided credentials
- GitHub Releases with checksums, SBOM, license notices, support matrix, and known capability gaps
- No automatic updater in the MVP; releases remain useful offline
- No store submission, code-signing success, or installer compatibility is claimed until verified

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Device identifiers are missing, unstable, or privacy-sensitive | Capability-tagged observations, user-approved identity claims, keyed local hashes, confidence labels, redacted export defaults |
| OS APIs expose different topology semantics | Native adapters behind a shared contract; fixtures and per-OS capability docs; never invent parity |
| Friendly names produce false matches | Conservative matching, ambiguity results, aliases separated from identity, explanations in UI |
| Partial scan looks like missing hardware | Scan health/capability summary gates comparison; failed classes become unknown, not missing |
| Native API work expands scope | Implement one device class at a time behind traits; defer Thunderbolt internals, driver health, and protocol diagnostics |
| Export leaks system identity | Redaction preview, golden tests, denylist plus structured allowlist, no raw identifiers by default |
| Tauri/webview accessibility varies | Semantic HTML, automated checks, Narrator/VoiceOver manual matrix, native focus smoke tests |
| Packaging differs from development | Matrix builds and clean-machine smoke checklist; signing/notarization tracked separately |

## Explicit non-goals

- Automatic repair, driver or firmware management, device reset, or privileged operations
- Background service/daemon when the app is closed
- Remote fleet inventory, cloud dashboards, accounts, telemetry, or subscriptions
- USB packet capture, electrical measurements, dock power-delivery analysis, or cable certification
- Bluetooth discovery, Wi-Fi scanning, microphone/camera capture, or network traffic inspection
- Changing default audio devices, monitor arrangement, network settings, or power settings
- Guaranteeing a root cause from OS-visible symptoms
