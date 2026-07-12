import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import JSZip from "jszip";
import { artifactFileName, type Artifact } from "./artifacts";

function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function decodeDataUri(dataUri: string): { bytes: Uint8Array; mimeType: string } | null {
  const match = dataUri.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) {
    return null;
  }
  const [, mimeType = "application/octet-stream", isBase64, payload] = match;
  if (isBase64) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return { bytes, mimeType };
  }
  return { bytes: new TextEncoder().encode(decodeURIComponent(payload)), mimeType };
}

async function artifactBytes(artifact: Artifact): Promise<Uint8Array> {
  if (artifact.kind === "image") {
    const decoded = decodeDataUri(artifact.source);
    if (decoded) {
      return decoded.bytes;
    }
    const response = await fetch(artifact.source);
    if (!response.ok) {
      throw new Error(`Could not download image (${response.status}).`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  return new TextEncoder().encode(artifact.source);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function triggerBrowserDownload(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes.buffer as ArrayBuffer]);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function saveBytes(bytes: Uint8Array, suggestedFileName: string): Promise<boolean> {
  if (!isTauri()) {
    triggerBrowserDownload(bytes, suggestedFileName);
    return true;
  }

  const path = await save({ defaultPath: suggestedFileName });
  if (!path) {
    return false;
  }
  await invoke<void>("write_binary_file", { path, contentsBase64: toBase64(bytes) });
  return true;
}

/** Saves one artifact to disk. Returns false when the user cancelled the save dialog. */
export async function downloadArtifact(artifact: Artifact): Promise<boolean> {
  const bytes = await artifactBytes(artifact);
  return saveBytes(bytes, artifactFileName(artifact));
}

/** Bundles the given artifacts into a zip and saves it. Duplicate names get numbered. */
export async function downloadArtifactsZip(artifacts: Artifact[], zipName = "artifacts.zip"): Promise<boolean> {
  const zip = new JSZip();
  const usedNames = new Set<string>();

  for (const artifact of artifacts) {
    let fileName = artifactFileName(artifact);
    if (usedNames.has(fileName)) {
      const dot = fileName.lastIndexOf(".");
      let counter = 2;
      const base = dot === -1 ? fileName : fileName.slice(0, dot);
      const extension = dot === -1 ? "" : fileName.slice(dot);
      while (usedNames.has(`${base}-${counter}${extension}`)) {
        counter += 1;
      }
      fileName = `${base}-${counter}${extension}`;
    }
    usedNames.add(fileName);
    zip.file(fileName, await artifactBytes(artifact));
  }

  const bytes = await zip.generateAsync({ type: "uint8array" });
  return saveBytes(bytes, zipName);
}

/** Copies an artifact's raw source to the clipboard. */
export async function copyArtifactSource(artifact: Artifact): Promise<void> {
  await navigator.clipboard.writeText(artifact.source);
}
