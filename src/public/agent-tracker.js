/**
 * AgentTracker - Detects and tracks sub-agent activity from Claude Code CLI terminal output.
 *
 * Claude Code spawns sub-agents via the "Agent" tool.  Terminal output contains
 * recognisable patterns such as:
 *   - "⏳ <description>"  or spinner lines when an agent starts
 *   - Box-drawing frames (╭─ / ╰─) that wrap agent output
 *   - "✓" / "✗" completion markers
 *   - "Agent(…)" or "Launching agent" style text
 *
 * This class watches the raw PTY stream, maintains a list of tracked agents,
 * and fires callbacks so the UI can display a live panel.
 */
class AgentTracker {
    constructor() {
        this.isMonitoring = false;
        this.agents = new Map();          // id -> { id, description, status, startTime, endTime, output[] }
        this.nextId = 1;
        this.outputBuffer = '';           // rolling text buffer for pattern matching
        this.maxBufferSize = 30000;       // chars

        // Callbacks – set by the host (app.js)
        this.onAgentStart = null;         // (agent) => void
        this.onAgentUpdate = null;        // (agent) => void
        this.onAgentComplete = null;      // (agent) => void
        this.onChange = null;             // () => void  (any change)

        // Internal state for the incremental parser
        this._pendingAgentId = null;      // id of the agent we're currently collecting output for
    }

    /* ------------------------------------------------------------------ */
    /*  Public API                                                        */
    /* ------------------------------------------------------------------ */

    startMonitoring() {
        this.isMonitoring = true;
        this.agents.clear();
        this.outputBuffer = '';
        this.nextId = 1;
        this._pendingAgentId = null;
    }

    stopMonitoring() {
        this.isMonitoring = false;
        this.agents.clear();
        this.outputBuffer = '';
        this._pendingAgentId = null;
    }

    /** Feed every chunk of PTY data through here. */
    processOutput(data) {
        if (!this.isMonitoring) return;

        // Strip ANSI escape codes for pattern matching
        const clean = this._stripAnsi(data);

        this.outputBuffer += clean;
        if (this.outputBuffer.length > this.maxBufferSize) {
            this.outputBuffer = this.outputBuffer.slice(-this.maxBufferSize / 2);
        }

        this._detect(clean);
    }

    getAgents() {
        return Array.from(this.agents.values());
    }

    getActiveAgents() {
        return this.getAgents().filter(a => a.status === 'running');
    }

    getCompletedAgents() {
        return this.getAgents().filter(a => a.status !== 'running');
    }

    clearCompleted() {
        for (const [id, agent] of this.agents) {
            if (agent.status !== 'running') {
                this.agents.delete(id);
            }
        }
        this._fireChange();
    }

    /* ------------------------------------------------------------------ */
    /*  Detection logic                                                   */
    /* ------------------------------------------------------------------ */

    _detect(text) {
        // ── Pattern 1: Agent tool invocation ─────────────────────────
        // Claude Code prints lines like:
        //   "⏳ <description>" when launching a task
        //   "Agent" or "Launching agent" in tool-call banners
        //   Lines starting with ╭ (box top) to frame agent output

        // Detect agent spawn – look for common patterns
        const spawnPatterns = [
            /(?:^|\n)\s*⏳\s+(.{3,80})/,                       // ⏳ Running tests...
            /(?:^|\n)\s*(?:Launching|Starting|Running)\s+agent[:\s]+(.{3,80})/i,
            /(?:^|\n)\s*Agent\s*(?:\(|tool\b)[:\s]*(.{3,80})/i, // Agent(description) or Agent tool: desc
            /(?:^|\n)\s*╭─+\s*Agent[:\s]*(.{3,80})/,           // ╭── Agent: description
        ];

        for (const pattern of spawnPatterns) {
            const match = text.match(pattern);
            if (match) {
                const desc = match[1].trim().replace(/[─╮╭╯╰│┤├┬┴┼]+/g, '').trim();
                if (desc.length > 2 && !this._isDuplicate(desc)) {
                    this._spawnAgent(desc);
                }
            }
        }

        // ── Pattern 2: Agent completion ──────────────────────────────
        const completePatterns = [
            /(?:^|\n)\s*[✓✔]\s+(.{3,80})/,                     // ✓ Agent completed
            /(?:^|\n)\s*╰─+\s*/,                                 // ╰── end of box frame
            /(?:^|\n)\s*Agent (?:completed|finished|done)/i,
            /(?:^|\n)\s*Result:/i,
        ];

        for (const pattern of completePatterns) {
            if (pattern.test(text) && this._pendingAgentId) {
                this._completeAgent(this._pendingAgentId, 'completed');
                break;
            }
        }

        // ── Pattern 3: Agent failure ─────────────────────────────────
        const failPatterns = [
            /(?:^|\n)\s*[✗✘×]\s+/,
            /(?:^|\n)\s*Agent (?:failed|error|aborted)/i,
            /(?:^|\n)\s*Error running agent/i,
        ];

        for (const pattern of failPatterns) {
            if (pattern.test(text) && this._pendingAgentId) {
                this._completeAgent(this._pendingAgentId, 'failed');
                break;
            }
        }

        // ── Collect output for the active agent ──────────────────────
        if (this._pendingAgentId) {
            const agent = this.agents.get(this._pendingAgentId);
            if (agent && agent.status === 'running') {
                agent.output.push(text);
                // Trim to avoid unbounded growth
                if (agent.output.length > 200) {
                    agent.output = agent.output.slice(-100);
                }
            }
        }
    }

    _isDuplicate(description) {
        const recent = Date.now() - 3000; // 3 second dedup window
        for (const agent of this.agents.values()) {
            if (agent.description === description && agent.startTime > recent) {
                return true;
            }
        }
        return false;
    }

    _spawnAgent(description) {
        const id = this.nextId++;
        const agent = {
            id,
            description,
            status: 'running',
            startTime: Date.now(),
            endTime: null,
            output: []
        };
        this.agents.set(id, agent);
        this._pendingAgentId = id;

        if (this.onAgentStart) {
            try { this.onAgentStart(agent); } catch (_) {}
        }
        this._fireChange();
    }

    _completeAgent(id, status) {
        const agent = this.agents.get(id);
        if (!agent || agent.status !== 'running') return;

        agent.status = status;
        agent.endTime = Date.now();

        if (this._pendingAgentId === id) {
            this._pendingAgentId = null;
        }

        if (this.onAgentComplete) {
            try { this.onAgentComplete(agent); } catch (_) {}
        }
        this._fireChange();
    }

    _fireChange() {
        if (this.onChange) {
            try { this.onChange(); } catch (_) {}
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                           */
    /* ------------------------------------------------------------------ */

    _stripAnsi(str) {
        return str
            .replace(/\x1b\[[0-9;]*m/g, '')
            .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
            .replace(/\x1b\][^\x07]*\x07/g, '')   // OSC sequences
            .replace(/\x1b\[[\?]?[0-9;]*[hl]/g, ''); // mode set/reset
    }

    formatDuration(ms) {
        if (ms < 1000) return '<1s';
        const s = Math.floor(ms / 1000);
        if (s < 60) return `${s}s`;
        const m = Math.floor(s / 60);
        const rem = s % 60;
        return `${m}m${rem}s`;
    }
}

// Export for use in app.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AgentTracker;
}
