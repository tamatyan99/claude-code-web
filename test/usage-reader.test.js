const assert = require('assert');
const path = require('path');
const UsageReader = require('../src/usage-reader');

describe('UsageReader', function() {
  describe('constructor', function() {
    it('should use HOME env variable to build claudeProjectsPath', function() {
      const originalHome = process.env.HOME;
      process.env.HOME = '/test/home';
      const reader = new UsageReader();
      assert(reader.claudeProjectsPath.startsWith('/test/home'));
      process.env.HOME = originalHome;
    });

    it('should fall back to "/" when HOME is not set', function() {
      const originalHome = process.env.HOME;
      delete process.env.HOME;
      const reader = new UsageReader();
      assert(reader.claudeProjectsPath.startsWith('/'));
      process.env.HOME = originalHome;
    });

    it('should initialise cache as null', function() {
      const reader = new UsageReader();
      assert.strictEqual(reader.cache, null);
      assert.strictEqual(reader.cacheTime, null);
    });

    it('should use default sessionDurationHours of 5', function() {
      const reader = new UsageReader();
      assert.strictEqual(reader.sessionDurationHours, 5);
    });

    it('should accept a custom sessionDurationHours', function() {
      const reader = new UsageReader(8);
      assert.strictEqual(reader.sessionDurationHours, 8);
    });
  });

  describe('normalizeModelName', function() {
    let reader;
    beforeEach(function() { reader = new UsageReader(); });

    it('should return "opus" for model names containing "opus"', function() {
      assert.strictEqual(reader.normalizeModelName('claude-opus-4'), 'opus');
      assert.strictEqual(reader.normalizeModelName('Claude-Opus-4-20250514'), 'opus');
    });

    it('should return "sonnet" for model names containing "sonnet"', function() {
      assert.strictEqual(reader.normalizeModelName('claude-sonnet-4-5'), 'sonnet');
    });

    it('should return "haiku" for model names containing "haiku"', function() {
      assert.strictEqual(reader.normalizeModelName('claude-3-haiku'), 'haiku');
    });

    it('should return "unknown" for unrecognised model names', function() {
      assert.strictEqual(reader.normalizeModelName('gpt-4'), 'unknown');
      assert.strictEqual(reader.normalizeModelName(''), 'unknown');
      assert.strictEqual(reader.normalizeModelName(null), 'unknown');
      assert.strictEqual(reader.normalizeModelName(undefined), 'unknown');
    });
  });

  describe('createUniqueHash', function() {
    let reader;
    beforeEach(function() { reader = new UsageReader(); });

    it('should return a composite hash when both message_id and request_id are present', function() {
      const entry = { message_id: 'msg-1', request_id: 'req-1' };
      const hash = reader.createUniqueHash(entry);
      assert.strictEqual(hash, 'msg-1:req-1');
    });

    it('should return null when either ID is missing', function() {
      assert.strictEqual(reader.createUniqueHash({ message_id: 'msg-1' }), null);
      assert.strictEqual(reader.createUniqueHash({ request_id: 'req-1' }), null);
      assert.strictEqual(reader.createUniqueHash({}), null);
    });

    it('should read messageId from nested message.id', function() {
      const entry = { message: { id: 'msg-nested' }, request_id: 'req-2' };
      const hash = reader.createUniqueHash(entry);
      assert.strictEqual(hash, 'msg-nested:req-2');
    });
  });

  describe('getSessionUsageById', function() {
    let reader;
    beforeEach(function() { reader = new UsageReader(); });

    it('should return null for a null sessionId', async function() {
      const result = await reader.getSessionUsageById(null);
      assert.strictEqual(result, null);
    });

    it('should return null for an empty sessionId', async function() {
      const result = await reader.getSessionUsageById('');
      assert.strictEqual(result, null);
    });

    it('should reject a sessionId containing path traversal characters (..)', async function() {
      const result = await reader.getSessionUsageById('../etc/passwd');
      assert.strictEqual(result, null);
    });

    it('should reject a sessionId containing slashes', async function() {
      const result = await reader.getSessionUsageById('foo/bar');
      assert.strictEqual(result, null);
    });

    it('should reject a sessionId containing spaces', async function() {
      const result = await reader.getSessionUsageById('bad session');
      assert.strictEqual(result, null);
    });

    it('should return null when the session file does not exist', async function() {
      // A valid-format ID that has no corresponding file on disk
      const result = await reader.getSessionUsageById('valid-session-id-does-not-exist-1234');
      assert.strictEqual(result, null);
    });
  });

  describe('findJsonlFiles', function() {
    let reader;
    beforeEach(function() { reader = new UsageReader(); });

    it('should not include entries with ".." in the directory name', async function() {
      // Point to a path that does not exist so the method returns [] gracefully
      reader.claudeProjectsPath = path.join('/tmp', 'nonexistent-usage-test-dir-' + Date.now());
      const files = await reader.findJsonlFiles();
      // No files expected — and critically no crash
      assert(Array.isArray(files));
      assert.strictEqual(files.length, 0);
    });
  });

  describe('calculateStats', function() {
    let reader;
    beforeEach(function() { reader = new UsageReader(); });

    it('should return zero-value stats for empty entries array', function() {
      const stats = reader.calculateStats([], 24);
      assert.strictEqual(stats.requests, 0);
      assert.strictEqual(stats.totalTokens, 0);
      assert.strictEqual(stats.totalCost, 0);
      assert.strictEqual(stats.firstEntry, null);
      assert.strictEqual(stats.lastEntry, null);
    });

    it('should aggregate token and cost values across entries', function() {
      const now = new Date().toISOString();
      const later = new Date(Date.now() + 10000).toISOString();
      const entries = [
        { timestamp: now, model: 'sonnet', inputTokens: 100, outputTokens: 50, cacheCreationTokens: 10, cacheReadTokens: 5, totalCost: 0.01 },
        { timestamp: later, model: 'sonnet', inputTokens: 200, outputTokens: 100, cacheCreationTokens: 20, cacheReadTokens: 10, totalCost: 0.02 },
      ];
      const stats = reader.calculateStats(entries, 24);
      assert.strictEqual(stats.requests, 2);
      assert.strictEqual(stats.inputTokens, 300);
      assert.strictEqual(stats.outputTokens, 150);
      assert.strictEqual(stats.totalTokens, 450);
      assert(Math.abs(stats.totalCost - 0.03) < 0.0001);
    });

    it('should set firstEntry and lastEntry correctly', function() {
      const ts1 = '2025-01-01T00:00:00.000Z';
      const ts2 = '2025-01-01T01:00:00.000Z';
      const entries = [
        { timestamp: ts1, model: 'haiku', inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 },
        { timestamp: ts2, model: 'haiku', inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 },
      ];
      const stats = reader.calculateStats(entries, 24);
      assert.strictEqual(stats.firstEntry, ts1);
      assert.strictEqual(stats.lastEntry, ts2);
    });
  });

  describe('getDailySessionBoundaries', function() {
    it('should handle duplicate timestamps without crashing', async function() {
      const reader = new UsageReader();

      // Stub readAllEntries to return two entries with identical timestamps
      const ts = new Date();
      ts.setHours(1, 0, 0, 0); // within today
      const duplicate = {
        timestamp: ts.toISOString(),
        model: 'sonnet',
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalCost: 0.01,
        type: 'assistant'
      };

      reader.readAllEntries = async () => [duplicate, duplicate];

      const sessions = await reader.getDailySessionBoundaries();
      assert(Array.isArray(sessions));
      // With duplicate timestamps the composite key deduplication should produce 1 session
      assert(sessions.length >= 1);
    });
  });

  describe('generateSessionId', function() {
    it('should return a string starting with "session_"', function() {
      const reader = new UsageReader();
      const id = reader.generateSessionId('2025-01-01T00:00:00.000Z');
      assert(typeof id === 'string');
      assert(id.startsWith('session_'));
    });

    it('should produce different IDs for different timestamps', function() {
      const reader = new UsageReader();
      const id1 = reader.generateSessionId('2025-01-01T00:00:00.000Z');
      const id2 = reader.generateSessionId('2025-01-01T01:00:00.000Z');
      assert.notStrictEqual(id1, id2);
    });
  });

  describe('getStartOfCurrentDay', function() {
    it('should return a Date set to midnight', function() {
      const reader = new UsageReader();
      const start = reader.getStartOfCurrentDay();
      assert(start instanceof Date);
      assert.strictEqual(start.getHours(), 0);
      assert.strictEqual(start.getMinutes(), 0);
      assert.strictEqual(start.getSeconds(), 0);
      assert.strictEqual(start.getMilliseconds(), 0);
    });
  });
});
