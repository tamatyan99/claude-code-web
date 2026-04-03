const { spawn } = require('node-pty');
const path = require('path');
const fs = require('fs');

class BaseBridge {
  constructor(commandName, possiblePaths, skipPermissionsFlag = null) {
    this.sessions = new Map();
    this.commandName = commandName;
    this.skipPermissionsFlag = skipPermissionsFlag;
    this.command = this.findCommand(possiblePaths);
  }

  findCommand(possiblePaths) {
    for (const cmd of possiblePaths) {
      try {
        if (fs.existsSync(cmd) || this.commandExists(cmd)) {
          console.log(`Found ${this.commandName} command at: ${cmd}`);
          return cmd;
        }
      } catch (error) {
        continue;
      }
    }

    console.error(`${this.commandName} command not found, using default "${this.commandName}"`);
    return this.commandName;
  }

  commandExists(command) {
    try {
      require('child_process').execFileSync('which', [command], { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  }

  buildArgs(options) {
    if (this.skipPermissionsFlag && options.dangerouslySkipPermissions) {
      return [this.skipPermissionsFlag];
    }
    return [];
  }

  async startSession(sessionId, options = {}) {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }

    const {
      workingDir = process.cwd(),
      dangerouslySkipPermissions = false,
      onOutput = () => {},
      onExit = () => {},
      onError = () => {},
      cols = 80,
      rows = 24
    } = options;

    try {
      console.log(`Starting ${this.commandName} session ${sessionId}`);
      console.log(`Command: ${this.command}`);
      console.log(`Working directory: ${workingDir}`);
      console.log(`Terminal size: ${cols}x${rows}`);
      if (dangerouslySkipPermissions && this.skipPermissionsFlag) {
        console.log(`WARNING: Skipping permissions with ${this.skipPermissionsFlag} flag`);
      }

      const args = this.buildArgs({ dangerouslySkipPermissions });
      const proc = spawn(this.command, args, {
        cwd: workingDir,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          FORCE_COLOR: '1',
          COLORTERM: 'truecolor'
        },
        cols,
        rows,
        name: 'xterm-color'
      });

      const session = {
        process: proc,
        workingDir,
        created: new Date(),
        active: true,
        killTimeout: null
      };

      this.sessions.set(sessionId, session);

      let dataBuffer = '';

      proc.onData((data) => {
        if (process.env.DEBUG) {
          console.log(`${this.commandName} session ${sessionId} output:`, data);
        }

        dataBuffer += data;

        this.handleData(sessionId, proc, dataBuffer, data);

        if (dataBuffer.length > 10000) {
          dataBuffer = dataBuffer.slice(-5000);
        }

        try {
          onOutput(data);
        } catch (err) {
          console.error(`onOutput callback error in session ${sessionId}:`, err);
        }
      });

      proc.onExit((exitCode, signal) => {
        console.log(`${this.commandName} session ${sessionId} exited with code ${exitCode}, signal ${signal}`);
        if (session.killTimeout) {
          clearTimeout(session.killTimeout);
          session.killTimeout = null;
        }
        session.active = false;
        this.sessions.delete(sessionId);
        try {
          onExit(exitCode, signal);
        } catch (err) {
          console.error(`onExit callback error in session ${sessionId}:`, err);
        }
      });

      proc.on('error', (error) => {
        console.error(`${this.commandName} session ${sessionId} error:`, error);
        if (session.killTimeout) {
          clearTimeout(session.killTimeout);
          session.killTimeout = null;
        }
        session.active = false;
        this.sessions.delete(sessionId);
        try {
          onError(error);
        } catch (err) {
          console.error(`onError callback error in session ${sessionId}:`, err);
        }
      });

      console.log(`${this.commandName} session ${sessionId} started successfully`);
      return session;

    } catch (error) {
      console.error(`Failed to start ${this.commandName} session ${sessionId}:`, error);
      throw new Error(`Failed to start ${this.commandName}: ${error.message}`);
    }
  }

  // Override in subclasses for special data handling (e.g., trust prompt)
  handleData(sessionId, proc, dataBuffer, data) {
    // no-op by default
  }

  async sendInput(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.active) {
      throw new Error(`Session ${sessionId} not found or not active`);
    }

    try {
      session.process.write(data);
    } catch (error) {
      throw new Error(`Failed to send input to session ${sessionId}: ${error.message}`);
    }
  }

  async resize(sessionId, cols, rows) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.active) {
      throw new Error(`Session ${sessionId} not found or not active`);
    }

    try {
      session.process.resize(cols, rows);
    } catch (error) {
      console.warn(`Failed to resize session ${sessionId}:`, error.message);
    }
  }

  async stopSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      if (session.killTimeout) {
        clearTimeout(session.killTimeout);
        session.killTimeout = null;
      }

      if (session.active && session.process) {
        session.process.kill('SIGTERM');

        session.killTimeout = setTimeout(() => {
          if (session.active && session.process) {
            session.process.kill('SIGKILL');
          }
        }, 5000);
      }
    } catch (error) {
      console.warn(`Error stopping ${this.commandName} session ${sessionId}:`, error.message);
    }

    session.active = false;
    this.sessions.delete(sessionId);
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  getAllSessions() {
    return Array.from(this.sessions.entries()).map(([id, session]) => ({
      id,
      workingDir: session.workingDir,
      created: session.created,
      active: session.active
    }));
  }

  async cleanup() {
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      await this.stopSession(sessionId);
    }
  }
}

module.exports = BaseBridge;
