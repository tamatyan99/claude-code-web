const assert = require('assert');
const { ClaudeCodeWebServer } = require('../src/server');

describe('Server Aliases', function() {
  it('should set aliases from options', function() {
    const server = new ClaudeCodeWebServer({
      claudeAlias: 'Buddy',
    });

    assert.strictEqual(server.aliases.claude, 'Buddy');
  });

  it('should default aliases when not provided', function() {
    // Temporarily clear any environment overrides so true defaults are tested
    const savedClaude = process.env.CLAUDE_ALIAS;
    delete process.env.CLAUDE_ALIAS;

    const server = new ClaudeCodeWebServer({ noAuth: true });

    assert.strictEqual(server.aliases.claude, 'Claude');

    // Restore environment variables
    if (savedClaude !== undefined) process.env.CLAUDE_ALIAS = savedClaude;
  });
});
