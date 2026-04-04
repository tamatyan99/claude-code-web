const assert = require('assert');
const { ClaudeCodeWebServer } = require('../src/server');

describe('Server Aliases', function() {
  it('should set aliases from options', function() {
    const server = new ClaudeCodeWebServer({
      claudeAlias: 'Buddy',
      codexAlias: 'Robo',
      agentAlias: 'Helper',
    });

    assert.strictEqual(server.aliases.claude, 'Buddy');
    assert.strictEqual(server.aliases.codex, 'Robo');
    assert.strictEqual(server.aliases.agent, 'Helper');
  });

  it('should default aliases when not provided', function() {
    // Temporarily clear any environment overrides so true defaults are tested
    const savedClaude = process.env.CLAUDE_ALIAS;
    const savedCodex = process.env.CODEX_ALIAS;
    const savedAgent = process.env.AGENT_ALIAS;
    delete process.env.CLAUDE_ALIAS;
    delete process.env.CODEX_ALIAS;
    delete process.env.AGENT_ALIAS;

    const server = new ClaudeCodeWebServer({ noAuth: true });

    assert.strictEqual(server.aliases.claude, 'Claude');
    assert.strictEqual(server.aliases.codex, 'Codex');
    assert.strictEqual(server.aliases.agent, 'Cursor');

    // Restore environment variables
    if (savedClaude !== undefined) process.env.CLAUDE_ALIAS = savedClaude;
    if (savedCodex !== undefined) process.env.CODEX_ALIAS = savedCodex;
    if (savedAgent !== undefined) process.env.AGENT_ALIAS = savedAgent;
  });
});

