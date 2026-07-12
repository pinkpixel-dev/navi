# Navi

Navi is a local-first chat app and MCP client built with Tauri, React, and TypeScript. You can chat with OpenAI, any OpenAI-compatible endpoint, Ollama, or a model running entirely on your own machine through a managed llama.cpp runtime — all from the same app, with real streaming responses and real MCP tool use.

Project management and a proper canvas for generated artifacts are still on the way. See `ROADMAP.md` for what's built and what's next.

## What works right now

- **Chat with real providers.** OpenAI, OpenAI-compatible endpoints (LM Studio, vLLM, custom servers), and Ollama are all wired up, with responses streaming in token by token instead of appearing all at once.
- **Real MCP tool use.** Connect to an MCP server over stdio or Streamable HTTP, and the model can actually call its tools. Write or destructive calls pause for your approval (allow once, allow for the rest of the conversation, or deny) right in the chat; read-only calls just run.
- **Run models locally, no extra installs.** Import a `.gguf` file from disk, hit Start, and Navi downloads a CPU-only `llama-server` build on first use (with a confirm prompt so it never happens silently), spawns it, and routes chat through it. If you already have `llama-server` installed somewhere, you can point Settings at it instead and skip the download.
- **Real GGUF metadata.** Navi reads architecture, quantization, context length, and chat template straight out of the GGUF header — no separate tool needed.
- **Manage your chats.** Delete, rename, and pin conversations, and search the sidebar by title.
- **Everything's saved locally.** Conversations, messages, tool calls, provider configs, and MCP servers live in SQLite. API keys go through your OS keyring, never into the database.

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

## Project layout

- `src/core/providers/` — the `ChatProvider` contract and the OpenAI, OpenAI-compatible, and Ollama adapters, all sharing one SSE streaming parser.
- `src/core/local-models/` — GGUF import and llama.cpp runtime management (frontend side).
- `src/core/mcp/` — the MCP client (frontend side): connect/discover/call tools, plus mapping a discovered tool to the schema providers expect and classifying its risk.
- `src/core/agent-loop/` — the provider-neutral run loop: real multi-step tool execution, interactive approval, retries, cancellation, timeouts, and the event stream that drives the UI.
- `src-tauri/src/llama_runtime.rs` — downloads, spawns, and manages the local `llama-server` process.
- `src-tauri/src/gguf.rs` — a small hand-rolled GGUF header parser (no external crate).
- `src-tauri/src/mcp_client.rs` — the MCP client itself, built on the official `rmcp` SDK.

`OVERVIEW.md` has the full architecture breakdown if you want more detail than this.

## Project direction

`PLAN.md` is the full product plan. `ROADMAP.md` tracks what's actually been built. Phases 0 through 2 are done — chat, local models, and MCP tool use all work end to end. Canvas artifacts, projects, and the remaining hosted provider adapters (Anthropic, Gemini, OpenRouter) are next.

Made with love by Pink Pixel.
