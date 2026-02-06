// js/ui.js

class UIManager {
    constructor(vfs, compiler) {
        this.vfs = vfs;
        this.compiler = compiler;
        this.els = {
            fileList: document.getElementById('file-list'),
            previewFrame: document.getElementById('preview-frame'),
            previewLoader: document.getElementById('preview-loader'),
            codeEditor: document.getElementById('code-editor'),
            editorOverlay: document.getElementById('editor-overlay'),
            editorFilename: document.getElementById('editor-filename'),
            chatHistory: document.getElementById('chat-history'),
            chatResizer: document.getElementById('chat-resizer'),
            chatPanel: document.getElementById('chat-panel'),
            filePreviewArea: document.getElementById('file-preview-area'),
            // Project UI
            projectName: document.getElementById('current-project-name'),
            projectRenameInput: document.getElementById('project-rename-input'),
            projectSelectTrigger: document.getElementById('project-select-trigger'),
            projectModal: document.getElementById('project-modal'),
            projectList: document.getElementById('project-list'),
            btnCloseModal: document.getElementById('btn-close-modal'),
            btnNewProjectModal: document.getElementById('btn-new-project-modal'),
            saveStatus: document.getElementById('save-status')
        };
        
        this._initResizer();
        this._initProjectUI();
    }

    _initProjectUI() {
        // Toggle Modal
        this.els.projectSelectTrigger.addEventListener('click', (e) => {
            // If clicking input, don't toggle
            if (e.target === this.els.projectRenameInput) return;
            this.toggleProjectModal(true);
        });

        this.els.btnCloseModal.addEventListener('click', () => this.toggleProjectModal(false));
        this.els.projectModal.addEventListener('click', (e) => {
            if (e.target === this.els.projectModal) this.toggleProjectModal(false);
        });

        // Rename logic
        this.els.projectName.addEventListener('dblclick', () => this.startRename());
        this.els.projectRenameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.finishRename();
            if (e.key === 'Escape') this.cancelRename();
        });
        this.els.projectRenameInput.addEventListener('blur', () => this.finishRename());
    }

    // --- Resizer Logic ---
    _initResizer() {
        let isResizing = false;
        
        const startResize = (e) => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            this.els.chatResizer.classList.add('resizing');
        };

        const stopResize = () => {
            isResizing = false;
            document.body.style.cursor = '';
            this.els.chatResizer.classList.remove('resizing');
        };

        const resize = (e) => {
            if (!isResizing) return;
            const newWidth = document.body.clientWidth - e.clientX;
            this.els.chatPanel.style.width = `${newWidth}px`;
        };

        this.els.chatResizer.addEventListener('mousedown', startResize);
        document.addEventListener('mousemove', resize);
        document.addEventListener('mouseup', stopResize);
    }

    // --- Project UI Methods ---
    
    updateProjectName(name) {
        this.els.projectName.textContent = name;
        this.els.projectRenameInput.value = name;
    }

    startRename() {
        this.els.projectRenameInput.classList.remove('hidden');
        this.els.projectRenameInput.focus();
        this.els.projectName.classList.add('opacity-0');
    }

    finishRename() {
        const newName = this.els.projectRenameInput.value.trim();
        if (newName) {
            this.updateProjectName(newName);
            // Notify Core (handled via event dispatch usually, but here we call direct or trigger event)
            document.dispatchEvent(new CustomEvent('project-renamed', { detail: newName }));
        }
        this.cancelRename();
    }

    cancelRename() {
        this.els.projectRenameInput.classList.add('hidden');
        this.els.projectName.classList.remove('opacity-0');
    }

    toggleProjectModal(show) {
        if (show) {
            this.els.projectModal.classList.remove('hidden');
            // Trigger refresh of list
            document.dispatchEvent(new CustomEvent('request-project-list'));
        } else {
            this.els.projectModal.classList.add('hidden');
        }
    }

    renderProjectList(projects, currentId, onSelect, onDelete) {
        this.els.projectList.innerHTML = '';
        
        if (projects.length === 0) {
            this.els.projectList.innerHTML = '<div class="text-gray-500 text-center text-xs p-4">No history yet.</div>';
            return;
        }

        projects.forEach(p => {
            const date = new Date(p.lastModified).toLocaleString();
            const isActive = p.id === currentId;
            
            const div = document.createElement('div');
            div.className = `flex justify-between items-center p-3 mb-2 rounded border transition ${
                isActive ? 'bg-blue-900/30 border-blue-600' : 'bg-gray-700 border-gray-600 hover:border-gray-500'
            }`;

            const infoDiv = document.createElement('div');
            infoDiv.className = "flex flex-col cursor-pointer flex-1";
            infoDiv.onclick = () => onSelect(p.id);
            
            const nameSpan = document.createElement('span');
            nameSpan.className = `font-bold text-sm ${isActive ? 'text-blue-300' : 'text-gray-200'}`;
            nameSpan.textContent = p.name || '(Untitled)';
            
            const dateSpan = document.createElement('span');
            dateSpan.className = "text-[10px] text-gray-400";
            dateSpan.textContent = date;

            infoDiv.append(nameSpan, dateSpan);
            
            const delBtn = document.createElement('button');
            delBtn.className = "ml-3 p-2 text-gray-500 hover:text-red-400 hover:bg-gray-800 rounded transition";
            delBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                if(confirm(`Delete project "${p.name}"?`)) onDelete(p.id);
            };

            div.append(infoDiv, delBtn);
            this.els.projectList.appendChild(div);
        });
    }

    setSaveStatus(state) {
        const el = this.els.saveStatus;
        if (state === 'saving') {
            el.textContent = 'Saving...';
            el.className = 'text-[10px] text-yellow-500 italic mr-2 self-center transition opacity-100';
        } else if (state === 'saved') {
            el.textContent = 'Saved';
            el.className = 'text-[10px] text-green-500 italic mr-2 self-center transition opacity-100';
            setTimeout(() => {
                if (el.textContent === 'Saved') el.classList.add('opacity-0');
            }, 2000);
        } else {
            el.classList.add('opacity-0');
        }
    }

    // --- File List & Editor ---
    renderFileList() {
        const files = this.vfs.listFiles();
        this.els.fileList.innerHTML = '';
        files.forEach(path => {
            const li = document.createElement('li');
            li.className = 'cursor-pointer hover:bg-gray-700 p-1 rounded px-2 flex items-center gap-2 truncate text-gray-300';
            li.innerHTML = `<span>📄</span> ${path}`;
            li.onclick = () => this.openEditor(path);
            this.els.fileList.appendChild(li);
        });
    }

    openEditor(path) {
        const content = this.vfs.readFile(path);
        this.els.codeEditor.value = content;
        this.els.editorFilename.textContent = path;
        this.els.editorOverlay.classList.remove('hidden');
    }

    // --- Preview ---
    async updatePreview() {
        this.els.previewLoader.classList.remove('hidden');
        
        const iframeLoadPromise = new Promise((resolve) => {
            const handler = () => {
                this.els.previewFrame.removeEventListener('load', handler);
                resolve();
            };
            this.els.previewFrame.addEventListener('load', handler);
        });

        const loadWithTimeout = Promise.race([
            iframeLoadPromise,
            new Promise(resolve => setTimeout(resolve, 5000)) 
        ]);

        try {
            const entryUrl = await this.compiler.compile();
            if (entryUrl) {
                this.els.previewFrame.src = entryUrl;
                await loadWithTimeout;
            } else {
                this.els.previewFrame.srcdoc = '<div style="color:#888; padding:20px; font-family:sans-serif;">No index.html found.</div>';
                await new Promise(r => setTimeout(r, 100));
            }
        } catch (e) {
            console.error("Preview update error:", e);
        } finally {
            setTimeout(() => this.els.previewLoader.classList.add('hidden'), 200);
        }
    }

    // --- Chat Rendering ---
    addMessage(role, text, attachments = null, onDelete = null) {
        const div = document.createElement('div');
        div.className = `relative group p-3 rounded-lg text-sm mb-2 border border-transparent hover:border-gray-700 transition ${
            role === 'user' ? 'bg-blue-900 text-blue-100 ml-4' : 
            role === 'model' ? 'bg-gray-700 text-gray-200 mr-4' :
            'bg-red-900 text-red-200 text-xs mx-8'
        }`;
        
        // Metadata & Delete Button
        const header = document.createElement('div');
        header.className = "flex justify-between items-center mb-1";
        
        const meta = document.createElement('span');
        meta.className = "text-[10px] font-bold uppercase opacity-50";
        meta.textContent = role;
        header.appendChild(meta);

        if (onDelete) {
            const delBtn = document.createElement('button');
            delBtn.innerHTML = '✕';
            delBtn.className = "text-gray-500 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition";
            delBtn.onclick = () => {
                div.remove();
                onDelete();
            };
            header.appendChild(delBtn);
        }
        div.appendChild(header);

        // Attachments
        if (attachments && attachments.length > 0) {
            const imgContainer = document.createElement('div');
            imgContainer.className = "flex flex-wrap gap-2 mb-2";
            attachments.forEach(att => {
                if (att.inlineData) {
                    const img = document.createElement('img');
                    img.src = `data:${att.inlineData.mimeType};base64,${att.inlineData.data}`;
                    img.className = "h-16 rounded border border-gray-600 cursor-pointer hover:opacity-80 bg-gray-900";
                    img.onclick = () => {
                        const w = window.open("");
                        w.document.write(`<img src="${img.src}" style="max-width:100%">`);
                    };
                    imgContainer.appendChild(img);
                } else if (att.text && att.text.startsWith('<user_attachment')) {
                    const span = document.createElement('span');
                    span.className = "text-xs bg-gray-800 px-2 py-1 rounded border border-gray-600 text-blue-300 font-mono";
                    const nameMatch = att.text.match(/name="([^"]+)"/);
                    span.textContent = `📎 ${nameMatch ? nameMatch[1] : 'Text File'}`;
                    imgContainer.appendChild(span);
                }
            });
            div.appendChild(imgContainer);
        }

        const content = document.createElement('div');
        content.className = "msg-content whitespace-pre-wrap font-mono break-all"; 
        content.textContent = text || "";
        div.appendChild(content);

        this.els.chatHistory.appendChild(div);
        this.els.chatHistory.scrollTop = this.els.chatHistory.scrollHeight;
        return div;
    }

    renderUploadPreview(file) {
        this.els.filePreviewArea.classList.remove('hidden');
        const div = document.createElement('div');
        div.className = "bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs flex items-center gap-2 text-gray-300 animate-fade-in";
        div.innerHTML = `<span>📎 ${file.name}</span>`;
        this.els.filePreviewArea.appendChild(div);
    }

    clearUploadPreviews() {
        this.els.filePreviewArea.innerHTML = "";
        this.els.filePreviewArea.classList.add('hidden');
    }
}