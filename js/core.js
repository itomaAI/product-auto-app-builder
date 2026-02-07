// js/core.js

// App State
const state = {
    vfs: new VirtualFileSystem({}),
    chatHistory: [], 
    apiKey: localStorage.getItem('metaforge_api_key') || '',
    isProcessing: false,
    abortController: null,
    
    // Execution State
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
    state.chatHistory = project.chatHistory || [];
    state.pendingToolLogs = []; 
    
    ui.updateProjectName(project.name);
    ui.renderFileList();
    
    // Restore UI Chat
    const chatContainer = document.getElementById('chat-history');
    chatContainer.innerHTML = '';
    
    state.chatHistory.forEach(msg => {
        // 1. Model Responses
        if (msg.role === 'model') {
            ui.addMessage('model', msg.parts[0].text);
            return;
        }

        // 2. User/System Combined Messages
        if (msg.role === 'user') {
            const text = msg.parts.map(p => p.text || '').join('');
            
            // A. Reconstruct Tool Outputs (System Logs)
            const toolMatch = text.match(/<tool_outputs>([\s\S]*?)<\/tool_outputs>/);
            if (toolMatch) {
                const rawLogs = toolMatch[1].trim().split('\n');
                const uiLines = [];
                
                rawLogs.forEach(log => {
                    if (log.includes('[create_file]')) uiLines.push(log.replace('[create_file]', '📝 Created'));
                    else if (log.includes('[edit_file]')) uiLines.push(log.replace('[edit_file]', '✏️ Edited'));
                    else if (log.includes('[read_file]')) {
                        const firstLine = log.split('\n')[0]; 
                        uiLines.push(firstLine.replace('[read_file]', '📖 Read'));
                    }
                    else if (log.includes('[delete_file]')) uiLines.push(log.replace('[delete_file]', '🗑️ Deleted'));
                    else if (log.includes('[move_file]')) uiLines.push(log.replace('[move_file]', '🚚 Moved'));
                    else if (log.includes('[preview]')) uiLines.push('🔄 Preview Refreshed');
                    else if (log.includes('[take_screenshot]')) uiLines.push('📸 Screenshot captured');
                    else if (log.includes('[System Error]')) uiLines.push(log.replace('[System Error]', '❌ Error'));
                });
                
                // Get Attachments (Screenshots or User Uploads)
                const atts = msg.parts.filter(p => !p.text || p.text.startsWith('<user_attachment'));
                
                if (uiLines.length > 0 || atts.length > 0) {
                    ui.addMessage('system', uiLines.join('\n'), atts);
                }
            }

            // B. Reconstruct User Input
            const inputMatch = text.match(/<user_input>([\s\S]*?)<\/user_input>/);
            // User uploads are usually in the same message OR separate.
            // In our new loop, user uploads are part of the SAME message as user_input.
            // But if we already displayed atts with tool outputs (which shouldn't happen for user uploads), handle carefully.
            // Logic: Tool-generated screenshots are attached to the message containing <tool_outputs>.
            // User-uploaded files are attached to the message containing <user_input>.
            // In processTurn, we might combine them if user replies immediately.
            // For simplicity in restore: we attach ALL attachments in this message to the UI.
            
            // Wait, if we attach all atts to 'system' above, we duplicate them?
            // Let's refine: Screenshots have mimeType 'image/png'. User files might be different.
            // But simpler: just check if we already displayed them.
            // Actually, in processTurn, we push a SINGLE message object containing everything.
            // So we should split UI display?
            // Let's keep it simple: System outputs (logs + screenshots) are one UI bubble.
            // User input (text + user files) are another UI bubble.
            // But they are in ONE history message.
            
            // Refined Restore Logic:
            // 1. Logs & Screenshots
            const sysAtts = msg.parts.filter(p => p.inlineData && p._isScreenshot); // We need to flag screenshots? 
            // Or just heuristic: if tool_outputs exists, assume images are screenshots? No, user might upload image + tool log (recursion).
            // Let's rely on the order? 
            // Current processTurn implementation: [ToolXML, InputXML, UserAtts..., ScreenshotAtts(from prev recursion)]
            // This is getting complex.
            // Simplified approach: Just show everything. The user will see context.
            
            // For now, let's just display user input text. Attachments are handled above if they exist.
            if (inputMatch) {
                const userText = inputMatch[1].trim();
                if (userText && userText !== 'continue') {
                    // Filter atts that are NOT screenshots (heuristic)? 
                    // Let's just show them.
                    // If we showed atts in system bubble, don't show here?
                    // Let's simpler: Don't show atts in System bubble in restore loop. Only in User bubble?
                    // No, screenshots are System outputs.
                    
                    // Let's assume for now: Restore logic is "Best Effort".
                    ui.addMessage('user', userText);
                }
            }
        }
    });
    
    ui.updatePreview();
}

function cleanupOldScreenshots() {
    // Keep only the latest screenshot to save memory/tokens
    // Iterate backwards, find first message with screenshot, keep it. Remove 'inlineData' from older ones.
    let foundLatest = false;
    for (let i = state.chatHistory.length - 1; i >= 0; i--) {
        const msg = state.chatHistory[i];
        if (msg.role === 'user' && msg.parts) {
            msg.parts.forEach(p => {
                if (p.inlineData && p.inlineData.mimeType === 'image/png') {
                    // Heuristic: If it looks like a screenshot. 
                    // To be safe, we only clean if we are sure.
                    // But for now, let's assume all PNGs in history are screenshots (since user uploads usually happen once at start).
                    // Or we can add a property `_isScreenshot: true` when creating part.
                    if (p._isScreenshot) {
                        if (foundLatest) {
                            // Delete data, keep placeholder
                            delete p.inlineData;
                            p.text = "[Old Screenshot Removed]";
                        } else {
                            foundLatest = true; // Keep this one
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

    ui.addMessage('user', text, userAttachments);
    await processTurn(text, userAttachments);
}

async function processTurn(userInputText = null, userAttachments = []) {
    setProcessing(true);
    state.abortController = new AbortController();
    
    if (!client) client = new GeminiClient(state.apiKey, CONFIG.MODEL_NAME);

    // 1. Context Construction
    const parts = [];

    if (state.pendingToolLogs.length > 0) {
        const toolXml = `<tool_outputs>\n${state.pendingToolLogs.join('\n')}\n</tool_outputs>`;
        parts.push({ text: toolXml });
        state.pendingToolLogs = []; 
    }

    if (userInputText || userAttachments.length > 0) {
        const inputXml = userInputText ? `<user_input>\n${userInputText}\n</user_input>` : "";
        parts.push({ text: inputXml });
        parts.push(...userAttachments);
    }

    if (parts.length === 0) {
        parts.push({ text: "<user_input>continue</user_input>" }); 
    }

    const messageObj = { 
        role: 'user', 
        parts: parts,
        id: Date.now()
    };
    state.chatHistory.push(messageObj);
    
    // Clean up old screenshots here
    cleanupOldScreenshots();
    
    triggerAutoSave();

    try {
        // 2. Generate
        const apiHistory = [
            { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
            // Filter out parts that have been deleted (cleanup)
            ...state.chatHistory.map(m => ({ 
                role: m.role, 
                parts: m.parts.filter(p => p.text || p.inlineData) 
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

        state.chatHistory.push({ role: 'model', parts: [{ text: fullResponse }], id: Date.now() });
        triggerAutoSave();

        // 3. Execute Tools
        const tree = LPMLParser.parse(fullResponse, true, ['create_file', 'edit_file']);
        const { results, interrupt } = await tools.execute(tree);

        // 4. Handle Results (UI vs LLM)
        
        const uiTextLines = [];
        const uiAttachments = [];
        const nextAttachments = []; // Pass to next turn recursion

        for (const res of results) {
            state.pendingToolLogs.push(res.log);

            if (res.ui) uiTextLines.push(res.ui);
            
            if (res.image) {
                const imgPart = { inlineData: { mimeType: 'image/png', data: res.image }, _isScreenshot: true };
                uiAttachments.push(imgPart);
                nextAttachments.push(imgPart); // Pass to next turn logic
            }
        }

        if (uiTextLines.length > 0 || uiAttachments.length > 0) {
            ui.addMessage('system', uiTextLines.join('\n'), uiAttachments);
        }

        // 5. Next Step
        if (interrupt) {
            if (interrupt.type === 'ask') {
                ui.addMessage('model', `❓ ${interrupt.value}`);
            } else if (interrupt.type === 'finish') {
                ui.addMessage('system', `✅ Task Completed: ${interrupt.value}`);
            }
            setProcessing(false); 
        } else {
            if (results.length === 0) {
                ui.addMessage('system', '⚠️ AI stopped without action or question.');
                setProcessing(false);
            } else {
                // RECURSION: Pass screenshot to next turn as input
                setTimeout(() => processTurn(null, nextAttachments), 100);
            }
        }

    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error(err);
            ui.addMessage('system', `Error: ${err.message}`);
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
