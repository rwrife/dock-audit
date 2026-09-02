# Development

Dock Audit is a Tauri 2 desktop application with a TypeScript/Vite frontend and a
Rust workspace. The bootstrap shell is deliberately capability-honest: it reports
that inventory adapters are unavailable and does not inspect or fabricate devices.

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

### Windows

Supported development hosts are Windows 10 22H2 and Windows 11. Install:

- Microsoft C++ Build Tools from Visual Studio 2022, including the **Desktop
  development with C++** workload and a Windows SDK;
- WebView2 (included with current Windows 10/11; use Microsoft's Evergreen
  bootstrapper only if it is missing);
- Git, Rustup, and Node.js at the versions above.

No administrator privilege is required to run Dock Audit after the development
prerequisites are installed. This bootstrap does not yet inventory hardware.

### macOS

Supported development hosts are macOS 13 or newer. Install:

- Xcode Command Line Tools (`xcode-select --install`);
- Rustup and Node.js at the versions above.

Apple Silicon and Intel are source targets. This bootstrap CI builds only the native
architecture of GitHub's current `macos-latest` runner; it does not establish a
universal binary or physical peripheral compatibility.

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

- `crates/dock-audit-core`: UI-independent status and future domain contracts.
- `crates/dock-audit-core/src/adapters/windows.rs`: Windows native adapter boundary.
- `crates/dock-audit-core/src/adapters/macos.rs`: macOS native adapter boundary.
- `src-tauri`: narrow Tauri command and desktop process.
- `src`: TypeScript UI, rendered without injecting observed device strings as HTML.

Platform adapters must remain ordinary-user and read-only. They must report scan
failures and unsupported capabilities rather than converting them into missing
observations. Baseline operation has no telemetry or cloud account.
