#!/usr/bin/env node

const { Command } = require('commander');
const path = require('path');
const open = require('open');
const { startServer } = require('../src/server');

const program = new Command();

program
  .name('cc-web')
  .description('Web-based interface for Claude Code CLI')
  .version('3.4.0')
  .option('-p, --port <number>', 'port to run the server on', '32352')
  .option('--no-open', 'do not automatically open browser')
  .option('--https', 'enable HTTPS (requires cert files)')
  .option('--cert <path>', 'path to SSL certificate file')
  .option('--key <path>', 'path to SSL private key file')
  .option('--dev', 'development mode with additional logging')
  .option('--plan <type>', 'subscription plan (pro, max5, max20)', 'max20')
  .option('--claude-alias <name>', 'display alias for Claude (default: env CLAUDE_ALIAS or "Claude")')
  .option('--codex-alias <name>', 'display alias for Codex (default: env CODEX_ALIAS or "Codex")')
  .option('--agent-alias <name>', 'display alias for Agent (default: env AGENT_ALIAS or "Cursor")')
  .option('--ngrok-auth-token <token>', 'ngrok auth token to open a public tunnel')
  .option('--ngrok-domain <domain>', 'ngrok reserved domain to use for the tunnel')
  .parse();

const options = program.opts();

async function main() {
  try {
    const port = parseInt(options.port, 10);

    if (isNaN(port) || port < 1 || port > 65535) {
      console.error('Error: Port must be a number between 1 and 65535');
      process.exit(1);
    }

    const serverOptions = {
      port,
      https: options.https,
      cert: options.cert,
      key: options.key,
      dev: options.dev,
      plan: options.plan,
      // UI aliases for assistants
      claudeAlias: options.claudeAlias || process.env.CLAUDE_ALIAS || 'Claude',
      codexAlias: options.codexAlias || process.env.CODEX_ALIAS || 'Codex',
      agentAlias: options.agentAlias || process.env.AGENT_ALIAS || 'Cursor',
      folderMode: true // Always use folder mode
    };

    console.log('Starting Claude Code Web Interface...');
    console.log(`Port: ${port}`);
    console.log('Mode: Folder selection mode');
    console.log(`Plan: ${options.plan}`);
    console.log(`Aliases: Claude → "${serverOptions.claudeAlias}", Codex → "${serverOptions.codexAlias}", Agent → "${serverOptions.agentAlias}"`);

    const server = await startServer(serverOptions);

    // ngrok setup
    const hasNgrokToken = !!options.ngrokAuthToken;
    const hasNgrokDomain = !!options.ngrokDomain;

    if ((hasNgrokToken && !hasNgrokDomain) || (!hasNgrokToken && hasNgrokDomain)) {
      console.error('Error: Both --ngrok-auth-token and --ngrok-domain are required to enable ngrok tunneling');
      process.exit(1);
    }

    let ngrokListener = null;

    const protocol = options.https ? 'https' : 'http';
    const url = `${protocol}://localhost:${port}`;

    console.log(`\nClaude Code Web Interface is running at: ${url}`);

    // Start ngrok tunnel if both flags provided
    let publicUrl = null;
    if (hasNgrokToken && hasNgrokDomain) {
      console.log('\nStarting ngrok tunnel...');
      try {
        const mod = await import('@ngrok/ngrok');
        const ngrok = mod.default || mod;

        if (typeof ngrok.authtoken === 'function') {
          try { await ngrok.authtoken(options.ngrokAuthToken); } catch (_) {}
        }

        ngrokListener = await ngrok.connect({
          addr: port,
          authtoken: options.ngrokAuthToken,
          domain: options.ngrokDomain
        });

        if (ngrokListener && typeof ngrokListener.url === 'function') {
          publicUrl = ngrokListener.url();
        }

        if (!publicUrl && ngrokListener && ngrokListener.url) {
          publicUrl = ngrokListener.url; // fallback in case API exposes property
        }

        if (publicUrl) {
          console.log(`\nngrok tunnel established: ${publicUrl}`);
        } else {
          console.log('\nngrok tunnel established');
        }

        if (options.open && publicUrl) {
          try { await open(publicUrl); } catch (error) {
            console.warn('Could not automatically open browser:', error.message);
          }
        }

      } catch (error) {
        console.error('Failed to start ngrok tunnel:', error.message);
      }
    } else if (options.open) {
      // Open local URL only when ngrok not used and auto-open enabled
      try {
        await open(url);
      } catch (error) {
        console.warn('Could not automatically open browser:', error.message);
      }
    }

    console.log('\nPress Ctrl+C to stop the server\n');

    const shutdown = async () => {
      console.log('\nShutting down server...');
      // Save sessions before closing
      if (typeof server.saveAllSessions === 'function') {
        try { await server.saveAllSessions(); } catch (_) {}
      }
      // Close ngrok tunnel first if active
      if (ngrokListener && typeof ngrokListener.close === 'function') {
        try { await ngrokListener.close(); } catch (_) {}
      }
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => { shutdown(); });
    process.on('SIGTERM', () => { shutdown(); });

  } catch (error) {
    console.error('Error starting server:', error.message);
    process.exit(1);
  }
}

main();
