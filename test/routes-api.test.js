const assert = require('assert');
const http = require('http');
const { ClaudeCodeWebServer } = require('../src/server');

describe('API Routes', function() {
  let webServer;
  let httpServer;
  let port;

  before(async function() {
    webServer = new ClaudeCodeWebServer({ folderMode: false, port: 0 });
    httpServer = await webServer.start();
    port = httpServer.address().port;
  });

  after(async function() {
    await webServer.close();
  });

  function get(path) {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}${path}`, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, headers: res.headers, body: data, json: () => JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, body: data, json: () => null });
          }
        });
      }).on('error', reject);
    });
  }

  function request(method, path, body) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(JSON.stringify(body)) } : {}
      };
      const req = http.request(options, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: data, json: () => JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data, json: () => null });
          }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  describe('GET /api/health', function() {
    it('should return status ok', async function() {
      const res = await get('/api/health');
      assert.strictEqual(res.status, 200);
      const data = res.json();
      assert.strictEqual(data.status, 'ok');
      assert.strictEqual(typeof data.claudeSessions, 'number');
      assert.strictEqual(typeof data.activeConnections, 'number');
    });
  });

  describe('GET /api/sessions/list', function() {
    it('should return sessions array', async function() {
      const res = await get('/api/sessions/list');
      assert.strictEqual(res.status, 200);
      const data = res.json();
      assert(Array.isArray(data.sessions));
    });
  });

  describe('GET /api/sessions/persistence', function() {
    it('should return persistence metadata', async function() {
      const res = await get('/api/sessions/persistence');
      assert.strictEqual(res.status, 200);
      const data = res.json();
      assert.strictEqual(typeof data.currentSessions, 'number');
      assert.strictEqual(data.autoSaveEnabled, true);
    });
  });

  describe('GET /api/config', function() {
    it('should return server configuration', async function() {
      const res = await get('/api/config');
      assert.strictEqual(res.status, 200);
      const data = res.json();
      assert.strictEqual(typeof data.baseFolder, 'string');
      assert.strictEqual(typeof data.folderMode, 'boolean');
    });
  });

  describe('GET /', function() {
    it('should return HTML for the chat UI', async function() {
      const res = await get('/');
      assert.strictEqual(res.status, 200);
      assert(res.headers['content-type'].includes('html'));
      assert(res.body.includes('Claude Code'));
    });
  });

  describe('GET /manifest.json', function() {
    it('should return manifest with correct content type', async function() {
      const res = await get('/manifest.json');
      assert.strictEqual(res.status, 200);
      assert(res.headers['content-type'].includes('manifest'));
      const data = res.json();
      assert.strictEqual(data.name, 'Claude Code Web');
    });
  });

  describe('PATCH /api/sessions/:id', function() {
    it('should return 404 for non-existent session', async function() {
      const res = await request('PATCH', '/api/sessions/nonexistent', { name: 'Test' });
      assert.strictEqual(res.status, 404);
    });
  });

  describe('DELETE /api/sessions/:id', function() {
    it('should return 404 for non-existent session', async function() {
      const res = await request('DELETE', '/api/sessions/nonexistent', null);
      assert.strictEqual(res.status, 404);
    });
  });

  describe('GET /api/files/content', function() {
    it('should return 400 when path is missing', async function() {
      const res = await get('/api/files/content');
      assert.strictEqual(res.status, 400);
    });

    it('should return 403 for .env files', async function() {
      const res = await get('/api/files/content?path=' + encodeURIComponent(process.cwd() + '/.env'));
      assert.strictEqual(res.status, 403);
    });

    it('should return 403 for .env.local files', async function() {
      const res = await get('/api/files/content?path=' + encodeURIComponent(process.cwd() + '/.env.local'));
      assert.strictEqual(res.status, 403);
    });
  });

  describe('GET /api/git/status', function() {
    it('should return git status for current directory', async function() {
      const res = await get('/api/git/status?path=' + encodeURIComponent(process.cwd()));
      assert.strictEqual(res.status, 200);
      const data = res.json();
      assert.strictEqual(typeof data.isGitRepo, 'boolean');
    });
  });
});
