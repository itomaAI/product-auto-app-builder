// js/tools.js

class ToolExecutor {
    constructor(vfs, uiManager) {
        this.vfs = vfs;
        this.ui = uiManager;
    }

    async execute(tree) {
        const results = [];
        let previewRequested = false;

        for (const element of tree) {
            if (typeof element === 'string') continue;

            const { tag, attributes, content } = element;
            const textContent = Array.isArray(content) 
                ? content.map(c => typeof c === 'string' ? c : '').join('') 
                : (content || "");

            try {
                let res = await this._runTool(tag, attributes, textContent);
                if (res) results.push(res);
                
                if (tag === 'preview') previewRequested = true;

            } catch (e) {
                console.error(`Exec Error <${tag}>:`, e);
                results.push({ type: 'text', value: `[System Error] <${tag}>: ${e.message}` });
            }
        }
        return results;
    }

    async _runTool(tag, attr, content) {
        switch (tag) {
            case 'create_file':
                this.vfs.writeFile(attr.path, content);
                this.ui.renderFileList();
                return { type: 'text', value: `[create_file] Created ${attr.path}` };

            case 'edit_file':
                const editMsg = this.vfs.editLines(
                    attr.path, parseInt(attr.start), parseInt(attr.end), attr.mode, content
                );
                return { type: 'text', value: `[edit_file] ${editMsg}` };

            case 'delete_file':
                const delMsg = this.vfs.deleteFile(attr.path);
                this.ui.renderFileList();
                return { type: 'text', value: `[delete_file] ${delMsg}` };

            case 'move_file':
                const moveMsg = this.vfs.moveFile(attr.path, attr.new_path);
                this.ui.renderFileList();
                return { type: 'text', value: `[move_file] ${moveMsg}` };

            case 'read_file':
                const lines = this.vfs.readLines(attr.path, parseInt(attr.start || 1), parseInt(attr.end || 999999));
                
                // line_numbers default is "true"
                const showLineNumbers = attr.line_numbers !== 'false';

                let contentStr;
                if (showLineNumbers) {
                    contentStr = lines.map((l, i) => {
                        const lineNum = (parseInt(attr.start || 1) + i);
                        return `${lineNum} | ${l}`;
                    }).join('\n');
                } else {
                    contentStr = lines.join('\n');
                }
                
                return { type: 'text', value: `[read_file] ${attr.path}:\n${contentStr}` };

            case 'list_files':
                return { type: 'text', value: `[list_files] ${this.vfs.listFiles().join(', ')}` };

            case 'preview':
                await this.ui.updatePreview();
                return { type: 'text', value: `[preview] Refreshed.` };
            
            case 'take_screenshot':
                try {
                    // Update preview first and wait for LOAD event (handled by updated ui.updatePreview)
                    await this.ui.updatePreview();
                    
                    // Additional small delay to ensure rendering loop catch-up (styles, fonts)
                    await new Promise(r => setTimeout(r, 500));
                    
                    const base64 = await this._captureViaMessaging();
                    return { type: 'image', value: base64 };
                } catch (e) {
                    return { type: 'text', value: `[take_screenshot] Failed: ${e.message}` };
                }

            case 'finish':
                return { type: 'text', value: `[finish] Task marked as complete.` };

            case 'plan':
            case 'ask':
            case 'thinking':
            case 'report':
                return null; 

            // 未定義タグに対しては何もしない
            default:
                return null;

            // default:
            //     return { type: 'text', value: `[System Warning] Unknown tag <${tag}> ignored.` };
        }
    }

    async _captureViaMessaging() {
        const iframe = document.getElementById('preview-frame');
        if (!iframe.contentWindow) throw new Error("No preview window");

        return new Promise((resolve, reject) => {
            // Extended Timeout for heavier pages
            const tid = setTimeout(() => {
                window.removeEventListener('message', handler);
                reject(new Error("Screenshot timeout (iframe didn't respond in 8s)"));
            }, 8000);

            // Handler
            const handler = (e) => {
                if (e.data.type === 'SCREENSHOT_RESULT') {
                    clearTimeout(tid);
                    window.removeEventListener('message', handler);
                    // data is "data:image/png;base64,..."
                    resolve(e.data.data.split(',')[1]);
                } else if (e.data.type === 'SCREENSHOT_ERROR') {
                    clearTimeout(tid);
                    window.removeEventListener('message', handler);
                    reject(new Error(e.data.message));
                }
            };

            window.addEventListener('message', handler);

            // Send trigger
            iframe.contentWindow.postMessage({ action: 'CAPTURE' }, '*');
        });
    }
}