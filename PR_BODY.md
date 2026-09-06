## Summary

- implement an accessible profile-capture workflow that lets users review fresh observations, select expected devices, assign aliases, and mark each expectation as required/optional before saving a named profile
- implement **Check desk** with progress, cancel, and re-scan controls plus grouped result sections: present, missing, unexpected, changed, ambiguous, and unknown
- show match evidence as identity-signal keys + plain-language reasoning while keeping hash values/raw serial-like values hidden by default
- gate missing conclusions behind class scan-health completeness (failed/partial/unsupported classes are reported as unknown with an explicit limitation notice)
- support profile edits and profile deletion without rewriting historical snapshots (snapshots retain the captured profile version/aliases)
- add keyboard/screen-reader/contrast/reduced-motion focused UI semantics and focus-visible styling for the end-to-end workflow
- add injected-adapter UI tests that cover first capture, successful reconnect, partial scan, ambiguity resolution, optional devices, deletion snapshot preservation, and axe accessibility checks
- wire new Tauri commands for inventory-report + compare-profile invocation from the desktop UI

## Verification

- `pnpm format:check` — passed
- `pnpm lint:ui` — passed
- `pnpm test:ui` — passed
  - `✓ src/app.test.ts (7 tests) 260ms`
  - includes axe run: `passes axe accessibility checks without serious or critical violations`
- `cargo test -p dock-audit-core` — passed
  - unit/integration fixture suite passed (`4 + 2 + 3 + 8 + 8`, 25 tests total)
- `cargo clippy -p dock-audit-core --all-targets -- -D warnings` — passed
- `pnpm build` — passed (Vite production build)
- `git diff --check` — passed

## Platform / evidence gaps

- `pnpm lint` and `pnpm test` (workspace-wide Rust checks) cannot complete on this Linux runner because building `src-tauri` pulls `libdbus-sys`, and `dbus-1.pc` is missing on host (`Package 'dbus-1' ... not found`).
- I did **not** fabricate native hardware/peripheral results for Windows/macOS. This PR only includes real fixture/UI execution from this host and leaves cross-platform native evidence to CI hosts with required system packages/hardware access.

Closes #5
