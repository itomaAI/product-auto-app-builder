// js/core.js

// App State
const state = {
    vfs: new VirtualFileSystem({}), // Start empty, will load from DB
    chatHistory: [], 
    apiKey: localStorage.getItem('metaforge_api_key') || '',
    isGenerating: false,
    abortController: null,
    maxTurns: 10,
    pendingUploads: [],
    // Project State
    currentProjectId: null,
    currentProjectName: 'Untitled',
    saveDebounceTimer: null
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
    
    // VFS Change Listener for Auto-Save
    state.vfs.addListener(() => triggerAutoSave());

    // Load API Key UI
    if (state.apiKey) document.getElementById('api-key').value = state.apiKey;

    // Load Project
    try {
        const lastId = await storage.getLastProjectId();
        if (lastId) {
            await loadProject(lastId);
        } else {
            await createNewProject();
        }
    } catch (e) {
        console.error("Init Error:", e);
        await createNewProject(); // Fallback
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
    
    console.log(`Created new project: ${id}`);
}

async function loadProject(id) {
    try {
        const project = await storage.getProject(id);
        if (!project) {
            console.warn(`Project ${id} not found, creating new.`);
            await createNewProject();
            return;
        }
        await loadProjectData(project);
        await storage.setLastProjectId(id);
    } catch (e) {
        console.error("Load Project Error:", e);
        alert("Failed to load project.");
    }
}

async function loadProjectData(project) {
    state.currentProjectId = project.id;
    state.currentProjectName = project.name;
    
    // Restore VFS
    state.vfs.files = { ...project.files };
    
    // Restore Chat
    state.chatHistory = project.chatHistory || [];
    
    // Update UI
    ui.updateProjectName(project.name);
    ui.renderFileList();
    
    // Re-render Chat History
    const chatContainer = document.getElementById('chat-history');
    chatContainer.innerHTML = '';
    
    state.chatHistory.forEach(msg => {
        let role = msg.uiRole || msg.role;
        let text = msg.summaryText || msg.parts.find(p => p.text)?.text || "";
        
        // Backwards compatibility: Detect tool outputs in old data
        if (!msg.uiRole && role === 'user' && text.includes('<tool_outputs>')) {
            role = 'system';
            text = '[System] Tool execution logs (Hidden)';
        }

        const atts = msg.parts.filter(p => !p.text || p.text.startsWith('<user_attachment'));
        ui.addMessage(role, text, atts); 
    });

    ui.updatePreview();
}

// Auto-Save Logic
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

        try {
            await storage.saveProject(project);
            ui.setSaveStatus('saved');
        } catch (e) {
            console.error("Auto-Save failed:", e);
            ui.setSaveStatus('error');
        }
    }, 1000); // 1 sec debounce
}

// --- DOM Event Bindings ---

function bindEvents() {
    const ids = {
        apiKey: 'api-key', btnSaveKey: 'btn-save-key',
        folderUpload: 'folder-upload', filesUpload: 'files-upload',
        btnDownload: 'btn-download', btnRefresh: 'btn-refresh',
        chatInput: 'chat-input', btnSend: 'btn-send', btnStop: 'btn-stop',
        btnCloseEditor: 'btn-close-editor', editorOverlay: 'editor-overlay',
        chatFileUpload: 'chat-file-upload', btnClearChat: 'btn-clear-chat',
        btnNewProject: 'btn-new-project',
        btnNewProjectModal: 'btn-new-project-modal'
    };

    const el = (id) => document.getElementById(ids[id]);

    // Header Actions
    el('btnSaveKey').addEventListener('click', () => {
        state.apiKey = el('apiKey').value.trim();
        localStorage.setItem('metaforge_api_key', state.apiKey);
        alert('API Key Saved');
    });

    // Project Actions
    el('btnNewProject').addEventListener('click', async () => {
        if(confirm("Create new project? Current one is saved.")) {
            await createNewProject();
        }
    });
    el('btnNewProjectModal').addEventListener('click', async () => {
        await createNewProject();
        ui.toggleProjectModal(false);
    });

    // Rename Event
    document.addEventListener('project-renamed', (e) => {
        state.currentProjectName = e.detail;
        triggerAutoSave();
    });

    // List Request
    document.addEventListener('request-project-list', async () => {
        const projects = await storage.getAllProjectsMetadata();
        ui.renderProjectList(
            projects, 
            state.currentProjectId, 
            // On Select
            async (id) => {
                if (id !== state.currentProjectId) {
                    await loadProject(id);
                    ui.toggleProjectModal(false);
                }
            },
            // On Delete
            async (id) => {
                await storage.deleteProject(id);
                // Refresh list
                document.dispatchEvent(new CustomEvent('request-project-list'));
                
                // If deleted current project, create new one
                if (id === state.currentProjectId) {
                    await createNewProject();
                    ui.toggleProjectModal(false);
                }
            }
        );
    });

    // VFS Uploads
    el('folderUpload').addEventListener('change', (e) => handleVfsUpload(e, true));
    el('filesUpload').addEventListener('change', (e) => handleVfsUpload(e, false));
    
    // Download ZIP
    el('btnDownload').addEventListener('click', () => {
        const zip = new JSZip();
        state.vfs.listFiles().forEach(path => {
            if (!path.startsWith('.sample/')) {
                zip.file(path, state.vfs.readFile(path));
            }
        });
        zip.generateAsync({ type: 'blob' }).then(blob => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${state.currentProjectName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.zip`;
            a.click();
        });
    });

    el('btnRefresh').addEventListener('click', () => ui.updatePreview());
    el('btnCloseEditor').addEventListener('click', () => el('editorOverlay').classList.add('hidden'));
    
    // Chat Controls
    el('btnSend').addEventListener('click', handleSend);
    el('btnStop').addEventListener('click', handleStop);
    el('chatInput').addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') handleSend();
    });

    el('chatFileUpload').addEventListener('change', handleChatUpload);
    el('btnClearChat').addEventListener('click', () => {
        if(confirm("Clear chat history? (Project files will remain)")) {
            state.chatHistory = [];
            document.getElementById('chat-history').innerHTML = '';
            triggerAutoSave();
        }
    });
}

// --- VFS Upload Logic (Project Files) ---
async function handleVfsUpload(e, isFolder) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    
    for (const file of files) {
        let relPath = file.name;
        if (isFolder && file.webkitRelativePath) {
            const parts = file.webkitRelativePath.split('/');
            relPath = parts.slice(1).join('/'); 
        }
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

// --- Chat Upload Logic (Context) ---
async function handleChatUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    for (const file of files) {
        state.pendingUploads.push(file);
        ui.renderUploadPreview(file);
    }
    e.target.value = "";
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file); 
        reader.onload = () => resolve(reader.result); 
        reader.onerror = reject;
    });
}

// --- Agent Logic ---
async function handleSend() {
    const inputEl = document.getElementById('chat-input');
    const text = inputEl.value.trim();
    if (!text && state.pendingUploads.length === 0) return;
    if (!state.apiKey) return alert('Please set API Key first.');

    const userParts = [];
    
    for (const file of state.pendingUploads) {
        if (file.type.startsWith('text/') || 
            file.name.match(/\.(js|py|html|json|css|md|txt)$/)) {
            
            const content = await file.text();
            userParts.push({ text: `<user_attachment name="${file.name}">\n${content}\n</user_attachment>` });
        } else {
            const dataUrl = await fileToBase64(file);
            const base64 = dataUrl.split(',')[1];
            userParts.push({ inlineData: { mimeType: file.type, data: base64 } });
        }
    }
    
    if (text) userParts.push({ text: text });

    state.pendingUploads = [];
    ui.clearUploadPreviews();
    inputEl.value = '';

    const msgId = Date.now();
    // ★ Add uiRole for consistency
    const msgObj = { role: 'user', parts: userParts, id: msgId, uiRole: 'user' };
    state.chatHistory.push(msgObj);
    triggerAutoSave(); // Save User Message
    
    ui.addMessage('user', text, userParts, () => {
        state.chatHistory = state.chatHistory.filter(m => m.id !== msgId);
        triggerAutoSave();
    });

    setGenerating(true);
    if (!client) client = new GeminiClient(state.apiKey, CONFIG.MODEL_NAME);

    await runAgentLoop();
}

async function runAgentLoop() {
    state.abortController = new AbortController();
    let turn = 0;
    
    try {
        while (turn < state.maxTurns) {
            turn++;
            console.log(`--- Turn ${turn} ---`);

            // map removes custom props like uiRole/summaryText before sending to API
            const apiHistory = [
                { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
                ...state.chatHistory.map(m => ({ role: m.role, parts: m.parts }))
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

            // ★ Add uiRole
            state.chatHistory.push({ role: 'model', parts: [{ text: fullResponse }], id: Date.now(), uiRole: 'model' });
            triggerAutoSave(); // Save AI Response

            const tree = LPMLParser.parse(fullResponse, true, ['create_file', 'edit_file']);
            const results = await tools.execute(tree);

            if (tree.some(t => t.tag === 'finish')) break;
            if (results.length === 0) break;

            const feedbackParts = [];
            const textOutputs = [];
            
            for (const res of results) {
                if (res.type === 'text') textOutputs.push(res.value);
                if (res.type === 'image') {
                    feedbackParts.push({ inlineData: { mimeType: 'image/png', data: res.value } });
                    textOutputs.push(`[System] Screenshot captured.`);
                }
            }
            
            feedbackParts.push({ text: `<tool_outputs>\n${textOutputs.join('\n\n')}\n</tool_outputs>` });
            
            // ★ Add uiRole & summaryText for clean restoration
            const feedbackMsg = { 
                role: 'user', // Keep 'user' for API context
                parts: feedbackParts, 
                id: Date.now(),
                uiRole: 'system', // Use 'system' for UI
                summaryText: `Executed ${results.length} tool(s).`
            };
            state.chatHistory.push(feedbackMsg);
            triggerAutoSave(); // Save Tool Output

            ui.addMessage('system', `Executed ${results.length} tool(s).`, 
                feedbackParts.filter(p => p.inlineData));
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error(err);
            ui.addMessage('system', `Error: ${err.message}`);
        }
    } finally {
        setGenerating(false);
        state.abortController = null;
    }
}

function setGenerating(isGen) {
    state.isGenerating = isGen;
    const ids = { btnSend: 'btn-send', btnStop: 'btn-stop', aiTyping: 'ai-typing', chatInput: 'chat-input' };
    const el = (id) => document.getElementById(ids[id]);
    
    el('btnSend').classList.toggle('hidden', isGen);
    el('btnStop').classList.toggle('hidden', !isGen);
    el('aiTyping').classList.toggle('hidden', !isGen);
    el('chatInput').disabled = isGen;
    if(!isGen) el('chatInput').focus();
}

function handleStop() {
    if (state.abortController) state.abortController.abort();
}

// Start
document.addEventListener('DOMContentLoaded', init);