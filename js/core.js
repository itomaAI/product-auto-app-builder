// js/core.js

// App State
const state = {
    vfs: new VirtualFileSystem({}),
    chatHistory: [], 
    apiKey: localStorage.getItem('metaforge_api_key') || '',
    isProcessing: false,
    abortController: null,
    
    // Execution State
    // Stores objects: { log: "<xml>...", ui: "📝 Created...", report: "...", image: "base64..." }
    pendingToolLogs: [], 
    
    // Project State
    currentProjectId: null,
    currentProjectName: 'Untitled',
    saveDebounceTimer: null,
    pendingUploads: []
};

// Modules
const storage = new StorageManager();
const compiler = new Compiler(state.vfs);
const ui = new UIManager(state.vfs, compiler);
const tools = new ToolExecutor(state.vfs, ui);
let client = null;

// --- Helper: Message Factory ---

function createChatEntry(role, parts, flags = {}) {
    return {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        role: role, 
        parts: parts,
        flags: {
            type: 'message',      // 'user_input', 'raw_response', 'tool_log', 'ai_report', 'ai_ask'
            isVisible: true,      // Show in UI?
            isContext: true,      // Send to API?
            uiRole: role,         // 'user', 'model', 'system'
            cachedUiText: null,   // Pre-formatted text for UI
            ...flags
        }
    };
}

// --- Initialization ---

async function init() {
    bindEvents();
    state.vfs.addListener(() => triggerAutoSave());
    if (state.apiKey) document.getElementById('api-key').value = state.apiKey;

    try {
        const lastId = await storage.getLastProjectId();
        if (lastId) await loadProject(lastId);
        else await createNewProject();
    } catch (e) {
        console.error("Init Error:", e);
        await createNewProject();
    }
}

// --- Project Management ---

async function createNewProject() {
    const id = crypto.randomUUID();
    const name = new Date().toLocaleString();
    const newProject = {
        id: id,
        name: name,
        lastModified: Date.now(),
        files: { ...CONFIG.DEFAULT_FILES },
        chatHistory: []
    };
    await loadProjectData(newProject);
    await storage.saveProject(newProject);
    await storage.setLastProjectId(id);
}

async function loadProject(id) {
    const project = await storage.getProject(id);
    if (!project) return createNewProject();
    await loadProjectData(project);
    await storage.setLastProjectId(id);
}

async function loadProjectData(project) {
    state.currentProjectId = project.id;
    state.currentProjectName = project.name;
    state.vfs.files = { ...project.files };
    state.pendingToolLogs = []; 
    state.chatHistory = project.chatHistory || [];
    
    ui.updateProjectName(project.name);
    ui.renderFileList();
    
    // Restore UI Chat
    const chatContainer = document.getElementById('chat-history');
    chatContainer.innerHTML = '';
    
    state.chatHistory.forEach(msg => {
        if (!msg.flags.isVisible) return;

        const text = msg.flags.cachedUiText !== null 
            ? msg.flags.cachedUiText 
            : msg.parts.map(p => p.text || '').join('');
            
        const attachments = msg.parts.filter(p => p.inlineData || (p.text && p.text.startsWith('<user_attachment')));
        
        ui.addMessage(msg.flags.uiRole, text, attachments);
    });
    
    ui.updatePreview();
}

function cleanupOldScreenshots() {
    let foundLatest = false;
    for (let i = state.chatHistory.length - 1; i >= 0; i--) {
        const msg = state.chatHistory[i];
        if (msg.flags.isContext && msg.role === 'user' && msg.parts) {
            msg.parts.forEach(p => {
                if (p.inlineData && p.inlineData.mimeType === 'image/png') {
                    if (p._isScreenshot) {
                        if (foundLatest) {
                            delete p.inlineData;
                            p.text = "[Old Screenshot Removed]";
                        } else {
                            foundLatest = true;
                        }
                    }
                }
            });
        }
    }
}

function triggerAutoSave() {
    ui.setSaveStatus('saving');
    if (state.saveDebounceTimer) clearTimeout(state.saveDebounceTimer);
    state.saveDebounceTimer = setTimeout(async () => {
        if (!state.currentProjectId) return;
        const project = {
            id: state.currentProjectId,
            name: state.currentProjectName,
            lastModified: Date.now(),
            files: { ...state.vfs.files },
            chatHistory: state.chatHistory
        };
        await storage.saveProject(project);
        ui.setSaveStatus('saved');
    }, 1000);
}

// --- DOM Events ---

function bindEvents() {
    const el = (id) => document.getElementById(id);

    el('btn-save-key').addEventListener('click', () => {
        state.apiKey = el('api-key').value.trim();
        localStorage.setItem('metaforge_api_key', state.apiKey);
        alert('API Key Saved');
    });

    el('btn-new-project').addEventListener('click', async () => {
        if(confirm("Create new project?")) await createNewProject();
    });
    
    el('btn-new-project-modal').addEventListener('click', async () => {
        await createNewProject();
        ui.toggleProjectModal(false);
    });

    document.addEventListener('project-renamed', (e) => {
        state.currentProjectName = e.detail;
        triggerAutoSave();
    });

    document.addEventListener('request-project-list', async () => {
        const projects = await storage.getAllProjectsMetadata();
        ui.renderProjectList(projects, state.currentProjectId, 
            async (id) => { if(id !== state.currentProjectId) { await loadProject(id); ui.toggleProjectModal(false); } },
            async (id) => { await storage.deleteProject(id); document.dispatchEvent(new CustomEvent('request-project-list')); if(id === state.currentProjectId) { await createNewProject(); ui.toggleProjectModal(false); } }
        );
    });

    el('folder-upload').addEventListener('change', (e) => handleVfsUpload(e, true));
    el('files-upload').addEventListener('change', (e) => handleVfsUpload(e, false));
    
    el('btn-download').addEventListener('click', () => {
        const zip = new JSZip();
        state.vfs.listFiles().forEach(path => {
            if (!path.startsWith('.sample/')) zip.file(path, state.vfs.readFile(path));
        });
        zip.generateAsync({ type: 'blob' }).then(blob => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${state.currentProjectName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.zip`;
            a.click();
        });
    });

    el('btn-refresh').addEventListener('click', () => ui.updatePreview());
    el('btn-close-editor').addEventListener('click', () => el('editor-overlay').classList.add('hidden'));
    
    el('btn-send').addEventListener('click', handleSend);
    el('btn-stop').addEventListener('click', handleStop);
    el('chat-input').addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') handleSend();
    });

    el('chat-file-upload').addEventListener('change', handleChatUpload);
    el('btn-clear-chat').addEventListener('click', () => {
        if(confirm("Clear chat history?")) {
            state.chatHistory = [];
            state.pendingToolLogs = [];
            document.getElementById('chat-history').innerHTML = '';
            triggerAutoSave();
        }
    });
}

// --- Handlers ---

async function handleVfsUpload(e, isFolder) {
    const files = Array.from(e.target.files);
    for (const file of files) {
        let relPath = file.name;
        if (isFolder && file.webkitRelativePath) relPath = file.webkitRelativePath.split('/').slice(1).join('/');
        if (!relPath) continue;

        if (file.type.startsWith('image/') || file.type === 'application/pdf') {
            const b64 = await fileToBase64(file);
            state.vfs.writeFile(relPath, b64); 
        } else {
            const text = await file.text();
            state.vfs.writeFile(relPath, text);
        }
    }
    ui.renderFileList();
    ui.updatePreview();
}

async function handleChatUpload(e) {
    const files = Array.from(e.target.files);
    for (const file of files) {
        state.pendingUploads.push(file);
        ui.renderUploadPreview(file);
    }
    e.target.value = "";
}

function fileToBase64(file) {
    return new Promise((r, j) => {
        const reader = new FileReader();
        reader.readAsDataURL(file); 
        reader.onload = () => r(reader.result); 
        reader.onerror = j;
    });
}

// --- Core Logic: State Machine ---

async function handleSend() {
    const inputEl = document.getElementById('chat-input');
    const text = inputEl.value.trim();
    if (!text && state.pendingUploads.length === 0) return;
    if (!state.apiKey) return alert('Please set API Key first.');

    // Build User Input
    const userAttachments = [];
    for (const file of state.pendingUploads) {
        if (file.type.startsWith('text/') || file.name.match(/\.(js|py|html|json|css|md|txt)$/)) {
            const content = await file.text();
            userAttachments.push({ text: `<user_attachment name="${file.name}">\n${content}\n</user_attachment>` });
        } else {
            const dataUrl = await fileToBase64(file);
            const base64 = dataUrl.split(',')[1];
            userAttachments.push({ inlineData: { mimeType: file.type, data: base64 } });
        }
    }

    state.pendingUploads = [];
    ui.clearUploadPreviews();
    inputEl.value = '';

    // Add to history (Visible & Context)
    const entry = createChatEntry('user', [{ text: text }, ...userAttachments], {
        type: 'user_input',
        isVisible: true,
        isContext: true,
        uiRole: 'user',
        cachedUiText: text // User text is safe to render as is
    });
    
    state.chatHistory.push(entry);
    ui.addMessage('user', text, userAttachments);
    
    // Call processTurn WITHOUT arguments. 
    await processTurn();
}

async function processTurn(incomingAttachments = []) {
    setProcessing(true);
    state.abortController = new AbortController();
    
    if (!client) client = new GeminiClient(state.apiKey, CONFIG.MODEL_NAME);

    // 1. Context Construction
    // Bundle "Pending Logs" and "Incoming Attachments" (Recursive Screenshots) into a new History Entry.
    const contextParts = [];

    // A. Tool Logs (from previous turn)
    if (state.pendingToolLogs.length > 0) {
        const toolXml = `<tool_outputs>\n${state.pendingToolLogs.map(i => i.log).join('\n')}\n</tool_outputs>`;
        contextParts.push({ text: toolXml });
    }

    // B. Incoming Attachments (Screenshots from recursive call)
    if (incomingAttachments.length > 0) {
        contextParts.push(...incomingAttachments);
    }

    // If there is new context to add...
    if (contextParts.length > 0) {
        // UI Text for logs (if any)
        const uiText = state.pendingToolLogs.map(i => i.ui).filter(Boolean).join('\n');
        
        const logEntry = createChatEntry('user', contextParts, {
            type: 'tool_log',
            isVisible: true,  
            isContext: true,  
            uiRole: 'system',
            cachedUiText: uiText 
        });
        state.chatHistory.push(logEntry);
        
        // Render in UI (logs + images)
        if (uiText.trim() || incomingAttachments.length > 0) {
            ui.addMessage('system', uiText, incomingAttachments);
        }
        
        state.pendingToolLogs = []; 
    } 
    // Trigger if completely empty start (auto-run case)
    else if (state.chatHistory.length === 0) {
         const triggerEntry = createChatEntry('user', [{ text: "<user_input>continue</user_input>" }], {
             type: 'auto_trigger',
             isVisible: false,
             isContext: true
         });
         state.chatHistory.push(triggerEntry);
    }

    cleanupOldScreenshots();
    triggerAutoSave();

    try {
        // 2. API Request
        // IMPORTANT: Sanitize parts to remove internal flags like _isScreenshot
        const apiHistory = [
            { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
            ...state.chatHistory
                .filter(m => m.flags.isContext)
                .map(m => ({ 
                    role: m.role, 
                    parts: m.parts
                        .filter(p => p.text || p.inlineData)
                        .map(p => {
                            if (p.text) return { text: p.text };
                            if (p.inlineData) return { inlineData: p.inlineData };
                            return null;
                        })
                        .filter(Boolean)
                }))
        ];

        const aiMsgDiv = ui.addMessage('model', '...');
        const aiContent = aiMsgDiv.querySelector('.msg-content');
        let fullResponse = "";

        await client.generateStream(
            apiHistory, 
            (chunk) => {
                fullResponse += chunk;
                aiContent.textContent = fullResponse; 
                ui.els.chatHistory.scrollTop = ui.els.chatHistory.scrollHeight;
            },
            state.abortController.signal
        );

        aiMsgDiv.remove(); 

        // 3. Save Raw Response
        const rawEntry = createChatEntry('model', [{ text: fullResponse }], {
            type: 'raw_response',
            isVisible: false, 
            isContext: true,
            uiRole: 'model'
        });
        state.chatHistory.push(rawEntry);
        triggerAutoSave();

        // 4. Execute Tools
        const tree = LPMLParser.parse(fullResponse, true, ['create_file', 'edit_file']);
        const { results, interrupt } = await tools.execute(tree);

        // 5. Process Results
        const reports = [];
        const nextAttachments = []; 

        for (const res of results) {
            state.pendingToolLogs.push(res); // Store full result object for context log
            if (res.report) reports.push(res.report);
            if (res.image) {
                const imgPart = { inlineData: { mimeType: 'image/png', data: res.image }, _isScreenshot: true };
                nextAttachments.push(imgPart); 
            }
        }

        // 6. UI Messages
        for (const report of reports) {
            const msg = `📢 ${report}`;
            const reportEntry = createChatEntry('model', [{ text: msg }], {
                type: 'ai_report',
                isVisible: true,
                isContext: false, 
                uiRole: 'model',
                cachedUiText: msg
            });
            state.chatHistory.push(reportEntry);
            ui.addMessage('model', msg);
        }

        if (interrupt) {
            if (interrupt.type === 'ask') {
                const askMsg = `❓ ${interrupt.value}`;
                const askEntry = createChatEntry('model', [{ text: askMsg }], {
                    type: 'ai_ask',
                    isVisible: true,
                    isContext: false,
                    uiRole: 'model',
                    cachedUiText: askMsg
                });
                state.chatHistory.push(askEntry);
                ui.addMessage('model', askMsg);

            } else if (interrupt.type === 'finish') {
                const finishMsg = `✅ Task Completed: ${interrupt.value}`;
                const finishEntry = createChatEntry('model', [{ text: finishMsg }], {
                    type: 'ai_finish',
                    isVisible: true,
                    isContext: false,
                    uiRole: 'system',
                    cachedUiText: finishMsg
                });
                state.chatHistory.push(finishEntry);
                ui.addMessage('system', finishMsg);
            }
            setProcessing(false); 
        } else {
            if (results.length === 0) {
                // Assuming thinking process
                setTimeout(() => processTurn(nextAttachments), 100);
            } else {
                setTimeout(() => processTurn(nextAttachments), 100);
            }
        }
        
        triggerAutoSave();

    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error(err);
            ui.addMessage('system', `Error: ${err.message}`);
            state.chatHistory.push(createChatEntry('model', [{ text: `[System Error] ${err.message}` }], {
                type: 'error',
                isVisible: true,
                isContext: true,
                cachedUiText: `❌ System Error: ${err.message}`
            }));
        }
        setProcessing(false);
    }
}

function setProcessing(isProc) {
    state.isProcessing = isProc;
    const el = (id) => document.getElementById(id);
    
    el('btn-send').classList.toggle('hidden', isProc);
    el('btn-stop').classList.toggle('hidden', !isProc);
    el('ai-typing').classList.toggle('hidden', !isProc);
    el('chat-input').disabled = isProc;
    if(!isProc) el('chat-input').focus();
}

function handleStop() {
    if (state.abortController) state.abortController.abort();
}

document.addEventListener('DOMContentLoaded', init);