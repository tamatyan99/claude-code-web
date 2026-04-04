# Claude Code Web Interface

A web-based Chat UI for the Claude Code CLI, accessible from any browser. Provides structured message rendering, multi-session support, real-time streaming, and mobile optimization.

## Requirements

- Node.js >= 18.0.0
- Claude Code CLI installed and available on `PATH` (`npm install -g @anthropic-ai/claude-code`)
- Modern browser with WebSocket support

## Features

- **Structured chat interface** — Messages rendered as Markdown with syntax-highlighted code blocks
- **Tool use cards** — File edits, bash commands, searches displayed as expandable cards
- **Model selector** — Switch between Opus, Sonnet, Haiku from dropdown
- **Cost display** — Real-time cost tracking from SDK output
- **Session resume** — Supports `--resume` and `--continue` via SDK
- **Multi-session support** — Create and manage multiple persistent sessions as tabs
- **Multi-browser access** — Connect to the same session from different browsers/devices
- **Session persistence** — Sessions remain active even when disconnecting
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

### Accessing the UI
```
http://localhost:32352/     # Chat UI
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

### ngrok Tunneling
```bash
npx claude-code-web --ngrok-auth-token <token> --ngrok-domain <domain>
```

## How It Works

1. Client sends `sdk_prompt` via WebSocket with the user's message
2. Server spawns `claude -p --output-format stream-json` as a child process
3. CLI outputs structured JSONL (one JSON object per line)
4. Server parses and broadcasts typed messages (`assistant`, `tool_use`, `result`, etc.)
5. Client renders messages as Markdown, tool cards, and cost info
6. Session IDs captured from SDK for resume/continue support

## Architecture

```
┌────────────────────────────────────────┐
│  Chat UI (/)                           │
│  Markdown + Tool Cards                 │
└──────────────┬─────────────────────────┘
               │ WebSocket
┌──────────────▼─────────────────────────┐
│  Express + WebSocket Server            │
│  src/server.js                         │
│  src/routes/api.js                     │
│  src/routes/websocket.js               │
│  Session management, REST API, routing │
└──────────────┬─────────────────────────┘
               │
┌──────────────▼─────────────────────────┐
│  SdkSession (src/sdk-session.js)       │
│  claude -p --output-format stream-json │
└────────────────────────────────────────┘
```

### File Structure
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
│       ├── v2/                # Chat UI
│       │   ├── index.html
│       │   ├── chat.js
│       │   └── chat.css
│       ├── manifest.json      # PWA manifest
│       └── service-worker.js  # PWA support
├── test/                      # Unit tests
│   ├── sdk-session.test.js
│   ├── server-alias.test.js
│   ├── session-store.test.js
│   ├── usage-analytics.test.js
│   ├── usage-reader.test.js
│   └── validation.test.js
├── docs/                      # GitHub Pages site
└── package.json
```

## WebSocket Protocol

### Client to Server
| Message | Description |
|---------|-------------|
| `create_session` | Create new session |
| `join_session` | Join existing session |
| `start_sdk` | Start SDK mode (options: model, dangerouslySkipPermissions, resumeSessionId) |
| `sdk_prompt` | Send user prompt (options: model) |

### Server to Client
| Message | Description |
|---------|-------------|
| `sdk_started` | SDK session ready |
| `sdk_processing` | Processing started |
| `sdk_message` | Structured message (assistant text, tool_use, result, etc.) |
| `sdk_done` | Processing complete |
| `sdk_error` | Error occurred |

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Chat UI |
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
