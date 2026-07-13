#!/usr/bin/env bash
# Strip the bundled TLS/crypto stack from the AppImage and repack.
#
# linuxdeploy bundles gnutls + its crypto deps (nettle, hogweed, p11-kit,
# leancrypto) and the glib-networking GIO module (libgiognutls.so), but NOT
# libgmp — so the bundled stack gets combined with the host's live libgmp.
# On a rolling-release host (CachyOS) those go ABI-incompatible over time and
# GIO's module scan segfaults dlopen()ing libgiognutls.so during the very
# first GTK CSS load, crashing the app at launch with no output.
#
# Removing the whole stack makes WebKit's network process load the host's
# glib-networking module with the host's own consistent crypto libs, which
# keeps HTTPS (cloud providers) working in the webview.
set -euo pipefail

bundle_dir="$(dirname "$0")/../src-tauri/target/release/bundle/appimage"
appdir=$(find "$bundle_dir" -maxdepth 1 -type d -name "*.AppDir" | head -1)
appimage=$(find "$bundle_dir" -maxdepth 1 -type f -name "*.AppImage" | head -1)

if [[ -z "$appdir" || -z "$appimage" ]]; then
  echo "error: AppDir or AppImage not found in $bundle_dir" >&2
  exit 1
fi

removed=0
for lib in libgnutls.so.30 libnettle.so.9 libhogweed.so.7 libp11-kit.so.0 libleancrypto.so.1 gio/modules/libgiognutls.so; do
  if [[ -f "$appdir/usr/lib/$lib" ]]; then
    rm -v "$appdir/usr/lib/$lib"
    removed=1
  fi
done

if [[ "$removed" -eq 0 ]]; then
  echo "nothing to remove; AppImage left untouched"
  exit 0
fi

ARCH=x86_64 appimagetool "$appdir" "$appimage"
echo "repacked: $appimage"
