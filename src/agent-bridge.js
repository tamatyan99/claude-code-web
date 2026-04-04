const path = require('path');
const BaseBridge = require('./base-bridge');

class AgentBridge extends BaseBridge {
  constructor() {
    super('cursor-agent', [
      path.join(process.env.HOME || '/', '.cursor', 'local', 'cursor-agent'),
      'cursor-agent',
      path.join(process.env.HOME || '/', '.local', 'bin', 'cursor-agent'),
      '/usr/local/bin/cursor-agent',
      '/usr/bin/cursor-agent'
    ]);
  }
}

module.exports = AgentBridge;
