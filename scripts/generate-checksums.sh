#!/usr/bin/env bash
# Generates SHA256SUMS for every installer Tauri produced.
# Run this after `npm run tauri build`, then publish SHA256SUMS
# alongside the installers on the release.
set -euo pipefail

BUNDLE_DIR="${1:-src-tauri/target/release/bundle}"
OUTPUT_FILE="${2:-SHA256SUMS}"

if [ ! -d "$BUNDLE_DIR" ]; then
  echo "No bundle directory at $BUNDLE_DIR. Run 'npm run tauri build' first." >&2
  exit 1
fi

# Collect the artifacts users actually download.
mapfile -t artifacts < <(find "$BUNDLE_DIR" -type f \( \
  -name '*.AppImage' -o \
  -name '*.deb' -o \
  -name '*.rpm' -o \
  -name '*.dmg' -o \
  -name '*.app.tar.gz' -o \
  -name '*.msi' -o \
  -name '*.exe' \) | sort)

if [ "${#artifacts[@]}" -eq 0 ]; then
  echo "No installers found under $BUNDLE_DIR." >&2
  exit 1
fi

: > "$OUTPUT_FILE"
for artifact in "${artifacts[@]}"; do
  # Store just the file name so the sums verify from a download folder.
  (cd "$(dirname "$artifact")" && sha256sum "$(basename "$artifact")") >> "$OUTPUT_FILE"
done

echo "Wrote $(wc -l < "$OUTPUT_FILE") checksums to $OUTPUT_FILE:"
cat "$OUTPUT_FILE"
