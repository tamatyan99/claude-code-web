const path = require('path');
const BaseBridge = require('./base-bridge');

class ClaudeBridge extends BaseBridge {
  constructor() {
    super('claude', [
      '/home/ec2-user/.claude/local/claude',
      'claude',
      'claude-code',
      path.join(process.env.HOME || '/', '.claude', 'local', 'claude'),
      path.join(process.env.HOME || '/', '.local', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/usr/bin/claude'
    ], '--dangerously-skip-permissions');

    this._trustPromptHandled = new Set();
  }

  handleData(sessionId, proc, dataBuffer, data) {
    if (!this._trustPromptHandled.has(sessionId) && dataBuffer.includes('Do you trust the files in this folder?')) {
      this._trustPromptHandled.add(sessionId);
      console.log(`Auto-accepting trust prompt for session ${sessionId}`);
      setTimeout(() => {
        proc.write('\r');
        console.log(`Sent Enter to accept trust prompt for session ${sessionId}`);
      }, 500);
    }
  }

  async stopSession(sessionId) {
    this._trustPromptHandled.delete(sessionId);
    return super.stopSession(sessionId);
  }
}

module.exports = ClaudeBridge;
