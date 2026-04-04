class ChatUI {
    constructor() {
        this.socket = null;
        this.sessionId = null;
        this.totalCost = 0;
        this.isProcessing = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectTimer = null;
        this.lastResultRendered = false;
        this.messageIdCounter = 0;

        this.messagesEl = document.getElementById('chatMessages');
        this.inputEl = document.getElementById('chatInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.statusDot = document.getElementById('statusDot');
        this.statusText = document.getElementById('statusText');
        this.costDisplay = document.getElementById('costDisplay');
        this.modelSelect = document.getElementById('modelSelect');
        this.permissionSelect = document.getElementById('permissionSelect');
        this.welcomeEl = document.getElementById('welcomeMessage');

        this.setupEvents();
        this.connect();
    }

    setupEvents() {
        this.sendBtn.addEventListener('click', () => this.sendMessage());

        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Auto-resize textarea
        this.inputEl.addEventListener('input', () => {
            this.inputEl.style.height = 'auto';
            this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 150) + 'px';
        });
    }

    connect() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${location.host}`;

        this.socket = new WebSocket(wsUrl);

        this.socket.onopen = () => {
            this.reconnectAttempts = 0;
            this.setStatus('connected', 'Connected');

            // Try to rejoin an existing session from sessionStorage
            const savedSessionId = sessionStorage.getItem('ccw_sessionId');
            if (savedSessionId) {
                this.sessionId = savedSessionId;
                this.send({ type: 'join_session', sessionId: this.sessionId });
            } else {
                // Create a new session
                this.send({
                    type: 'create_session',
                    name: `Chat ${new Date().toLocaleString()}`,
                    workingDir: null
                });
            }
        };

        this.socket.onmessage = (event) => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch (err) {
                console.error('[Chat] Failed to parse WebSocket message:', err);
                return;
            }
            this.handleMessage(data);
        };

        this.socket.onclose = () => {
            this.setStatus('disconnected', 'Disconnected');
            clearTimeout(this.reconnectTimer);
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectTimer = setTimeout(() => {
                    this.reconnectAttempts++;
                    this.connect();
                }, 1000 * Math.pow(2, this.reconnectAttempts));
            } else {
                this.showReconnectError();
            }
        };

        this.socket.onerror = () => {
            this.setStatus('disconnected', 'Connection error');
        };
    }

    send(data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(data));
        }
    }

    handleMessage(msg) {
        switch (msg.type) {
            case 'connected':
                break;

            case 'session_created':
                this.sessionId = msg.sessionId;
                sessionStorage.setItem('ccw_sessionId', this.sessionId);
                // Join and start SDK session
                this.send({ type: 'join_session', sessionId: this.sessionId });
                break;

            case 'session_joined': {
                // Start SDK mode; URL param 'permissions=prompt' takes precedence,
                // otherwise fall back to the permission select value
                const urlParams = new URLSearchParams(window.location.search);
                const skipPermissions = urlParams.has('permissions')
                    ? urlParams.get('permissions') !== 'prompt'
                    : this.permissionSelect.value === 'bypass';
                this.send({
                    type: 'start_sdk',
                    options: { dangerouslySkipPermissions: skipPermissions }
                });
                break;
            }

            case 'sdk_started':
                this.setStatus('connected', 'Ready');
                break;

            case 'sdk_processing':
                this.setStatus('processing', 'Thinking...');
                this.isProcessing = true;
                this.sendBtn.disabled = true;
                this.showTypingIndicator();
                break;

            case 'sdk_message':
                this.handleSdkMessage(msg.message);
                break;

            case 'sdk_done':
                this.setStatus('connected', 'Ready');
                this.isProcessing = false;
                this.sendBtn.disabled = false;
                this.removeTypingIndicator();
                break;

            case 'sdk_error':
                this.setStatus('connected', 'Error');
                this.isProcessing = false;
                this.sendBtn.disabled = false;
                this.removeTypingIndicator();
                this.appendSystemMessage(`Error: ${msg.message}`);
                break;

            case 'error':
                // If rejoin fails, create a new session
                if (this.sessionId && msg.message && msg.message.includes('session')) {
                    sessionStorage.removeItem('ccw_sessionId');
                    this.sessionId = null;
                    this.send({
                        type: 'create_session',
                        name: `Chat ${new Date().toLocaleString()}`,
                        workingDir: null
                    });
                } else {
                    this.appendSystemMessage(`Error: ${msg.message}`);
                }
                break;
        }
    }

    handleSdkMessage(msg) {
        this.removeTypingIndicator();

        if (!msg || !msg.type) return;

        switch (msg.type) {
            case 'assistant': {
                // Assistant message with content blocks
                const content = msg.message?.content || msg.content;
                if (!content) break;

                let textParts = [];
                let toolUses = [];

                if (Array.isArray(content)) {
                    for (const block of content) {
                        if (block.type === 'text') {
                            textParts.push(block.text);
                        } else if (block.type === 'tool_use') {
                            toolUses.push(block);
                        }
                    }
                } else if (typeof content === 'string') {
                    textParts.push(content);
                }

                if (textParts.length > 0) {
                    this.appendAssistantMessage(textParts.join('\n'));
                }

                for (const tool of toolUses) {
                    this.appendToolCard(tool.name, tool.input, tool.id);
                }
                break;
            }

            case 'user': {
                // Tool results
                const content = msg.message?.content || msg.content;
                if (Array.isArray(content)) {
                    for (const block of content) {
                        if (block.type === 'tool_result') {
                            this.updateToolResult(block.tool_use_id, block.content);
                        }
                    }
                }
                break;
            }

            case 'result': {
                // Final result with cost info
                if (msg.cost_usd != null) {
                    this.totalCost += msg.cost_usd;
                    this.costDisplay.textContent = `$${this.totalCost.toFixed(4)}`;
                }
                if (msg.result && !this.lastResultRendered) {
                    this.lastResultRendered = true;
                    // Deduplicate: check last assistant message content before appending
                    const allAssistant = this.messagesEl.querySelectorAll('.msg-assistant');
                    const lastAssistantMsg = allAssistant.length > 0 ? allAssistant[allAssistant.length - 1] : null;
                    const lastContent = lastAssistantMsg ? lastAssistantMsg.querySelector('.msg-content') : null;
                    if (!lastContent || !lastContent.textContent.includes(msg.result.substring(0, 50))) {
                        this.appendAssistantMessage(msg.result);
                    }
                }
                if (msg.usage) {
                    this.appendResultInfo(msg);
                }
                break;
            }

            case 'system': {
                // Session init etc - just log
                if (msg.session_id) {
                    console.log('SDK session ID:', msg.session_id);
                }
                break;
            }

            default:
                // Log unknown message types for debugging
                console.log('[SDK msg]', msg.type, msg);
        }
    }

    sendMessage() {
        const text = this.inputEl.value.trim();
        if (!text || this.isProcessing) return;
        this.lastResultRendered = false;

        // Hide welcome
        if (this.welcomeEl) {
            this.welcomeEl.style.display = 'none';
        }

        // Show user message
        this.appendUserMessage(text);

        // Send to server
        this.send({
            type: 'sdk_prompt',
            prompt: text,
            options: {
                model: this.modelSelect.value,
            }
        });

        // Clear input
        this.inputEl.value = '';
        this.inputEl.style.height = 'auto';
    }

    // ── DOM helpers ──

    appendUserMessage(text) {
        const el = document.createElement('div');
        el.className = 'msg msg-user';
        const role = document.createElement('div');
        role.className = 'msg-role user';
        role.textContent = 'You';
        const content = document.createElement('div');
        content.className = 'msg-content';
        content.textContent = text;
        el.appendChild(role);
        el.appendChild(content);
        this.messagesEl.appendChild(el);
        this.scrollToBottom();
    }

    appendAssistantMessage(text) {
        const el = document.createElement('div');
        el.className = 'msg msg-assistant';
        el.dataset.msgId = ++this.messageIdCounter;
        const role = document.createElement('div');
        role.className = 'msg-role assistant';
        role.textContent = 'Claude';
        const content = document.createElement('div');
        content.className = 'msg-content';
        content.appendChild(this.renderMarkdownSafe(text));
        el.appendChild(role);
        el.appendChild(content);
        this.messagesEl.appendChild(el);
        this.scrollToBottom();
    }

    appendToolCard(toolName, input, toolId) {
        const card = document.createElement('div');
        card.className = 'tool-card';
        if (toolId) {
            card.dataset.toolId = toolId;
        }

        const header = document.createElement('div');
        header.className = 'tool-card-header';

        const icon = document.createElement('span');
        icon.className = 'tool-card-icon';
        icon.textContent = '\u2699';
        header.appendChild(icon);

        const nameSpan = document.createElement('span');
        nameSpan.textContent = ' ' + toolName;
        header.appendChild(nameSpan);

        header.addEventListener('click', () => card.classList.toggle('expanded'));

        const body = document.createElement('div');
        body.className = 'tool-card-body';
        body.textContent = typeof input === 'string' ? input : JSON.stringify(input, null, 2);

        card.appendChild(header);
        card.appendChild(body);
        this.messagesEl.appendChild(card);
        this.scrollToBottom();
    }

    updateToolResult(toolUseId, content) {
        // Tool results are informational - show as a subtle card
        let text = '';
        if (Array.isArray(content)) {
            text = content.map(c => c.text || JSON.stringify(c)).join('\n');
        } else if (typeof content === 'string') {
            text = content;
        } else {
            text = JSON.stringify(content, null, 2);
        }

        // Find the matching tool card by ID, or fall back to last card
        const escapedId = CSS.escape(toolUseId);
        const card = this.messagesEl.querySelector(`.tool-card[data-tool-id="${escapedId}"]`)
            || this.messagesEl.querySelector('.tool-card:last-child');
        if (card) {
            const body = card.querySelector('.tool-card-body');
            if (body) {
                body.textContent += '\n--- Result ---\n' + text;
            }
        }
    }

    appendResultInfo(msg) {
        const el = document.createElement('div');
        el.className = 'msg-result';
        const parts = [];
        if (msg.cost_usd != null) parts.push(`Cost: $${msg.cost_usd.toFixed(4)}`);
        if (msg.usage) {
            if (msg.usage.input_tokens) parts.push(`In: ${msg.usage.input_tokens}`);
            if (msg.usage.output_tokens) parts.push(`Out: ${msg.usage.output_tokens}`);
        }
        if (msg.model) parts.push(`Model: ${msg.model}`);
        for (const p of parts) {
            const span = document.createElement('span');
            span.textContent = p;
            el.appendChild(span);
        }
        this.messagesEl.appendChild(el);
        this.scrollToBottom();
    }

    appendSystemMessage(text) {
        const el = document.createElement('div');
        el.className = 'msg-result';
        el.style.borderColor = 'var(--error)';
        const span = document.createElement('span');
        span.style.color = 'var(--error)';
        span.textContent = text;
        el.appendChild(span);
        this.messagesEl.appendChild(el);
        this.scrollToBottom();
    }

    showTypingIndicator() {
        if (document.getElementById('typingIndicator')) return;
        const el = document.createElement('div');
        el.className = 'typing-indicator';
        el.id = 'typingIndicator';
        for (let i = 0; i < 3; i++) {
            el.appendChild(document.createElement('span'));
        }
        this.messagesEl.appendChild(el);
        this.scrollToBottom();
    }

    removeTypingIndicator() {
        const el = document.getElementById('typingIndicator');
        if (el) el.remove();
    }

    showReconnectError() {
        const existing = document.getElementById('reconnectError');
        if (existing) existing.remove();

        const el = document.createElement('div');
        el.className = 'reconnect-error';
        el.id = 'reconnectError';

        const msgSpan = document.createElement('span');
        msgSpan.textContent = 'Connection lost. Could not reconnect after multiple attempts.';
        el.appendChild(msgSpan);

        const retryBtn = document.createElement('button');
        retryBtn.className = 'reconnect-retry-btn';
        retryBtn.textContent = 'Retry';
        retryBtn.addEventListener('click', () => {
            el.remove();
            this.reconnectAttempts = 0;
            this.connect();
        });
        el.appendChild(retryBtn);

        this.messagesEl.appendChild(el);
        this.scrollToBottom();
    }

    scrollToBottom() {
        requestAnimationFrame(() => {
            this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        });
    }

    setStatus(state, text) {
        this.statusDot.className = 'status-dot ' + state;
        this.statusText.textContent = text;
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    renderMarkdown(text) {
        // Simple markdown: code blocks, inline code, bold, italic
        let html = this.escapeHtml(text);

        // Code blocks: ```...```
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
            return `<pre><code>${code}</code></pre>`;
        });

        // Inline code: `...`
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Bold: **...**
        html = html.replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>');

        // Italic: *...*
        html = html.replace(/(?<!\*)\*(?!\*)([^\n]+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

        // Line breaks
        html = html.replace(/\n/g, '<br>');

        return html;
    }

    /**
     * Safe markdown renderer that returns a DocumentFragment using DOM APIs
     * instead of innerHTML. Handles code blocks, inline code, bold, italic,
     * and line breaks.
     */
    renderMarkdownSafe(text) {
        const fragment = document.createDocumentFragment();

        // First, split out fenced code blocks
        const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
        let lastIndex = 0;
        let match;

        while ((match = codeBlockRegex.exec(text)) !== null) {
            // Render inline content before this code block
            if (match.index > lastIndex) {
                this._renderInlineSegments(fragment, text.substring(lastIndex, match.index));
            }

            // Create <pre><code> for the code block
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.textContent = match[2];
            pre.appendChild(code);
            fragment.appendChild(pre);

            lastIndex = match.index + match[0].length;
        }

        // Render any remaining text after the last code block
        if (lastIndex < text.length) {
            this._renderInlineSegments(fragment, text.substring(lastIndex));
        }

        return fragment;
    }

    /**
     * Render inline markdown (inline code, bold, italic, plain text with newlines)
     * into the given parent node using safe DOM operations.
     */
    _renderInlineSegments(parent, text) {
        // Pattern matches: inline code, bold, italic, or plain text/newlines
        const inlineRegex = /`([^`]+)`|\*\*(.+?)\*\*|(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|(\n)|([^`*\n]+)/g;
        let m;

        while ((m = inlineRegex.exec(text)) !== null) {
            if (m[1] !== undefined) {
                // Inline code
                const code = document.createElement('code');
                code.textContent = m[1];
                parent.appendChild(code);
            } else if (m[2] !== undefined) {
                // Bold
                const strong = document.createElement('strong');
                strong.textContent = m[2];
                parent.appendChild(strong);
            } else if (m[3] !== undefined) {
                // Italic
                const em = document.createElement('em');
                em.textContent = m[3];
                parent.appendChild(em);
            } else if (m[4] !== undefined) {
                // Newline -> <br>
                parent.appendChild(document.createElement('br'));
            } else if (m[5] !== undefined) {
                // Plain text
                parent.appendChild(document.createTextNode(m[5]));
            }
        }
    }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    new ChatUI();
});
