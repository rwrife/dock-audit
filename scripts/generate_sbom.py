#!/usr/bin/env python3
"""Generate a deterministic CycloneDX 1.6 SBOM for Dock Audit release candidates.

Sources of truth, in scope order:
  * ``Cargo.lock``    - every Rust crate in the workspace dependency graph
                        (license resolved from ``cargo metadata`` when available).
  * ``pnpm-lock.yaml`` - every JavaScript package in the pnpm v9 lockfile.
  * ``package.json``  - the workspace root component itself.

The output intentionally contains no local absolute paths, so it can be shipped
inside a release archive without leaking developer machine layout.

Usage:
    python3 scripts/generate_sbom.py [output.json] [--cargo-metadata file.json]

``--cargo-metadata`` reads a previously dumped ``cargo metadata`` JSON instead
of invoking cargo (used by the packaging workflow where the metadata step runs
independently). Without it, the script tries ``cargo metadata`` and degrades to
"license unknown" if cargo is unavailable.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
NAMESPACE = uuid.UUID("3fa8a76c-7cb1-4f4f-a2a1-2d0d0f0f3f8e")  # fixed: dock-audit SBOM
SCHEMA_VERSION = "1.6"
VALID_LICENSE_IDS = {
    # Only allow-list SPDX license identifiers that actually appear in this
    # dependency set; anything else falls back to a named (non-validated)
    # license entry so the SBOM stays schema-valid.
    "0BSD", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "CC0-1.0",
    "ISC", "MIT", "MPL-2.0", "Unicode-3.0", "Zlib",
}


def component_urn(name: str, version: str, purl_type: str) -> str:
    return f"pkg:{purl_type}/{name}@{version}"


def bom_ref(name: str, version: str) -> str:
    return f"pkg:{name}@{version}"


def parse_cargo_lock(text: str) -> list[dict[str, str]]:
    packages: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    in_package = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped == "[[package]]":
            if current and "name" in current and "version" in current:
                packages.append(current)
            in_package = True
            current = {}
            continue
        if stripped.startswith("[") and in_package:
            if current and "name" in current and "version" in current:
                packages.append(current)
            in_package = False
            current = None
        if in_package and current is not None:
            for key in ("name", "version", "source"):
                if stripped.startswith(f"{key} = "):
                    current[key] = stripped.split("=", 1)[1].strip().strip('"')
    if current and "name" in current and "version" in current:
        packages.append(current)
    return packages


def parse_pnpm_lock(text: str) -> list[dict[str, str]]:
    """Extract name/version pairs from the /packages: section of a pnpm v9 lockfile.

    Keys look like ``"name@version":`` or ``"@scope/name@version(peers...)":``.
    Only the ``packages:`` top-level section is parsed; the workspace root and
    any non-package entries are skipped.
    """
    key_re = re.compile(r'^ {2}(?:"(?P<qkey>[^"]+)"|(?P<ukey>[^\s"]+)):\s*$')
    name_re = re.compile(r"^(?P<name>@?[^@/]+(?:/[^@/]+)?)@(?P<version>[^@()]+)$")
    packages: list[dict[str, str]] = []
    seen: set[str] = set()
    in_packages = False
    for line in text.splitlines():
        if line.startswith("packages:"):
            in_packages = True
            continue
        if in_packages and line and not line.startswith(" "):
            break  # left the packages section
        match = key_re.match(line)
        if not match:
            continue
        raw_key = match.group("qkey") or match.group("ukey")
        key = raw_key.split("(", 1)[0]  # strip peer-dependency suffix
        resolved = name_re.match(key)
        if not resolved:
            continue
        name, version = resolved.group("name"), resolved.group("version")
        if name == "dock-audit":  # workspace root, not a dependency
            continue
        id_key = f"{name}@{version}"
        if id_key in seen:
            continue
        seen.add(id_key)
        packages.append({"name": name, "version": version})
    return packages


def load_cargo_licenses(cargo_metadata_path: Path | None) -> dict[tuple[str, str], str]:
    licenses: dict[tuple[str, str], str] = {}
    metadata: Any = None
    if cargo_metadata_path is not None:
        metadata = json.loads(cargo_metadata_path.read_text(encoding="utf-8"))
    else:
        try:
            proc = subprocess.run(
                ["cargo", "metadata", "--format-version", "1", "--locked"],
                cwd=REPO_ROOT, capture_output=True, text=True, timeout=300,
            )
            if proc.returncode == 0:
                metadata = json.loads(proc.stdout)
        except (OSError, subprocess.TimeoutExpired):
            metadata = None
    if metadata is None:
        return licenses
    for pkg in metadata.get("packages", []):
        license_field = pkg.get("license") or ""
        if license_field:
            licenses[(pkg["name"], pkg["version"])] = license_field
    return licenses


def license_entries(expression: str) -> list[dict[str, str]]:
    if not expression:
        return []
    parts = [p.strip() for p in expression.split(" OR ")]
    entries = []
    for part in parts:
        if part in VALID_LICENSE_IDS:
            entries.append({"license": {"id": part}})
        else:
            entries.append({"license": {"name": part}})
    return entries


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", default="sbom.cdx.json")
    parser.add_argument("--cargo-metadata", type=Path, default=None)
    args = parser.parse_args()

    package_json = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))
    cargo_text = (REPO_ROOT / "Cargo.lock").read_text(encoding="utf-8")
    pnpm_text = (REPO_ROOT / "pnpm-lock.yaml").read_text(encoding="utf-8")
    rust_packages = parse_cargo_lock(cargo_text)
    js_packages = parse_pnpm_lock(pnpm_text)
    rust_licenses = load_cargo_licenses(args.cargo_metadata)

    components: list[dict[str, Any]] = []
    seen_refs: set[str] = set()

    for pkg in rust_packages:
        ref = bom_ref(pkg["name"], pkg["version"])
        if ref in seen_refs:
            continue
        seen_refs.add(ref)
        entry: dict[str, Any] = {
            "type": "library",
            "name": pkg["name"],
            "version": pkg["version"],
            "bom-ref": ref,
            "purl": component_urn(pkg["name"], pkg["version"], "cargo"),
        }
        expr = rust_licenses.get((pkg["name"], pkg["version"]), "")
        if expr:
            entry["licenses"] = license_entries(expr)
        components.append(entry)

    for pkg in js_packages:
        ref = bom_ref(pkg["name"], pkg["version"])
        if ref in seen_refs:
            continue
        seen_refs.add(ref)
        components.append({
            "type": "library",
            "name": pkg["name"],
            "version": pkg["version"],
            "bom-ref": ref,
            "purl": component_urn(pkg["name"], pkg["version"], "npm"),
        })

    components.sort(key=lambda c: (c["name"], c["version"]))

    root_version = package_json.get("version", "0.0.0")
    serial = uuid.uuid5(NAMESPACE, f"dock-audit@{root_version}").urn
    bom = {
        "bomFormat": "CycloneDX",
        "specVersion": SCHEMA_VERSION,
        "serialNumber": serial,
        "version": 1,
        "metadata": {
            "component": {
                "type": "application",
                "name": "dock-audit",
                "version": root_version,
                "bom-ref": bom_ref("dock-audit", root_version),
                "purl": component_urn("dock-audit", root_version, "generic"),
                "description": "Local-first desktop utility for auditing dock peripherals.",
                "licenses": [{"license": {"id": "MIT"}}],
            },
        },
        "components": components,
    }

    out_path = Path(args.output)
    if not out_path.is_absolute():
        out_path = REPO_ROOT / out_path
    out_path.write_text(json.dumps(bom, indent=2) + "\n", encoding="utf-8")

    digest = hashlib.sha256(out_path.read_bytes()).hexdigest()
    print(
        f"wrote {out_path.name}: {len(components)} components "
        f"({len(rust_packages)} rust-lock, {len(js_packages)} npm-lock), sha256={digest}"
    )
    if "\\home" in out_path.read_text(encoding="utf-8") or "file:///" in out_path.read_text(encoding="utf-8"):
        print("error: SBOM contains local path references", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
