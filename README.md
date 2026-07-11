# Navi

Navi is a chat app and MCP client for local and hosted models. The app is planned as a polished desktop workspace with chat, model management, MCP tools, approvals, and an integrated canvas.

This repository currently contains the Phase 0 scaffold:

- Tauri 2 desktop shell
- React, TypeScript, and Vite frontend
- Provider-neutral conversation types
- Mock provider and mock tool loop
- Canvas artifact placeholder
- Settings surfaces for models, MCP servers, runtime, and approvals

## Development

Install dependencies:

```bash
npm install
```

Run the web app:

```bash
npm run dev
```

Run the desktop app:

```bash
npm run tauri dev
```

Build the frontend:

```bash
npm run build
```

## Project Direction

`PLAN.md` is the product source of truth. The current scaffold intentionally stops before real llama.cpp runtime management, SQLite persistence, secure credential storage, hosted model adapters, and real MCP transport execution.

Made with love by Pink Pixel.
