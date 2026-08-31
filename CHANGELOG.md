# Changelog

## 1.0.1 - August 31, 2026

### 🐛 Canvas artifacts

- Added one shared artifact protocol to every chat provider. The prompt now requires complete HTML, SVG, Mermaid, Markdown, and code artifacts to use labeled fenced blocks.
- Added strict recovery for complete unfenced HTML documents and standalone SVGs when a provider misses the fencing instruction.
- Kept fenced blocks authoritative. Navi does not infer unfenced Mermaid, Markdown, general code, HTML fragments, or incomplete documents.

### 🏷️ Versioning

- Updated npm, Tauri, and Cargo metadata to `1.0.1`.

## 2026-07-13 (AppImage TLS/crypto crash fix)

- Fixed the `1.0.0` AppImage crashing silently on launch (no error output, SIGSEGV) on rolling-release Linux hosts. GIO's module scan `dlopen`s the bundled `libgiognutls.so` GIO TLS module during the first GTK render, and its bundled crypto dependencies (gnutls, nettle, hogweed, p11-kit, leancrypto) go ABI-incompatible with the host's live `libgmp`, which linuxdeploy never bundles.
- Added `scripts/fix-appimage-tls.sh`, which strips those six bundled crypto/TLS files from the AppImage's AppDir and repacks it with `appimagetool` so the host's own consistent glib-networking stack is used instead. This keeps webview HTTPS (cloud provider chat) working, unlike disabling GIO module scanning outright.
- Chained the fix script into `npm run bundle:linux` so it runs automatically after every `tauri build`.
- Regenerated `SHA256SUMS` for the fixed `Navi_1.0.0_amd64.AppImage`.

## 2026-07-13 (v1.0.0 release prep)

- Updated Navi's app, npm, Cargo, and Tauri metadata to version `1.0.0`.
- Added a Linux release build script that sets `NO_STRIP=true` for reliable AppImage bundling on rolling-release Linux hosts.
- Built the Linux v1.0.0 installers: `Navi_1.0.0_amd64.AppImage`, `Navi_1.0.0_amd64.deb`, and `Navi-1.0.0-1.x86_64.rpm`.
- Generated and verified `SHA256SUMS` for the Linux installers.
- Added a manual `Build Windows Release` GitHub Actions workflow that builds the Windows NSIS `.exe`, creates `SHA256SUMS-windows.txt`, stores both as workflow artifacts, and uploads them to an existing GitHub Release tag.
- Added an optional Docker browser-preview build using a multi-stage Node/nginx image, plus Docker Hub copy and README instructions that clearly keep native installers as the recommended path.
- Added v1.0.0 release notes, GitHub repository description/topics, Docker Hub description, and updated release documentation.

## 2026-07-12 (Phases 3–5)

- Added Appearance controls in Settings for dark/light theme mode and accent color selection. Blue remains the default, and red, orange, yellow, green, purple, and pink accents now recolor Navi's main blue UI accents, the sidebar icon, and bundled default chat avatars without affecting custom uploaded avatars.
- Added a real Projects sidebar section with colored project icons, project creation, project settings, project-level instructions, project home chat lists, new-chat-in-project flow, chat moves between projects, and provider prompt context for project instructions.
- Refined Projects navigation so selecting a project no longer replaces the sidebar chat list, the sidebar New chat button stays generic, project pages have their own settings icon, project-created chats open directly in the normal chat view, and project settings now use icon/color pickers with expanded icon and color choices.
- Cleaned up project chat management: the Projects header icon now creates a default new project without an always-visible text box, the bottom Chats section only shows unsorted chats, project pages are list-only until a chat is opened, and chat project moves now use hover icon menus instead of inline dropdowns.
- Added project-page chat hover actions for rename, archive, delete, remove from project, and move to another project; shifted sidebar chat hover icons away from the scrollbar; and added a confirmed Delete project button that moves contained chats back to unsorted Chats.
- Replaced the sidebar's multi-icon chat hover strip with a single actions menu so long chat titles and narrow sidebar widths no longer hide rename, pin, archive, project move, or delete controls.
- Added the same chat actions menu to open chat headers, including inline title rename, pin/unpin, archive/unarchive, project moves, and delete.
- Added dependency-free syntax highlighting for canvas code/raw views and fenced code blocks inside Markdown artifacts, with escaped HTML output and language-aware styling for common code, JSON, markup, and Markdown.
- Added personalization settings for a saved name, short bio, and custom user instructions. Navi now adds those details to the provider system context on chat runs, ignores blank personalization fields, and uses the saved name on the new-chat start screen.
- Fixed LM Studio model fetching and chat requests in the desktop app by routing loopback LM Studio HTTP calls through a scoped native request command, avoiding WebView CORS failures when LM Studio is running on `localhost:1234`.
- Fixed provider-type switching in Settings so changing from one default local endpoint to LM Studio updates the base URL to `http://localhost:1234/v1` instead of keeping the previous provider's default URL.
- Fixed a startup race from the generated-title state helper where SQLite-loaded conversations could be replaced in the sidebar by the initial blank `New chat` state before the saved conversation ref caught up. The existing database remained intact.
- Added background LLM-generated chat titles after the first successful assistant response, replacing the provisional first-message title only when the user has not manually renamed the chat.
- Replaced Navi's frontend-only built-in tools with curated MCP tool presets. Settings now has a Navi Tools section for Web Search, Notifications, Sequential Thinking, Date & Time, Memory, Context7 documentation, and Pixara image generation; presets save normal MCP server configs, use the same local `env` storage as manual MCP servers, support required options like timezone/API keys/paths, and auto-connect enabled preset servers on app launch without changing custom MCP server startup behavior.
- Regenerated the full Tauri app icon set from the updated `public/icon.png` source image.
- Added a focused canvas mode that collapses the chat column so artifact previews can expand from the sidebar to the right edge, and widened the drag-resize range for larger manual previews.
- Filtered fetched OpenAI model lists to hide non-chat model families by name (`embedding`, `whisper`, `tts`, `moderation`, `search`, `transcribe`, `image`, `audio`, `realtime`, and `sora`), keeping the chat picker focused without trying to build a full cross-provider model taxonomy.
- Filtered fetched Gemini model lists to hide image/video generation families (`image`, `omni`, `veo`, and `video`) while keeping a manual-selection guard that prevents those Gemini models from receiving tool/function schemas if a user enters one directly.
- Added a default agent-loop system instruction telling providers to answer the latest user message directly and use earlier messages/attachments only as relevant context, so vision-capable models do not eagerly describe every older attachment in the thread.
- Fixed recent-chat sidebar row hover actions at the default sidebar width by giving the action cluster room to render and hiding the timestamp while row actions are visible.
- Fixed Gemini Interactions requests for the current steps-based API revision: stateless Gemini history now uses typed `user_input`, `model_output`, `function_call`, and `function_result` steps instead of the older role/turn list shape, and raw streaming requests now use `?alt=sse` plus `step.start`/`step.delta` parsing.
- Reworked Settings into a compact card-first layout: saved providers and MCP servers now sit in horizontal cards with edit/delete/start-stop actions, while provider setup and MCP server setup open in focused modal dialogs. Local Models now appears directly under providers, followed by General, Avatars, Navi Tools, and custom MCP servers.
- Switched Gemini chat requests from the old `streamGenerateContent` endpoint to the newer Gemini Interactions API, including stateless `store: false` requests, Interactions image blocks, Interactions tool declarations, streamed text deltas, and streamed function-call handling.
- Fixed attachments not reaching providers by passing composer attachments through the agent loop's provider message bridge. Images and text documents now travel with the actual provider request instead of only appearing in the visible chat UI.
- Fixed the file picker only exposing images in some environments by removing the restrictive picker accept filter and validating supported attachments in code. Navi currently supports images plus text-based documents; unsupported binary documents are rejected with a clear message instead of being read as nonsense text.
- Added width resizing for the sidebar and canvas panel, with persisted widths, so long chat names and larger artifact previews are easier to inspect.
- Cleaned up sidebar chat rows: recent chats now use the same hover actions as pinned chats, row titles get the full width when not hovering, and the confusing project/folder row action was removed.
- Increased message avatar size again for better readability in chat.
- Added saved-provider deletion through the provider config repository and Tauri storage command.
- Enlarged and reorganized Settings so provider setup is first, connected providers scan in a horizontal card list, general/avatar/local model/MCP/tool sections follow in a more practical order, and saved MCP servers are separated from the add/edit server form.
- Fixed provider draft names so switching the provider type updates untouched default names (`Google Gemini`, `OpenRouter`, `LM Studio`, etc.) instead of leaving every new provider named "Compatible endpoint"; the editable Name field now sits directly under the provider Type dropdown.
- Increased user and assistant avatar sizes in chat and Settings so custom avatars are easier to see.
- Added practical GPU acceleration controls for the managed llama.cpp runtime: Settings now includes acceleration mode (`Auto`, `CUDA`, `Vulkan`, `ROCm`, `SYCL`, or CPU) plus GPU layer count, and the native runtime downloader now selects backend-specific llama.cpp release assets instead of only CPU builds. Runtime starts now pass `--n-gpu-layers` for accelerated modes. Auto currently prefers CUDA on Windows and Vulkan on Linux; Linux CUDA can still be used through the custom `llama-server` path until llama.cpp publishes a matching Linux CUDA prebuilt asset.
- **Added the Anthropic provider adapter** (Phase 4): native Messages API streaming over SSE with `x-api-key`/`anthropic-version` headers, `tool_use`/`tool_result` block round-tripping (with the same orphaned-tool-call protection the OpenAI adapters have), system messages hoisted to the top-level `system` field, base64 image blocks for attachments, and model listing via `/v1/models`.
- **Added the Google Gemini provider adapter** (Phase 4): native `streamGenerateContent?alt=sse` streaming, function calling (results matched back to calls by function name, since Gemini has no call ids), `inlineData` image parts, `systemInstruction`, JSON-Schema sanitizing for tool declarations (Gemini rejects `$schema`/`additionalProperties`), and model listing filtered to `generateContent`-capable models.
- **Added the OpenRouter adapter** (Phase 4): OpenAI-compatible streaming against `openrouter.ai/api/v1` with attribution headers and a model list that carries real display names and context lengths.
- **Added the LM Studio adapter** (Phase 4): OpenAI-compatible streaming against `http://localhost:1234/v1` (configurable), listed as a local provider.
- Refactored provider selection behind a single `createProviderFromConfig` factory shared by chat execution and the Settings "Fetch models" flow; the Settings type dropdown now offers all seven provider types with sensible base-URL defaults and per-type endpoint labels.
- **Built the real artifact canvas** (Phase 3): assistant messages are now scanned for *all* fenced blocks and image references — markdown, code (with language tag), HTML, SVG, Mermaid, and images — not just the first `\`\`\`markdown` fence. Markdown renders through `marked` + DOMPurify, HTML previews in a sandboxed iframe, SVG renders safely as an image, Mermaid diagrams render via `mermaid`, and code/text get a language-labelled raw view. Every artifact has a preview/raw-source toggle.
- **Added artifact revision history** (Phase 3): artifacts with the same kind + title across a conversation group into one revision timeline with prev/next navigation (`v2 of 3`), and all of a conversation's artifacts (not just the newest) now persist to the SQLite `artifacts` table.
- **Added artifact downloads** (Phase 3): save any artifact to a file (native save dialog + a new `write_binary_file` Rust command in the desktop app, anchor download in browser dev), download all of a conversation's artifacts as a zip (JSZip), and copy-to-clipboard.
- **Added projects, archive, and deep search** (Phase 3/5): assign any chat to a project (folder icon on the chat row), filter the sidebar by project, archive/unarchive chats into a collapsible Archived section, and the sidebar search now matches message content as well as titles. New chats inherit the active project filter.
- **Added file attachments to chat** (Phase 5): attach images (PNG/JPEG/GIF/WebP, sent as real image blocks to vision-capable providers on every adapter) and text documents (inlined into the message with a filename header) from a paperclip button in the composer, with chips/thumbnails in the composer and message history. 10MB per-file limit.
- **Added built-in tool access through curated MCP presets** (Phase 5): a small collection of first-class Navi Tools can be toggled from Settings while still saving and executing as normal MCP servers.
- **Added customizable avatars** (Phase 5): messages now show avatar images (bundled `user.png`/`assistant.png` defaults) instead of the "user"/"assistant" role text, and Settings lets you swap either for your own image (stored locally) or reset to the default.
- **Distribution prep** (Phase 5): generated the full native icon set (`.icns`, `.ico`, and all PNG sizes) from `icon.png` via `tauri icon`, filled in bundle metadata (publisher, category, copyright, descriptions, per-platform settings) in `tauri.conf.json`, added `scripts/generate-checksums.sh` + `scripts/verify-install.sh` for a SHA256-based installer verification flow, and wrote `docs/RELEASING.md` covering the whole build → checksum → publish → verify pipeline.
- Redesigned the chat header: removed the small "Navi" project label (that slot was a placeholder for a future projects feature that will live in the sidebar instead, not the header), restyled the provider/model dropdowns to match the app's dark theme with a custom chevron instead of the raw OS-native widget look, and gave the title/selector area more breathing room.
- **Fixed confirm dialogs silently failing in the desktop app.** `window.confirm` isn't wired up in the Tauri webview (throws `dialog.confirm not allowed. Command not found`), so both the new chat-delete confirmation and the existing llama.cpp runtime download confirmation were broken — clicking through them did nothing. Added a shared `confirmDestructiveAction` helper (`src/ui/confirmDialog.ts`) that uses `@tauri-apps/plugin-dialog`'s `confirm()` in the desktop app and falls back to the real `window.confirm` in browser-dev mode.
- Added chat management to the sidebar: delete (with a confirm prompt), rename (inline, click the pencil icon), and pin/unpin, plus a working search box that actually filters the list (it was a non-functional placeholder before). Chat rows now reveal these actions on hover instead of cluttering the default view.
- Fixed chat titles never auto-populating from the first message — the check compared against the string `"Untitled chat"`, but new chats are actually titled `"New chat"`, so the comparison never matched and every chat stayed "New chat" forever.
- Fixed `updatedAt` being hardcoded to the literal string `"Just now"` everywhere instead of a real timestamp, which made "sort by recency" meaningless once more than one chat had been touched (they'd all just say "Just now"). Now stores a real ISO timestamp and formats it for display (`5m ago`, `2h ago`, `3d ago`, etc.) via a new `formatRelativeTime` helper.
- Fixed the Settings model-picker checkboxes rendering as oversized, mismatched (pink instead of the app's cyan/blue) native checkboxes — added `accent-color` and explicit sizing.
- Added a `delete_conversation` command (cascades to messages/tool calls/run events/artifacts via existing `ON DELETE CASCADE` foreign keys) and an `update_conversation_metadata` command that updates just the conversation row (title/pin/etc.) without touching its stored run history — needed because renaming or pinning a conversation that isn't the currently active one has no way to know its real run events/artifacts, and reusing the full snapshot-save path would have silently wiped them.

## 2026-07-11

- Wired MCP tools into real chat execution (Phase 2): the model now sees real MCP tool schemas and can actually call them. Write/destructive tool calls pause for an interactive approval prompt (Allow once / Allow for this conversation / Deny) rendered right in the chat; read/network calls execute immediately. Approved calls run against the real connected MCP server via a new `call_tool` Rust command, results feed back to the model, and the loop continues — bounded by the existing step/tool-call limits — until a final answer. `agentLoop.ts` went from a single-pass "call the model once, fake the tool results" loop to a real multi-step loop built around this. The old static `approvalPolicy` (`allow-all`/`deny-writes`) stays as a fallback for callers that don't supply the new interactive `requestApproval`, so it still behaves exactly as before for that case.
- Fixed provider adapters silently breaking every turn after a tool call: the three OpenAI-style adapters now replay `role: "assistant"` messages with real `tool_calls` and `role: "tool"` results with matching `tool_call_id`s, and a message only serializes as a `tool_calls` entry when a matching tool result actually follows it in the conversation — a persisted "final answer" message that still carries `toolCalls` for its own UI display safely degrades to plain text instead of replaying as an orphaned tool call the API rejects. Found via real end-to-end testing: every message sent after a tool call was failing with an opaque "The provider request failed." Also fixed that error message itself to show the real underlying error instead of a generic string that told you nothing.
- Fixed a chat send bug where creating a new chat right after a previous run could fail to save with a `UNIQUE constraint failed: run_events.id` error, because the new conversation's save reused leftover run events from the prior chat's reducer state instead of starting empty.
- Redesigned the chat header model picker: a Provider dropdown now narrows the Model dropdown to just that provider's models, instead of one flat list mixing every fetched model from every provider together. Settings also gained per-model checkboxes (with a search filter) so a provider with hundreds of fetched models can be trimmed down to the ones you actually want in the picker; unchecked models stay configured but hidden from the picker until re-enabled.
- **Fixed a critical bug: saved provider API keys were never actually being persisted.** The `keyring` crate (v3) requires an explicit backend feature to be selected in `Cargo.toml`; without one it silently falls back to a no-op mock keystore that reports success on every save without writing anything. This had been the case since credential storage was first added, so every "Saved key available" in Settings was misleading and any provider requiring a key (OpenAI, OpenRouter, etc.) would eventually fail with an empty-key auth error. Fixed by adding the `sync-secret-service`/`apple-native`/`windows-native` features; verified with a real save-then-read round trip.
- Added an MCP client (Phase 2, first slice): connect to MCP servers over stdio (spawned local process) or Streamable HTTP (remote URL), test a connection before saving, and see real discovered tools/resources/prompts once connected, all from a new "MCP Servers" section in Settings. Uses the official `rmcp` Rust SDK. Connections persist in the app process (not tied to any UI panel) until explicitly disconnected or the app quits. Wiring discovered tools into what the model actually sees and can call is the next slice.
- Added an Ollama provider type (defaults to `http://localhost:11434/v1`, no API key required) alongside OpenAI/OpenAI-compatible/OpenAI in Settings, reusing the same streaming completion path. Phase 1 (Local Chat) is now complete.
- Added real streaming chat state: OpenAI, OpenAI-compatible, and Ollama providers now request `stream: true` and parse Server-Sent Events, so assistant replies fill in incrementally instead of appearing all at once. Local llama.cpp chat streams too, since it goes through the same OpenAI-compatible adapter. Fixed a `this`-binding bug this introduced (`"Can only call Window.fetch on instances of Window"`) where the shared streaming helper called `params.fetcher(...)` as a method instead of a bare function.
- Added managed llama.cpp runtime commands: Navi can now download a CPU-only `llama-server` build on demand (with a confirm prompt, and an optional custom-binary override in Settings), start/stop it per local model, and route chat through it via the existing OpenAI-compatible adapter. Local models are now actually usable in chat, not just importable.
- Fixed the app defaulting new/invalid chats to the first model in an arbitrary fetch order (risking an expensive model getting auto-selected); it now persists and reuses the last model you actually picked, the same way other settings persist.
- Replaced the full per-model list under Provider Setup with a fetch-count status line, and moved Local Models above the saved Providers list, so a large fetched model catalog (e.g. hundreds of OpenAI models) no longer buries the rest of Settings.
- Added GGUF model import: a Settings "Local Models" section (desktop-only) lets users pick a `.gguf` file via a native dialog, reads real architecture/quantization/context-length/chat-template metadata from the GGUF header in Rust, and lists imported models as selectable local models in chat. Runtime execution against them is a separate, later slice.
- Added a native OpenAI provider adapter (fixed `api.openai.com` endpoint, mandatory API key) alongside the existing OpenAI-compatible adapter, with a Settings provider-type selector.
- Removed visible mock models, mock provider rows, mock tool status, seeded demo chats, and settings filler sections from the main UI.
- Added a blank new-chat start state with no fake assistant messages.
- Added Settings provider selection so saved compatible endpoints can be reopened and edited.
- Switched legacy chats that reference removed mock models to the first available saved real model.
- Added browser dev persistence for provider configs and keys across server restarts.
- Simplified the running assistant placeholder to `Thinking...`.
- Filtered Navi seed/demo and internal failure messages out of external provider request context.
- Updated the running assistant placeholder to distinguish local, hosted, and external providers.
- Removed the fake OpenAI-compatible placeholder model from selectable built-in models.
- Fixed browser dev provider config/key sharing so Settings and chat execution use the same fallback store.
- Added selectable saved-provider default models when compatible endpoints have not fetched a model list.
- Wired selected OpenAI-compatible provider configs into the chat run loop.
- Added run loop coverage for injected provider completions.
- Added provider setup controls in Settings for mock local and OpenAI-compatible endpoints.
- Added SQLite-backed provider config storage without raw API keys.
- Added OS keyring commands for provider API keys.
- Added compatible endpoint model fetching and a chat-header model picker.
- Added OpenAI-compatible provider adapter contract tests and implementation.
- Added provider summaries to Settings.
- Made the canvas panel collapsible and added a chat-header reopen control.
- Darkened the canvas empty/artifact surfaces to match the default theme.
- Added SQLite persistence for conversation snapshots, messages, tool calls, run events, and artifacts.
- Added a frontend conversation repository with a Tauri SQLite driver and browser-safe memory fallback.
- Wired the app to load saved conversations on startup and save new/completed chat snapshots.
- Darkened the default theme toward the `#0f1012` range.
- Added cancellation, timeout, and retry handling to the mock agent loop contract.
- Wired the composer button to stop the active mock run through `AbortController`.
- Added reducer-based chat run state so the UI can apply run events progressively.
- Added run-event reducer tests for pending assistant text, tool state updates, and terminal completion.
- Updated the mock loop to emit events through an `onEvent` callback while preserving the final run result.
- Added Vitest coverage for the mock agent loop and canvas artifact extraction.
- Reworked the mock agent loop to return normalized run events, terminal statuses, approval denial behavior, and configurable run limits.
- Added a compact latest-run timeline to the chat workspace.
- Changed the Vite/Tauri development URL from port `5173` to `1420` to avoid common Vite port collisions.
- Scaffolded Navi as a Tauri 2, React, TypeScript, and Vite desktop app.
- Added the Phase 0 app shell with sidebar, chat workspace, canvas panel, settings panel, mock provider, and mock tool loop.
- Added provider-neutral conversation, tool, model, MCP, runtime, and artifact boundaries.
- Added project documentation, roadmap, memory log, error log, and Apache 2.0 license.
