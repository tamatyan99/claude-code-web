# Claude Code Web Interface

A web-based interface for Claude Code CLI accessible from any browser. Provides a structured **Chat UI** (default) and a legacy **Terminal UI**, with multi-session support, real-time streaming, and mobile optimization.

## Requirements

- Node.js >= 18
- Claude Code CLI installed and available on `PATH` (`npm install -g @anthropic-ai/claude-code`)
- Modern browser with WebSocket support

## Features

### Chat UI (default at `/`)
- **Structured chat interface** — Messages rendered as Markdown with syntax-highlighted code blocks
- **Tool use cards** — File edits, bash commands, searches displayed as expandable cards
- **Model selector** — Switch between Opus, Sonnet, Haiku from dropdown
- **Cost display** — Real-time cost tracking from SDK output
- **Session resume** — Supports `--resume` and `--continue` via SDK
- **Mobile-first** — Standard text input, no terminal emulation needed

### Terminal UI (legacy at `/v1`)
- **Web-based terminal** — Full ANSI color support via xterm.js
- **VS Code-style split view** — Drag tabs to create side-by-side terminals
- **Sub-agent tracking** — Real-time detection and display of sub-agent activity
- **Plan mode detection** — Detects Claude's plan mode and provides approval UI
- **Mobile key toolbar** — Esc, Tab, Ctrl, arrows, Copy/Paste buttons for touch devices
- **Multi-agent support** — Run Claude, Codex, or Cursor Agent in any session

### Shared Features
- **Multi-session support** — Create and manage multiple persistent sessions as tabs
- **Multi-browser access** — Connect to the same session from different browsers/devices
- **Session persistence** — Sessions remain active even when disconnecting
- **Output buffering** — Reconnect and see previous output from your session
- **PWA support** — Installable as a Progressive Web App
- **Responsive design** — Works on desktop and mobile

## Installation

### Global Installation
```bash
npm install -g claude-code-web
```

### NPX (No installation required)
```bash
npx claude-code-web
```

### Local Development (from source)
```bash
git clone <repository>
cd claude-code-web
npm install
npm run dev            # starts with debug logging
```

## Usage

### Basic Usage
```bash
# Start with default settings (port 32352)
npx claude-code-web

# Specify a subscription plan
npx claude-code-web --plan pro    # 19k tokens, $18 limit
npx claude-code-web --plan max5   # 88k tokens, $35 limit
npx claude-code-web --plan max20  # 220k tokens, $140 limit (default)

# Specify a custom port
npx claude-code-web --port 8080

# Don't automatically open browser
npx claude-code-web --no-open
```

### Accessing the UIs
```
http://localhost:32352/     # Chat UI (default)
http://localhost:32352/v1   # Terminal UI (legacy)
http://localhost:32352/v2   # Chat UI (alias)
```

### HTTPS Support
```bash
npx claude-code-web --https --cert /path/to/cert.pem --key /path/to/key.pem
```

### Development Mode
```bash
npx claude-code-web --dev
```

### Assistant Aliases
```bash
npx claude-code-web --claude-alias Alice --codex-alias R2

# Or via environment variables
export CLAUDE_ALIAS=Alice
export CODEX_ALIAS=R2
npx claude-code-web
```

### ngrok Tunneling
```bash
npx claude-code-web --ngrok-auth-token <token> --ngrok-domain <domain>
```

## How It Works

### Chat UI (SDK Mode)
1. Client sends `sdk_prompt` via WebSocket with the user's message
2. Server spawns `claude -p --output-format stream-json` as a child process
3. CLI outputs structured JSONL (one JSON object per line)
4. Server parses and broadcasts typed messages (`assistant`, `tool_use`, `result`, etc.)
5. Client renders messages as Markdown, tool cards, and cost info
6. Session IDs captured from SDK for resume/continue support

### Terminal UI (PTY Mode)
1. Server spawns Claude CLI via `node-pty` (pseudo-terminal)
2. Raw ANSI output is streamed to the browser via WebSocket
3. Client renders output using `xterm.js` terminal emulator
4. Client-side detectors parse output for plan mode and sub-agent activity

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Chat UI (/)         │  Terminal UI (/v1)           │
│  Markdown + Cards    │  xterm.js                    │
└──────────┬───────────┴──────────┬───────────────────┘
           │ WebSocket            │ WebSocket
┌──────────▼──────────────────────▼───────────────────┐
│  Express + WebSocket Server (src/server.js)         │
│  Session management, REST API, routing              │
└──────────┬──────────────────────┬───────────────────┘
           │                      │
┌──────────▼─────────┐  ┌────────▼────────────────────┐
│  SdkSession        │  │  BaseBridge (node-pty)      │
│  (sdk-session.js)  │  │  ├── ClaudeBridge           │
│  claude -p         │  │  ├── CodexBridge            │
│  --output-format   │  │  └── AgentBridge            │
│  stream-json       │  │                              │
└────────────────────┘  └──────────────────────────────┘
```

### File Structure
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
│       ├── index.html         # Terminal UI (legacy)
│       ├── app.js             # Terminal UI controller
│       ├── session-manager.js # Tab management
│       ├── plan-detector.js   # Plan mode detection
│       ├── agent-tracker.js   # Sub-agent tracking
│       ├── splits.js          # Split view
│       └── style.css          # Terminal UI styles
├── test/                      # Unit tests
├── docs/                      # GitHub Pages site
└── package.json
```

## WebSocket Protocol

### SDK Mode (Chat UI)
| Client → Server | Description |
|-----------------|-------------|
| `create_session` | Create new session |
| `join_session` | Join existing session |
| `start_sdk` | Start SDK mode (options: model, dangerouslySkipPermissions, resumeSessionId) |
| `sdk_prompt` | Send user prompt (options: model) |

| Server → Client | Description |
|-----------------|-------------|
| `sdk_started` | SDK session ready |
| `sdk_processing` | Processing started |
| `sdk_message` | Structured message (assistant text, tool_use, result, etc.) |
| `sdk_done` | Processing complete |
| `sdk_error` | Error occurred |

### PTY Mode (Terminal UI)
| Client → Server | Description |
|-----------------|-------------|
| `start_claude` / `start_codex` / `start_agent` | Launch CLI agent |
| `input` | Send terminal input |
| `resize` | Resize terminal |
| `stop` | Stop running agent |
| `get_usage` | Request usage stats |

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Chat UI |
| GET | `/v1` | Terminal UI (legacy) |
| GET | `/api/health` | Server health status |
| GET | `/api/config` | Server configuration |
| GET | `/api/sessions/list` | List all sessions |
| POST | `/api/sessions/create` | Create new session |
| GET | `/api/sessions/:id` | Session details |
| DELETE | `/api/sessions/:id` | Delete session |
| GET | `/api/folders` | List directories |
| POST | `/api/folders/select` | Select working directory |

## Command Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port <number>` | Server port | 32352 |
| `--no-open` | Don't auto-open browser | false |
| `--https` | Enable HTTPS | false |
| `--cert <path>` | SSL certificate path | none |
| `--key <path>` | SSL private key path | none |
| `--dev` | Development mode | false |
| `--plan <type>` | Subscription plan (pro, max5, max20) | max20 |
| `--claude-alias <name>` | Display name for Claude | Claude |
| `--codex-alias <name>` | Display name for Codex | Codex |
| `--agent-alias <name>` | Display name for Cursor Agent | Cursor |
| `--ngrok-auth-token <token>` | ngrok auth token | none |
| `--ngrok-domain <domain>` | ngrok reserved domain | none |

## Testing

- Framework: Mocha with Node's `assert`
- Location: `test/*.test.js`
- Run: `npm test`

## Browser Compatibility

- Chrome/Chromium 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Troubleshooting

### Claude Code Not Found
```bash
which claude
claude --version
```

### Connection Issues
- Check firewall settings for the specified port
- Try `--dev` flag for detailed logs

## License

MIT — see the [LICENSE](LICENSE) file.

## Contributing

Contributions welcome! See [CONTRIBUTING](CONTRIBUTING.md) for guidelines.
