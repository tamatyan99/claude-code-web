# Contributing to Claude Code Web

Thanks for your interest in contributing! This guide covers setup, development, testing, and PR workflow.

## Project Structure

- `bin/cc-web.js`: CLI entry; parses flags and starts the server.
- `src/server.js`: Express + WebSocket server, routes (`/` → Chat UI, `/v1` → Terminal UI), session wiring.
- `src/sdk-session.js`: SDK mode — spawns `claude -p --output-format stream-json`, parses JSONL.
- `src/base-bridge.js`, `src/claude-bridge.js`, `src/codex-bridge.js`, `src/agent-bridge.js`: Legacy PTY mode via `node-pty`.
- `src/public/v2/`: Chat UI assets (chat.js, chat.css, index.html).
- `src/public/`: Terminal UI assets (app.js, session-manager.js, plan-detector.js, etc.).
- `src/utils/session-store.js`: Session persistence to disk.
- `test/*.test.js`: Mocha unit tests.

## Prerequisites

- Node.js >= 18
- Claude Code CLI installed and available on `PATH`

## Getting Started

```bash
git clone <repository>
cd claude-code-web
npm install
npm run dev           # or: npm start
```

- Dev mode: `npm run dev` (extra logging).
- Normal mode: `npm start`.
- Custom port: `node bin/cc-web.js --port 8080`.
- Access Chat UI at `http://localhost:32352/`, Terminal UI at `http://localhost:32352/v1`.

## Testing

- Framework: Mocha with Node's `assert`.
- Location: `test/` directory; name tests as `*.test.js`.
- Run: `npm test`.
- Write fast, isolated unit tests. Avoid network and real CLI calls — mock process spawns where possible.

## Coding Style

- Language: Node.js (CommonJS).
- Indentation: 2 spaces; use semicolons; prefer single quotes.
- File naming: kebab-case for modules, PascalCase for classes, camelCase for functions/variables.
- No linters/formatters configured; match existing style and keep diffs minimal.

## Commit Messages

Follow Conventional Commits:

- `feat: add session resume support`
- `fix(sdk): handle empty JSONL lines`
- `chore(release): v4.0.0`

## Pull Requests

- Keep PRs focused and narrowly scoped.
- Provide a concise description and risk/impact notes.
- Add or update tests for behavior changes.
- Update README/CLAUDE.md when flags, routes, or defaults change.
- Include screenshots/GIFs for UI-facing changes.

## Architecture Notes

The project has two execution modes:

1. **SDK Mode** (Chat UI at `/`): `SdkSession` spawns `claude -p --output-format stream-json`. Outputs structured JSONL messages. Client renders Markdown + tool cards.
2. **PTY Mode** (Terminal UI at `/v1`): `BaseBridge` spawns CLI via node-pty. Outputs raw ANSI. Client renders via xterm.js.

Both modes share the same Express server, WebSocket layer, and session management.

## Releasing

1. Ensure clean working tree on `main`.
2. Run `npm run release:pr` (or `BUMP=minor npm run release:pr`).
3. Review and merge the PR.
4. GitHub Actions will tag, create a release, and publish to npm.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
