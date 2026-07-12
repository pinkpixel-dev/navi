# Releasing Navi

How to cut a public release: build the installers, checksum them, publish them, and how users verify what they downloaded.

## Prerequisites

- Node.js 20+ and npm
- Rust (stable) with the platform targets you're building for
- Platform build deps for Tauri — on Linux that's `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, and `patchelf`; macOS needs Xcode command line tools; Windows needs the MSVC build tools. The [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) has the full list per platform.

Installers are built per platform — a Linux machine produces the Linux bundles, a Mac produces the macOS ones, and so on. There's no cross-compilation step here.

## 1. Bump the version

The version lives in three places and they should all match:

- `package.json` — `"version"`
- `src-tauri/tauri.conf.json` — `"version"`
- `src-tauri/Cargo.toml` — `version`

## 2. Run the checks

```bash
npm run test:run              # frontend tests (Vitest)
npm run build                 # TypeScript + Vite production build
cd src-tauri && cargo test    # Rust tests
```

Don't ship if any of these fail.

## 3. Build the installers

```bash
npm run tauri build
```

Bundles land under `src-tauri/target/release/bundle/`:

| Platform | Artifacts |
| --- | --- |
| Linux | `appimage/*.AppImage`, `deb/*.deb`, `rpm/*.rpm` |
| macOS | `dmg/*.dmg`, `macos/*.app.tar.gz` |
| Windows | `msi/*.msi`, `nsis/*-setup.exe` |

Bundle metadata (product name, publisher, category, icons) comes from the `bundle` section of `src-tauri/tauri.conf.json`. Icons are generated from the root `icon.png` — if the icon ever changes, regenerate them with:

```bash
npx tauri icon icon.png
```

## 4. Generate checksums

```bash
./scripts/generate-checksums.sh
```

This finds every installer under the bundle directory and writes a `SHA256SUMS` file next to the repo root. Upload `SHA256SUMS` to the release alongside the installers — it's what the verification flow checks against.

Note for macOS and Windows: the bundles are currently unsigned, so Gatekeeper and SmartScreen will warn on first launch. Code signing certificates are on the wish list; until then, the checksums are the integrity story.

## 5. Publish the release

```bash
git tag v<version>
git push origin v<version>
gh release create v<version> \
  --title "Navi v<version>" \
  --notes-file CHANGELOG.md \
  src-tauri/target/release/bundle/appimage/*.AppImage \
  src-tauri/target/release/bundle/deb/*.deb \
  src-tauri/target/release/bundle/rpm/*.rpm \
  SHA256SUMS \
  scripts/verify-install.sh
```

Add the macOS and Windows artifacts from their build machines with `gh release upload v<version> <files>`.

## Verifying an install (for users)

Every release ships a `SHA256SUMS` file. To check that an installer wasn't corrupted or tampered with:

1. Download the installer and `SHA256SUMS` from the same release page.
2. Run the verify script from the download directory:

```bash
./verify-install.sh Navi_0.1.0_amd64.AppImage
```

It prints `OK` when the checksum matches and refuses loudly when it doesn't.

No script handy? The manual version is one line:

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

On macOS use `shasum -a 256 -c SHA256SUMS --ignore-missing`; on Windows (PowerShell), compare `Get-FileHash .\Navi_0.1.0_x64-setup.exe` against the matching line in `SHA256SUMS`.

If the check fails, don't install the file. Delete it and re-download from the official release page.
