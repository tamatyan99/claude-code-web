const path = require('path');
const BaseBridge = require('./base-bridge');

class CodexBridge extends BaseBridge {
  constructor() {
    super('codex', [
      path.join(process.env.HOME || '/', '.codex', 'local', 'codex'),
      'codex',
      'codex-code',
      path.join(process.env.HOME || '/', '.local', 'bin', 'codex'),
      '/usr/local/bin/codex',
      '/usr/bin/codex'
    ], '--dangerously-bypass-approvals-and-sandbox');
  }
}

module.exports = CodexBridge;
