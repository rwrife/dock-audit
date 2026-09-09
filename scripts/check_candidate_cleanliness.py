#!/usr/bin/env python3
"""Fail the release if human-readable candidate artifacts leak identifiers.

Scope: text files in candidate/ (SBOM, notices, licenses, runner evidence,
checksums). Compiled binaries inside ZIP/DMG bundles are not string-scanned
here; RELEASE_READINESS.md documents that residual limitation honestly.

Usage: python3 scripts/check_candidate_cleanliness.sh  (yes, .sh name is kept
for workflow readability; the file is Python.)
"""

import re
import sys
from pathlib import Path

CANDIDATE = Path("candidate")

PATTERNS = [
    ("unix home path", re.compile(r"/home/[a-z]", re.I)),
    ("macOS user path", re.compile(r"/Users/[a-z]", re.I)),
    ("windows user path", re.compile(r"[A-Za-z]:[\\/](Users|Documents and Settings)[\\/]", re.I)),
    ("github pat", re.compile(r"(ghp_|github_pat_)[A-Za-z0-9]")),
    ("private key", re.compile(r"BEGIN [A-Z ]*PRIVATE KEY")),
    ("password assignment", re.compile(r"password\s*[:=]", re.I)),
    ("secret assignment", re.compile(r"secret\s*[:=]", re.I)),
    ("auth token assignment", re.compile(r"\b(auth_?|access_?)?token\s*[:=]", re.I)),
    ("fixture mac address", re.compile(r"aa:bb:cc:dd:ee:ff", re.I)),
    ("fixture serial", re.compile(r"SERIAL-[A-Z]", re.I)),
]

TEXT_SUFFIXES = {".txt", ".json", ".md", ".yaml", ".yml", ".toml", ".cdx.json", ".log"}


def looks_text(path: Path) -> bool:
    if path.suffix.lower() in TEXT_SUFFIXES or path.name == "CHECKSUMS.txt":
        return True
    with path.open("rb") as handle:
        chunk = handle.read(4096)
    if not chunk:
        return False
    return b"\x00" not in chunk


def main() -> int:
    if not CANDIDATE.is_dir():
        print("error: candidate/ directory missing; run assemble_candidate.sh first", file=sys.stderr)
        return 2
    failures = 0
    scanned = 0
    for path in sorted(CANDIDATE.iterdir()):
        if not path.is_file() or path.name == "CHECKSUMS.txt":
            continue
        if not looks_text(path):
            continue
        scanned += 1
        text = path.read_text(encoding="utf-8", errors="replace")
        for label, pattern in PATTERNS:
            if pattern.search(text):
                print(f"::error:: {label}: forbidden pattern found in {path.name}", file=sys.stderr)
                failures += 1
    if failures:
        print("candidate cleanliness scan FAILED", file=sys.stderr)
        return 1
    print(f"candidate cleanliness scan passed: {scanned} text artifacts, no local paths, credentials, or raw fixture identifiers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
