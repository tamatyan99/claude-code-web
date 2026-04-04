const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

/**
 * Set up WebSocket connection handling on the server.
 * @param {object} server - The ClaudeCodeWebServer instance
 */
function setupWebSocketHandlers(server) {
  server.wss.on('connection', (ws, req) => {
    handleWebSocketConnection(server, ws, req);
  });
}

function handleWebSocketConnection(server, ws, req) {
  const wsId = uuidv4();
  const url = new URL(req.url, `ws://localhost`);
  const claudeSessionId = url.searchParams.get('sessionId');

  if (server.dev) {
    console.log(`New WebSocket connection: ${wsId}`);
    if (claudeSessionId) {
      console.log(`Joining Claude session: ${claudeSessionId}`);
    }
  }

  // Store WebSocket connection info
  const wsInfo = {
    id: wsId,
    ws,
    claudeSessionId: null,
    created: new Date()
  };
  server.webSocketConnections.set(wsId, wsInfo);

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      if (!data || typeof data.type !== 'string') {
        server.sendToWebSocket(ws, {
          type: 'error',
          message: 'Invalid message: missing or invalid type'
        });
        return;
      }
      await handleMessage(server, wsId, data);
    } catch (error) {
      if (server.dev) {
        console.error('Error handling message:', error);
      }
      server.sendToWebSocket(ws, {
        type: 'error',
        message: 'Failed to process message'
      });
    }
  });

  ws.on('close', () => {
    if (server.dev) {
      console.log(`WebSocket connection closed: ${wsId}`);
    }
    server.cleanupWebSocketConnection(wsId);
  });

  ws.on('error', (error) => {
    if (server.dev) {
      console.error(`WebSocket error for connection ${wsId}:`, error);
    }
    server.cleanupWebSocketConnection(wsId);
  });

  // Send initial connection message
  server.sendToWebSocket(ws, {
    type: 'connected',
    connectionId: wsId
  });

  // If sessionId provided, auto-join that session
  if (claudeSessionId && server.claudeSessions.has(claudeSessionId)) {
    server.joinClaudeSession(wsId, claudeSessionId);
  }
}

async function handleMessage(server, wsId, data) {
  const wsInfo = server.webSocketConnections.get(wsId);
  if (!wsInfo) return;

  switch (data.type) {
    case 'create_session':
      await server.createAndJoinSession(wsId, data.name, data.workingDir);
      break;

    case 'join_session':
      await server.joinClaudeSession(wsId, data.sessionId);
      break;

    case 'leave_session':
      await server.leaveClaudeSession(wsId);
      break;

    case 'start_sdk':
      await server.startSdkSession(wsId, data.options || {});
      break;

    case 'sdk_prompt':
      await server.sendSdkPrompt(wsId, data.prompt, data.options || {});
      break;

    case 'input':
    case 'resize':
      // Legacy PTY input/resize — no-op since PTY bridges have been removed
      if (server.dev) {
        console.log(`Ignoring legacy message type '${data.type}' (PTY bridges removed)`);
      }
      break;

    case 'stop':
      if (wsInfo.claudeSessionId) {
        const session = server.claudeSessions.get(wsInfo.claudeSessionId);
        if (session) {
          await server.stopAgentSession(wsInfo.claudeSessionId);
        }
      }
      break;

    case 'ping':
      server.sendToWebSocket(wsInfo.ws, { type: 'pong' });
      break;

    case 'get_usage':
      server.handleGetUsage(wsInfo);
      break;

    default:
      if (server.dev) {
        console.log(`Unknown message type: ${data.type}`);
      }
  }
}

module.exports = { setupWebSocketHandlers };
