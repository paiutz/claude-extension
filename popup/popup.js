// popup.js - Main Extension Logic

class ClaudeAssistant {
    constructor() {
        this.conversations = [];
        this.currentConversationId = null;
        this.isProcessing = false;
        this.selectedText = '';
        this.pageContent = '';
        this.currentTabInfo = null;
        
        this.init();
    }

    async init() {
        // Load saved data
        await this.loadConversations();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Get current tab info
        await this.getCurrentTabInfo();
        
        // Check for selected text
        await this.checkSelectedText();
        
        // Initialize conversation
        if (this.conversations.length === 0) {
            this.createNewConversation();
        } else {
            this.loadConversation(this.conversations[0].id);
        }
        
        // Show welcome message if first time
        const isFirstTime = await this.getStorageData('firstTime', true);
        if (isFirstTime) {
            this.showWelcomeMessage();
            await this.setStorageData('firstTime', false);
        }
    }

    setupEventListeners() {
        // Send button
        document.getElementById('sendBtn').addEventListener('click', () => this.sendMessage());
        
        // Input field
        const input = document.getElementById('messageInput');
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // Auto-resize textarea
        input.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 100) + 'px';
        });
        
        // Header buttons
        document.getElementById('captureBtn').addEventListener('click', () => this.capturePageContent());
        document.getElementById('searchBtn').addEventListener('click', () => this.toggleWebSearch());
        document.getElementById('newChatBtn').addEventListener('click', () => this.createNewConversation());
        document.getElementById('optionsBtn').addEventListener('click', () => this.openOptions());
        
        // Quick action buttons
        document.querySelectorAll('.quick-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleQuickAction(e.target.dataset.action));
        });
        
        // Attach file button
        document.getElementById('attachBtn').addEventListener('click', () => this.attachFile());
        
        // Message context menu
        this.setupContextMenu();
    }

    setupContextMenu() {
        const contextMenu = document.getElementById('contextMenu');
        
        // Hide context menu on click outside
        document.addEventListener('click', () => {
            contextMenu.style.display = 'none';
        });
        
        // Context menu items
        document.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                this.handleContextMenuAction(action);
            });
        });
    }

    async getCurrentTabInfo() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        this.currentTabInfo = {
            url: tab.url,
            title: tab.title,
            id: tab.id
        };
    }

    async checkSelectedText() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            const result = await chrome.tabs.sendMessage(tab.id, {
                action: 'getSelectedText'
            });
            
            if (result && result.selectedText) {
                this.selectedText = result.selectedText;
                this.showSelectedTextPrompt();
            }
        } catch (error) {
            console.log('No text selected or content script not loaded');
        }
    }

    showSelectedTextPrompt() {
        if (this.selectedText) {
            const container = document.getElementById('chatContainer');
            const promptDiv = document.createElement('div');
            promptDiv.className = 'message system';
            promptDiv.innerHTML = `
                <div class="message-content" style="background: linear-gradient(135deg, rgba(255, 215, 61, 0.1) 0%, rgba(255, 193, 7, 0.1) 100%); border-color: rgba(255, 215, 61, 0.3);">
                    <div style="margin-bottom: 0.5rem;">📌 <strong>Testo selezionato dalla pagina:</strong></div>
                    <div style="background: rgba(0,0,0,0.2); padding: 0.5rem; border-radius: 4px; font-size: 0.85rem;">
                        ${this.escapeHtml(this.selectedText.substring(0, 200))}${this.selectedText.length > 200 ? '...' : ''}
                    </div>
                    <div style="margin-top: 0.5rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                        <button class="quick-btn" onclick="assistant.askAboutSelection('explain')">💡 Spiega</button>
                        <button class="quick-btn" onclick="assistant.askAboutSelection('summarize')">📝 Riassumi</button>
                        <button class="quick-btn" onclick="assistant.askAboutSelection('translate')">🌐 Traduci</button>
                    </div>
                </div>
            `;
            container.appendChild(promptDiv);
        }
    }

    askAboutSelection(action) {
        const prompts = {
            'explain': `Spiega questo testo:\n\n"${this.selectedText}"`,
            'summarize': `Riassumi questo testo:\n\n"${this.selectedText}"`,
            'translate': `Traduci questo testo in italiano:\n\n"${this.selectedText}"`
        };
        
        document.getElementById('messageInput').value = prompts[action] || this.selectedText;
        this.sendMessage();
    }

    async capturePageContent() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            // Inject script to get page content
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    // Get main content
                    const content = document.body.innerText || document.body.textContent;
                    const title = document.title;
                    const url = window.location.href;
                    
                    // Try to get main article content if exists
                    const article = document.querySelector('article, main, [role="main"], .content, #content');
                    const mainContent = article ? article.innerText : content;
                    
                    return {
                        title,
                        url,
                        content: mainContent.substring(0, 5000), // Limit to 5000 chars
                        fullLength: mainContent.length
                    };
                }
            });
            
            if (results && results[0]) {
                this.pageContent = results[0].result;
                this.showCapturedContent();
            }
        } catch (error) {
            console.error('Error capturing page:', error);
            this.showMessage('Non posso catturare il contenuto di questa pagina', 'system');
        }
    }

    showCapturedContent() {
        const { title, url, content, fullLength } = this.pageContent;
        
        this.showMessage(`📷 Contenuto catturato da: ${title}\n\n${content.substring(0, 500)}...`, 'web');
        
        // Add to input
        const input = document.getElementById('messageInput');
        input.value = `Analizza questo contenuto dalla pagina "${title}":\n\n${content}`;
        input.focus();
    }

    async sendMessage() {
        if (this.isProcessing) return;
        
        const input = document.getElementById('messageInput');
        const message = input.value.trim();
        
        if (!message) return;
        
        this.isProcessing = true;
        document.getElementById('sendBtn').disabled = true;
        this.updateStatus('Elaborazione...');
        
        // Add user message
        this.addMessage(message, 'user');
        input.value = '';
        input.style.height = 'auto';
        
        // Save to conversation
        this.saveMessageToConversation(message, 'user');
        
        try {
            // Check if web search is enabled
            const webSearchEnabled = await this.getStorageData('webSearchEnabled', false);
            let context = '';
            
            if (webSearchEnabled) {
                // Perform web search first
                const searchResults = await this.performWebSearch(message);
                if (searchResults.length > 0) {
                    context = this.formatSearchContext(searchResults);
                    this.showSearchResults(searchResults);
                }
            }
            
            // Prepare full prompt with context
            const fullPrompt = this.buildPrompt(message, context);
            
            // Show loading
            const loadingId = this.showLoading();
            
            // Call Claude via Puter.js
            const model = document.getElementById('modelSelect').value;
            const response = await puter.ai.chat(fullPrompt, {
                model: model,
                stream: true
            });
            
            // Remove loading
            this.removeLoading(loadingId);
            
            // Stream response
            const responseDiv = this.addMessage('', 'assistant');
            let fullResponse = '';
            
            for await (const part of response) {
                if (part?.text) {
                    fullResponse += part.text;
                    responseDiv.querySelector('.message-content').textContent = fullResponse;
                    this.scrollToBottom();
                }
            }
            
            // Save response
            this.saveMessageToConversation(fullResponse, 'assistant');
            
            // Add copy button to code blocks
            this.addCopyButtons(responseDiv);
            
        } catch (error) {
            console.error('Error:', error);
            this.removeLoading();
            this.addMessage(`❌ Errore: ${error.message}`, 'system');
        } finally {
            this.isProcessing = false;
            document.getElementById('sendBtn').disabled = false;
            this.updateStatus('Pronto');
        }
    }

    buildPrompt(message, context = '') {
        const conversation = this.conversations.find(c => c.id === this.currentConversationId);
        let prompt = '';
        
        // Add conversation history
        if (conversation && conversation.messages.length > 0) {
            const history = conversation.messages.slice(-10).map(m => 
                `${m.role}: ${m.content}`
            ).join('\n');
            prompt += `Conversazione precedente:\n${history}\n\n`;
        }
        
        // Add page context if available
        if (this.currentTabInfo) {
            prompt += `Pagina corrente: ${this.currentTabInfo.title} (${this.currentTabInfo.url})\n\n`;
        }
        
        // Add web search context
        if (context) {
            prompt += `Informazioni dal web:\n${context}\n\n`;
        }
        
        // Add user message
        prompt += `Utente: ${message}\n\nRispondi in italiano:`;
        
        return prompt;
    }

    async performWebSearch(query) {
        // This would need a backend proxy or use a free search API
        // For demo purposes, returning mock data
        return [
            {
                title: "Risultato di esempio 1",
                snippet: "Questo è un esempio di risultato di ricerca.",
                url: "https://example.com/1"
            }
        ];
    }

    formatSearchContext(results) {
        return results.map(r => `- ${r.title}: ${r.snippet}`).join('\n');
    }

    showSearchResults(results) {
        const container = document.getElementById('chatContainer');
        const resultsDiv = document.createElement('div');
        resultsDiv.className = 'message web';
        resultsDiv.innerHTML = `
            <div class="message-avatar">🔍</div>
            <div class="message-content">
                <div style="font-weight: 600; margin-bottom: 0.5rem;">Risultati ricerca web:</div>
                ${results.map(r => `
                    <div class="web-result">
                        <div class="web-result-title">${r.title}</div>
                        <div style="font-size: 0.85rem; color: var(--text-secondary);">${r.snippet}</div>
                        <a href="${r.url}" target="_blank" class="web-result-url">${r.url}</a>
                    </div>
                `).join('')}
            </div>
        `;
        container.appendChild(resultsDiv);
        this.scrollToBottom();
    }

    handleQuickAction(action) {
        const prompts = {
            'summarize': 'Riassumi il contenuto di questa pagina',
            'explain': 'Spiega cosa fa questa pagina',
            'translate': 'Traduci il contenuto principale di questa pagina in italiano',
            'improve': 'Come posso migliorare questo contenuto?',
            'code': 'Genera del codice basato su questa pagina',
            'analyze': 'Analizza questa pagina e fornisci insights'
        };
        
        const input = document.getElementById('messageInput');
        input.value = prompts[action] || '';
        input.focus();
    }

    addMessage(content, type) {
        const container = document.getElementById('chatContainer');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.dataset.messageId = Date.now();
        
        const avatar = {
            'user': 'U',
            'assistant': 'C',
            'system': '⚡',
            'web': '🔍'
        }[type] || '?';
        
        messageDiv.innerHTML = `
            <div class="message-avatar">${avatar}</div>
            <div class="message-content">${this.escapeHtml(content)}</div>
        `;
        
        // Add context menu for assistant messages
        if (type === 'assistant') {
            messageDiv.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showContextMenu(e, messageDiv.dataset.messageId);
            });
        }
        
        container.appendChild(messageDiv);
        this.scrollToBottom();
        
        return messageDiv;
    }

    showMessage(content, type) {
        this.addMessage(content, type);
    }

    showLoading() {
        const container = document.getElementById('chatContainer');
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'message assistant';
        loadingDiv.id = `loading-${Date.now()}`;
        loadingDiv.innerHTML = `
            <div class="message-avatar">C</div>
            <div class="message-content">
                <div class="loading">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        `;
        container.appendChild(loadingDiv);
        this.scrollToBottom();
        return loadingDiv.id;
    }

    removeLoading(loadingId) {
        const loading = document.getElementById(loadingId || 'loading');
        if (loading) loading.remove();
    }

    showContextMenu(event, messageId) {
        const menu = document.getElementById('contextMenu');
        menu.style.display = 'block';
        menu.style.left = `${event.pageX}px`;
        menu.style.top = `${event.pageY}px`;
        menu.dataset.messageId = messageId;
    }

    handleContextMenuAction(action) {
        const menu = document.getElementById('contextMenu');
        const messageId = menu.dataset.messageId;
        
        switch(action) {
            case 'copy':
                this.copyMessage(messageId);
                break;
            case 'regenerate':
                this.regenerateMessage(messageId);
                break;
            case 'delete':
                this.deleteMessage(messageId);
                break;
        }
        
        menu.style.display = 'none';
    }

    copyMessage(messageId) {
        const message = document.querySelector(`[data-message-id="${messageId}"] .message-content`);
        if (message) {
            navigator.clipboard.writeText(message.textContent);
            this.showNotification('Messaggio copiato!');
        }
    }

    regenerateMessage(messageId) {
        // Find the user message before this assistant message
        const messages = document.querySelectorAll('.message');
        let userMessage = '';
        
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].classList.contains('user')) {
                userMessage = messages[i].querySelector('.message-content').textContent;
                break;
            }
        }
        
        if (userMessage) {
            // Delete the assistant message
            this.deleteMessage(messageId);
            // Resend the user message
            document.getElementById('messageInput').value = userMessage;
            this.sendMessage();
        }
    }

    deleteMessage(messageId) {
        const message = document.querySelector(`[data-message-id="${messageId}"]`);
        if (message) {
            message.remove();
        }
    }

    addCopyButtons(messageDiv) {
        const codeBlocks = messageDiv.querySelectorAll('pre');
        codeBlocks.forEach(block => {
            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-code-btn';
            copyBtn.textContent = '📋';
            copyBtn.title = 'Copia codice';
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(block.textContent);
                this.showNotification('Codice copiato!');
            };
            block.appendChild(copyBtn);
        });
    }

    showNotification(message) {
        // Use Chrome notifications API
        chrome.notifications.create({
            type: 'basic',
            iconUrl: '/icons/icon48.png',
            title: 'Claude AI Assistant',
            message: message
        });
    }

    showWelcomeMessage() {
        const welcomeMessage = `👋 Benvenuto in Claude AI Assistant!
        
Ecco cosa puoi fare:
• Chatta con Claude direttamente dal browser
• Cattura e analizza il contenuto delle pagine web
• Usa shortcuts (Ctrl+Shift+C per aprirmi)
• Seleziona testo su qualsiasi pagina e chiedi spiegazioni
• Cerca informazioni sul web (configurabile)

Inizia con una domanda o usa i pulsanti rapidi sopra!`;
        
        this.addMessage(welcomeMessage, 'system');
    }

    createNewConversation() {
        const id = Date.now().toString();
        const conversation = {
            id,
            title: `Chat ${new Date().toLocaleString('it-IT')}`,
            messages: [],
            createdAt: new Date().toISOString()
        };
        
        this.conversations.unshift(conversation);
        this.currentConversationId = id;
        this.saveConversations();
        this.clearChat();
    }

    loadConversation(id) {
        this.currentConversationId = id;
        const conversation = this.conversations.find(c => c.id === id);
        
        if (conversation) {
            this.clearChat();
            conversation.messages.forEach(msg => {
                this.addMessage(msg.content, msg.role);
            });
        }
    }

    saveMessageToConversation(content, role) {
        const conversation = this.conversations.find(c => c.id === this.currentConversationId);
        if (conversation) {
            conversation.messages.push({
                content,
                role,
                timestamp: new Date().toISOString()
            });
            this.saveConversations();
        }
    }

    clearChat() {
        document.getElementById('chatContainer').innerHTML = '';
    }

    async loadConversations() {
        const data = await this.getStorageData('conversations', []);
        this.conversations = data;
    }

    async saveConversations() {
        await this.setStorageData('conversations', this.conversations);
    }

    async getStorageData(key, defaultValue = null) {
        return new Promise((resolve) => {
            chrome.storage.local.get([key], (result) => {
                resolve(result[key] !== undefined ? result[key] : defaultValue);
            });
        });
    }

    async setStorageData(key, value) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ [key]: value }, resolve);
        });
    }

    updateStatus(text) {
        document.getElementById('statusText').textContent = text;
    }

    scrollToBottom() {
        const container = document.getElementById('chatContainer');
        container.scrollTop = container.scrollHeight;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    openOptions() {
        chrome.runtime.openOptionsPage();
    }

    attachFile() {
        // Create file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'text/*,.pdf,.doc,.docx';
        
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const content = e.target.result;
                    const messageInput = document.getElementById('messageInput');
                    messageInput.value = `Analizza questo file (${file.name}):\n\n${content.substring(0, 1000)}...`;
                    messageInput.focus();
                };
                reader.readAsText(file);
            }
        };
        
        input.click();
    }

    toggleWebSearch() {
        // Toggle web search setting
        this.getStorageData('webSearchEnabled', false).then(enabled => {
            this.setStorageData('webSearchEnabled', !enabled);
            this.showNotification(`Ricerca web ${!enabled ? 'attivata' : 'disattivata'}`);
        });
    }
}

// Initialize assistant when DOM is ready
let assistant;
document.addEventListener('DOMContentLoaded', () => {
    assistant = new ClaudeAssistant();
    window.assistant = assistant; // Make it globally accessible for inline handlers
});
