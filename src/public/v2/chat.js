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
        this.sidebarOpen = true;
        this.currentSdkSessionId = null;
        this.pendingResume = null;
        this.usagePollingTimer = null;
        this.folderCurrentPath = null;

        this.messagesEl = document.getElementById('chatMessages');
        this.inputEl = document.getElementById('chatInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.statusDot = document.getElementById('statusDot');
        this.statusText = document.getElementById('statusText');
        this.costDisplay = document.getElementById('costDisplay');
        this.modelSelect = document.getElementById('modelSelect');
        this.permissionSelect = document.getElementById('permissionSelect');
        this.welcomeEl = document.getElementById('welcomeMessage');
        this.workingDirEl = document.getElementById('workingDirDisplay');
        this.sidebar = document.getElementById('sidebar');
        this.sidebarToggle = document.getElementById('sidebarToggle');
        this.sidebarOverlay = document.getElementById('sidebarOverlay');
        this.sessionListEl = document.getElementById('sessionList');
        this.newChatBtn = document.getElementById('newChatBtn');

        // Folder modal elements
        this.folderModal = document.getElementById('folderModal');
        this.folderModalOverlay = document.getElementById('folderModalOverlay');
        this.folderBreadcrumb = document.getElementById('folderBreadcrumb');
        this.folderList = document.getElementById('folderList');
        this.folderSelectBtn = document.getElementById('folderSelectBtn');
        this.folderCancelBtn = document.getElementById('folderCancelBtn');
        this.folderModalClose = document.getElementById('folderModalClose');

        // Usage panel elements
        this.usagePanel = document.getElementById('usagePanel');
        this.usagePanelToggle = document.getElementById('usagePanelToggle');

        this.setupEvents();
        this.setupKeyboardShortcuts();
        this.connect();
    }

    // ── Tool config map ──
    static TOOL_CONFIG = {
        'Read':       { icon: '\u{1F4C4}', color: 'var(--accent)',   label: 'Read File' },
        'Write':      { icon: '\u270F\uFE0F',  color: 'var(--warning)', label: 'Write File' },
        'Edit':       { icon: '\u270F\uFE0F',  color: 'var(--warning)', label: 'Edit File' },
        'MultiEdit':  { icon: '\u270F\uFE0F',  color: 'var(--warning)', label: 'Multi Edit' },
        'Bash':       { icon: '\u26A1',  color: 'var(--success)', label: 'Run Command' },
        'Glob':       { icon: '\u{1F50D}', color: 'var(--accent)',   label: 'Find Files' },
        'Grep':       { icon: '\u{1F50D}', color: 'var(--accent)',   label: 'Search Code' },
        'TodoWrite':  { icon: '\u2705',  color: 'var(--accent)',   label: 'Update Todos' },
        'Agent':      { icon: '\u{1F916}', color: 'var(--purple)',  label: 'Sub-agent' },
        'WebSearch':  { icon: '\u{1F310}', color: 'var(--accent)',   label: 'Web Search' },
        'WebFetch':   { icon: '\u{1F310}', color: 'var(--accent)',   label: 'Web Fetch' },
    };

    static getToolConfig(name) {
        return ChatUI.TOOL_CONFIG[name] || { icon: '\u2699', color: 'var(--text-secondary)', label: name };
    }

    setupEvents() {
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.stopBtn.addEventListener('click', () => this.stopProcessing());

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

        // Sidebar toggle
        this.sidebarToggle.addEventListener('click', () => this.toggleSidebar());
        this.sidebarOverlay.addEventListener('click', () => this.closeSidebar());

        // New chat button
        this.newChatBtn.addEventListener('click', () => this.createNewChat());

        // Working directory click → folder picker
        this.workingDirEl.addEventListener('click', () => this.openFolderPicker());

        // Folder modal
        this.folderModalOverlay.addEventListener('click', () => this.closeFolderPicker());
        this.folderModalClose.addEventListener('click', () => this.closeFolderPicker());
        this.folderCancelBtn.addEventListener('click', () => this.closeFolderPicker());
        this.folderSelectBtn.addEventListener('click', () => this.selectFolder());

        // Usage panel toggle
        this.usagePanelToggle.addEventListener('click', () => {
            this.usagePanel.classList.toggle('collapsed');
        });
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            const isMod = e.metaKey || e.ctrlKey;

            // Ctrl/Cmd+N: New chat
            if (isMod && e.key === 'n') {
                e.preventDefault();
                this.createNewChat();
            }

            // Ctrl/Cmd+/: Focus input
            if (isMod && e.key === '/') {
                e.preventDefault();
                this.inputEl.focus();
            }

            // Escape: Stop processing
            if (e.key === 'Escape' && this.isProcessing) {
                this.stopProcessing();
            }
        });
    }

    // ── Sidebar & Sessions ──

    toggleSidebar() {
        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
            this.sidebar.classList.toggle('open');
            this.sidebarOverlay.classList.toggle('active');
        } else {
            this.sidebar.classList.toggle('collapsed');
        }
    }

    closeSidebar() {
        this.sidebar.classList.remove('open');
        this.sidebarOverlay.classList.remove('active');
    }

    // ── Folder Picker ──

    async openFolderPicker() {
        try {
            const resp = await fetch('/api/config');
            const config = await resp.json();
            const startPath = config.selectedWorkingDir || config.baseFolder || '/';
            await this.loadFolders(startPath);
            this.folderModal.classList.remove('hidden');
            this.folderModalOverlay.classList.remove('hidden');
        } catch (err) {
            console.error('Failed to open folder picker:', err);
        }
    }

    async loadFolders(path) {
        try {
            const resp = await fetch(`/api/folders?path=${encodeURIComponent(path)}`);
            const data = await resp.json();
            this.folderCurrentPath = data.currentPath || path;
            this.renderBreadcrumb(this.folderCurrentPath);
            this.renderFolderList(data);
        } catch (err) {
            console.error('Failed to load folders:', err);
        }
    }

    renderBreadcrumb(path) {
        this.folderBreadcrumb.innerHTML = '';
        const parts = path.split('/').filter(Boolean);
        let accumulated = '';

        // Root
        const rootSpan = document.createElement('span');
        rootSpan.className = 'folder-breadcrumb-item';
        rootSpan.textContent = '/';
        rootSpan.addEventListener('click', () => this.loadFolders('/'));
        this.folderBreadcrumb.appendChild(rootSpan);

        for (const part of parts) {
            accumulated += '/' + part;
            const sep = document.createElement('span');
            sep.className = 'folder-breadcrumb-sep';
            sep.textContent = '/';
            this.folderBreadcrumb.appendChild(sep);

            const span = document.createElement('span');
            span.className = 'folder-breadcrumb-item';
            span.textContent = part;
            const target = accumulated;
            span.addEventListener('click', () => this.loadFolders(target));
            this.folderBreadcrumb.appendChild(span);
        }
    }

    renderFolderList(data) {
        this.folderList.innerHTML = '';

        // Parent directory
        if (data.parentPath) {
            const parentItem = document.createElement('div');
            parentItem.className = 'folder-item parent-dir';

            const icon = document.createElement('span');
            icon.className = 'folder-item-icon';
            icon.textContent = '\u2B06';

            const name = document.createElement('span');
            name.className = 'folder-item-name';
            name.textContent = '.. (parent)';

            parentItem.appendChild(icon);
            parentItem.appendChild(name);
            parentItem.addEventListener('click', () => this.loadFolders(data.parentPath));
            this.folderList.appendChild(parentItem);
        }

        // Folders
        const folders = data.folders || [];
        for (const folder of folders) {
            const item = document.createElement('div');
            item.className = 'folder-item';

            const icon = document.createElement('span');
            icon.className = 'folder-item-icon';
            icon.textContent = '\u{1F4C1}';

            const name = document.createElement('span');
            name.className = 'folder-item-name';
            name.textContent = folder.name;

            item.appendChild(icon);
            item.appendChild(name);
            item.addEventListener('click', () => this.loadFolders(folder.path));
            this.folderList.appendChild(item);
        }

        if (folders.length === 0 && !data.parentPath) {
            const empty = document.createElement('div');
            empty.className = 'folder-item';
            empty.style.color = 'var(--text-secondary)';
            empty.textContent = 'No subdirectories';
            this.folderList.appendChild(empty);
        }
    }

    async selectFolder() {
        if (!this.folderCurrentPath) return;
        try {
            await fetch('/api/set-working-dir', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: this.folderCurrentPath })
            });
            this.closeFolderPicker();
            // Create new session with new working dir
            this.clearMessages();
            this.totalCost = 0;
            this.costDisplay.textContent = '$0.00';
            this.send({
                type: 'create_session',
                name: `Chat ${new Date().toLocaleString()}`,
                workingDir: this.folderCurrentPath
            });
        } catch (err) {
            console.error('Failed to set working directory:', err);
        }
    }

    closeFolderPicker() {
        this.folderModal.classList.add('hidden');
        this.folderModalOverlay.classList.add('hidden');
    }

    // ── Usage Dashboard ──

    requestUsageUpdate() {
        this.send({ type: 'get_usage' });
    }

    startUsagePolling() {
        this.stopUsagePolling();
        this.requestUsageUpdate();
        this.usagePollingTimer = setInterval(() => this.requestUsageUpdate(), 30000);
    }

    stopUsagePolling() {
        if (this.usagePollingTimer) {
            clearInterval(this.usagePollingTimer);
            this.usagePollingTimer = null;
        }
    }

    handleUsageUpdate(msg) {
        // Session timer
        const timerEl = document.getElementById('usageSessionTimer');
        const remainEl = document.getElementById('usageRemaining');
        if (msg.sessionTimer) {
            timerEl.textContent = msg.sessionTimer.formatted || '--:--:--';
            remainEl.textContent = msg.sessionTimer.remainingFormatted || '--:--';
            if (msg.sessionTimer.isExpired) {
                remainEl.style.color = 'var(--error)';
                remainEl.textContent = 'Expired';
            } else {
                remainEl.style.color = '';
            }
        }

        // Token stats
        const stats = msg.sessionStats || {};
        const tokensEl = document.getElementById('usageTokens');
        const costEl = document.getElementById('usageCost');
        const requestsEl = document.getElementById('usageRequests');
        const totalTokens = (stats.inputTokens || 0) + (stats.outputTokens || 0) + (stats.cacheReadTokens || 0);
        tokensEl.textContent = this.formatTokenCount(totalTokens);
        costEl.textContent = `$${(stats.totalCost || 0).toFixed(4)}`;
        requestsEl.textContent = stats.requests || 0;

        // Token bar
        if (totalTokens > 0) {
            const inputPct = ((stats.inputTokens || 0) / totalTokens * 100);
            const outputPct = ((stats.outputTokens || 0) / totalTokens * 100);
            const cachePct = ((stats.cacheReadTokens || 0) / totalTokens * 100);
            document.getElementById('usageBarInput').style.width = inputPct + '%';
            document.getElementById('usageBarOutput').style.width = outputPct + '%';
            document.getElementById('usageBarCache').style.width = cachePct + '%';
        }

        // Burn rate
        const burnEl = document.getElementById('usageBurnRate');
        if (msg.burnRate && msg.burnRate.rate > 0) {
            const rate = Math.round(msg.burnRate.rate);
            const trend = msg.sessionTimer?.burnRate > 0 ? '' : '';
            burnEl.textContent = `${rate} tok/min`;
        } else {
            burnEl.textContent = '-- tok/min';
        }

        // Depletion prediction
        const depletionEl = document.getElementById('usageDepletion');
        if (msg.analytics?.predictions?.depletionTime) {
            const deplTime = new Date(msg.analytics.predictions.depletionTime);
            const confidence = msg.analytics.predictions.confidence || 0;
            if (confidence > 0.3) {
                depletionEl.textContent = `Est. depletion: ${deplTime.toLocaleTimeString()} (${Math.round(confidence * 100)}%)`;
            } else {
                depletionEl.textContent = '';
            }
        } else {
            depletionEl.textContent = '';
        }
    }

    formatTokenCount(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return String(n);
    }

    // ── Session Resume ──

    resumeSession(sessionId, sdkSessionId) {
        this.clearMessages();
        this.totalCost = 0;
        this.costDisplay.textContent = '$0.00';
        this.sessionId = sessionId;
        sessionStorage.setItem('ccw_sessionId', sessionId);
        this.pendingResume = sdkSessionId;
        this.send({ type: 'join_session', sessionId });
    }

    async loadSessionList() {
        try {
            const resp = await fetch('/api/sessions/list');
            const data = await resp.json();
            const sessions = data.sessions || [];
            this.renderSessionList(sessions);
        } catch (err) {
            console.error('Failed to load sessions:', err);
        }
    }

    renderSessionList(sessions) {
        this.sessionListEl.innerHTML = '';
        // Sort by lastActivity descending
        sessions.sort((a, b) => new Date(b.lastActivity || b.created) - new Date(a.lastActivity || a.created));

        for (const s of sessions) {
            const item = document.createElement('div');
            item.className = 'session-item' + (s.id === this.sessionId ? ' active' : '');

            const info = document.createElement('div');
            info.className = 'session-item-info';

            const name = document.createElement('div');
            name.className = 'session-item-name';
            name.textContent = s.name || 'Unnamed Session';

            const time = document.createElement('div');
            time.className = 'session-item-time';
            time.textContent = this.relativeTime(s.lastActivity || s.created);

            info.appendChild(name);
            info.appendChild(time);
            item.appendChild(info);

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'session-item-actions';

            // Resume button (if session has sdkSessionId and is not current)
            if (s.sdkSessionId && s.id !== this.sessionId) {
                const resumeBtn = document.createElement('button');
                resumeBtn.className = 'session-item-resume';
                resumeBtn.textContent = 'Resume';
                resumeBtn.title = 'Resume Claude conversation';
                resumeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.resumeSession(s.id, s.sdkSessionId);
                    this.closeSidebar();
                });
                actionsDiv.appendChild(resumeBtn);
            }

            const delBtn = document.createElement('button');
            delBtn.className = 'session-item-delete';
            delBtn.textContent = '\u00D7';
            delBtn.title = 'Delete session';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteSession(s.id);
            });
            actionsDiv.appendChild(delBtn);
            item.appendChild(actionsDiv);

            item.addEventListener('click', () => {
                if (s.id !== this.sessionId) {
                    this.switchSession(s.id);
                }
                this.closeSidebar();
            });

            this.sessionListEl.appendChild(item);
        }
    }

    relativeTime(dateStr) {
        if (!dateStr) return '';
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        return `${days}d ago`;
    }

    createNewChat() {
        // Clear messages
        this.clearMessages();
        this.totalCost = 0;
        this.costDisplay.textContent = '$0.00';
        this.send({
            type: 'create_session',
            name: `Chat ${new Date().toLocaleString()}`,
            workingDir: null
        });
    }

    switchSession(sessionId) {
        this.clearMessages();
        this.totalCost = 0;
        this.costDisplay.textContent = '$0.00';
        this.sessionId = sessionId;
        sessionStorage.setItem('ccw_sessionId', sessionId);
        this.send({ type: 'join_session', sessionId });
    }

    async deleteSession(sessionId) {
        try {
            await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
            if (sessionId === this.sessionId) {
                this.createNewChat();
            }
            this.loadSessionList();
        } catch (err) {
            console.error('Failed to delete session:', err);
        }
    }

    clearMessages() {
        this.messagesEl.innerHTML = '';
        if (this.welcomeEl) {
            this.messagesEl.appendChild(this.welcomeEl);
            this.welcomeEl.style.display = '';
        }
    }

    // ── Connection ──

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

            // Load session list
            this.loadSessionList();
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
                this.loadSessionList();
                break;

            case 'session_joined': {
                // Display working directory
                if (msg.workingDir) {
                    this.workingDirEl.textContent = this.shortenPath(msg.workingDir);
                    this.workingDirEl.title = msg.workingDir;
                }

                // Store sdkSessionId if available
                if (msg.sdkSessionId) {
                    this.currentSdkSessionId = msg.sdkSessionId;
                }

                // Replay output buffer if available
                if (msg.outputBuffer && msg.outputBuffer.length > 0) {
                    this.replayBuffer(msg.outputBuffer);
                }

                // Start SDK mode (with resume if pending)
                const urlParams = new URLSearchParams(window.location.search);
                const skipPermissions = urlParams.has('permissions')
                    ? urlParams.get('permissions') !== 'prompt'
                    : this.permissionSelect.value === 'bypass';
                const sdkOptions = { dangerouslySkipPermissions: skipPermissions };
                if (this.pendingResume) {
                    sdkOptions.resumeSessionId = this.pendingResume;
                    this.pendingResume = null;
                }
                this.send({
                    type: 'start_sdk',
                    options: sdkOptions
                });

                this.loadSessionList();
                break;
            }

            case 'sdk_started':
                this.setStatus('connected', 'Ready');
                this.startUsagePolling();
                break;

            case 'usage_update':
                this.handleUsageUpdate(msg);
                break;

            case 'sdk_processing':
                this.setStatus('processing', 'Thinking...');
                this.setProcessing(true);
                this.showTypingIndicator();
                break;

            case 'sdk_message':
                this.handleSdkMessage(msg.message);
                break;

            case 'sdk_done':
                this.setStatus('connected', 'Ready');
                this.setProcessing(false);
                this.removeTypingIndicator();
                this.requestUsageUpdate();
                break;

            case 'sdk_error':
                this.setStatus('connected', 'Error');
                this.setProcessing(false);
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

    setProcessing(processing) {
        this.isProcessing = processing;
        this.sendBtn.disabled = processing;
        this.sendBtn.classList.toggle('hidden', processing);
        this.stopBtn.classList.toggle('hidden', !processing);
    }

    stopProcessing() {
        this.send({ type: 'stop' });
    }

    shortenPath(path) {
        if (!path) return '';
        // Replace home directory with ~
        const homeMatch = path.match(/^\/home\/[^/]+/);
        if (homeMatch) {
            return '~' + path.substring(homeMatch[0].length);
        }
        return path;
    }

    replayBuffer(buffer) {
        // Hide welcome on replay
        if (this.welcomeEl && buffer.length > 0) {
            this.welcomeEl.style.display = 'none';
        }
        for (const item of buffer) {
            if (item && item.message) {
                this.handleSdkMessage(item.message);
            } else if (item && item.type) {
                this.handleSdkMessage(item);
            }
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
                if (msg.session_id) {
                    this.currentSdkSessionId = msg.session_id;
                    console.log('SDK session ID:', msg.session_id);
                }
                break;
            }

            default:
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

        // Message actions
        const actions = this.createMessageActions(text, true);

        el.appendChild(role);
        el.appendChild(content);
        el.appendChild(actions);
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

        // Message actions
        const actions = this.createMessageActions(text, false);

        el.appendChild(role);
        el.appendChild(content);
        el.appendChild(actions);
        this.messagesEl.appendChild(el);
        this.scrollToBottom();
    }

    createMessageActions(text, isUser) {
        const actions = document.createElement('div');
        actions.className = 'msg-actions';

        // Copy button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'msg-action-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(text).then(() => {
                copyBtn.textContent = 'Copied!';
                setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
            });
        });
        actions.appendChild(copyBtn);

        // Retry button (user messages only)
        if (isUser) {
            const retryBtn = document.createElement('button');
            retryBtn.className = 'msg-action-btn';
            retryBtn.textContent = 'Retry';
            retryBtn.addEventListener('click', () => {
                if (!this.isProcessing) {
                    this.inputEl.value = text;
                    this.sendMessage();
                }
            });
            actions.appendChild(retryBtn);
        }

        return actions;
    }

    appendToolCard(toolName, input, toolId) {
        const config = ChatUI.getToolConfig(toolName);

        const card = document.createElement('div');
        card.className = 'tool-card';
        if (toolId) {
            card.dataset.toolId = toolId;
        }

        const header = document.createElement('div');
        header.className = 'tool-card-header';

        const icon = document.createElement('span');
        icon.className = 'tool-card-icon';
        icon.textContent = config.icon;
        icon.style.color = config.color;
        header.appendChild(icon);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'tool-card-name';
        nameSpan.textContent = toolName;
        header.appendChild(nameSpan);

        const labelSpan = document.createElement('span');
        labelSpan.className = 'tool-card-label';
        labelSpan.textContent = ' \u2014 ' + config.label;
        header.appendChild(labelSpan);

        // Show file path for file operations
        if (input && (input.file_path || input.path || input.command)) {
            const pathSpan = document.createElement('span');
            pathSpan.className = 'tool-card-label';
            pathSpan.style.fontFamily = 'var(--font-mono)';
            pathSpan.style.fontSize = '11px';
            pathSpan.style.marginLeft = '8px';
            pathSpan.style.opacity = '0.7';
            const displayVal = input.file_path || input.path || input.command;
            pathSpan.textContent = typeof displayVal === 'string' && displayVal.length > 60
                ? displayVal.substring(0, 60) + '\u2026'
                : displayVal;
            header.appendChild(pathSpan);
        }

        const chevron = document.createElement('span');
        chevron.className = 'tool-card-chevron';
        chevron.textContent = '\u25B6';
        header.appendChild(chevron);

        header.addEventListener('click', () => card.classList.toggle('expanded'));

        const body = document.createElement('div');
        body.className = 'tool-card-body';

        // Render tool-specific content
        if (toolName === 'Edit' || toolName === 'MultiEdit') {
            this.renderEditDiff(body, input);
        } else {
            // JSON syntax highlighted input
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.className = 'language-json';
            code.textContent = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
            pre.appendChild(code);
            body.appendChild(pre);
            if (typeof hljs !== 'undefined') {
                hljs.highlightElement(code);
            }
        }

        card.appendChild(header);
        card.appendChild(body);
        this.messagesEl.appendChild(card);
        this.scrollToBottom();
    }

    renderEditDiff(container, input) {
        if (!input) return;

        if (input.file_path) {
            const fileInfo = document.createElement('div');
            fileInfo.className = 'diff-line-info';
            fileInfo.textContent = input.file_path;
            container.appendChild(fileInfo);
        }

        const oldStr = input.old_string;
        const newStr = input.new_string;

        if (oldStr !== undefined && newStr !== undefined) {
            const diffView = document.createElement('div');
            diffView.className = 'diff-view';

            if (oldStr) {
                const oldLines = oldStr.split('\n');
                for (const line of oldLines) {
                    const div = document.createElement('div');
                    div.className = 'diff-line-removed';
                    div.textContent = '- ' + line;
                    diffView.appendChild(div);
                }
            }

            if (newStr) {
                const newLines = newStr.split('\n');
                for (const line of newLines) {
                    const div = document.createElement('div');
                    div.className = 'diff-line-added';
                    div.textContent = '+ ' + line;
                    diffView.appendChild(div);
                }
            }

            container.appendChild(diffView);
        } else {
            // Fallback to JSON
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.className = 'language-json';
            code.textContent = JSON.stringify(input, null, 2);
            pre.appendChild(code);
            container.appendChild(pre);
            if (typeof hljs !== 'undefined') {
                hljs.highlightElement(code);
            }
        }
    }

    updateToolResult(toolUseId, content) {
        let text = '';
        if (Array.isArray(content)) {
            text = content.map(c => c.text || JSON.stringify(c)).join('\n');
        } else if (typeof content === 'string') {
            text = content;
        } else {
            text = JSON.stringify(content, null, 2);
        }

        const escapedId = CSS.escape(toolUseId);
        const card = this.messagesEl.querySelector(`.tool-card[data-tool-id="${escapedId}"]`)
            || this.messagesEl.querySelector('.tool-card:last-child');
        if (card) {
            const body = card.querySelector('.tool-card-body');
            if (body) {
                const separator = document.createElement('div');
                separator.className = 'diff-separator';
                body.appendChild(separator);

                const resultLabel = document.createElement('div');
                resultLabel.className = 'diff-line-info';
                resultLabel.textContent = 'Result';
                body.appendChild(resultLabel);

                // Try to syntax-highlight the result
                const pre = document.createElement('pre');
                const code = document.createElement('code');
                code.textContent = text;
                pre.appendChild(code);
                body.appendChild(pre);

                // Auto-detect and highlight if possible
                if (typeof hljs !== 'undefined' && text.length < 10000) {
                    hljs.highlightElement(code);
                }
            }
        }
    }

    appendResultInfo(msg) {
        const el = document.createElement('div');
        el.className = 'msg-result';
        const parts = [];
        if (msg.cost_usd != null) parts.push({ text: `Cost: $${msg.cost_usd.toFixed(4)}`, cls: '' });
        if (msg.usage) {
            if (msg.usage.input_tokens) parts.push({ text: `In: ${msg.usage.input_tokens}`, cls: '' });
            if (msg.usage.output_tokens) parts.push({ text: `Out: ${msg.usage.output_tokens}`, cls: '' });
            if (msg.usage.cache_read_input_tokens) {
                parts.push({ text: `Cache Read: ${msg.usage.cache_read_input_tokens}`, cls: 'cache-info' });
            }
            if (msg.usage.cache_creation_input_tokens) {
                parts.push({ text: `Cache Write: ${msg.usage.cache_creation_input_tokens}`, cls: 'cache-info' });
            }
        }
        if (msg.model) parts.push({ text: `Model: ${msg.model}`, cls: '' });
        for (const p of parts) {
            const span = document.createElement('span');
            span.textContent = p.text;
            if (p.cls) span.className = p.cls;
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

    // ── Markdown rendering ──

    /**
     * Safe markdown renderer that returns a DocumentFragment using DOM APIs.
     * Handles: code blocks (with highlight.js), headings, lists, tables,
     * inline code, bold, italic, links, and line breaks.
     */
    renderMarkdownSafe(text) {
        const fragment = document.createDocumentFragment();

        // Split out fenced code blocks first
        const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
        let lastIndex = 0;
        let match;

        while ((match = codeBlockRegex.exec(text)) !== null) {
            // Render block content before this code block
            if (match.index > lastIndex) {
                this._renderBlockSegments(fragment, text.substring(lastIndex, match.index));
            }

            // Create code block with header (lang label + copy button)
            const lang = match[1] || '';
            const codeText = match[2];

            const pre = document.createElement('pre');

            if (lang || true) {
                const headerDiv = document.createElement('div');
                headerDiv.className = 'code-block-header';

                const langLabel = document.createElement('span');
                langLabel.className = 'code-lang-label';
                langLabel.textContent = lang || 'code';
                headerDiv.appendChild(langLabel);

                const copyBtn = document.createElement('button');
                copyBtn.className = 'code-copy-btn';
                copyBtn.textContent = 'Copy';
                copyBtn.addEventListener('click', () => {
                    navigator.clipboard.writeText(codeText).then(() => {
                        copyBtn.textContent = 'Copied!';
                        copyBtn.classList.add('copied');
                        setTimeout(() => {
                            copyBtn.textContent = 'Copy';
                            copyBtn.classList.remove('copied');
                        }, 1500);
                    });
                });
                headerDiv.appendChild(copyBtn);

                pre.appendChild(headerDiv);
            }

            const code = document.createElement('code');
            if (lang) {
                code.className = `language-${lang}`;
            }
            code.textContent = codeText;
            pre.appendChild(code);

            // Apply syntax highlighting
            if (typeof hljs !== 'undefined') {
                hljs.highlightElement(code);
            }

            fragment.appendChild(pre);
            lastIndex = match.index + match[0].length;
        }

        // Render remaining text after last code block
        if (lastIndex < text.length) {
            this._renderBlockSegments(fragment, text.substring(lastIndex));
        }

        return fragment;
    }

    /**
     * Process block-level markdown: headings, lists, tables, then inline.
     */
    _renderBlockSegments(parent, text) {
        const lines = text.split('\n');
        let i = 0;

        while (i < lines.length) {
            const line = lines[i];

            // Heading
            const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
            if (headingMatch) {
                const level = headingMatch[1].length;
                const h = document.createElement('h' + level);
                this._renderInlineSegments(h, headingMatch[2]);
                parent.appendChild(h);
                i++;
                continue;
            }

            // Table: detect | at start
            if (line.trim().startsWith('|') && i + 1 < lines.length && /^\|[\s-:|]+\|/.test(lines[i + 1].trim())) {
                const table = this._parseTable(lines, i);
                if (table.element) {
                    parent.appendChild(table.element);
                    i = table.endIndex;
                    continue;
                }
            }

            // Unordered list
            if (/^\s*[-*]\s+/.test(line)) {
                const list = document.createElement('ul');
                while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
                    const li = document.createElement('li');
                    this._renderInlineSegments(li, lines[i].replace(/^\s*[-*]\s+/, ''));
                    list.appendChild(li);
                    i++;
                }
                parent.appendChild(list);
                continue;
            }

            // Ordered list
            if (/^\s*\d+\.\s+/.test(line)) {
                const list = document.createElement('ol');
                while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
                    const li = document.createElement('li');
                    this._renderInlineSegments(li, lines[i].replace(/^\s*\d+\.\s+/, ''));
                    list.appendChild(li);
                    i++;
                }
                parent.appendChild(list);
                continue;
            }

            // Empty line
            if (line.trim() === '') {
                parent.appendChild(document.createElement('br'));
                i++;
                continue;
            }

            // Regular inline content
            this._renderInlineSegments(parent, line);
            parent.appendChild(document.createElement('br'));
            i++;
        }
    }

    _parseTable(lines, startIndex) {
        const table = document.createElement('table');
        let i = startIndex;

        // Header row
        const headerCells = this._parseTableRow(lines[i]);
        if (headerCells.length === 0) return { element: null, endIndex: i + 1 };

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        for (const cell of headerCells) {
            const th = document.createElement('th');
            this._renderInlineSegments(th, cell);
            headerRow.appendChild(th);
        }
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Skip separator row
        i += 2;

        // Body rows
        const tbody = document.createElement('tbody');
        while (i < lines.length && lines[i].trim().startsWith('|')) {
            const cells = this._parseTableRow(lines[i]);
            if (cells.length === 0) break;
            const tr = document.createElement('tr');
            for (const cell of cells) {
                const td = document.createElement('td');
                this._renderInlineSegments(td, cell);
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
            i++;
        }
        table.appendChild(tbody);

        return { element: table, endIndex: i };
    }

    _parseTableRow(line) {
        return line.split('|').slice(1, -1).map(c => c.trim());
    }

    /**
     * Render inline markdown (inline code, bold, italic, links, plain text)
     * into the given parent node using safe DOM operations.
     */
    _renderInlineSegments(parent, text) {
        // Pattern matches: inline code, links, bold, italic, or plain text
        const inlineRegex = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*|(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|([^`*\[\n]+)/g;
        let m;

        while ((m = inlineRegex.exec(text)) !== null) {
            if (m[1] !== undefined) {
                // Inline code
                const code = document.createElement('code');
                code.textContent = m[1];
                parent.appendChild(code);
            } else if (m[2] !== undefined && m[3] !== undefined) {
                // Link [text](url)
                const a = document.createElement('a');
                a.href = m[3];
                a.textContent = m[2];
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                parent.appendChild(a);
            } else if (m[4] !== undefined) {
                // Bold
                const strong = document.createElement('strong');
                strong.textContent = m[4];
                parent.appendChild(strong);
            } else if (m[5] !== undefined) {
                // Italic
                const em = document.createElement('em');
                em.textContent = m[5];
                parent.appendChild(em);
            } else if (m[6] !== undefined) {
                // Plain text
                parent.appendChild(document.createTextNode(m[6]));
            }
        }
    }

    // Keep old renderMarkdown for backwards compatibility
    renderMarkdown(text) {
        let html = this.escapeHtml(text);
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
            return `<pre><code>${code}</code></pre>`;
        });
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/(?<!\*)\*(?!\*)([^\n]+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
        html = html.replace(/\n/g, '<br>');
        return html;
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    new ChatUI();
});
