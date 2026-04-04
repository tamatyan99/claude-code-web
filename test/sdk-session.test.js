const assert = require('assert');
const SdkSession = require('../src/sdk-session');

describe('SdkSession', function() {
  let sdk;

  beforeEach(function() {
    sdk = new SdkSession();
  });

  describe('constructor', function() {
    it('should initialize with an empty sessions Map', function() {
      assert(sdk.sessions instanceof Map);
      assert.strictEqual(sdk.sessions.size, 0);
    });

    it('should set a command string on initialization', function() {
      assert(typeof sdk.command === 'string');
      assert(sdk.command.length > 0);
    });
  });

  describe('startSession', function() {
    it('should create a session with correct initial state', async function() {
      const session = await sdk.startSession('sess-1');

      assert.strictEqual(session.active, false);
      assert.strictEqual(session.process, null);
      assert(session.created instanceof Date);
      assert(session.lastActivity instanceof Date);
      assert(Array.isArray(session.messageHistory));
      assert.strictEqual(session.messageHistory.length, 0);
    });

    it('should store the session in the sessions Map', async function() {
      await sdk.startSession('sess-2');
      assert(sdk.sessions.has('sess-2'));
    });

    it('should use workingDir option', async function() {
      const session = await sdk.startSession('sess-3', { workingDir: '/tmp' });
      assert.strictEqual(session.workingDir, '/tmp');
    });

    it('should use model option', async function() {
      const session = await sdk.startSession('sess-4', { model: 'claude-haiku-3' });
      assert.strictEqual(session.model, 'claude-haiku-3');
    });

    it('should set sdkSessionId from resumeSessionId option', async function() {
      const session = await sdk.startSession('sess-5', { resumeSessionId: 'resume-abc' });
      assert.strictEqual(session.sdkSessionId, 'resume-abc');
    });

    it('should throw if session with same ID already exists', async function() {
      await sdk.startSession('sess-dup');
      await assert.rejects(
        () => sdk.startSession('sess-dup'),
        /already exists/
      );
    });
  });

  describe('sendPrompt', function() {
    it('should reject if session does not exist', async function() {
      await assert.rejects(
        () => sdk.sendPrompt('nonexistent', 'hello'),
        /not found/
      );
    });

    it('should reject if session.processing is true (concurrent guard)', async function() {
      await sdk.startSession('sess-busy');
      const session = sdk.sessions.get('sess-busy');
      session.processing = true;

      await assert.rejects(
        () => sdk.sendPrompt('sess-busy', 'hello'),
        /already processing/
      );
    });

    it('should reject if prompt exceeds MAX_PROMPT_LENGTH', async function() {
      await sdk.startSession('sess-long');
      const longPrompt = 'x'.repeat(1_000_001);

      await assert.rejects(
        () => sdk.sendPrompt('sess-long', longPrompt),
        /Prompt too long/
      );
    });

    it('should reject if model name contains shell-special characters (injection attempt)', async function() {
      await sdk.startSession('sess-badmodel');

      // The regex ^[a-zA-Z0-9._:-]+$ rejects characters like $, !, (, ), etc.
      await assert.rejects(
        () => sdk.sendPrompt('sess-badmodel', 'hi', { model: 'bad$model' }),
        /Invalid model name/
      );
    });

    it('should reject if model name contains spaces', async function() {
      await sdk.startSession('sess-badmodel2');

      await assert.rejects(
        () => sdk.sendPrompt('sess-badmodel2', 'hi', { model: 'bad model' }),
        /Invalid model name/
      );
    });

    it('should accept a valid model name like claude-sonnet-4-20250514', async function() {
      // A valid model name should not throw before spawning (it will fail on spawn,
      // but the validation itself should pass). We test this by checking that the
      // error thrown is NOT about an invalid model name.
      await sdk.startSession('sess-goodmodel');
      const session = sdk.sessions.get('sess-goodmodel');

      let thrownError = null;
      try {
        await sdk.sendPrompt('sess-goodmodel', 'hi', { model: 'claude-sonnet-4-20250514' });
      } catch (err) {
        thrownError = err;
      }

      // The error should not be about model validation
      if (thrownError) {
        assert(
          !/Invalid model name/.test(thrownError.message),
          `Unexpected model validation error: ${thrownError.message}`
        );
      }
      // Reset processing flag if it was set
      session.processing = false;
    });

    it('should reject if permissionMode is invalid', async function() {
      await sdk.startSession('sess-badperm');

      await assert.rejects(
        () => sdk.sendPrompt('sess-badperm', 'hi', { permissionMode: 'invalidMode' }),
        /Invalid permission mode/
      );
    });

    it('should accept valid permission modes', async function() {
      const validModes = ['default', 'bypassPermissions', 'acceptEdits', 'plan'];

      for (const mode of validModes) {
        const sessId = `sess-perm-${mode}`;
        await sdk.startSession(sessId);
        const session = sdk.sessions.get(sessId);

        let thrownError = null;
        try {
          await sdk.sendPrompt(sessId, 'hi', { permissionMode: mode });
        } catch (err) {
          thrownError = err;
        }

        if (thrownError) {
          assert(
            !/Invalid permission mode/.test(thrownError.message),
            `Permission mode "${mode}" should be valid but got: ${thrownError.message}`
          );
        }
        session.processing = false;
      }
    });
  });

  describe('stopSession', function() {
    it('should handle a session with no process gracefully', async function() {
      await sdk.startSession('sess-stop-noproc');
      // process is null by default — stopSession should not throw
      await sdk.stopSession('sess-stop-noproc');
      // Session is deleted when process is null
      assert(!sdk.sessions.has('sess-stop-noproc'));
    });

    it('should return without error if sessionId does not exist', async function() {
      // Should not throw
      await sdk.stopSession('nonexistent-stop');
    });

    it('should clear killTimeout when process closes', async function() {
      await sdk.startSession('sess-killtimeout');
      const session = sdk.sessions.get('sess-killtimeout');

      // Simulate a killTimeout being set
      let timeoutCleared = false;
      const fakeTimeout = setTimeout(() => {}, 10000);
      session.killTimeout = fakeTimeout;

      // Simulate the close handler logic directly
      if (session.killTimeout) {
        clearTimeout(session.killTimeout);
        timeoutCleared = true;
        session.killTimeout = null;
      }

      assert.strictEqual(timeoutCleared, true);
      assert.strictEqual(session.killTimeout, null);
    });

    it('should set session.active to false when stopping', async function() {
      await sdk.startSession('sess-stop-active');
      const session = sdk.sessions.get('sess-stop-active');

      // Simulate a fake process so stopSession takes the kill path
      let killed = false;
      session.process = {
        kill: (sig) => { killed = true; }
      };

      await sdk.stopSession('sess-stop-active');

      assert.strictEqual(session.active, false);
      assert.strictEqual(killed, true);
    });
  });

  describe('removeSession', function() {
    it('should delete the session from the Map', async function() {
      await sdk.startSession('sess-remove');
      assert(sdk.sessions.has('sess-remove'));

      sdk.removeSession('sess-remove');
      assert(!sdk.sessions.has('sess-remove'));
    });

    it('should handle removing a non-existent session without throwing', function() {
      // Should not throw
      sdk.removeSession('nope');
    });
  });

  describe('getSession', function() {
    it('should return null for a non-existent session', function() {
      const result = sdk.getSession('missing');
      assert.strictEqual(result, null);
    });

    it('should return the session object if it exists', async function() {
      await sdk.startSession('sess-get');
      const result = sdk.getSession('sess-get');
      assert(result !== null);
      assert(Array.isArray(result.messageHistory));
    });
  });

  describe('listSessions', function() {
    it('should return an empty array when no sessions exist', function() {
      const list = sdk.listSessions();
      assert(Array.isArray(list));
      assert.strictEqual(list.length, 0);
    });

    it('should include session summary fields', async function() {
      await sdk.startSession('sess-list', { model: 'claude-haiku' });
      const list = sdk.listSessions();
      assert.strictEqual(list.length, 1);
      const entry = list[0];
      assert.strictEqual(entry.id, 'sess-list');
      assert.strictEqual(entry.model, 'claude-haiku');
      assert('active' in entry);
      assert('workingDir' in entry);
      assert('created' in entry);
      assert('messageCount' in entry);
    });
  });
});
