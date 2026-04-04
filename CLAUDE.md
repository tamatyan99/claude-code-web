# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Code Web is a web-based interface for the Claude Code CLI. It provides two UI modes:

1. **Chat UI (default at `/`)** — A structured chat interface powered by `claude -p --output-format stream-json`. Messages are rendered as Markdown with tool-use cards, model selector, and cost display. Mobile-friendly by design.
2. **Terminal UI (legacy at `/v1`)** — A terminal emulator via xterm.js with raw ANSI output from node-pty. Includes split view, plan detection, sub-agent tracking, and mobile key toolbar.

Both modes share the same Express + WebSocket server and session management.

## Common Commands

```bash
# Install dependencies
npm install

# Start development server (with extra logging)
npm run dev

# Start production server
npm start

# Start with custom port
npm start -- --port 8080

# Start with HTTPS
npm start -- --https --cert cert.pem --key key.pem
```

## Architecture

### Two Execution Modes

**SDK Mode (Chat UI — default)**
- Client sends `start_sdk` + `sdk_prompt` WebSocket messages
- Server spawns `claude -p --output-format stream-json` via `SdkSession` (`src/sdk-session.js`)
- Output is structured JSONL: each line is a typed message (assistant, tool_use, result, etc.)
- Client renders messages as Markdown, tool cards, and cost info
- Supports `--resume`, `--continue`, `--model` flags programmatically

**PTY Mode (Terminal UI — legacy)**
- Client sends `start_claude` / `start_codex` / `start_agent` + `input` messages
- Server spawns CLI via node-pty through Bridge classes (`src/base-bridge.js`)
- Output is raw ANSI terminal text
- Client renders via xterm.js

### Core Components

**Server Layer (src/server.js)**
- Express server handling REST API and WebSocket connections
- Routes: `/` → Chat UI, `/v1` → Terminal UI, `/v2` → Chat UI alias
- Session persistence via SessionStore (saves to ~/.claude-code-web/sessions.json)
- Folder mode for working directory selection
- Auto-save sessions every 30 seconds
- WebSocket message type validation
- SDK handlers: `start_sdk`, `sdk_prompt` → SdkSession
- PTY handlers: `start_claude`, `start_codex`, `start_agent`, `input` → Bridge classes

**SDK Session (src/sdk-session.js)**
- Spawns `claude -p --output-format stream-json` as a child process
- Parses JSONL output into structured messages
- Supports model switching, session resume/continue, permission modes
- Manages session lifecycle (start, stop, prompt sending)
- Captures SDK session IDs for resume capability

**Bridge Layer (src/base-bridge.js) — Legacy**
- `BaseBridge`: Common base class for CLI process management using node-pty
- `ClaudeBridge` (src/claude-bridge.js): Claude CLI with trust prompt auto-accept
- `CodexBridge` (src/codex-bridge.js): Codex CLI
- `AgentBridge` (src/agent-bridge.js): Cursor Agent CLI
- Each bridge handles process lifecycle (start, stop, resize), output buffering, and error handling

**Session Management**
- Persistent sessions survive server restarts
- Multi-browser support — same session accessible from different devices
- Session data includes: ID, name, working directory, output buffer, creation time
- Sessions auto-save and can be manually deleted

**Chat Client (src/public/v2/)**
- **chat.js**: WebSocket client, message rendering, model selection, input handling
- **chat.css**: Dark theme, responsive layout, tool cards, typing indicators
- **index.html**: Minimal HTML shell with header, message area, input bar

**Terminal Client (src/public/) — Legacy**
- **app.js**: Main interface controller, terminal setup, WebSocket management
- **session-manager.js**: Session tab UI, notifications, multi-session handling
- **plan-detector.js**: Detects Claude plan mode and provides approval UI
- **agent-tracker.js**: Detects and tracks sub-agent activity from terminal output
- **splits.js**: Split view for side-by-side terminals
- **service-worker.js**: PWA support for offline capabilities

### WebSocket Protocol

**SDK Mode (Chat UI):**
- `create_session`: Initialize new session
- `join_session`: Connect to existing session
- `start_sdk`: Start SDK mode in session (options: model, dangerouslySkipPermissions, resumeSessionId)
- `sdk_prompt`: Send a user prompt (options: model)
- Server responds with: `sdk_started`, `sdk_processing`, `sdk_message`, `sdk_done`, `sdk_error`

**PTY Mode (Terminal UI):**
- `start_claude` / `start_codex` / `start_agent`: Launch CLI agent in session
- `input`: Send raw terminal input
- `resize`: Adjust terminal dimensions
- `stop`: Terminate the running agent
- `get_usage`: Request usage statistics
- `ping/pong`: Heartbeat

Messages without a valid `type` string field are rejected with an error response.

### Security Features
- Path validation to prevent directory traversal
- Explicit option whitelisting for startSession (only dangerouslySkipPermissions, cols, rows)
- DOM XSS prevention: user-controlled data uses textContent/createElement, not innerHTML
- HTTPS support with async SSL certificate loading

## Key Implementation Details

- CLI discovery attempts multiple paths including ~/.claude/local/claude
- Sessions persist to disk at ~/.claude-code-web/sessions.json
- Session store uses atomic writes (temp file + rename) with mkdir-before-write ordering
- SDK mode parses JSONL (one JSON object per line) from stdout
- SDK mode captures session IDs from `system` messages for resume support
- PTY output buffer maintains last 1000 lines for reconnection
- Terminal uses xterm-256color with full ANSI color support
- Folder browser restricts access to base directory and subdirectories only
- Chat UI uses simple regex-based Markdown rendering (code blocks, inline code, bold, italic)
- Mobile key toolbar (Terminal UI) provides Esc, Tab, Ctrl, arrows, Copy/Paste on touch devices
- Sub-agent tracker monitors terminal output for spawn/complete patterns (⏳, ╭──, ✓, ✗)
- Plan detector monitors for plan mode activation and extracts plan content

## File Structure

```
claude-code-web/
├── bin/cc-web.js              # CLI entry point
├── src/
│   ├── server.js              # Express server + WebSocket + routing
│   ├── sdk-session.js         # SDK mode: claude -p --output-format stream-json
│   ├── base-bridge.js         # Legacy: common PTY bridge class
│   ├── claude-bridge.js       # Legacy: Claude CLI bridge
│   ├── codex-bridge.js        # Legacy: Codex CLI bridge
│   ├── agent-bridge.js        # Legacy: Cursor Agent bridge
│   ├── usage-reader.js        # Claude usage log parser
│   ├── usage-analytics.js     # Usage analytics and predictions
│   ├── utils/
│   │   └── session-store.js   # Session persistence to disk
│   └── public/
│       ├── v2/                # Chat UI (default)
│       │   ├── index.html
│       │   ├── chat.js
│       │   └── chat.css
│       ├── index.html         # Terminal UI (legacy, served at /v1)
│       ├── app.js             # Terminal UI controller
│       ├── session-manager.js # Tab management
│       ├── plan-detector.js   # Plan mode detection
│       ├── agent-tracker.js   # Sub-agent tracking
│       ├── splits.js          # Split view
│       ├── style.css          # Terminal UI styles
│       ├── icons.js           # SVG icon helpers
│       ├── service-worker.js  # PWA support
│       └── manifest.json      # PWA manifest
├── test/                      # Unit tests
├── docs/                      # GitHub Pages site
└── package.json
```
