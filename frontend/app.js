/**
 * PUME Interview Prototype - Frontend Application
 */

const App = {
    ws: null,
    elements: {},
    state: {
        isConnecting: false,
        isConnected: false,
        isInterviewing: false,
        pendingResponse: false,
        pipelineMode: 'single',
        streamStrategy: 'response_first',
        currentStreamElement: null,
    },

    init() {
        this.cacheElements();
        this.bindEvents();
        this.fetchCompanies();
        this.updateUI();
    },

    cacheElements() {
        // Screens
        this.elements.setupScreen = document.getElementById('setup-screen');
        this.elements.interviewScreen = document.getElementById('interview-screen');

        // Setup Form
        this.elements.companySelect = document.getElementById('company-select');
        this.elements.roleSelect = document.getElementById('role-select');
        this.elements.startBtn = document.getElementById('start-btn');

        // Header
        this.elements.headerCompany = document.getElementById('header-company');
        this.elements.headerRole = document.getElementById('header-role');
        this.elements.headerMode = document.getElementById('header-mode');
        this.elements.headerElapsed = document.getElementById('header-elapsed');
        this.elements.toggleDebugBtn = document.getElementById('toggle-debug');
        this.elements.endInterviewBtn = document.getElementById('end-interview');

        // Chat & Input
        this.elements.chatMessages = document.getElementById('chat-messages');
        this.elements.typingIndicator = document.getElementById('typing-indicator');
        this.elements.messageInput = document.getElementById('message-input');
        this.elements.sendBtn = document.getElementById('send-btn');
        this.elements.charCount = document.getElementById('char-count');
        this.elements.statusIndicator = document.getElementById('status-indicator');

        // Debug Panel
        this.elements.debugPanel = document.getElementById('debug-panel');
        // Debug Values
        this.elements.debugPhase = document.getElementById('debug-phase');
        this.elements.debugProposed = document.getElementById('debug-proposed');
        this.elements.debugReason = document.getElementById('debug-reason');
        this.elements.debugTurn = document.getElementById('debug-turn');
        this.elements.debugDifficulty = document.getElementById('debug-difficulty-bar');
        this.elements.debugRetrieval = document.getElementById('debug-retrieval');
        this.elements.debugAnalysis = document.getElementById('debug-analysis');
        this.elements.debugUnverified = document.getElementById('debug-unverified');
        this.elements.debugStrengths = document.getElementById('debug-strengths');
        this.elements.debugRisks = document.getElementById('debug-risks');
        this.elements.debugPhaseHistory = document.getElementById('debug-phase-history');
    },

    bindEvents() {
        this.elements.companySelect.addEventListener('change', () => this.updateRoleOptions());
        this.elements.startBtn.addEventListener('click', () => this.startInterview());
        this.elements.toggleDebugBtn.addEventListener('click', () => this.toggleDebug());
        this.elements.endInterviewBtn.addEventListener('click', () => this.endInterview());

        // Mode selector
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.pipelineMode = btn.dataset.mode;
                // Show/hide strategy selector
                const strategyGroup = document.getElementById('strategy-group');
                if (btn.dataset.mode === 'single') {
                    strategyGroup.style.display = '';
                } else {
                    strategyGroup.style.display = 'none';
                }
            });
        });

        // Strategy selector
        document.querySelectorAll('.strategy-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.strategy-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.streamStrategy = btn.dataset.strategy;
            });
        });

        this.elements.messageInput.addEventListener('input', (e) => this.handleInput(e));
        this.elements.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        this.elements.sendBtn.addEventListener('click', () => this.sendMessage());
    },

    async fetchCompanies() {
        try {
            const response = await fetch('/api/companies');
            if (response.ok) {
                this.companyData = await response.json();
                this.populateCompanySelect();
            }
        } catch (error) {
            console.error('Failed to fetch companies. Using static options.', error);
        }
    },

    populateCompanySelect() {
        if (!this.companyData) return;

        this.elements.companySelect.innerHTML = '';
        this.companyData.forEach(company => {
            const option = document.createElement('option');
            option.value = company.id;
            option.textContent = company.name;
            this.elements.companySelect.appendChild(option);
        });

        this.updateRoleOptions();
    },

    updateRoleOptions() {
        if (!this.companyData) return;

        const selectedCompanyId = this.elements.companySelect.value;
        const company = this.companyData.find(c => c.id === selectedCompanyId);

        if (company) {
            this.elements.roleSelect.innerHTML = '';
            company.roles.forEach(role => {
                const option = document.createElement('option');
                option.value = role.id;
                option.textContent = role.title;
                this.elements.roleSelect.appendChild(option);
            });
        }
    },

    toggleDebug() {
        const isHidden = this.elements.debugPanel.classList.toggle('hidden');
        this.elements.toggleDebugBtn.classList.toggle('active', !isHidden);
    },

    async startInterview() {
        const companyId = this.elements.companySelect.value;
        const roleId = this.elements.roleSelect.value;
        const companyName = this.elements.companySelect.options[this.elements.companySelect.selectedIndex].text;
        const roleName = this.elements.roleSelect.options[this.elements.roleSelect.selectedIndex].text;
        const pipelineMode = this.state.pipelineMode;
        const streamStrategy = this.state.streamStrategy;

        this.elements.headerCompany.textContent = companyName;
        this.elements.headerRole.textContent = roleName;

        // Update mode badge
        const strategyLabels = {
            'response_first': '⚡ Resp-First',
            'response_only': '💬 Conv-Only',
            'think_response': '🧠 Think',
        };
        if (pipelineMode === 'single') {
            this.elements.headerMode.textContent = strategyLabels[streamStrategy] || '⚡ Single';
        } else {
            this.elements.headerMode.textContent = '🔬 Multi';
        }
        this.elements.headerMode.className = `header-mode-badge mode-${pipelineMode}`;
        this.elements.headerElapsed.textContent = '—';

        this.elements.setupScreen.classList.remove('active');
        this.elements.interviewScreen.classList.add('active');

        this.elements.chatMessages.innerHTML = '';
        this.resetDebugPanel();

        this.connectWebSocket(companyId, roleId, pipelineMode, streamStrategy);
    },

    endInterview() {
        if (confirm("면접을 종료하시겠습니까?")) {
            if (this.ws) {
                this.ws.close();
            }
            this.elements.interviewScreen.classList.remove('active');
            this.elements.setupScreen.classList.add('active');
            this.state.isInterviewing = false;
        }
    },

    connectWebSocket(companyId, roleId, pipelineMode, streamStrategy) {
        this.setConnectionStatus('connecting');

        // Create WebSocket connection (assuming same host for prototype)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        // const host = 'localhost:8000'; // fallback
        const wsUrl = `${protocol}//${host}/ws/interview`;

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('Connected to interview stream');
                this.setConnectionStatus('connected');
                this.state.isInterviewing = true;

                // Send setup message with pipeline mode
                this.ws.send(JSON.stringify({
                    type: 'start_session',
                    company_id: companyId,
                    role_id: roleId,
                    pipeline_mode: pipelineMode,
                    stream_strategy: streamStrategy,
                }));

                this.setTypingIndicator(true);
            };

            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleServerMessage(data);
            };

            this.ws.onclose = () => {
                console.log('Disconnected');
                this.setConnectionStatus('disconnected');
                this.state.isInterviewing = false;
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket Error:', error);
                this.setConnectionStatus('disconnected');
            };

        } catch (e) {
            console.error("Failed to connect", e);
            this.setConnectionStatus('disconnected');
        }
    },

    handleServerMessage(message) {
        if (message.type === 'stream_start') {
            this.setTypingIndicator(false);
            
            // Create a new empty message bubble for the interviewer
            const msgDiv = document.createElement('div');
            msgDiv.className = `message msg-interviewer`;
            msgDiv.innerHTML = `
                <div class="msg-avatar">AI</div>
                <div class="msg-content">
                    <div class="msg-bubble stream-bubble"></div>
                </div>
            `;
            this.elements.chatMessages.appendChild(msgDiv);
            this.scrollToBottom();
            
            // Track the bubble content element
            this.state.currentStreamElement = msgDiv.querySelector('.msg-bubble');
            return;
        }

        if (message.type === 'stream_chunk') {
            if (this.state.currentStreamElement) {
                // Remove trailing quotes, newlines, and brackets for a clean look
                let chunkText = message.data;
                chunkText = chunkText.replace(/\\n/g, '<br>');
                
                this.state.currentStreamElement.innerHTML += chunkText;
                
                // Remove raw HTML/XML tags that might have leaked (like </response or <analysis)
                let currentHtml = this.state.currentStreamElement.innerHTML;
                if (currentHtml.includes('</')) {
                    currentHtml = currentHtml.replace(/<\/?[a-zA-Z]*>?/g, '');
                    this.state.currentStreamElement.innerHTML = currentHtml;
                }
                
                this.scrollToBottom();
            }
            return;
        }

        if (message.type === 'stream_end') {
            this.state.currentStreamElement = null;
            return;
        }

        // Final turn message complete
        this.setTypingIndicator(false);
        this.state.pendingResponse = false;
        this.updateInputState();

        if (message.type === 'interviewer_message') {
            const data = message.data;
            
            // If we were streaming, the last message bubble is the one we created.
            // Let's replace its content with the clean formatted text + add the phase badge.
            if (data.pipeline_mode === 'single') {
                const lastMsg = this.elements.chatMessages.lastElementChild;
                if (lastMsg && lastMsg.classList.contains('msg-interviewer')) {
                    const contentDiv = lastMsg.querySelector('.msg-content');
                    contentDiv.innerHTML = `
                        <div class="msg-bubble">${this.formatText(data.text)}</div>
                        ${data.phase ? `<div class="msg-meta"><span class="msg-phase-badge phase-${data.phase}">${this.formatPhase(data.phase)}</span></div>` : ''}
                    `;
                    this.scrollToBottom();
                } else {
                    this.appendMessage('interviewer', data.text, data.phase);
                }
            } else {
                this.appendMessage('interviewer', data.text, data.phase);
            }
            
            this.updateDebugPanel(data);

            // Update elapsed time in header
            if (data.elapsed_ms !== undefined && data.elapsed_ms > 0) {
                const secs = (data.elapsed_ms / 1000).toFixed(1);
                this.elements.headerElapsed.textContent = `${secs}s`;
            }
        } else if (message.type === 'error') {
            console.error("Server Error:", message.data);
            this.appendMessage('interviewer', "시스템 오류가 발생했습니다. 다시 시도해주세요.", "error");
        }
    },

    sendMessage() {
        const text = this.elements.messageInput.value.trim();
        if (!text || this.state.pendingResponse || !this.state.isConnected) return;

        // Add to UI
        this.appendMessage('user', text);

        // Send to server
        this.ws.send(JSON.stringify({
            type: "user_message",
            text: text
        }));

        // Reset input
        this.elements.messageInput.value = '';
        this.elements.messageInput.style.height = 'auto';
        this.updateCharCount();

        // Show typing indicator
        this.state.pendingResponse = true;
        this.updateInputState();
        this.setTypingIndicator(true);
    },

    appendMessage(role, text, phase = null) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message msg-${role}`;

        let innerHTML = '';

        if (role === 'interviewer') {
            innerHTML += `
                <div class="msg-avatar">AI</div>
                <div class="msg-content">
                    <div class="msg-bubble">${this.formatText(text)}</div>
                    ${phase ? `<div class="msg-meta"><span class="msg-phase-badge phase-${phase}">${this.formatPhase(phase)}</span></div>` : ''}
                </div>
            `;
        } else {
            innerHTML += `
                <div class="msg-content">
                    <div class="msg-bubble">${this.formatText(text)}</div>
                </div>
            `;
        }

        msgDiv.innerHTML = innerHTML;
        this.elements.chatMessages.appendChild(msgDiv);
        this.scrollToBottom();
    },

    setTypingIndicator(show) {
        if (show) {
            this.elements.typingIndicator.classList.remove('hidden');
            this.scrollToBottom();
        } else {
            this.elements.typingIndicator.classList.add('hidden');
        }
    },

    scrollToBottom() {
        this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
    },

    handleInput(e) {
        // Auto-resize textarea
        const target = e.target;
        target.style.height = 'auto';
        target.style.height = Math.min(target.scrollHeight, 200) + 'px';

        this.updateCharCount();
        this.updateInputState();
    },

    updateCharCount() {
        const len = this.elements.messageInput.value.length;
        this.elements.charCount.textContent = `${len} / 2000`;
    },

    updateInputState() {
        const len = this.elements.messageInput.value.trim().length;
        this.elements.sendBtn.disabled = len === 0 || this.state.pendingResponse || !this.state.isConnected;
        this.elements.messageInput.disabled = this.state.pendingResponse || !this.state.isConnected;
    },

    setConnectionStatus(status) {
        const indicator = this.elements.statusIndicator;
        indicator.className = 'status-dot';

        if (status === 'connected') {
            indicator.classList.add('status-connected');
            indicator.textContent = '연결됨';
            this.state.isConnected = true;
        } else if (status === 'disconnected') {
            indicator.classList.add('status-disconnected');
            indicator.textContent = '연결 끊김';
            this.state.isConnected = false;
        } else if (status === 'connecting') {
            indicator.classList.add('status-connecting');
            indicator.textContent = '연결 중...';
            this.state.isConnected = false;
        }

        this.updateInputState();
    },

    /* ── UI Helpers ── */
    formatText(text) {
        // Simple markdown to HTML (newline to br)
        return text.replace(/\n/g, '<br>');
    },

    formatPhase(phase) {
        const map = {
            'technical_question': '기술 질문',
            'behavioral_question': '인성 질문',
            'followup_probe': '꼬리질문',
            'live_qa': 'Live Q&A'
        };
        return map[phase] || phase;
    },

    /* ── Debug Panel Updates ── */
    updateDebugPanel(data) {
        if (!data.debug) return;
        const debug = data.debug;

        this.elements.debugPhase.textContent = data.phase;
        this.elements.debugPhase.className = `debug-value phase-badge phase-${data.phase}`;

        this.elements.debugProposed.textContent = debug.proposed_phase || '-';
        this.elements.debugReason.textContent = data.phase_reason || '-';
        this.elements.debugTurn.textContent = data.turn_id;

        // Difficulty Bar
        const diffBars = Array.from({length: 5}, () => '<span></span>').join('');
        this.elements.debugDifficulty.innerHTML = `<span class="difficulty-bar diff-${data.difficulty}">${diffBars}</span>`;

        this.elements.debugRetrieval.textContent = debug.should_retrieve ? 'Yes (Local)' : 'Skip';

        // Analysis
        if (debug.candidate_analysis) {
            const an = debug.candidate_analysis;
            let text = `목표: ${an.next_probe_goal || '-'}\n`;
            text += `구체성: ${an.specificity || 0} | 깊이: ${an.depth || 0}\n`;
            if (an.missing_evidence && an.missing_evidence.length) {
                text += `미확인: ${an.missing_evidence.join(', ')}`;
            }
            this.elements.debugAnalysis.textContent = text;
        }

        // Tags
        this.updateTags(this.elements.debugUnverified, debug.unverified_competencies);

        // Lists
        this.updateList(this.elements.debugStrengths, debug.strengths || [], 'strength');
        this.updateList(this.elements.debugRisks, debug.risks || [], 'risk');

        // History
        if (debug.phase_history) {
            this.elements.debugPhaseHistory.innerHTML = debug.phase_history
                .map(p => `<span class="flow-item">${this.formatPhase(p)}</span>`)
                .join('');
        }
    },

    updateTags(container, items) {
        if (!items || !items.length) {
            container.innerHTML = '-';
            return;
        }
        container.innerHTML = items.map(item => `<span class="debug-tag">${item}</span>`).join('');
    },

    updateList(container, items, typeClass) {
        if (!items || !items.length) {
            container.innerHTML = '-';
            return;
        }
        container.innerHTML = items.map(item => `<div class="list-item ${typeClass}">${item}</div>`).join('');
    },

    resetDebugPanel() {
        this.elements.debugPhase.textContent = '-';
        this.elements.debugProposed.textContent = '-';
        this.elements.debugReason.textContent = '-';
        this.elements.debugTurn.textContent = '0';
        this.elements.debugAnalysis.textContent = '-';
        this.elements.debugUnverified.innerHTML = '-';
        this.elements.debugStrengths.innerHTML = '-';
        this.elements.debugRisks.innerHTML = '-';
        this.elements.debugPhaseHistory.innerHTML = '-';
    }
};

// Initialize app when DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
