#!/usr/bin/env bash
# Verifies a downloaded Navi installer against the published SHA256SUMS file.
#
#   ./verify-install.sh <installer> [SHA256SUMS]
#
# Download both files from the same GitHub release, put them in one
# directory, and run this script from there.
set -euo pipefail

INSTALLER="${1:-}"
SUMS_FILE="${2:-SHA256SUMS}"

if [ -z "$INSTALLER" ]; then
  echo "Usage: $0 <installer file> [SHA256SUMS file]" >&2
  exit 1
fi

if [ ! -f "$INSTALLER" ]; then
  echo "Installer not found: $INSTALLER" >&2
  exit 1
fi

if [ ! -f "$SUMS_FILE" ]; then
  echo "Checksum file not found: $SUMS_FILE (download it from the same release)" >&2
  exit 1
fi

name="$(basename "$INSTALLER")"
expected="$(grep -F "  $name" "$SUMS_FILE" | awk '{print $1}' | head -n 1)"

if [ -z "$expected" ]; then
  echo "FAIL: $name is not listed in $SUMS_FILE." >&2
  exit 1
fi

actual="$(sha256sum "$INSTALLER" | awk '{print $1}')"

if [ "$expected" = "$actual" ]; then
  echo "OK: $name matches the published checksum."
else
  echo "FAIL: checksum mismatch for $name." >&2
  echo "  expected: $expected" >&2
  echo "  actual:   $actual" >&2
  echo "Do not install this file. Re-download it from the official release page." >&2
  exit 1
fi
