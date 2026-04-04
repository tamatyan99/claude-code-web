const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class SdkSession {
  constructor() {
    this.sessions = new Map();
    this.command = this.findCommand();
  }

  findCommand() {
    const candidates = [
      path.join(process.env.HOME || '/', '.claude', 'local', 'claude'),
      path.join(process.env.HOME || '/', '.local', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/usr/bin/claude',
      'claude'
    ];
    for (const cmd of candidates) {
      try {
        if (fs.existsSync(cmd)) return cmd;
      } catch (_) { continue; }
    }
    try {
      require('child_process').execFileSync('which', ['claude'], { stdio: 'ignore' });
      return 'claude';
    } catch (_) {}
    console.error('Claude CLI not found for SDK mode, using "claude"');
    return 'claude';
  }

  /**
   * Start a new SDK session.
   * Unlike the PTY bridge, this uses `claude -p --output-format stream-json`
   * which outputs one JSON object per line (JSONL) with structured messages.
   */
  async startSession(sessionId, options = {}) {
    if (this.sessions.has(sessionId)) {
      throw new Error(`SDK session ${sessionId} already exists`);
    }

    const {
      workingDir = process.cwd(),
      model = null,
      permissionMode = 'default',
      resumeSessionId = null,
      continueSession = false,
      onMessage = () => {},
      onEnd = () => {},
      onError = () => {},
    } = options;

    const session = {
      workingDir,
      model,
      process: null,
      active: false,
      created: new Date(),
      lastActivity: new Date(),
      sdkSessionId: resumeSessionId || null, // Claude's internal session ID
      messageHistory: [],
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Send a prompt to the session. Spawns `claude -p --output-format stream-json`
   * and streams back structured JSON messages via the onMessage callback.
   */
  async sendPrompt(sessionId, prompt, options = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const {
      model = session.model,
      onMessage = () => {},
      onEnd = () => {},
      onError = () => {},
    } = options;

    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
    ];

    if (model) {
      args.push('--model', model);
      session.model = model;
    }

    // Resume or continue
    if (session.sdkSessionId) {
      args.push('--resume', session.sdkSessionId);
    } else if (options.continueSession) {
      args.push('--continue');
    }

    // Permission mode
    const permMode = options.permissionMode || 'default';
    args.push('--permission-mode', permMode);

    console.log(`[SDK] Starting: claude ${args.slice(0, 5).join(' ')}${args.length > 5 ? '...' : ''}`);
    console.log(`[SDK] Working dir: ${session.workingDir}`);

    const proc = spawn(this.command, args, {
      cwd: session.workingDir,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    session.process = proc;
    session.active = true;
    session.lastActivity = new Date();

    let buffer = '';

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      // Keep last incomplete line in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          session.lastActivity = new Date();

          // Capture the SDK session ID from init messages
          if (msg.type === 'system' && msg.session_id) {
            session.sdkSessionId = msg.session_id;
          }

          session.messageHistory.push(msg);
          // Keep history manageable
          if (session.messageHistory.length > 500) {
            session.messageHistory = session.messageHistory.slice(-400);
          }

          try { onMessage(msg); } catch (err) {
            console.error(`[SDK] onMessage callback error:`, err);
          }
        } catch (parseErr) {
          // Not valid JSON - might be partial or non-JSON output
          console.log(`[SDK] Non-JSON stdout: ${trimmed.substring(0, 200)}`);
        }
      }
    });

    let stderrBuf = '';
    proc.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
      // Log stderr but don't treat as fatal
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) console.log(`[SDK] stderr: ${line.trim()}`);
      }
    });

    proc.on('close', (code, signal) => {
      console.log(`[SDK] Process exited: code=${code}, signal=${signal}`);
      session.active = false;
      session.process = null;

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer.trim());
          session.messageHistory.push(msg);
          try { onMessage(msg); } catch (_) {}
        } catch (_) {}
      }

      try { onEnd(code, signal); } catch (err) {
        console.error(`[SDK] onEnd callback error:`, err);
      }
    });

    proc.on('error', (err) => {
      console.error(`[SDK] Process error:`, err);
      session.active = false;
      session.process = null;
      try { onError(err); } catch (_) {}
    });

    return proc;
  }

  /**
   * Stop an active session.
   */
  async stopSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.process) {
      const proc = session.process;
      proc.kill('SIGTERM');
      // Force kill after 5s
      const killTimeout = setTimeout(() => {
        if (session.process) {
          try { session.process.kill('SIGKILL'); } catch (_) {}
        }
      }, 5000);
      proc.on('close', () => clearTimeout(killTimeout));
    }
    session.active = false;
  }

  /**
   * Remove a session entirely.
   */
  removeSession(sessionId) {
    this.stopSession(sessionId);
    this.sessions.delete(sessionId);
  }

  /**
   * Get session info.
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * List all sessions.
   */
  listSessions() {
    return Array.from(this.sessions.entries()).map(([id, s]) => ({
      id,
      active: s.active,
      model: s.model,
      workingDir: s.workingDir,
      created: s.created,
      lastActivity: s.lastActivity,
      sdkSessionId: s.sdkSessionId,
      messageCount: s.messageHistory.length,
    }));
  }
}

module.exports = SdkSession;
