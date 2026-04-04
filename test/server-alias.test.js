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
    const server = new ClaudeCodeWebServer({});
    assert.ok(server.aliases.claude && server.aliases.claude.length > 0);
  });
});
