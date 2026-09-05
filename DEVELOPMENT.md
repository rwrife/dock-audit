# Development

Dock Audit is a Tauri 2 desktop application with a TypeScript/Vite frontend and a
Rust workspace. On Windows builds, the shell invokes read-only native inventory
and presents per-class health/capability gaps. Other builds explicitly report no
native inventory adapter. This repository has no recorded real-Windows diagnostic
run and therefore claims no platform or hardware compatibility.

## Pinned toolchain

| Tool             | Version                        |
| ---------------- | ------------------------------ |
| Rust             | 1.98.0 (`rust-toolchain.toml`) |
| Node.js          | 22.23.1 (`.node-version`)      |
| pnpm             | 11.25.0 (`package.json`)       |
| Tauri CLI        | 2.11.4                         |
| Tauri Rust crate | 2.11.5                         |

Use the checked-in lockfiles. Dependency upgrades should be explicit pull requests,
not incidental local changes.

## Platform prerequisites

### Windows development target

The Windows adapter is source-targeted at current Windows 10/11 development
systems. This is a build prerequisite description, **not** a support statement
or evidence that a particular OS, dock, or peripheral works. Install:

- Microsoft C++ Build Tools from Visual Studio 2022, including the **Desktop
  development with C++** workload and a Windows SDK;
- WebView2 (included with current Windows 10/11; use Microsoft's Evergreen
  bootstrapper only if it is missing);
- Git, Rustup, and Node.js at the versions above.

No administrator privilege is requested by the adapter after the development
prerequisites are installed. It performs read-only enumeration only; see
[WINDOWS_ADAPTERS.md](WINDOWS_ADAPTERS.md) for API and field boundaries.

### macOS development target

Supported development hosts are macOS 13 or newer. Install:

- Xcode Command Line Tools (`xcode-select --install`);
- Rustup and Node.js at the versions above.

Apple Silicon and Intel are source targets. This bootstrap CI builds only the native
architecture of GitHub's current `macos-latest` runner; it does not establish a
universal binary or physical peripheral compatibility. macOS inventory is not yet
implemented.

Tauri's maintained prerequisite details are at
<https://v2.tauri.app/start/prerequisites/>.

## Deterministic commands

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

`pnpm tauri dev` opens a desktop window and remains running until it is closed. The
build command creates an unsigned development executable only; it does not create
an installer, sign code, notarize an app, or prove hardware compatibility.

## Architecture boundaries

- `crates/dock-audit-core`: UI-independent status, normalized inventory, and domain contracts.
- `crates/dock-audit-core/src/adapters/windows.rs`: Windows read-only native adapter.
- `crates/dock-audit-core/src/adapters/macos.rs`: macOS native adapter boundary.
- `src-tauri`: narrow Tauri command and desktop process.
- `src`: TypeScript UI, rendered without injecting observed device strings as HTML.

Platform adapters must remain ordinary-user and read-only. They must report scan
failures and unsupported capabilities rather than converting them into missing
observations. Baseline operation has no telemetry or cloud account. The opt-in
native diagnostic displays only redacted capability counts; it does not emit
device labels, fields, IDs, serials, or MAC addresses.
