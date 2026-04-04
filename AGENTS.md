# Repository Guidelines

## Project Structure & Module Organization
- `bin/cc-web.js`: CLI entry; parses flags and starts the server.
- `src/server.js`: Express + WebSocket server, routes, session wiring. Routes: `/` → Chat UI, `/v1` → Terminal UI.
- `src/sdk-session.js`: SDK mode — spawns `claude -p --output-format stream-json`, parses JSONL output into structured messages. Handles model switching, session resume/continue.
- `src/base-bridge.js`, `src/claude-bridge.js`, `src/codex-bridge.js`, `src/agent-bridge.js`: Legacy PTY mode — spawn and manage CLI sessions via node-pty.
- `src/usage-reader.js`, `src/usage-analytics.js`: Usage tracking and cost analytics.
- `src/utils/session-store.js`: Session persistence to `~/.claude-code-web/sessions.json`.
- `src/public/v2/`: Chat UI assets (default at `/`). Files: `index.html`, `chat.js`, `chat.css`.
- `src/public/`: Terminal UI assets (legacy at `/v1`). Files: `index.html`, `app.js`, `session-manager.js`, `plan-detector.js`, `agent-tracker.js`, `splits.js`, `style.css`.
- `test/*.test.js`: Mocha unit tests.

## Two Execution Modes
- **SDK Mode (Chat UI)**: WebSocket messages `start_sdk` and `sdk_prompt` → `SdkSession` spawns `claude -p --output-format stream-json` → structured JSONL messages → client renders Markdown + tool cards.
- **PTY Mode (Terminal UI)**: WebSocket messages `start_claude`/`input` → `BaseBridge` spawns CLI via node-pty → raw ANSI output → client renders via xterm.js.

## Build, Test, and Development Commands
- `npm install`: install dependencies (Node 18+ required).
- `npm run dev`: start locally with debug logging.
- `npm start`: start the web server.
- `npm test`: run Mocha tests in `test/*.test.js`.
- Custom port: `node bin/cc-web.js --port 8080`.

## Coding Style & Naming Conventions
- Language: Node.js (CommonJS). Indentation: 2 spaces; use semicolons; prefer single quotes.
- Files: kebab-case for modules (e.g., `sdk-session.js`), PascalCase for classes, camelCase for functions/variables.
- Tests: name as `*.test.js` colocated under `test/`.
- No linters/formatters configured; match existing style and keep diffs minimal.

## Testing Guidelines
- Framework: Mocha with Node's `assert`.
- Location: `test/` directory; name tests `name.test.js`.
- Running: `npm test`.
- Write fast, isolated unit tests; avoid network and real CLI calls — mock process spawns where possible.

## Commit & Pull Request Guidelines
- Commits: follow Conventional Commits (e.g., `feat:`, `fix:`, `chore(release): vX.Y.Z`).
- PRs: concise description, linked issues, screenshots/GIFs for UI changes.
- Add or update tests for behavior changes; update README/CLAUDE.md when flags, routes, or defaults change.

## Security & Configuration
- HTTPS: prefer `--https --cert <path> --key <path>` for production.
- Dependencies: ensure Claude Code CLI is installed and on PATH; respect `engines.node >= 18`.
- Path validation prevents directory traversal in folder browser.
