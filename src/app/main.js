// src/app/main.js

document.addEventListener('DOMContentLoaded', async () => {
    // Shortcuts
    const { ALLA, App } = window;
    const { Engine, WorldState } = ALLA;
    const { Config } = App;
    const { VirtualFileSystem, Compiler } = App.World;
    const { UIController, DOM } = App.UI;
    const { Registry } = App.Tools;
    const { GeminiAdapter, LPMLAdapter, MetaForgeProjector, StorageAdapter } = App.Adapters;

    // --- 1. Initialize Adapters & Infrastructure ---
    const storage = new StorageAdapter();
    const parser = new LPMLAdapter();
    const projector = new MetaForgeProjector(Config.SYSTEM_PROMPT);
    const compiler = new Compiler();
    
    // --- 2. Initialize Logic Components (Empty state initially) ---
    const vfs = new VirtualFileSystem({}); 
    const state = new WorldState(vfs); 
    const registry = new Registry();
    const ui = new UIController(compiler);

    // Register Tools
    App.Tools.registerFSTools(registry, vfs);
    App.Tools.registerNavTools(registry, vfs);
    App.Tools.registerUITools(registry, ui);

    // LLM Init
    let apiKey = localStorage.getItem('metaforge_api_key') || '';
    if (apiKey && document.getElementById(DOM.apiKey)) document.getElementById(DOM.apiKey).value = apiKey;
    
    // Set Model Status from Config
    if (DOM.modelStatus && document.getElementById(DOM.modelStatus)) {
        document.getElementById(DOM.modelStatus).innerText = Config.MODEL_NAME;
    }
    
    const createLLM = () => new GeminiAdapter(apiKey, Config.MODEL_NAME);
    let llm = createLLM();

    const engine = new Engine(state, projector, llm, parser, registry);

    // --- 3. Helpers ---
    
    const fileToBase64 = (file) => {
        return new Promise((r, j) => {
            const reader = new FileReader();
            reader.readAsDataURL(file); 
            reader.onload = () => r(reader.result); 
            reader.onerror = j;
        });
    };

    // --- 4. Project Management Logic ---
    
    let currentProjectId = null;
    let currentProjectName = "Untitled";
    let saveDebounceTimer = null;

    const loadProjectData = (project) => {
        currentProjectId = project.id;
        currentProjectName = project.name;
        
        // VFS Restore
        vfs.files = { ...project.files }; // Reset files
        vfs.notify(); 
        
        // History Restore
        // Engineが参照するstate.historyを置換
        state.history = project.chatHistory || [];
        
        // UI Update
        ui.renderHistory(state.getHistory());
        ui.refreshPreview(vfs);
        ui.updateProjectName(currentProjectName);
    };

    const createNewProject = async () => {
        const id = crypto.randomUUID();
        const project = {
            id: id,
            name: new Date().toLocaleString(),
            files: { ...Config.DEFAULT_FILES },
            chatHistory: []
        };
        await storage.saveProject(project.id, project.name, project.files, project.chatHistory);
        await storage.setLastProjectId(id);
        loadProjectData(project);
    };

    const triggerAutoSave = () => {
        if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
        ui.setSaveStatus('saving');

        saveDebounceTimer = setTimeout(async () => {
            if (!currentProjectId) return;
            await storage.saveProject(
                currentProjectId, 
                currentProjectName, 
                vfs.files, 
                state.getHistory()
            );
            ui.setSaveStatus('saved');
        }, 1000);
    };

    // --- 5. Event Bindings (Wiring) ---

    // Engine Events
    engine.on('turn_start', (data) => {
        if (data.role === ALLA.Role.MODEL) {
            ui.setProcessing(true);
            // ★ストリーミング開始
            ui.startStreaming();
        }
    });

    // ★ストリーミング更新
    engine.on('stream_chunk', (chunk) => {
        ui.updateStreaming(chunk);
    });
    
    engine.on('turn_end', (data) => {
        // ★Modelターンの終了時のみストリーミング完了処理を行う
        if (data.role === ALLA.Role.MODEL) {
            ui.finalizeStreaming();
        } else {
            // SystemやUserの場合は普通に描画更新
            ui.renderHistory(state.getHistory());
        }
        triggerAutoSave();
    });

    engine.on('loop_stop', (data) => {
        // 強制終了やエラー時もストリーミングを閉じる
        if (ui.currentStreamEl) ui.finalizeStreaming();
        
        ui.setProcessing(false);
        // 全体整合性のためリロード
        ui.renderHistory(state.getHistory());
        triggerAutoSave();
        
        if (data.reason === 'error') alert('Engine Error. See console.');
    });


    // VFS Events
    vfs.subscribe((files) => {
        ui.renderFileList(Object.keys(files).sort());
        triggerAutoSave();
    });

    // UI: Project Events
    document.addEventListener('project-rename', (e) => {
        currentProjectName = e.detail;
        triggerAutoSave();
    });

    document.addEventListener('request-project-list', async () => {
        const projects = await storage.getAllProjectsMetadata();
        ui.renderProjectList(projects);
    });

    document.addEventListener('project-select', async (e) => {
        const id = e.detail;
        if (id === currentProjectId) return;
        const project = await storage.getProject(id);
        if (project) {
            loadProjectData(project);
            await storage.setLastProjectId(id);
        }
    });

    document.addEventListener('project-delete', async (e) => {
        const id = e.detail;
        await storage.deleteProject(id);
        // Refresh list
        const projects = await storage.getAllProjectsMetadata();
        ui.renderProjectList(projects);
        
        // If deleted current, create new
        if (id === currentProjectId) {
            await createNewProject();
        }
    });
    
    // Button: New Project (Sidebar & Modal)
    const btnNew = document.getElementById(DOM.btnNewProject);
    if(btnNew) btnNew.addEventListener('click', async () => {
        if(confirm("Create new project?")) await createNewProject();
    });
    const btnNewModal = document.getElementById(DOM.btnNewProjectModal);
    if(btnNewModal) btnNewModal.addEventListener('click', async () => {
        await createNewProject();
        ui.toggleProjectModal(false);
    });

    // UI: File Operations
    // Download ZIP
    const btnDownload = document.getElementById(DOM.btnDownload);
    if(btnDownload) btnDownload.addEventListener('click', async () => {
        if (typeof JSZip === 'undefined') { alert('JSZip not loaded'); return; }
        const zip = new JSZip();
        const files = vfs.listFiles();
        files.forEach(path => {
            if (!path.startsWith('.sample/')) {
                let content = vfs.readFile(path);
                // 画像データ(Base64 URI)の場合の対応
                if (content.startsWith('data:')) {
                    const base64 = content.split(',')[1];
                    zip.file(path, base64, { base64: true });
                } else {
                    zip.file(path, content);
                }
            }
        });
        const blob = await zip.generateAsync({ type: 'blob' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${currentProjectName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.zip`;
        a.click();
    });

    // Upload Handlers
    const handleFileUpload = async (e, isFolder) => {
        const files = Array.from(e.target.files);
        for (const file of files) {
            let relPath = file.name;
            if (isFolder && file.webkitRelativePath) {
                relPath = file.webkitRelativePath.split('/').slice(1).join('/');
            }
            if (!relPath) continue;

            if (file.type.startsWith('image/') || file.type === 'application/pdf') {
                const dataUrl = await fileToBase64(file);
                vfs.writeFile(relPath, dataUrl);
            } else {
                const text = await file.text();
                vfs.writeFile(relPath, text);
            }
        }
        e.target.value = ""; // Reset
    };

    if (document.getElementById(DOM.folderUpload)) {
        document.getElementById(DOM.folderUpload).addEventListener('change', (e) => handleFileUpload(e, true));
    }
    if (document.getElementById(DOM.filesUpload)) {
        document.getElementById(DOM.filesUpload).addEventListener('change', (e) => handleFileUpload(e, false));
    }

    // Chat Clear
    const btnClear = document.getElementById(DOM.btnClear);
    if(btnClear) btnClear.addEventListener('click', () => {
        if(confirm("Clear chat history?")) {
            state.history = []; // Clear ALLA history
            ui.renderHistory([]);
            triggerAutoSave();
        }
    });

    // Chat Send
    const handleSend = async () => {
        const inputEl = document.getElementById(DOM.chatInput);
        const text = inputEl.value.trim();
        const pendingFiles = ui.pendingUploads;

        if (!text && pendingFiles.length === 0) return;
        if (!apiKey) { alert('Please set API Key'); return; }

        inputEl.value = '';
        ui.clearUploadPreviews();
        ui.pendingUploads = [];
        ui.setProcessing(true);

        // Build Content for ALLA
        const content = [];
        if (text) content.push({ text });

        // Process attachments
        for (const file of pendingFiles) {
            if (file.type.startsWith('text/') || file.name.match(/\.(js|py|html|json|css|md|txt)$/)) {
                const textContent = await file.text();
                content.push({ text: `<user_attachment name="${file.name}">\n${textContent}\n</user_attachment>` });
            } else {
                const dataUrl = await fileToBase64(file);
                const base64 = dataUrl.split(',')[1];
                content.push({ inlineData: { mimeType: file.type, data: base64 } });
            }
        }

        // Refresh LLM with latest key
        engine.llm = createLLM(); 
        
        try {
            await engine.injectUserTurn(content);
        } catch (e) {
            console.error(e);
            ui.setProcessing(false);
            alert("Error: " + e.message);
        }
    };

    const btnSend = document.getElementById(DOM.btnSend);
    if(btnSend) btnSend.addEventListener('click', handleSend);

    const btnStop = document.getElementById(DOM.btnStop);
    if(btnStop) btnStop.addEventListener('click', () => {
        engine.stop(); // LLMの通信と自律ループを中断
        ui.setProcessing(false); // UIを入力可能状態に戻す
    });
    
    const chatInput = document.getElementById(DOM.chatInput);
    if(chatInput) chatInput.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') handleSend();
    });

    // API Key Save
    const btnSaveKey = document.getElementById(DOM.btnSaveKey);
    if(btnSaveKey) btnSaveKey.addEventListener('click', () => {
        apiKey = document.getElementById(DOM.apiKey).value.trim();
        localStorage.setItem('metaforge_api_key', apiKey);
        alert('API Key Saved');
    });

    // Editor & File Open
    document.getElementById(DOM.fileList).addEventListener('file-open', (e) => {
        const path = e.detail;
        const content = vfs.readFile(path);
        // DataURLの場合（画像など）の処理
        if (content.startsWith('data:')) {
            alert("Binary/Image file cannot be edited in text editor.");
        } else {
            ui.openEditor(path, content);
        }
    });

    // --- 6. Boot Sequence ---
    console.log("MetaForge v2 (ALLA) Booting...");
    try {
        const lastId = await storage.getLastProjectId();
        if (lastId) {
            const project = await storage.getProject(lastId);
            if (project) {
                loadProjectData(project);
            } else {
                await createNewProject();
            }
        } else {
            await createNewProject();
        }
    } catch (e) {
        console.error("Boot Error:", e);
        // Fallback
        vfs.files = { ...Config.DEFAULT_FILES };
        ui.renderFileList(Object.keys(vfs.files));
        ui.refreshPreview(vfs);
    }
});