# Release readiness, honest evidence, and recovery

This document is the release-verification contract for Dock Audit preview
releases. It exists so that every claim in a release description can be traced
to a command that actually ran, and so that anything that was **not** exercised
stays explicitly unclaimed.

## What CI actually produces

The `Release candidates` workflow builds on GitHub-hosted runners and produces,
per platform:

- **Windows:** an unsigned NSIS installer (`dock-audit_<version>_x64-setup.exe`)
  and a portable ZIP (`Dock-Audit-<version>-portable-windows-x64.zip`).
- **macOS:** an unsigned universal (Apple Silicon + Intel) `.app`, packaged as
  both a `.dmg` and a `.tar.gz`.

Each candidate bundle also contains:

| File                       | What it is                                                 |
| -------------------------- | ---------------------------------------------------------- |
| `candidate-sbom.cdx.json`  | CycloneDX 1.6 SBOM of all Rust and JavaScript dependencies |
| `THIRD-PARTY-NOTICES.txt`  | Pinned-version license notice list generated from the SBOM |
| `CHECKSUMS.txt`            | SHA-256 of every file in the bundle                        |
| `runner-os-<platform>.txt` | The exact runner OS/arch/image the candidate was built on  |
| `LICENSE`                  | The project MIT license                                    |

Before upload, `scripts/check_candidate_cleanliness.py` fails the release if
any human-readable artifact in the bundle contains local absolute paths,
credential shapes, or raw fixture serial/MAC fixtures. Compiled binaries inside
ZIP/DMG containers are **not** string-scanned; treat that as a known gap and
review binaries manually before promoting anything.

Code signing, Authenticode, Apple Developer ID signing, and notarization are
**not performed**. Expect SmartScreen and Gatekeeper warnings (see below).
Signing may only be claimed after owner-provided credentials and an external
verification run are attached to a release.

## Support matrix (evidence-bounded)

Claims below are limited to what has actually run. "Unclaimed" means no
evidence exists in this repository and no compatibility should be assumed.

| Platform/version                                                                  | Evidence kind                                          | Result                                                                                                                                    |
| --------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Windows Server 2025 (10.0.26100, Datacenter), GitHub `windows-latest` runner, x64 | Real CI run (format/lint/test/build/packaging)         | Format, clippy, UI tests (16), Rust tests (25 incl. import-safety corpus), web build, unsigned app build, and NSIS bundling succeed in CI |
| macOS 26.6.2 (25G83), GitHub `macos-26-arm64` runner, arm64                       | Real CI run (same gates + redacted diagnostic example) | All gates succeed in CI; redacted diagnostic sample emitted on the runner                                                                 |
| macOS x86_64 slice                                                                | Source-level universal build target only               | Universal binary is **built** in the release workflow; it has not been executed on Intel hardware — unclaimed                             |
| Windows 10 22H2 / Windows 11 desktop editions                                     | Development prerequisite documentation only            | **Unclaimed.** CI runs Windows Server 2025; desktop SKUs, WebView2 versions, and consumer driver stacks were not exercised                |
| macOS 13/14/15 desktops                                                           | Development prerequisite documentation only            | **Unclaimed.** CI runs the `macos-latest` image; older OS behavior was not exercised                                                      |
| Any dock, hub, display, audio, or network device                                  | Sanitized fixtures and deterministic tests only        | **Unclaimed.** No hardware-lab matrix exists; native observations are capability-aware, not electrical truth                              |
| Narrator / VoiceOver screen-reader smoke                                          | Not exercised                                          | **Unclaimed.** Automated axe accessibility tests pass in CI; human screen-reader checks are required per release checklist below          |
| Code signing / notarization                                                       | Not performed                                          | **Unclaimed by design** until owner credentials exist                                                                                     |

If you test a combination above marked unclaimed and it works (or fails), open
an issue with the OS version, adapter capability summary, and a redacted export
— never raw serials, MACs, usernames, or machine names.

## Clean-machine smoke checklist

Run this on a machine that has never had a Dock Audit development build, using
the exact artifact (checksum-verified) from the preview release. Record the OS
build, artifact SHA-256, and outcome for every row. A release is only as good
as the most recent completed checklist attached to it.

1. **Launch.** Start the app. Expect a window with an adapter status line and a
   scan health per device class. Unsigned-build warnings are expected (see
   below) but the app must start without elevation.
2. **Capture.** Run a scan and save a profile with at least one selected device.
   Expect: profile appears in the selector; no raw serial shown by default.
3. **Reconnect comparison.** Disconnect and reconnect the dock; run
   **Check desk**. Expect: present/missing/unexpected/changed rows with
   plain-language reasons and identity confidence; partial scans must surface
   as degraded health, never as missing devices.
4. **Partial adapter failure.** With one device class unavailable (e.g. no
   audio hardware), the class must read `unsupported`/`failed` with a capability
   gap, and comparisons must not claim absence for that class.
5. **Export preview + redacted export.** Open the privacy preview, then
   download the JSON and Markdown reports. Verify the redacted report contains
   no raw serials, MAC addresses, usernames, machine names, or local paths, and
   that opting into identifying fields is explicit and warned.
6. **Backup/restore.** Download the versioned backup, modify one profile in-app,
   then paste the backup JSON into restore and confirm the conflict preview
   counts match expectations before applying. Confirm the restored state matches
   the backup. Also paste `{ definitely-not-json` and confirm the app reports a
   plain error and leaves existing data intact.
7. **Erase-all.** From Settings run erase-all; confirm profiles, snapshots,
   timeline, and settings are gone and the app returns to the empty state.
8. **Uninstall + data location.** Uninstall (or move the portable folder) and
   confirm the documented data directory can be found and deleted manually.
9. **Persistence across restart.** After step 6, quit and relaunch; restored
   state must persist.

Attach the completed checklist (with OS build and artifact hash, no device
identifiers) to the release. Do not describe physical compatibility as tested
unless this checklist was actually completed on that platform.

## Unsigned-build warnings (what users will see)

- **Windows:** SmartScreen may show "Windows protected your PC" for the NSIS
  installer, and antivirus heuristics may flag unsigned executables. Both are
  expected for unsigned builds; verify `CHECKSUMS.txt` before running.
- **macOS:** Gatekeeper blocks the app on first launch ("unidentified
  developer"). Control-click → Open is the standard bypass for trusted
  artifacts; verify the DMG tarball's SHA-256 first.

## Data locations and uninstall

Dock Audit keeps everything local; there is no account or telemetry.

- **Windows (installed):** `%APPDATA%\com.rwrife.dock-audit\`
- **Windows (portable):** files next to `dock-audit.exe` where the app writes
  its data, plus the same `%APPDATA%` location for webview data.
- **macOS:** `~/Library/Application Support/com.rwrife.dock-audit/` and
  `~/Library/WebKit/com.rwrife.dock-audit/` (webview data).

Uninstall:

- Windows installer: **Settings → Apps → Dock Audit → Uninstall**, then delete
  the data directory above if you want the profiles/snapshots/timeline gone.
- Portable ZIP: delete the folder, then the data directory.
- macOS: drag `Dock Audit.app` to Trash, then delete the two `~/Library`
  directories above.
- To remove everything while keeping the app installed, use **Settings →
  Erase all local data** inside the app first.

## Recovery

- **Restore from backup:** install/launch a matching version, paste or load the
  versioned backup JSON in **Restore from versioned backup**, review the
  conflict preview, and apply. Restore is atomic: a rejected archive leaves
  existing data untouched (verified by the import-safety test corpus).
- **Corrupted install / failed launch:** reinstall the same checksum-verified
  artifact; user data survives reinstall because it lives outside the install
  folder.
- **Bad restore:** restore a known-good earlier backup, or erase-all from
  Settings and start fresh.

## Troubleshooting quick table

| Symptom                                          | First check                                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Gatekeeper/SmartScreen block                     | Verify `CHECKSUMS.txt`; unsigned builds are expected to warn                                   |
| Window opens but no devices listed               | Adapter status line; capability gaps are reported, not hidden                                  |
| Class shows `unsupported`/`failed`               | That is a reported capability gap, not a missing device; compare claims are gated on it        |
| Export still shows a field you expected redacted | Check whether the identifying-fields opt-in is enabled; report as a bug with a redacted sample |
| Restore rejected with a plain error              | The archive is malformed/foreign-version; existing data was left intact on purpose             |
| App data survives uninstall (you wanted it gone) | Data is user-owned by design; delete the documented directory manually                         |
