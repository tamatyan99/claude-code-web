# Claude Code Web Interface

A web-based interface for Claude Code CLI that can be accessed from any browser. This package allows you to run Claude Code in a terminal-like environment through your web browser, with real-time streaming and full interactivity.

## Requirements

- Node.js >= 16
- Claude/Code CLI installed and available on `PATH`
- Modern browser with WebSocket support

## Features

- **Web-based terminal** - Access Claude Code from any browser
- **Real-time streaming** - Live output with WebSocket communication
- **Terminal emulation** - Full ANSI color support and terminal features via xterm.js
- **Responsive design** - Works on desktop and mobile
- **NPX support** - Run anywhere with `npx claude-code-web`
- **Customizable** - Adjustable font size, themes, and settings
- **Multi-Session Support** - Create and manage multiple persistent Claude sessions as tabs
- **Multi-Browser Access** - Connect to the same session from different browsers/devices
- **Session Persistence** - Sessions remain active even when disconnecting
- **Output Buffering** - Reconnect and see previous output from your session
- **VS Code-Style Split View** - Drag tabs to create side-by-side terminals
- **Sub-Agent Tracking** - Real-time detection and display of sub-agent activity
- **Plan Mode Detection** - Detects Claude's plan mode and provides approval UI
- **Multi-Agent Support** - Run Claude, Codex, or Cursor Agent in any session

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
# Start with default settings (port 32352, max20 plan)
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

### HTTPS Support
```bash
# Enable HTTPS (requires SSL certificate files)
npx claude-code-web --https --cert /path/to/cert.pem --key /path/to/key.pem
```

### Development Mode
```bash
# Enable additional logging and debugging
npx claude-code-web --dev
```

### Assistant Aliases

You can customize how the assistants are labeled in the UI (for example, to display "Alice" instead of "Claude" or "R2" instead of "Codex").

Flags:
- `--claude-alias <name>`: Set the display name for Claude (default: env `CLAUDE_ALIAS` or "Claude").
- `--codex-alias <name>`: Set the display name for Codex (default: env `CODEX_ALIAS` or "Codex").
- `--agent-alias <name>`: Set the display name for Cursor Agent (default: env `AGENT_ALIAS` or "Cursor").

```bash
npx claude-code-web --claude-alias Alice --codex-alias R2

# Or via environment variables
export CLAUDE_ALIAS=Alice
export CODEX_ALIAS=R2
npx claude-code-web
```

These aliases are for display purposes only; they do not change which underlying CLI is launched.

### Running from source
```bash
# Start the server with defaults
npm start            # equivalent to: node bin/cc-web.js

# Start in dev mode with verbose logs
npm run dev          # equivalent to: node bin/cc-web.js --dev

# Run on a custom port
node bin/cc-web.js --port 8080
```

### ngrok Tunneling

Expose your local instance via ngrok:

```bash
npx claude-code-web --ngrok-auth-token <token> --ngrok-domain <domain>
```

Both `--ngrok-auth-token` and `--ngrok-domain` are required together.

## Multi-Session Features

### Creating and Managing Sessions
- **Tab Bar**: Sessions are displayed as VS Code-style tabs at the top
- **New Session**: Click `+` or press `Ctrl+T` to create a new session
- **Switch Tabs**: Click a tab, or use `Ctrl+Tab` / `Alt+1-9`
- **Close Tab**: Click `x` on a tab, or press `Ctrl+W`
- **Rename**: Double-click a tab name to rename it
- **Drag & Drop**: Reorder tabs or drag to split view

### Session Persistence
- Sessions remain active even after all browsers disconnect
- Reconnect from any device using the same server
- Output history preserved (last 1000 lines)
- Multiple users can connect to the same session simultaneously
- Auto-save every 30 seconds to `~/.claude-code-web/sessions.json`

### Use Cases
- **Remote Work**: Start a session at work, continue from home
- **Collaboration**: Share a session with team members
- **Device Switching**: Move between desktop and mobile seamlessly
- **Recovery**: Never lose work due to connection issues

## Sub-Agent Tracking

The interface automatically detects and displays sub-agent activity spawned by Claude Code CLI.

- A collapsible panel appears in the bottom-right when sub-agents are detected
- Each agent shows real-time status: spinner (running), checkmark (completed), X (failed)
- Elapsed time is displayed for each agent
- Desktop notifications are sent when sub-agents complete in background tabs
- Click the panel header to collapse/expand; use the trash icon to clear completed agents

Detected patterns include:
- Spinner indicators (`⏳ <description>`)
- Box-drawing frames (`╭── Agent: <description>`)
- Completion markers (`✓` / `✗`)

## Command Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port <number>` | Server port | 32352 |
| `--no-open` | Don't automatically open browser | false |
| `--https` | Enable HTTPS | false |
| `--cert <path>` | SSL certificate file path | none |
| `--key <path>` | SSL private key file path | none |
| `--dev` | Development mode with extra logging | false |
| `--plan <type>` | Subscription plan (pro, max5, max20) | max20 |
| `--claude-alias <name>` | Display name for Claude | Claude |
| `--codex-alias <name>` | Display name for Codex | Codex |
| `--agent-alias <name>` | Display name for Cursor Agent | Cursor |
| `--ngrok-auth-token <token>` | ngrok auth token | none |
| `--ngrok-domain <domain>` | ngrok reserved domain | none |

## How It Works

1. **Base Bridge** - Common process management layer using `node-pty` for all CLI agents
2. **CLI Bridges** - `ClaudeBridge`, `CodexBridge`, `AgentBridge` extend `BaseBridge` with agent-specific behavior
3. **WebSocket Communication** - Real-time bidirectional communication between browser and CLI
4. **Terminal Emulation** - Uses `xterm.js` for full terminal experience with ANSI colors
5. **Session Persistence** - Automatically saves and restores sessions across server restarts
6. **Sub-Agent Tracking** - Parses terminal output patterns to detect and display agent activity
7. **Plan Detection** - Monitors output for plan mode activation and provides approval UI
8. **Folder Mode** - Browse and select working directories through the web interface

## API Endpoints

### REST API
- `GET /` - Web interface
- `GET /api/health` - Server health status
- `GET /api/config` - Get server configuration
- `GET /api/sessions/list` - List all active Claude sessions
- `GET /api/sessions/persistence` - Get session persistence info
- `POST /api/sessions/create` - Create a new session
- `GET /api/sessions/:sessionId` - Get session details
- `DELETE /api/sessions/:sessionId` - Delete a session
- `GET /api/folders` - List available folders (folder mode)
- `POST /api/folders/select` - Select working directory
- `POST /api/set-working-dir` - Set working directory
- `POST /api/create-folder` - Create new folder
- `POST /api/close-session` - Close a session

### WebSocket Events
- `create_session` - Create a new Claude session
- `join_session` - Join an existing session
- `leave_session` - Leave current session
- `start_claude` / `start_codex` / `start_agent` - Start a CLI agent in current session
- `input` - Send input to the running agent
- `resize` - Resize terminal
- `stop` - Stop the running agent
- `get_usage` - Request usage statistics
- `ping/pong` - Heartbeat

## Architecture

### File Structure
```
claude-code-web/
├── bin/cc-web.js              # CLI entry point
├── src/
│   ├── server.js              # Express server + WebSocket handling
│   ├── base-bridge.js         # Common bridge class for CLI process management
│   ├── claude-bridge.js       # Claude CLI bridge (extends BaseBridge)
│   ├── codex-bridge.js        # Codex CLI bridge (extends BaseBridge)
│   ├── agent-bridge.js        # Cursor Agent bridge (extends BaseBridge)
│   ├── usage-reader.js        # Claude usage log parser
│   ├── usage-analytics.js     # Usage analytics and predictions
│   ├── utils/
│   │   └── session-store.js   # Session persistence to disk
│   └── public/                # Web interface files
│       ├── index.html         # Main HTML
│       ├── app.js             # Main interface controller
│       ├── session-manager.js # Session tab management and notifications
│       ├── plan-detector.js   # Plan mode detection from terminal output
│       ├── agent-tracker.js   # Sub-agent detection and tracking
│       ├── splits.js          # Split view (side-by-side terminals)
│       ├── icons.js           # SVG icon helpers
│       ├── style.css          # Styling
│       ├── service-worker.js  # PWA offline support
│       └── manifest.json      # PWA manifest
├── test/                      # Unit tests
└── package.json
```

### Bridge Inheritance

All CLI bridges share a common `BaseBridge` class:

```
BaseBridge (base-bridge.js)
├── ClaudeBridge  - Claude CLI with trust prompt auto-accept
├── CodexBridge   - Codex CLI with --dangerously-bypass-approvals-and-sandbox
└── AgentBridge   - Cursor Agent CLI
```

## Testing

- Framework: Mocha with Node's `assert`
- Location: tests under `test/*.test.js`
- Run tests: `npm test`
- Guidelines: write fast, isolated unit tests; avoid network and real CLI calls—mock process spawns where possible.

## Browser Compatibility

- Chrome/Chromium 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Troubleshooting

### Claude Code Not Found
Ensure Claude Code is installed and accessible:
```bash
which claude
# or
claude --version
```

### Connection Issues
- Check firewall settings for the specified port
- Verify Claude Code is properly installed
- Try running with `--dev` flag for detailed logs

### Permission Issues
- Ensure the process has permission to spawn child processes
- Check file system permissions for the working directory

## License

MIT — see the [LICENSE](LICENSE) file.

## Contributing

Contributions welcome! See [CONTRIBUTING](CONTRIBUTING.md) for guidelines on development, testing, and pull requests.

## Support

For issues and feature requests, please use the GitHub issue tracker.
