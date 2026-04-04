# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Subagent & Cost Optimization Rules

**Always use subagents aggressively and pick the right model for each task:**

- **Haiku** (`model: "haiku"`): File search, grep, simple lookups, listing files, reading configs, syntax checks — anything that just retrieves or confirms information.
- **Sonnet** (`model: "sonnet"`): Code exploration, codebase understanding, moderate analysis, summarizing findings, planning small features.
- **Opus** (`model: "opus"`): Complex architectural decisions, writing large implementations, multi-file refactoring, security reviews — only when deep reasoning is required.

**When to spawn subagents:**
- Any search/exploration task (use Explore agent with haiku or sonnet)
- Research questions (use claude-code-guide agent with sonnet)
- Running tests or builds (use general-purpose agent with haiku)
- Parallel independent tasks — always launch multiple agents concurrently

**Never use Opus for:**
- Simple file searches or grep operations
- Reading a file to check its contents
- Running a single command
- Looking up documentation

## Project Overview

Claude Code Web is a web-based interface for the Claude Code CLI. It provides a structured chat interface powered by `claude -p --output-format stream-json`. Messages are rendered as Markdown with tool-use cards, model selector, permission mode toggle, and cost display. Mobile-friendly by design.

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

### Execution Mode

**SDK Mode (Chat UI)**
- Client sends `start_sdk` + `sdk_prompt` WebSocket messages
- Server spawns `claude -p --output-format stream-json` via `SdkSession` (`src/sdk-session.js`)
- Output is structured JSONL: each line is a typed message (assistant, tool_use, result, etc.)
- Client renders messages as Markdown, tool cards, and cost info
- Supports `--resume`, `--continue`, `--model` flags programmatically
- Permission mode selectable in UI (Safe Mode / Bypass Permissions)

### Core Components

**Server Layer (src/server.js)**
- Express server handling REST API and WebSocket connections
- Route: `/` → Chat UI
- Session persistence via SessionStore (saves to ~/.claude-code-web/sessions.json)
- Folder mode for working directory selection
- Auto-save sessions every 30 seconds
- WebSocket message type validation
- SDK handlers: `start_sdk`, `sdk_prompt` → SdkSession
- REST routes extracted to `src/routes/api.js`
- WebSocket handlers extracted to `src/routes/websocket.js`

**SDK Session (src/sdk-session.js)**
- Spawns `claude -p --output-format stream-json` as a child process
- Parses JSONL output into structured messages
- Supports model switching, session resume/continue, permission modes
- Manages session lifecycle (start, stop, prompt sending)
- Captures SDK session IDs for resume capability

**Session Management**
- Persistent sessions survive server restarts
- Multi-browser support — same session accessible from different devices
- Session data includes: ID, name, working directory, output buffer, creation time
- Sessions auto-save and can be manually deleted
- Session IDs persisted in sessionStorage for reconnection

**Chat Client (src/public/v2/)**
- **chat.js**: WebSocket client, safe DOM-based message rendering, model selection, permission mode toggle, input handling, session persistence, reconnection with retry UI
- **chat.css**: Dark theme, responsive layout, tool cards, typing indicators
- **index.html**: Minimal HTML shell with header, message area, input bar

### WebSocket Protocol

**SDK Mode (Chat UI):**
- `create_session`: Initialize new session
- `join_session`: Connect to existing session
- `start_sdk`: Start SDK mode in session (options: model, dangerouslySkipPermissions, resumeSessionId)
- `sdk_prompt`: Send a user prompt (options: model)
- `ping/pong`: Heartbeat
- `get_usage`: Request usage statistics
- Server responds with: `sdk_started`, `sdk_processing`, `sdk_message`, `sdk_done`, `sdk_error`

Messages without a valid `type` string field are rejected with an error response.

### Security Features
- Path validation to prevent directory traversal (with trailing separator check)
- DOM XSS prevention: message rendering uses createElement/textContent, not innerHTML
- Permission mode defaults to safe; bypass requires explicit user selection
- HTTPS support with async SSL certificate loading

## Key Implementation Details

- CLI discovery attempts multiple paths including ~/.claude/local/claude
- Sessions persist to disk at ~/.claude-code-web/sessions.json
- Session store uses atomic writes (temp file + rename) with mkdir-before-write ordering
- SDK mode parses JSONL (one JSON object per line) from stdout
- SDK mode captures session IDs from `system` messages for resume support
- Folder browser restricts access to base directory and subdirectories only
- Chat UI uses safe DOM-based Markdown rendering (code blocks, inline code, bold, italic, line breaks)
- Reconnection with exponential backoff and visible retry UI on failure

## File Structure

```
claude-code-web/
├── bin/cc-web.js              # CLI entry point
├── src/
│   ├── server.js              # Express server + WebSocket + routing
│   ├── sdk-session.js         # SDK mode: claude -p --output-format stream-json
│   ├── usage-reader.js        # Claude usage log parser
│   ├── usage-analytics.js     # Usage analytics and predictions
│   ├── routes/
│   │   ├── api.js             # REST API route handlers
│   │   └── websocket.js       # WebSocket message handlers
│   ├── utils/
│   │   └── session-store.js   # Session persistence to disk
│   └── public/
│       ├── v2/                # Chat UI (default at /)
│       │   ├── index.html
│       │   ├── chat.js
│       │   └── chat.css
│       ├── service-worker.js  # PWA support
│       └── manifest.json      # PWA manifest
├── test/                      # Unit tests (sdk-session, server-alias, session-store, usage-analytics, usage-reader, validation)
├── docs/                      # GitHub Pages site
└── package.json
```
