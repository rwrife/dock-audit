#!/usr/bin/env bash
# Assemble the uploadable preview candidate bundle for the current platform.
# Runs on Git Bash (Windows runners) and zsh/bash (macOS runners).
set -euo pipefail

OUT=candidate
rm -rf "$OUT"
mkdir -p "$OUT"

version=$(python3 - <<'PY'
import json
print(json.load(open("package.json"))["version"])
PY
)

copy_if_exists() {
  local src="$1"
  if [ -f "$src" ]; then
    cp "$src" "$OUT/$(basename "$src")"
  fi
}

if [ "${RUNNER_OS:-}" = "Windows" ]; then
  # NSIS installer produced by `tauri build --bundles nsis`.
  for f in target/release/bundle/nsis/*.exe; do
    [ -e "$f" ] && cp "$f" "$OUT/"
  done
  # Portable ZIP: the standalone exe plus license/notices/SBOM text files.
  exe=target/release/dock-audit.exe
  if [ ! -f "$exe" ]; then
    echo "error: expected release executable $exe not found" >&2
    exit 1
  fi
  stage=portable-stage
  rm -rf "$stage" && mkdir -p "$stage"
  cp "$exe" "$stage/dock-audit.exe"
  cp LICENSE "$stage/LICENSE.txt"
  [ -f THIRD-PARTY-NOTICES.txt ] && cp THIRD-PARTY-NOTICES.txt "$stage/"
  [ -f candidate-sbom.cdx.json ] && cp candidate-sbom.cdx.json "$stage/"
  python3 - "$stage" "Dock-Audit-${version}-portable-windows-x64.zip" <<'PY'
import os, sys, zipfile
stage, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(os.listdir(stage)):
        archive.write(os.path.join(stage, name), name)
PY
  rm -rf "$stage"
else
  # Universal .app and DMG produced by `tauri build --bundles app,dmg
  # --target universal-apple-darwin`.
  bundle=target/universal-apple-darwin/release/bundle
  if [ ! -d "$bundle" ]; then
    echo "error: expected bundle directory $bundle not found" >&2
    exit 1
  fi
  for dmg in "$bundle"/dmg/*.dmg; do
    [ -e "$dmg" ] && cp "$dmg" "$OUT/"
  done
  for app in "$bundle"/macos/*.app; do
    [ -e "$app" ] && tar -czf "$OUT/$(basename "$app").tar.gz" -C "$(dirname "$app")" "$(basename "$app")"
  done
fi

copy_if_exists candidate-sbom.cdx.json
copy_if_exists THIRD-PARTY-NOTICES.txt
copy_if_exists LICENSE
copy_if_exists "runner-os-${RUNNER_OS:-unknown}.txt"

# Deterministic per-file checksums (filename only, sorted).
(
  cd "$OUT"
  if command -v sha256sum >/dev/null 2>&1; then
    find . -maxdepth 1 -type f ! -name CHECKSUMS.txt -exec sha256sum {} + | sort -k2 > CHECKSUMS.txt
  else
    find . -maxdepth 1 -type f ! -name CHECKSUMS.txt -exec shasum -a 256 {} + | sort -k2 > CHECKSUMS.txt
  fi
)

echo "candidate bundle contents:"
ls -la "$OUT"
