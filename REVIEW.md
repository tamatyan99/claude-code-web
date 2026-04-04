# Comprehensive Code Review Report

**Date**: 2026-04-04
**Scope**: Full codebase review — server, client, tests, documentation

---

## Executive Summary

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Security | 3 | 5 | 5 | 2 | 15 |
| Bugs | 0 | 5 | 7 | 4 | 16 |
| Code Quality | 0 | 0 | 5 | 6 | 11 |
| Performance | 0 | 0 | 4 | 4 | 8 |
| UX | 0 | 1 | 2 | 2 | 5 |
| Testing | 0 | 1 | 0 | 0 | 1 |
| **Total** | **3** | **12** | **23** | **18** | **56** |

---

## 1. CRITICAL Issues (Must Fix)

### 1.1 No WebSocket Authentication
- **File**: `src/server.js:537-619`
- **Description**: WebSocket connections have zero authentication. Anyone who can reach the server can create sessions, join existing sessions, and send commands to running CLI agents.
- **Fix**: Implement token-based authentication for WebSocket connections (e.g., shared secret as query parameter, verified on connection).

### 1.2 Unrestricted CORS
- **File**: `src/server.js:134`
- **Description**: `this.app.use(cors())` enables CORS for all origins. Any website can make requests to the server, including session management APIs.
- **Fix**: Configure CORS with a specific origin whitelist or restrict to localhost.

### 1.3 `innerHTML` with `renderMarkdown` in Chat UI
- **File**: `src/public/v2/chat.js:274`
- **Description**: `content.innerHTML = this.renderMarkdown(text)` uses regex-based Markdown rendering. While `escapeHtml` is called first, the subsequent regex replacements re-introduce raw HTML tags. The approach is fragile — if escape logic changes or a new replacement is added, this becomes exploitable.
- **Fix**: Use a proper Markdown library (e.g., `marked` + DOMPurify), or build the DOM with `textContent`/`createElement`.

---

## 2. HIGH Severity Issues

### 2.1 Security

#### Default Permission Bypass in SDK Session
- **File**: `src/sdk-session.js:102`
- **Description**: `const permMode = options.permissionMode || 'bypassPermissions'` defaults to bypassing all permissions. Any prompt sent without an explicit mode runs with full unrestricted access.
- **Fix**: Change default to `'default'`.

#### `dangerouslySkipPermissions: true` Hardcoded in Chat UI
- **File**: `src/public/v2/chat.js:98`
- **Description**: SDK mode always starts with `dangerouslySkipPermissions: true`, not user-configurable.
- **Fix**: Add a user-facing toggle or default to `false`.

#### `innerHTML` in `showSessionSelectionModal`
- **File**: `src/public/app.js:624-656`
- **Description**: `session.id` is injected into `data-session-id` attribute without escaping. If session IDs contain quotes, this breaks out of the attribute.
- **Fix**: Escape `session.id` for HTML attribute context, or build DOM programmatically.

#### `innerHTML` in `renderMobileSessionList`
- **File**: `src/public/app.js:1736-1748`
- **Description**: Uses `innerHTML` with template literals. Raw SVG icon strings from `window.icons` are injected.
- **Fix**: Build session list items using `createElement`/`textContent`.

#### Prompt Logged to Console
- **File**: `src/sdk-session.js:105`
- **Description**: Full user prompt logged to stdout. Could leak sensitive information (API keys, passwords) in logs.
- **Fix**: Truncate or redact prompt from log output.

### 2.2 Bugs

#### Race Condition in `startClaudeSession` — 500ms setTimeout Hack
- **File**: `src/public/app.js:1107-1175`
- **Description**: After `create_session`, a `setTimeout(500)` is used before sending `start_claude`. If session creation takes longer, the start command fails silently.
- **Fix**: Wait for `session_created` message before sending start command.

#### Unguarded `JSON.parse` on WebSocket Messages
- **Files**: `src/public/v2/chat.js:59`, `src/public/app.js:818`
- **Description**: `JSON.parse(event.data)` called without try/catch. Malformed data from server will throw uncaught exception, breaking all subsequent message processing.
- **Fix**: Wrap in try/catch.

#### `hamburgerBtn` Element Doesn't Exist
- **File**: `src/public/app.js:1181-1193`
- **Description**: `document.getElementById('hamburgerBtn')` returns null. Calling `.classList.toggle()` on null throws TypeError.
- **Fix**: Add null checks or remove dead code.

#### Duplicate Signal Handlers Causing Double Shutdown
- **File**: `src/server.js:79-81` + `bin/cc-web.js:141-142`
- **Description**: Both `setupAutoSave()` and `bin/cc-web.js` register SIGINT/SIGTERM handlers. Server's `handleShutdown()` calls `process.exit(0)` before cc-web.js can clean up ngrok/HTTP.
- **Fix**: Register shutdown handlers in one place.

#### Wrong Bridge Used for Session Deletion
- **File**: `src/server.js:294-296`
- **Description**: `this.claudeBridge.stopSession(sessionId)` is always called regardless of which agent (codex/agent) is running.
- **Fix**: Check `session.agent` and call the appropriate bridge.

### 2.3 UX

#### No Reconnection Feedback in Chat UI
- **File**: `src/public/v2/chat.js:62-69`
- **Description**: After `maxReconnectAttempts` (5), reconnection stops silently. The status dot turns red but no retry button or error message is shown.
- **Fix**: Show error message with manual retry button.

### 2.4 Testing

#### Extremely Low Test Coverage (~17% of source files)
- Only 3 of 18 source files have tests, and those are superficial
- **Zero test coverage** on: WebSocket handling, SdkSession, authentication, path traversal prevention, usage-reader, usage-analytics, all client-side code
- Existing tests leak side effects (signal handlers, intervals, `which` calls)
- **Fix**: Add integration tests for WebSocket protocol, SDK session lifecycle, and security features. Add `c8`/`nyc` for coverage tracking.

---

## 3. MEDIUM Severity Issues

### 3.1 Security

| File | Line | Issue |
|------|------|-------|
| `src/server.js` | 109 | Path traversal: `startsWith` without trailing separator can match `/base/folder-ext` as within `/base/folder` |
| `src/server.js` | 200-211 | `/api/sessions/list` has no authentication, exposes session metadata |
| `src/public/v2/index.html` | 5 | `user-scalable=no` prevents accessibility zoom (WCAG 1.4.4 violation) |
| `src/public/session-manager.js` | 279-303 | `innerHTML` with alias value from server `/api/config` |
| `src/public/session-manager.js` | 471-478 | `sessionId` in data attribute not escaped |

### 3.2 Bugs

| File | Line | Issue |
|------|------|-------|
| `src/server.js` | 60 | `loadPersistedSessions()` not awaited in constructor — race condition |
| `src/server.js` | 513 | Duplicate route `GET /` — dead code |
| `src/server.js` | 858-860 | Null dereference: `wsInfo.ws` accessed before null check |
| `src/base-bridge.js` | 200-211 | Timer leak: session deleted from map before process exits |
| `src/sdk-session.js` | 207-210 | Kill timeout leaks if process already exited; null process `.on('close')` throws |
| `src/sdk-session.js` | 142-144 | Message history truncation drops 200 messages at once |
| `src/public/v2/chat.js` | 195-198 | Fragile deduplication with `:last-of-type` selector |
| `src/public/session-manager.js` | 177-195 | New `AudioContext` on every notification; browser limits to ~6 |
| `src/public/session-manager.js` | 792-832 | `renameTab` doesn't persist to server |
| `src/public/app.js` | 1341-1347 | `startHeartbeat` creates interval never cleared (also dead code) |
| `src/public/app.js` | 2345-2382 | `showNotification`/`playNotificationSound` called but never defined |

### 3.3 Code Quality

| File | Line | Issue |
|------|------|-------|
| `src/server.js` | 857-1128 | `startClaude`/`startCodex`/`startAgent` are ~80 lines each of near-identical code |
| `src/public/service-worker.js` | 2-9 | Cache doesn't include v2 files; `CACHE_NAME` never changes |
| `src/public/service-worker.js` | 24 | `self.skipWaiting()` unconditional in install — conflicts with message-based activation |
| `src/usage-analytics.js` | 340-341 | `calculateConfidence` divides by factors (3) after weights already sum to 1.0 |
| `src/usage-reader.js` | 8 | Crash if `process.env.HOME` is undefined |

### 3.4 Performance

| File | Line | Issue |
|------|------|-------|
| `src/usage-reader.js` | 170-234 | `getAllTimeUsageStats` reads every JSONL file — unbounded I/O |
| `src/server.js` | 1298-1401 | `handleGetUsage` performs 4 heavy disk I/O operations per request |
| `src/public/plan-detector.js` | 59-67 | Re-joins entire buffer (up to 10K entries) on every output chunk |
| `src/public/splits.js` | 517-538 | `getData` in `dragover` always returns empty — drop zone indicator never shows |

### 3.5 UX

| File | Line | Issue |
|------|------|-------|
| `src/public/v2/chat.js` | 50-55 | New session created on every page load; no persistence/resume |
| `src/public/v2/index.html` | 25-29 | Model select uses short names (`sonnet`) — unclear if server maps to full IDs |

---

## 4. LOW Severity Issues

### Security
- `src/public/index.html:46-49` — Third-party scripts from unpkg without integrity hashes
- `src/claude-bridge.js:20-27` — Trust prompt auto-accepted; circumvents CLI safety

### Bugs
- `src/usage-reader.js:424` — Heuristic cost detection: costs >$1 incorrectly divided by 100
- `src/usage-reader.js:561` — Incorrect project path construction (uses basename only)
- `src/usage-reader.js:828-829` — Duplicate dedup uses timestamp only
- `src/public/v2/chat.js:265` — Dead variable `last` in `appendAssistantMessage`

### Code Quality
- `src/public/style.css:66` — CSS comment uses `#` instead of `/* */`
- `src/public/v2/chat.js:375` + `src/public/app.js:42` — Duplicate `escapeHtml` implementations
- `src/public/app.js:800,1780` — Duplicate `loadSessions` methods with separate state
- `src/claude-bridge.js:16` — `_trustPromptHandled` Set never cleaned up
- `src/usage-reader.js:633-637` — `getSessionUsage` always returns null (dead code)
- `package.json:42` — Placeholder `"author": "Your Name"`

### Performance
- `src/public/splits.js:286-303` — `mousemove`/`mouseup` listeners on document never removed
- `src/public/app.js:98-100` — Resize listener has no debounce
- `src/public/app.js:181` — `touchstart` with `passive: false` degrades scroll performance
- `src/usage-reader.js:250` — `entries.push(...fileEntries)` may stack overflow with large datasets

### UX
- `src/public/session-manager.js:515-519` — `Ctrl+W` overrides browser close-tab
- `src/public/session-manager.js:509-512` — `Ctrl+T` overrides browser new-tab

---

## 5. Documentation Issues

| Location | Issue |
|----------|-------|
| `docs/index.html:124` | FAQ states "Node.js 16+" but `package.json` requires `>=18.0.0` |
| `docs/ADVANCED_ANALYTICS.md:42` | Default plan states `"claude-pro"` but server defaults to `'max20'` |
| `docs/ADVANCED_ANALYTICS.md:118` | References `src/public/app.js` as primary client, but default is now v2 Chat UI |

---

## 6. Recommended Priority Actions

### Immediate (Security-Critical)
1. Add WebSocket authentication
2. Restrict CORS origins
3. Change default `permissionMode` from `'bypassPermissions'` to `'default'`
4. Remove hardcoded `dangerouslySkipPermissions: true` from Chat UI
5. Replace `innerHTML` + regex Markdown with proper library + sanitizer

### Short-Term (Stability)
6. Fix race condition in `startClaudeSession` (replace setTimeout with event-driven)
7. Add try/catch around all `JSON.parse` on WebSocket messages
8. Fix wrong bridge used for session deletion
9. Consolidate duplicate shutdown handlers
10. Fix null dereference in `wsInfo.ws` access

### Medium-Term (Quality)
11. Extract shared `startAgentSession` method (eliminate 3x duplication)
12. Add integration tests for WebSocket protocol and SDK session
13. Configure test coverage tooling (`c8`/`nyc`)
14. Fix service worker to include v2 files and use versioned cache
15. Update stale documentation (Node.js version, default plan, primary UI)

### Long-Term (Polish)
16. Add session persistence/resume to Chat UI
17. Implement reconnection feedback UI with retry button
18. Add debouncing for resize/performance-sensitive handlers
19. Replace `innerHTML` patterns with DOM building throughout app.js
20. Add subresource integrity to third-party scripts
