// js/tools.js

class ToolExecutor {
    constructor(vfs, uiManager) {
        this.vfs = vfs;
        this.ui = uiManager;
    }

    async execute(tree) {
        // --- 1. Split & Sort ---
        const immediateOps = [];
        let interruptOp = null;

        for (const item of tree) {
            if (item.tag === 'ask' || item.tag === 'finish') {
                interruptOp = item;
            } else {
                immediateOps.push(item);
            }
        }

        // Sort edit_file (Path ASC -> Start Line DESC)
        const edits = [];
        const others = [];
        for (const item of immediateOps) {
            if (item.tag === 'edit_file') edits.push(item);
            else others.push(item);
        }

        if (edits.length > 0) {
            edits.sort((a, b) => {
                const pathA = a.attributes.path || "";
                const pathB = b.attributes.path || "";
                if (pathA !== pathB) return pathA.localeCompare(pathB);
                return parseInt(b.attributes.start || 0) - parseInt(a.attributes.start || 0);
            });
        }

        let finalExecutionList = [];
        if (edits.length > 0) {
            let firstEditIndex = -1;
            immediateOps.forEach((op, i) => {
                if (op.tag === 'edit_file' && firstEditIndex === -1) firstEditIndex = i;
            });
            const nonEdits = immediateOps.filter(op => op.tag !== 'edit_file');
            finalExecutionList = [
                ...nonEdits.slice(0, firstEditIndex),
                ...edits,
                ...nonEdits.slice(firstEditIndex)
            ];
        } else {
            finalExecutionList = immediateOps;
        }

        // --- 2. Execution ---
        const results = [];
        
        for (const element of finalExecutionList) {
            try {
                const res = await this._runImmediateTool(element);
                if (res) results.push(res);
            } catch (e) {
                console.error(`Exec Error <${element.tag}>:`, e);
                results.push({ 
                    log: `[System Error] <${element.tag}>: ${e.message}`,
                    ui: `❌ Error <${element.tag}>: ${e.message}`
                });
            }
        }

        // --- 3. Interrupt ---
        let interrupt = null;
        if (interruptOp) {
            const content = interruptOp.content && Array.isArray(interruptOp.content)
                ? interruptOp.content.join('').trim()
                : "";
            
            interrupt = {
                type: interruptOp.tag,
                value: content
            };
        }

        return { results, interrupt };
    }

    async _runImmediateTool(element) {
        const { tag, attributes, content } = element;
        const textContent = Array.isArray(content) 
            ? content.map(c => typeof c === 'string' ? c : '').join('') 
            : (content || "");

        switch (tag) {
            case 'create_file':
                this.vfs.writeFile(attributes.path, textContent);
                this.ui.renderFileList();
                return {
                    log: `[create_file] Created ${attributes.path}`,
                    ui: `📝 Created ${attributes.path}`
                };

            case 'edit_file':
                const editMsg = this.vfs.editLines(
                    attributes.path, parseInt(attributes.start), parseInt(attributes.end), attributes.mode, textContent
                );
                return {
                    log: `[edit_file] ${editMsg}`,
                    ui: `✏️ ${editMsg}`
                };

            case 'delete_file':
                const delMsg = this.vfs.deleteFile(attributes.path);
                this.ui.renderFileList();
                return {
                    log: `[delete_file] ${delMsg}`,
                    ui: `🗑️ ${delMsg}`
                };

            case 'move_file':
                const moveMsg = this.vfs.moveFile(attributes.path, attributes.new_path);
                this.ui.renderFileList();
                return {
                    log: `[move_file] ${moveMsg}`,
                    ui: `🚚 ${moveMsg}`
                };

            case 'read_file':
                const lines = this.vfs.readLines(attributes.path, parseInt(attributes.start || 1), parseInt(attributes.end || 999999));
                const showLineNumbers = attributes.line_numbers !== 'false';
                let contentStr = showLineNumbers 
                    ? lines.map((l, i) => `${parseInt(attributes.start || 1) + i} | ${l}`).join('\n')
                    : lines.join('\n');
                
                return {
                    log: `[read_file] ${attributes.path}:\n${contentStr}`,
                    ui: `📖 Read ${attributes.path} (${lines.length} lines)`
                };

            case 'list_files':
                const files = this.vfs.listFiles();
                return {
                    log: `[list_files] ${files.join(', ')}`,
                    ui: `📂 Listed ${files.length} files`
                };

            case 'preview':
                await this.ui.updatePreview();
                return {
                    log: `[preview] Refreshed.`,
                    ui: `🔄 Preview Refreshed`
                };
            
            case 'take_screenshot':
                try {
                    await this.ui.updatePreview();
                    await new Promise(r => setTimeout(r, 500));
                    const base64 = await this._captureViaMessaging();
                    return {
                        // LogにはBase64を含めない (Core側で処理する)
                        log: `[take_screenshot] Captured.`, 
                        ui: `📸 Screenshot captured`,
                        image: base64
                    };
                } catch (e) {
                    return {
                        log: `[take_screenshot] Failed: ${e.message}`,
                        ui: `⚠️ Screenshot Failed: ${e.message}`
                    };
                }

            case 'thinking':
            case 'plan':
            case 'report':
                return null; 

            default:
                return null;  // 無限ループ
        }
    }

    async _captureViaMessaging() {
        const iframe = document.getElementById('preview-frame');
        if (!iframe.contentWindow) throw new Error("No preview window");

        return new Promise((resolve, reject) => {
            const tid = setTimeout(() => {
                window.removeEventListener('message', handler);
                reject(new Error("Screenshot timeout"));
            }, 8000);

            const handler = (e) => {
                if (e.data.type === 'SCREENSHOT_RESULT') {
                    clearTimeout(tid);
                    window.removeEventListener('message', handler);
                    resolve(e.data.data.split(',')[1]);
                } else if (e.data.type === 'SCREENSHOT_ERROR') {
                    clearTimeout(tid);
                    window.removeEventListener('message', handler);
                    reject(new Error(e.data.message));
                }
            };

            window.addEventListener('message', handler);
            iframe.contentWindow.postMessage({ action: 'CAPTURE' }, '*');
        });
    }
}