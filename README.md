# Navi

Navi is a local-first chat app and MCP client built with Tauri, React, and TypeScript. You can chat with OpenAI, Anthropic, Gemini, OpenRouter, any OpenAI-compatible endpoint, Ollama, LM Studio, or a model running entirely on your own machine through a managed llama.cpp runtime — all from the same app, with real streaming responses and real MCP tool use.

See `ROADMAP.md` for what's built and what's next.

## What works right now

- **Chat with real providers.** OpenAI, Anthropic, Google Gemini, OpenRouter, OpenAI-compatible endpoints (vLLM, custom servers), Ollama, and LM Studio are all wired up, with responses streaming in token by token instead of appearing all at once.
- **Real MCP tool use.** Connect to an MCP server over stdio or Streamable HTTP, and the model can actually call its tools. Write or destructive calls pause for your approval (allow once, allow for the rest of the conversation, or deny) right in the chat; read-only calls just run.
- **Built-in tools.** A small set of tools (current time, calculator, UUIDs, random numbers, URL fetching) ships with the app — no MCP server needed. Each one has a toggle in Settings.
- **An artifact canvas.** Fenced markdown, code, HTML, SVG, Mermaid, and images from the model open in a split-view canvas with rendered previews, a raw-source toggle, and revision history when the model keeps editing the same artifact. Download any artifact as a file, or grab everything as a zip.
- **Attach files to your messages.** Images go to vision-capable models as actual images; text documents (markdown, code, CSV, JSON, and friends) get inlined so the model can read them.
- **Run models locally, no extra installs.** Import a `.gguf` file from disk, hit Start, and Navi downloads a CPU-only `llama-server` build on first use (with a confirm prompt so it never happens silently), spawns it, and routes chat through it. If you already have `llama-server` installed somewhere, you can point Settings at it instead and skip the download.
- **Real GGUF metadata.** Navi reads architecture, quantization, context length, and chat template straight out of the GGUF header — no separate tool needed.
- **Organize your chats.** Delete, rename, pin, and archive conversations, group them into projects, and search across titles and message content. Custom avatars for you and the assistant, too.
- **Everything's saved locally.** Conversations, messages, tool calls, artifacts, provider configs, and MCP servers live in SQLite. API keys go through your OS keyring, never into the database.

## Development

Install dependencies:

```bash
npm install
```

Run the web app (browser-only shell — local models and anything needing native APIs are disabled here):

```bash
npm run dev
```

Run the actual desktop app:

```bash
npm run tauri dev
```

Build the frontend:

```bash
npm run build
```

Run tests:

```bash
npm run test:run   # frontend (Vitest)
cd src-tauri && cargo test   # Rust
```

## Releases

`docs/RELEASING.md` covers building installers, generating checksums, and publishing a release. Every release ships a `SHA256SUMS` file; verify a download with:

```bash
./scripts/verify-install.sh <installer file>
```

or the manual `sha256sum -c SHA256SUMS --ignore-missing`.

## Project layout

- `src/core/providers/` — the `ChatProvider` contract and the OpenAI, Anthropic, Gemini, OpenRouter, OpenAI-compatible, Ollama, and LM Studio adapters. The OpenAI-style ones share one SSE streaming parser; Anthropic and Gemini speak their native streaming APIs.
- `src/core/tools/` — the built-in tool collection (time, calculator, UUIDs, random numbers, URL fetch) with per-tool Settings toggles.
- `src/canvas/` — artifact extraction from messages, revision grouping, and download/zip helpers for the canvas.
- `src/core/local-models/` — GGUF import and llama.cpp runtime management (frontend side).
- `src/core/mcp/` — the MCP client (frontend side): connect/discover/call tools, plus mapping a discovered tool to the schema providers expect and classifying its risk.
- `src/core/agent-loop/` — the provider-neutral run loop: real multi-step tool execution, interactive approval, retries, cancellation, timeouts, and the event stream that drives the UI.
- `src-tauri/src/llama_runtime.rs` — downloads, spawns, and manages the local `llama-server` process.
- `src-tauri/src/gguf.rs` — a small hand-rolled GGUF header parser (no external crate).
- `src-tauri/src/mcp_client.rs` — the MCP client itself, built on the official `rmcp` SDK.

`OVERVIEW.md` has the full architecture breakdown if you want more detail than this.

## Project direction

`PLAN.md` is the full product plan. `ROADMAP.md` tracks what's actually been built. Phases 0 through 5 are done — chat, local models, MCP tool use, the artifact canvas, projects, hosted provider adapters, and release tooling all work end to end.

Made with love by Pink Pixel.
