const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const SdkSession = require('./sdk-session');
const SessionStore = require('./utils/session-store');
const UsageReader = require('./usage-reader');
const UsageAnalytics = require('./usage-analytics');
const { registerApiRoutes } = require('./routes/api');
const { setupWebSocketHandlers } = require('./routes/websocket');

class ClaudeCodeWebServer {
  constructor(options = {}) {
    this.port = options.port || 32352;
    this.dev = options.dev || false;
    this.useHttps = options.https || false;
    this.certFile = options.cert;
    this.keyFile = options.key;
    this.folderMode = options.folderMode !== false; // Default to true
    this.selectedWorkingDir = null;
    this.baseFolder = process.cwd(); // The folder where the app runs from
    // Session duration in hours (default to 5 hours from first message)
    this.sessionDurationHours = parseFloat(process.env.CLAUDE_SESSION_HOURS || options.sessionHours || 5) || 5;

    this.app = express();
    this.claudeSessions = new Map(); // Persistent sessions
    this.webSocketConnections = new Map(); // Maps WebSocket connection ID to session info
    this.sdkSession = new SdkSession();
    this.sessionStore = new SessionStore();
    this.usageReader = new UsageReader(this.sessionDurationHours);
    this.usageAnalytics = new UsageAnalytics({
      sessionDurationHours: this.sessionDurationHours,
      plan: options.plan || process.env.CLAUDE_PLAN || 'max20',
      customCostLimit: parseFloat(process.env.CLAUDE_COST_LIMIT || options.customCostLimit || 50.00) || 50.00
    });
    this.autoSaveInterval = null;
    this.startTime = Date.now(); // Track server start time
    this.aliases = {
      claude: options.claudeAlias || process.env.CLAUDE_ALIAS || 'Claude'
    };

    this.setupExpress();
    this.loadPersistedSessions();
    this.setupAutoSave();
  }

  async loadPersistedSessions() {
    try {
      const loaded = await this.sessionStore.loadSessions();
      if (loaded.size > 0) {
        for (const [k, v] of loaded) {
          this.claudeSessions.set(k, v);
        }
        console.log(`Loaded ${loaded.size} persisted sessions`);
      }
    } catch (error) {
      console.error('Failed to load persisted sessions:', error);
    }
  }

  setupAutoSave() {
    // Auto-save sessions every 30 seconds
    this.autoSaveInterval = setInterval(async () => {
      await this.saveSessionsToDisk();
    }, 30000);

    // Also save on process exit
    process.on('beforeExit', () => this.saveSessionsToDisk());
  }

  async saveSessionsToDisk() {
    if (this.claudeSessions.size > 0) {
      await this.sessionStore.saveSessions(this.claudeSessions);
    }
  }

  async handleShutdown() {
    // Prevent multiple shutdown attempts
    if (this.isShuttingDown) {
      return;
    }
    this.isShuttingDown = true;

    console.log('\nGracefully shutting down...');
    await this.saveSessionsToDisk();
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    this.close();
    process.exit(0);
  }

  isPathWithinBase(targetPath) {
    try {
      let resolvedTarget;
      try {
        resolvedTarget = fs.realpathSync(targetPath);
      } catch (e) {
        resolvedTarget = path.resolve(targetPath);
      }
      let resolvedBase;
      try {
        resolvedBase = fs.realpathSync(this.baseFolder);
      } catch (e) {
        resolvedBase = path.resolve(this.baseFolder);
      }
      return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + path.sep);
    } catch (error) {
      return false;
    }
  }

  validatePath(targetPath) {
    if (!targetPath) {
      return { valid: false, error: 'Path is required' };
    }

    const resolvedPath = path.resolve(targetPath);

    if (!this.isPathWithinBase(resolvedPath)) {
      return {
        valid: false,
        error: 'Access denied: Path is outside the allowed directory'
      };
    }

    return { valid: true, path: resolvedPath };
  }

  setupExpress() {
    this.app.use(cors());
    this.app.use(express.json());

    // Delegate all REST API routes to the api module
    registerApiRoutes(this);
  }

  async start() {
    let server;

    if (this.useHttps) {
      if (!this.certFile || !this.keyFile) {
        throw new Error('HTTPS requires both --cert and --key options');
      }

      const [cert, key] = await Promise.all([
        fs.promises.readFile(this.certFile),
        fs.promises.readFile(this.keyFile)
      ]);
      server = https.createServer({ cert, key }, this.app);
    } else {
      server = http.createServer(this.app);
    }

    this.wss = new WebSocket.Server({ server });

    // Delegate WebSocket handling to the websocket module
    setupWebSocketHandlers(this);

    return new Promise((resolve, reject) => {
      server.listen(this.port, (err) => {
        if (err) {
          reject(err);
        } else {
          this.server = server;
          resolve(server);
        }
      });
    });
  }

  // ─── Session Management ───

  async createAndJoinSession(wsId, name, workingDir) {
    const wsInfo = this.webSocketConnections.get(wsId);
    if (!wsInfo) return;

    // Validate working directory if provided
    let validWorkingDir = this.baseFolder;
    if (workingDir) {
      const validation = this.validatePath(workingDir);
      if (!validation.valid) {
        this.sendToWebSocket(wsInfo.ws, {
          type: 'error',
          message: 'Cannot create session with working directory outside the allowed area'
        });
        return;
      }
      validWorkingDir = validation.path;
    } else if (this.selectedWorkingDir) {
      validWorkingDir = this.selectedWorkingDir;
    }

    // Create new Claude session
    const sessionId = uuidv4();
    const session = {
      id: sessionId,
      name: name || `Session ${new Date().toLocaleString()}`,
      created: new Date(),
      lastActivity: new Date(),
      active: false,
      workingDir: validWorkingDir,
      connections: new Set([wsId]),
      outputBuffer: [],
      sessionStartTime: null, // Will be set when Claude starts
      sessionUsage: {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        totalCost: 0,
        models: {}
      },
      maxBufferSize: 1000
    };

    this.claudeSessions.set(sessionId, session);
    wsInfo.claudeSessionId = sessionId;

    // Save sessions after creating new one
    this.saveSessionsToDisk();

    this.sendToWebSocket(wsInfo.ws, {
      type: 'session_created',
      sessionId,
      sessionName: session.name,
      workingDir: session.workingDir
    });
  }

  async joinClaudeSession(wsId, claudeSessionId) {
    const wsInfo = this.webSocketConnections.get(wsId);
    if (!wsInfo) return;

    const session = this.claudeSessions.get(claudeSessionId);
    if (!session) {
      this.sendToWebSocket(wsInfo.ws, {
        type: 'error',
        message: 'Session not found'
      });
      return;
    }

    // Leave current session if any
    if (wsInfo.claudeSessionId) {
      await this.leaveClaudeSession(wsId);
    }

    // Join new session
    wsInfo.claudeSessionId = claudeSessionId;
    session.connections.add(wsId);
    session.lastActivity = new Date();
    session.lastAccessed = Date.now();

    // Send session info and replay buffer
    this.sendToWebSocket(wsInfo.ws, {
      type: 'session_joined',
      sessionId: claudeSessionId,
      sessionName: session.name,
      workingDir: session.workingDir,
      active: session.active,
      sdkSessionId: this.sdkSession?.getSession(claudeSessionId)?.sdkSessionId || null,
      outputBuffer: session.outputBuffer.slice(-200) // Send last 200 lines
    });

    if (this.dev) {
      console.log(`WebSocket ${wsId} joined Claude session ${claudeSessionId}`);
    }
  }

  async leaveClaudeSession(wsId) {
    const wsInfo = this.webSocketConnections.get(wsId);
    if (!wsInfo || !wsInfo.claudeSessionId) return;

    const session = this.claudeSessions.get(wsInfo.claudeSessionId);
    if (session) {
      session.connections.delete(wsId);
      session.lastActivity = new Date();
    }

    wsInfo.claudeSessionId = null;

    this.sendToWebSocket(wsInfo.ws, {
      type: 'session_left'
    });
  }

  // ─── SDK Chat Mode ───

  async startSdkSession(wsId, options) {
    const wsInfo = this.webSocketConnections.get(wsId);
    if (!wsInfo || !wsInfo.claudeSessionId) return;

    const sessionId = wsInfo.claudeSessionId;
    const session = this.claudeSessions.get(sessionId);
    if (!session) return;

    try {
      await this.sdkSession.startSession(sessionId, {
        workingDir: session.workingDir,
        model: options.model || null,
        permissionMode: options.dangerouslySkipPermissions ? 'bypassPermissions' : 'default',
        resumeSessionId: options.resumeSessionId || null,
      });

      session.active = true;
      session.agent = 'sdk';
      session.lastActivity = new Date();

      this.broadcastToSession(sessionId, {
        type: 'sdk_started',
        sessionId,
      });
    } catch (error) {
      this.sendToWebSocket(wsInfo.ws, {
        type: 'error',
        message: `Failed to start SDK session: ${error.message}`
      });
    }
  }

  async sendSdkPrompt(wsId, prompt, options) {
    const wsInfo = this.webSocketConnections.get(wsId);
    if (!wsInfo || !wsInfo.claudeSessionId) return;

    const sessionId = wsInfo.claudeSessionId;
    const session = this.claudeSessions.get(sessionId);
    if (!session) return;

    try {
      // Notify that processing has started
      this.broadcastToSession(sessionId, {
        type: 'sdk_processing',
        sessionId,
      });

      await this.sdkSession.sendPrompt(sessionId, prompt, {
        model: options.model || null,
        permissionMode: options.dangerouslySkipPermissions ? 'bypassPermissions' : 'default',
        onMessage: (msg) => {
          session.lastActivity = new Date();
          // Save SDK messages to outputBuffer for session replay
          const sdkMsg = { type: 'sdk_message', message: msg };
          session.outputBuffer.push(sdkMsg);
          if (session.outputBuffer.length > session.maxBufferSize) {
            session.outputBuffer = session.outputBuffer.slice(-session.maxBufferSize);
          }
          this.broadcastToSession(sessionId, sdkMsg);
        },
        onEnd: (code, signal) => {
          // Don't mark session inactive - it's still available for next prompt
          this.broadcastToSession(sessionId, {
            type: 'sdk_done',
            code,
            signal,
          });
        },
        onError: (err) => {
          this.broadcastToSession(sessionId, {
            type: 'sdk_error',
            message: err.message,
          });
        },
      });
    } catch (error) {
      this.sendToWebSocket(wsInfo.ws, {
        type: 'error',
        message: `Failed to send prompt: ${error.message}`
      });
    }
  }

  // Stop a session regardless of agent type. Used by WebSocket 'stop' handler.
  async stopAgentSession(sessionId) {
    const session = this.claudeSessions.get(sessionId);
    if (!session) return;
    await this.stopSdkSession(sessionId);
  }

  // Stop a session by agent type string. Used by REST DELETE /api/sessions/:id.
  async stopAgentByType(sessionId, agentType) {
    await this.stopAgentSession(sessionId);
  }

  async stopSdkSession(sessionId) {
    const session = this.claudeSessions.get(sessionId);
    if (!session || !session.active) return;

    if (session.agent === 'sdk') {
      this.sdkSession.stopSession(sessionId);
    }

    session.active = false;
    session.agent = null;
    session.lastActivity = new Date();

    this.broadcastToSession(sessionId, {
      type: 'sdk_done'
    });
  }

  // ─── WebSocket Utilities ───

  sendToWebSocket(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  broadcastToSession(claudeSessionId, data) {
    const session = this.claudeSessions.get(claudeSessionId);
    if (!session) return;

    session.connections.forEach(wsId => {
      const wsInfo = this.webSocketConnections.get(wsId);
      // Double-check that this WebSocket is actually part of this session
      if (wsInfo &&
          wsInfo.claudeSessionId === claudeSessionId &&
          wsInfo.ws.readyState === WebSocket.OPEN) {
        this.sendToWebSocket(wsInfo.ws, data);
      }
    });
  }

  cleanupWebSocketConnection(wsId) {
    const wsInfo = this.webSocketConnections.get(wsId);
    if (!wsInfo) return;

    // Remove from Claude session if joined
    if (wsInfo.claudeSessionId) {
      const session = this.claudeSessions.get(wsInfo.claudeSessionId);
      if (session) {
        session.connections.delete(wsId);
        session.lastActivity = new Date();

        // Don't stop Claude if other connections exist
        if (session.connections.size === 0 && this.dev) {
          console.log(`No more connections to session ${wsInfo.claudeSessionId}`);
        }
      }
    }

    this.webSocketConnections.delete(wsId);
  }

  close() {
    // Save sessions before closing
    this.saveSessionsToDisk();

    // Clear auto-save interval
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }

    if (this.wss) {
      this.wss.close();
    }
    if (this.server) {
      this.server.close();
    }

    // Stop all SDK sessions
    for (const [sessionId, session] of this.claudeSessions.entries()) {
      if (session.active && session.agent === 'sdk') {
        this.sdkSession.stopSession(sessionId);
      }
    }

    // Clear all data
    this.claudeSessions.clear();
    this.webSocketConnections.clear();
  }

  async handleGetUsage(wsInfo) {
    try {
      // Get usage stats for the current Claude session window
      const currentSessionStats = await this.usageReader.getCurrentSessionStats();

      // Get burn rate calculations
      const burnRateData = await this.usageReader.calculateBurnRate(60);

      // Get overlapping sessions
      const overlappingSessions = await this.usageReader.detectOverlappingSessions();

      // Get 24h stats for additional context
      const dailyStats = await this.usageReader.getUsageStats(24);

      // Update analytics with current session data
      if (currentSessionStats && currentSessionStats.sessionStartTime) {
        // Start tracking this session in analytics
        this.usageAnalytics.startSession(
          currentSessionStats.sessionId,
          new Date(currentSessionStats.sessionStartTime)
        );

        // Add usage data to analytics
        if (currentSessionStats.totalTokens > 0) {
          this.usageAnalytics.addUsageData({
            tokens: currentSessionStats.totalTokens,
            inputTokens: currentSessionStats.inputTokens,
            outputTokens: currentSessionStats.outputTokens,
            cacheCreationTokens: currentSessionStats.cacheCreationTokens,
            cacheReadTokens: currentSessionStats.cacheReadTokens,
            cost: currentSessionStats.totalCost,
            model: Object.keys(currentSessionStats.models)[0] || 'unknown',
            sessionId: currentSessionStats.sessionId
          });
        }
      }

      // Get comprehensive analytics
      const analytics = this.usageAnalytics.getAnalytics();

      // Calculate session timer if we have a current session
      let sessionTimer = null;
      if (currentSessionStats && currentSessionStats.sessionStartTime) {
        // Session starts at the hour, not the exact minute
        const startTime = new Date(currentSessionStats.sessionStartTime);
        const now = new Date();
        const elapsedMs = now - startTime;

        // Calculate remaining time in session window (5 hours from first message)
        const sessionDurationMs = this.sessionDurationHours * 60 * 60 * 1000;
        const remainingMs = Math.max(0, sessionDurationMs - elapsedMs);

        const hours = Math.floor(elapsedMs / (1000 * 60 * 60));
        const minutes = Math.floor((elapsedMs % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((elapsedMs % (1000 * 60)) / 1000);

        const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
        const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

        sessionTimer = {
          startTime: currentSessionStats.sessionStartTime,
          elapsed: elapsedMs,
          remaining: remainingMs,
          formatted: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
          remainingFormatted: `${String(remainingHours).padStart(2, '0')}:${String(remainingMinutes).padStart(2, '0')}`,
          hours,
          minutes,
          seconds,
          remainingMs,
          sessionDurationHours: this.sessionDurationHours,
          sessionNumber: currentSessionStats.sessionNumber || 1, // Add session number
          isExpired: remainingMs === 0,
          burnRate: burnRateData.rate,
          burnRateConfidence: burnRateData.confidence,
          depletionTime: analytics.predictions.depletionTime,
          depletionConfidence: analytics.predictions.confidence
        };
      }

      this.sendToWebSocket(wsInfo.ws, {
        type: 'usage_update',
        sessionStats: currentSessionStats || {
          requests: 0,
          totalTokens: 0,
          totalCost: 0,
          message: 'No active Claude session'
        },
        dailyStats: dailyStats,
        sessionTimer: sessionTimer,
        analytics: analytics,
        burnRate: burnRateData,
        overlappingSessions: overlappingSessions.length,
        plan: this.usageAnalytics.currentPlan,
        limits: this.usageAnalytics.planLimits[this.usageAnalytics.currentPlan]
      });

    } catch (error) {
      console.error('Error getting usage stats:', error);
      this.sendToWebSocket(wsInfo.ws, {
        type: 'error',
        message: 'Failed to retrieve usage statistics'
      });
    }
  }

}

async function startServer(options) {
  const webServer = new ClaudeCodeWebServer(options);
  const httpServer = await webServer.start();
  // Expose saveSessionsToDisk for coordinated shutdown from cc-web.js
  httpServer.saveAllSessions = () => webServer.saveSessionsToDisk();
  httpServer.closeAll = () => webServer.close();
  return httpServer;
}

module.exports = { startServer, ClaudeCodeWebServer };
