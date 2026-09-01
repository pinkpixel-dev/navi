# Navi v1.0.1 Release Notes

**Release Date:** August 31, 2026  
**Version:** 1.0.1

## Summary

Navi 1.0.1 improves artifact extraction and rendering across all supported AI providers. It introduces a shared system prompt protocol for fenced artifact output and adds strict recovery for complete unfenced HTML and SVG documents.

---

## User-Facing Highlights

* **Automatic Unfenced Artifact Recovery:** If a model returns a complete HTML document or a standalone SVG graphic without markdown code fences, Navi now detects and displays it in the Artifact Canvas rather than leaving raw markup in the chat stream.
* **Consistent Artifact Prompting:** Added a standard artifact protocol across all chat providers (OpenAI, Anthropic, Gemini, OpenRouter, Ollama, LM Studio, and llama.cpp). Providers are clearly instructed to wrap complete HTML, SVG, Mermaid, Markdown, and code artifacts in labelled fenced blocks.
* **Precise Canvas Parsing:** Fenced blocks remain the primary source of truth. Partial snippets, unclosed markup, and plain text fragments are not mistakenly converted into artifacts, avoiding broken canvas previews.

---

## Fixes and Improvements

* **Artifact Canvas Extraction:** Updated artifact detection logic to safely capture root HTML (`<!doctype html>` or `<html>...</html>`) and root SVG elements (`<svg>...</svg>`) when fences are omitted, while stripping surrounding conversational text from the artifact source.
* **System Prompt Architecture:** Split system prompt generation and user/project instruction merging into a dedicated modular file (`src/core/agent-loop/systemPrompt.ts`) backed by automated unit tests.
* **Attachment Protection:** Ensured image references in assistant responses do not suppress valid unfenced document recovery.

---

## Breaking Changes and Migrations

* **Breaking Changes:** None.
* **Database Migrations:** None.
* **Configuration Changes:** None required. Existing settings, conversations, and provider configs carry over directly.

---

## Known Notes

* Windows installers are currently unsigned. Windows SmartScreen may display a standard prompt on first launch.
* Binary document parsing (such as PDF and DOCX) is not yet supported. Text-based documents and image attachments are fully supported.

---

## Installation and Upgrades

### Linux

Download the package matching your distribution:
* AppImage: `Navi_1.0.1_amd64.AppImage`
* Debian / Ubuntu: `Navi_1.0.1_amd64.deb`
* Fedora / RHEL / openSUSE: `Navi-1.0.1-1.x86_64.rpm`

Verify download integrity:
```bash
./scripts/verify-install.sh Navi_1.0.1_amd64.AppImage
```

Or verify manually with `sha256sum`:
```bash
sha256sum -c SHA256SUMS --ignore-missing
```

### Windows

1. Download `Navi_1.0.1_x64-setup.exe`.
2. Verify the hash in PowerShell:
```powershell
Get-FileHash .\Navi_1.0.1_x64-setup.exe
```
3. Check the resulting hash against `SHA256SUMS-windows.txt`.
4. Run the installer.

---

## GitHub Release Copy

### Release Title
`Navi v1.0.1`

### Release Body
```markdown
Navi v1.0.1 improves artifact extraction and rendering reliability across all local and hosted providers.

### Highlights & Fixes
* **Unfenced HTML and SVG Recovery:** Automatically detects and renders complete HTML pages and standalone SVG graphics in the Canvas even if a model forgets to wrap them in markdown fences.
* **Unified Artifact Instructions:** System prompts now enforce a consistent artifact fencing protocol across all providers.
* **Clean Canvas Boundaries:** Prevents duplicate artifacts, ignores broken or partial fragments, and preserves conversational text around recovered documents.
* **Modular Prompt Layer:** Extracted system prompt generation into a tested, isolated module.

### Verification
Download the installer for your platform and verify the SHA-256 checksum against `SHA256SUMS` (Linux) or `SHA256SUMS-windows.txt` (Windows).
```
