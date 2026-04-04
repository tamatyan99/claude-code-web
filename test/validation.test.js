const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const { ClaudeCodeWebServer } = require('../src/server');
const SessionStore = require('../src/utils/session-store');

// ─────────────────────────────────────────────────────────────────────────────
// isPathWithinBase / validatePath
// ─────────────────────────────────────────────────────────────────────────────

describe('Path validation (isPathWithinBase)', function () {
  let server;

  beforeEach(function () {
    server = new ClaudeCodeWebServer({ noAuth: true });
    // Fix the base folder to a known value so tests are deterministic
    server.baseFolder = '/home/user/projects';
  });

  it('should accept a path equal to the base folder', function () {
    const result = server.validatePath('/home/user/projects');
    assert.strictEqual(result.valid, true);
  });

  it('should accept a valid subdirectory of the base folder', function () {
    const result = server.validatePath('/home/user/projects/myapp');
    assert.strictEqual(result.valid, true);
  });

  it('should accept a deeply nested subdirectory', function () {
    const result = server.validatePath('/home/user/projects/a/b/c');
    assert.strictEqual(result.valid, true);
  });

  it('should reject a path that is a prefix collision (not a real subpath)', function () {
    // /home/user/projects-evil starts with /home/user/projects but is NOT inside it
    const result = server.validatePath('/home/user/projects-evil');
    assert.strictEqual(result.valid, false);
  });

  it('should reject a sibling directory that shares a name prefix', function () {
    const result = server.validatePath('/home/user/projects-backup/secret');
    assert.strictEqual(result.valid, false);
  });

  it('should reject a path outside the base folder entirely', function () {
    const result = server.validatePath('/etc/passwd');
    assert.strictEqual(result.valid, false);
  });

  it('should reject a path that traverses above the base folder', function () {
    const result = server.validatePath('/home/user/projects/../../../etc/shadow');
    assert.strictEqual(result.valid, false);
  });

  it('should reject the parent of the base folder', function () {
    const result = server.validatePath('/home/user');
    assert.strictEqual(result.valid, false);
  });

  it('should return an error message when path is rejected', function () {
    const result = server.validatePath('/etc/passwd');
    assert.strictEqual(result.valid, false);
    assert.ok(typeof result.error === 'string' && result.error.length > 0);
  });

  it('should return valid: false and an error when path is missing', function () {
    const result = server.validatePath('');
    assert.strictEqual(result.valid, false);
    assert.ok(typeof result.error === 'string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SessionStore.getSessionMetadata — corrupted JSON handling
// ─────────────────────────────────────────────────────────────────────────────

describe('SessionStore.getSessionMetadata', function () {
  let sessionStore;
  let tempDir;

  beforeEach(async function () {
    tempDir = path.join(__dirname, 'temp-validation-sessions-' + Date.now());
    await fs.mkdir(tempDir, { recursive: true });

    sessionStore = new SessionStore();
    sessionStore.storageDir = tempDir;
    sessionStore.sessionsFile = path.join(tempDir, 'sessions.json');
  });

  afterEach(async function () {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (_) {
      // ignore cleanup errors
    }
  });

  it('should return { exists: false } when no sessions file exists', async function () {
    const meta = await sessionStore.getSessionMetadata();
    assert.strictEqual(meta.exists, false);
  });

  it('should return { exists: false } when sessions file contains invalid JSON', async function () {
    await fs.writeFile(sessionStore.sessionsFile, '{ this is not valid json !!!');
    const meta = await sessionStore.getSessionMetadata();
    assert.strictEqual(meta.exists, false);
  });

  it('should include an error string when sessions file contains invalid JSON', async function () {
    await fs.writeFile(sessionStore.sessionsFile, 'CORRUPTED');
    const meta = await sessionStore.getSessionMetadata();
    assert.ok(typeof meta.error === 'string' && meta.error.length > 0);
  });

  it('should return { exists: false } when sessions file is empty', async function () {
    await fs.writeFile(sessionStore.sessionsFile, '');
    // Empty file causes JSON.parse to throw
    const meta = await sessionStore.getSessionMetadata();
    assert.strictEqual(meta.exists, false);
  });

  it('should return metadata with exists: true for a valid sessions file', async function () {
    const data = {
      version: '1.0',
      savedAt: new Date().toISOString(),
      sessions: [{ id: 'abc', name: 'Test' }]
    };
    await fs.writeFile(sessionStore.sessionsFile, JSON.stringify(data));

    const meta = await sessionStore.getSessionMetadata();
    assert.strictEqual(meta.exists, true);
    assert.strictEqual(meta.sessionCount, 1);
    assert.strictEqual(meta.version, '1.0');
  });
});
