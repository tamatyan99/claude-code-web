# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Code Web is a web-based interface for the Claude Code CLI that enables browser-based access with multi-session support and real-time streaming capabilities. The application provides a terminal emulator interface through xterm.js with WebSocket communication for real-time interaction.

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

### Core Components

**Server Layer (src/server.js)**
- Express server handling REST API and WebSocket connections
- Session persistence via SessionStore (saves to ~/.claude-code-web/sessions.json)
- Folder mode for working directory selection
- Auto-save sessions every 30 seconds
- WebSocket message type validation

**Bridge Layer (src/base-bridge.js)**
- `BaseBridge`: Common base class for CLI process management using node-pty
- `ClaudeBridge` (src/claude-bridge.js): Claude CLI with trust prompt auto-accept
- `CodexBridge` (src/codex-bridge.js): Codex CLI
- `AgentBridge` (src/agent-bridge.js): Cursor Agent CLI
- Each bridge handles process lifecycle (start, stop, resize), output buffering, and error handling
- Callback exceptions are wrapped in try-catch to prevent server crashes

**Session Management**
- Persistent sessions survive server restarts
- Multi-browser support - same session accessible from different devices
- Session data includes: ID, name, working directory, output buffer, creation time
- Sessions auto-save and can be manually deleted

**Client Architecture (src/public/)**
- **app.js**: Main interface controller, terminal setup, WebSocket management
- **session-manager.js**: Session tab UI, notifications, multi-session handling
- **plan-detector.js**: Detects Claude plan mode and provides approval UI
- **agent-tracker.js**: Detects and tracks sub-agent activity from terminal output
- **splits.js**: Split view for side-by-side terminals
- **service-worker.js**: PWA support for offline capabilities

### WebSocket Protocol

The application uses WebSocket for real-time bidirectional communication:
- `create_session`: Initialize new Claude session
- `join_session`: Connect to existing session
- `leave_session`: Disconnect without stopping Claude
- `start_claude` / `start_codex` / `start_agent`: Launch CLI agent in session
- `input`: Send user input to the running agent
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
- Output buffer maintains last 1000 lines for reconnection
- Terminal uses xterm-256color with full ANSI color support
- Folder browser restricts access to base directory and subdirectories only
- Mobile-responsive design with touch-optimized controls
- Sub-agent tracker monitors terminal output for spawn/complete patterns (⏳, ╭──, ✓, ✗)
- Plan detector monitors for plan mode activation and extracts plan content
