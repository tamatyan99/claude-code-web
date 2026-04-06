const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * Register all REST API route handlers on the Express app.
 * @param {object} server - The ClaudeCodeWebServer instance
 */
function registerApiRoutes(server) {
  const app = server.app;

  // Serve manifest.json with correct MIME type
  app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json');
    res.sendFile(path.join(__dirname, '..', 'public', 'manifest.json'));
  });

  // Default: v2 Chat UI at /
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'v2', 'index.html'));
  });
  app.use('/v2', require('express').static(path.join(__dirname, '..', 'public', 'v2')));

  // Legacy terminal UI at /v1
  app.get('/v1', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });
  app.use('/v1', require('express').static(path.join(__dirname, '..', 'public')));

  // Static assets from public/ (icons, manifest, service-worker, etc.)
  app.use(require('express').static(path.join(__dirname, '..', 'public')));

  // PWA Icon routes - generate icons dynamically
  const iconSizes = [16, 32, 144, 180, 192, 512];
  iconSizes.forEach(size => {
    app.get(`/icon-${size}.png`, (req, res) => {
      const svg = `
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${size}" height="${size}" fill="#1a1a1a" rx="${size * 0.1}"/>
          <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
                font-family="monospace" font-size="${size * 0.4}px" font-weight="bold" fill="#ff6b00">
            CC
          </text>
        </svg>
      `;
      const svgBuffer = Buffer.from(svg);
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.send(svgBuffer);
    });
  });

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      claudeSessions: server.claudeSessions.size,
      activeConnections: server.webSocketConnections.size
    });
  });

  // Get session persistence info
  app.get('/api/sessions/persistence', async (req, res) => {
    const metadata = await server.sessionStore.getSessionMetadata();
    res.json({
      ...metadata,
      currentSessions: server.claudeSessions.size,
      autoSaveEnabled: true,
      autoSaveInterval: 30000
    });
  });

  // List all Claude sessions
  app.get('/api/sessions/list', (req, res) => {
    const sessionList = Array.from(server.claudeSessions.entries()).map(([id, session]) => ({
      id,
      name: session.name,
      created: session.created,
      active: session.active,
      workingDir: session.workingDir,
      connectedClients: session.connections.size,
      lastActivity: session.lastActivity,
      sdkSessionId: server.sdkSession?.getSession(id)?.sdkSessionId || null
    }));
    res.json({ sessions: sessionList });
  });

  // Create a new session
  app.post('/api/sessions/create', (req, res) => {
    const { name, workingDir } = req.body;
    const sessionId = uuidv4();

    // Validate working directory if provided
    let validWorkingDir = server.baseFolder;
    if (workingDir) {
      const validation = server.validatePath(workingDir);
      if (!validation.valid) {
        return res.status(403).json({
          error: validation.error,
          message: 'Cannot create session with working directory outside the allowed area'
        });
      }
      validWorkingDir = validation.path;
    } else if (server.selectedWorkingDir) {
      validWorkingDir = server.selectedWorkingDir;
    }

    const session = {
      id: sessionId,
      name: name || `Session ${new Date().toLocaleString()}`,
      created: new Date(),
      lastActivity: new Date(),
      active: false,
      agent: null,
      workingDir: validWorkingDir,
      connections: new Set(),
      outputBuffer: [],
      maxBufferSize: 1000
    };

    server.claudeSessions.set(sessionId, session);

    // Save sessions after creating new one
    server.saveSessionsToDisk();

    if (server.dev) {
      console.log(`Created new session: ${sessionId} (${session.name})`);
    }

    res.json({
      success: true,
      sessionId,
      session: {
        id: sessionId,
        name: session.name,
        workingDir: session.workingDir
      }
    });
  });

  // Get session details
  app.get('/api/sessions/:sessionId', (req, res) => {
    const session = server.claudeSessions.get(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
      id: session.id,
      name: session.name,
      created: session.created,
      active: session.active,
      workingDir: session.workingDir,
      connectedClients: session.connections.size,
      lastActivity: session.lastActivity
    });
  });

  // Delete a Claude session
  app.delete('/api/sessions/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    const session = server.claudeSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Stop running process if active
    if (session.active) {
      server.stopAgentByType(sessionId, session.agent);
    }

    // Disconnect all WebSocket connections for this session
    const WebSocket = require('ws');
    session.connections.forEach(wsId => {
      const wsInfo = server.webSocketConnections.get(wsId);
      if (wsInfo && wsInfo.ws.readyState === WebSocket.OPEN) {
        wsInfo.ws.send(JSON.stringify({
          type: 'session_deleted',
          message: 'Session has been deleted'
        }));
        wsInfo.ws.close();
      }
    });

    server.claudeSessions.delete(sessionId);

    // Save sessions after deletion
    server.saveSessionsToDisk();

    res.json({ success: true, message: 'Session deleted' });
  });

  app.get('/api/config', (req, res) => {
    res.json({
      folderMode: server.folderMode,
      selectedWorkingDir: server.selectedWorkingDir,
      baseFolder: server.baseFolder,
      aliases: server.aliases
    });
  });

  app.post('/api/create-folder', (req, res) => {
    const { parentPath, folderName } = req.body;

    if (!folderName || !folderName.trim()) {
      return res.status(400).json({ message: 'Folder name is required' });
    }

    if (folderName.includes('/') || folderName.includes('\\')) {
      return res.status(400).json({ message: 'Invalid folder name' });
    }

    const basePath = parentPath || server.baseFolder;
    const fullPath = path.join(basePath, folderName);

    // Validate that the parent path and resulting path are within base folder
    const parentValidation = server.validatePath(basePath);
    if (!parentValidation.valid) {
      return res.status(403).json({
        message: 'Cannot create folder outside the allowed area'
      });
    }

    const fullValidation = server.validatePath(fullPath);
    if (!fullValidation.valid) {
      return res.status(403).json({
        message: 'Cannot create folder outside the allowed area'
      });
    }

    try {
      // Check if folder already exists
      if (fs.existsSync(fullValidation.path)) {
        return res.status(409).json({ message: 'Folder already exists' });
      }

      // Create the folder
      fs.mkdirSync(fullValidation.path, { recursive: true });

      res.json({
        success: true,
        path: fullValidation.path,
        message: `Folder "${folderName}" created successfully`
      });
    } catch (error) {
      console.error('Failed to create folder:', error);
      res.status(500).json({
        message: `Failed to create folder: ${error.message}`
      });
    }
  });

  app.get('/api/folders', (req, res) => {
    const requestedPath = req.query.path || server.baseFolder;

    // Validate the requested path
    const validation = server.validatePath(requestedPath);
    if (!validation.valid) {
      return res.status(403).json({
        error: validation.error,
        message: 'Access to this directory is not allowed'
      });
    }

    const currentPath = validation.path;

    try {
      const items = fs.readdirSync(currentPath, { withFileTypes: true });
      const folders = items
        .filter(item => item.isDirectory())
        .filter(item => !item.name.startsWith('.') || req.query.showHidden === 'true')
        .map(item => ({
          name: item.name,
          path: path.join(currentPath, item.name),
          isDirectory: true
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const parentDir = path.dirname(currentPath);
      const canGoUp = server.isPathWithinBase(parentDir) && parentDir !== currentPath;

      res.json({
        currentPath,
        parentPath: canGoUp ? parentDir : null,
        folders,
        home: server.baseFolder,
        baseFolder: server.baseFolder
      });
    } catch (error) {
      res.status(403).json({
        error: 'Cannot access directory',
        message: error.message
      });
    }
  });

  app.post('/api/set-working-dir', (req, res) => {
    const { path: selectedPath } = req.body;

    // Validate the path
    const validation = server.validatePath(selectedPath);
    if (!validation.valid) {
      return res.status(403).json({
        error: validation.error,
        message: 'Cannot set working directory outside the allowed area'
      });
    }

    const validatedPath = validation.path;

    try {
      if (!fs.existsSync(validatedPath)) {
        return res.status(404).json({ error: 'Directory does not exist' });
      }

      const stats = fs.statSync(validatedPath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Path is not a directory' });
      }

      server.selectedWorkingDir = validatedPath;
      res.json({
        success: true,
        workingDir: server.selectedWorkingDir
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to set working directory',
        message: error.message
      });
    }
  });

  app.post('/api/folders/select', (req, res) => {
    try {
      const { path: selectedPath } = req.body;

      // Validate the path
      const validation = server.validatePath(selectedPath);
      if (!validation.valid) {
        return res.status(403).json({
          error: validation.error,
          message: 'Cannot select directory outside the allowed area'
        });
      }

      const validatedPath = validation.path;

      // Verify the path exists and is a directory
      if (!fs.existsSync(validatedPath) || !fs.statSync(validatedPath).isDirectory()) {
        return res.status(400).json({
          error: 'Invalid directory path'
        });
      }

      // Store the selected working directory
      server.selectedWorkingDir = validatedPath;

      res.json({
        success: true,
        workingDir: server.selectedWorkingDir
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to set working directory',
        message: error.message
      });
    }
  });

  app.post('/api/close-session', (req, res) => {
    try {
      // Clear the selected working directory
      server.selectedWorkingDir = null;

      res.json({
        success: true,
        message: 'Working directory cleared'
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to clear working directory',
        message: error.message
      });
    }
  });

  // Rename a session
  app.patch('/api/sessions/:sessionId', (req, res) => {
    const session = server.claudeSessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const name = (req.body.name || '').trim().substring(0, 100);
    if (name) session.name = name;
    server.saveSessionsToDisk();
    res.json({ success: true, name: session.name });
  });

  // File tree (depth-limited, hidden files excluded)
  app.get('/api/files/tree', (req, res) => {
    const requestedPath = req.query.path || server.selectedWorkingDir || server.baseFolder;
    const maxDepth = Math.min(parseInt(req.query.depth) || 3, 5);

    const validation = server.validatePath(requestedPath);
    if (!validation.valid) {
      return res.status(403).json({ error: 'Access denied' });
    }

    function buildTree(dirPath, depth) {
      if (depth <= 0) return [];
      try {
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        return items
          .filter(item => !item.name.startsWith('.'))
          .sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
          })
          .map(item => {
            const fullPath = path.join(dirPath, item.name);
            if (item.isDirectory()) {
              return { name: item.name, path: fullPath, type: 'dir', children: buildTree(fullPath, depth - 1) };
            }
            return { name: item.name, path: fullPath, type: 'file' };
          });
      } catch {
        return [];
      }
    }

    res.json({ path: validation.path, tree: buildTree(validation.path, maxDepth) });
  });

  // File content (500KB limit, binary detection, blocked extensions)
  app.get('/api/files/content', (req, res) => {
    const requestedPath = req.query.path;
    if (!requestedPath) return res.status(400).json({ error: 'path required' });

    const validation = server.validatePath(requestedPath);
    if (!validation.valid) return res.status(403).json({ error: 'Access denied' });

    const BLOCKED_EXTS = new Set(['.env', '.key', '.pem', '.p12', '.pfx', '.crt', '.cer']);
    const ext = path.extname(validation.path).toLowerCase();
    if (BLOCKED_EXTS.has(ext)) return res.status(403).json({ error: 'File type not allowed' });

    try {
      const stats = fs.statSync(validation.path);
      if (stats.isDirectory()) return res.status(400).json({ error: 'Path is a directory' });

      const MAX_SIZE = 500 * 1024;
      const buf = fs.readFileSync(validation.path);

      // Binary detection: null bytes in first 8000 bytes
      const sample = buf.slice(0, 8000);
      for (let i = 0; i < sample.length; i++) {
        if (sample[i] === 0) {
          return res.json({ binary: true, name: path.basename(validation.path), size: stats.size });
        }
      }

      const truncated = buf.length > MAX_SIZE;
      const content = truncated ? buf.slice(0, MAX_SIZE).toString('utf8') : buf.toString('utf8');
      res.json({ content, name: path.basename(validation.path), size: stats.size, truncated });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Git status for working directory
  app.get('/api/git/status', (req, res) => {
    const requestedPath = req.query.path || server.selectedWorkingDir || server.baseFolder;
    const validation = server.validatePath(requestedPath);
    if (!validation.valid) return res.status(403).json({ error: 'Access denied' });

    const { execSync } = require('child_process');
    try {
      const opts = { cwd: validation.path, timeout: 5000 };
      const branch = execSync('git branch --show-current', opts).toString().trim();
      const status = execSync('git status --short', opts).toString().trim();
      const log = execSync('git log --oneline -5', opts).toString().trim();
      res.json({ branch, status, log, isGitRepo: true, path: validation.path });
    } catch {
      res.json({ isGitRepo: false, path: validation.path });
    }
  });
}

module.exports = { registerApiRoutes };
