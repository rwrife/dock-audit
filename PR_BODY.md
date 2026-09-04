## Summary

- add capability-aware observations, profile expectations, deterministic matching, and scan-health-safe comparison contracts
- add injectable SQLite v1 profile/snapshot storage with validated atomic backup restore
- document stored data, identifier limits, migration behavior, and remaining privacy work

## Verification

- `corepack pnpm format:check` — passed
- `corepack pnpm test:ui` — passed: 1 file, 1 test
- `corepack pnpm build` — passed: Vite production build
- `cargo test -p dock-audit-core` — passed: 4 integration tests
- `cargo clippy -p dock-audit-core --all-targets -- -D warnings` — passed
- `git diff --check` — passed

## Platform/evidence gaps

`corepack pnpm lint` cannot finish on this Linux host because Tauri's `libdbus-sys`
build cannot find the system `dbus-1` development package. The exact error was
`Package 'dbus-1' ... was not found`. No workaround or native hardware evidence
was fabricated. CI remains responsible for the configured macOS and Windows
workspace checks. Native adapters, local hash-key lifecycle, hardware collection,
and platform compatibility are not implemented or claimed here.

Closes #2
