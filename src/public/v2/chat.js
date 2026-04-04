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

        this.messagesEl = document.getElementById('chatMessages');
        this.inputEl = document.getElementById('chatInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.statusDot = document.getElementById('statusDot');
        this.statusText = document.getElementById('statusText');
        this.costDisplay = document.getElementById('costDisplay');
        this.modelSelect = document.getElementById('modelSelect');
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

            // Create a session and start SDK mode
            this.send({
                type: 'create_session',
                name: `Chat ${new Date().toLocaleString()}`,
                workingDir: null
            });
        };

        this.socket.onmessage = (event) => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch (err) {
                console.error('Failed to parse WebSocket message:', err);
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
                // Join and start SDK session
                this.send({ type: 'join_session', sessionId: this.sessionId });
                break;

            case 'session_joined': {
                // Start SDK mode
                const urlParams = new URLSearchParams(window.location.search);
                const skipPermissions = urlParams.get('permissions') !== 'prompt';
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
                this.appendSystemMessage(`Error: ${msg.message}`);
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
                    // If there's a final text result not yet shown
                    const lastMsg = this.messagesEl.querySelector('.msg-assistant:last-of-type .msg-content');
                    if (!lastMsg || lastMsg.textContent.trim() !== msg.result.trim()) {
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
        const role = document.createElement('div');
        role.className = 'msg-role assistant';
        role.textContent = 'Claude';
        const content = document.createElement('div');
        content.className = 'msg-content';
        content.innerHTML = this.renderMarkdown(text);
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
        header.innerHTML = `<span class="tool-card-icon">&#9881;</span> ${this.escapeHtml(toolName)}`;
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
        el.innerHTML = parts.map(p => `<span>${this.escapeHtml(p)}</span>`).join('');
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
        el.innerHTML = '<span></span><span></span><span></span>';
        this.messagesEl.appendChild(el);
        this.scrollToBottom();
    }

    removeTypingIndicator() {
        const el = document.getElementById('typingIndicator');
        if (el) el.remove();
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
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    new ChatUI();
});
