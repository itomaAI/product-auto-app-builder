// src/app/world/vfs.js

(function(global) {
    global.App = global.App || {};
    global.App.World = global.App.World || {};

    class VirtualFileSystem {
        constructor(initialFiles = {}) {
            this.files = { ...initialFiles };
            this.listeners = [];
        }

        subscribe(callback) {
            this.listeners.push(callback);
            return () => this.listeners = this.listeners.filter(cb => cb !== callback);
        }

        notify() {
            this.listeners.forEach(cb => cb(this.files));
        }

        exists(path) {
            return Object.prototype.hasOwnProperty.call(this.files, path);
        }

        readFile(path) {
            if (!this.exists(path)) throw new Error(`File not found: ${path}`);
            return this.files[path];
        }

        readLines(path, startLine = 1, endLine = 999999) {
            const content = this.readFile(path);
            const lines = content.split(/\r?\n/);
            const s = Math.max(0, parseInt(startLine) - 1);
            const e = Math.min(lines.length, parseInt(endLine));
            return lines.slice(s, e);
        }

        writeFile(path, content) {
            this.files[path] = content;
            this.notify();
            return `Wrote ${content.length} chars to ${path}`;
        }

        deleteFile(path) {
            if (this.exists(path)) {
                delete this.files[path];
                this.notify();
                return `Deleted ${path}`;
            }
            return `File ${path} did not exist.`;
        }

        moveFile(oldPath, newPath) {
            if (!this.exists(oldPath)) throw new Error(`Source ${oldPath} not found.`);
            if (this.exists(newPath)) throw new Error(`Destination ${newPath} already exists.`);
            
            this.files[newPath] = this.files[oldPath];
            delete this.files[oldPath];
            this.notify();
            return `Moved ${oldPath} to ${newPath}`;
        }

        listFiles() {
            return Object.keys(this.files).sort();
        }

        editLines(path, startLine, endLine, mode, newContent = "") {
            if (!this.exists(path)) throw new Error(`File not found: ${path}`);

            const content = this.files[path];
            let lines = content.split(/\r?\n/);

            // 1. Newline Sanitization
            // タグ直後の改行(\n)と、閉じタグ直前の改行(\n)のみを除去する。
            // これをしないと、編集のたびに空行が増殖していく。
            let cleanContent = newContent;
            
            // 先頭の改行のみ削除
            if (cleanContent.startsWith('\n')) cleanContent = cleanContent.substring(1);
            // 末尾の改行のみ削除
            if (cleanContent.endsWith('\n')) cleanContent = cleanContent.substring(0, cleanContent.length - 1);

            const newLines = cleanContent.split(/\r?\n/);

            // 1-based to 0-based
            const sLine = parseInt(startLine);
            const sIdx = Math.max(0, sLine - 1);
            const eLine = parseInt(endLine); // replace/delete用

            if (mode === 'replace') {
                if (isNaN(eLine)) throw new Error("Attribute 'end' is required for mode='replace'");
                const deleteCount = Math.max(0, eLine - sLine + 1);
                
                // 配列外アクセス防止（ファイルの末尾より先を指定された場合のパディング）
                while (lines.length < sIdx) lines.push("");
                
                lines.splice(sIdx, deleteCount, ...newLines);
            } 
            else if (mode === 'insert') {
                // "start行目の前" に挿入する (標準的なspliceの挙動)
                // start=1 なら index=0 (先頭) に挿入
                // start=Length+1 なら 末尾に追加
                while (lines.length < sIdx) lines.push("");
                lines.splice(sIdx, 0, ...newLines);
            }
            else if (mode === 'delete') {
                if (isNaN(eLine)) throw new Error("Attribute 'end' is required for mode='delete'");
                const deleteCount = Math.max(0, eLine - sLine + 1);
                if (sIdx < lines.length) {
                    lines.splice(sIdx, deleteCount);
                }
            }
            else {
                throw new Error(`Unknown edit mode: ${mode}`);
            }

            this.files[path] = lines.join('\n');
            this.notify();
            return `Edited ${path} (Mode: ${mode}, Lines: ${startLine}${mode === 'insert' ? '' : '-' + endLine})`;
        }
    }

    global.App.World.VirtualFileSystem = VirtualFileSystem;

})(window);