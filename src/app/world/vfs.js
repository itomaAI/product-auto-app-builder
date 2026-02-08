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

            // 1. Content Sanitization (XML artifact removal)
            // <edit_file>直後の改行と、</edit_file>直前の改行を取り除く
            let cleanContent = newContent;
            if (cleanContent.startsWith('\n')) cleanContent = cleanContent.slice(1);
            if (cleanContent.endsWith('\n')) cleanContent = cleanContent.slice(0, -1);
            
            const newLines = cleanContent ? cleanContent.split(/\r?\n/) : [];
            
            const sLine = parseInt(startLine);
            // endLineが未指定(NaN)の場合はstartLineと同じとみなす（insert_after等で安全のため）
            const eLine = isNaN(parseInt(endLine)) ? sLine : parseInt(endLine);
            
            // 0-based index conversion
            const sIdx = Math.max(0, sLine - 1);

            if (mode === 'replace') {
                // startからendまでを削除して置換
                const deleteCount = Math.max(0, eLine - sLine + 1);
                // 配列外アクセスを防ぐためのパディング
                while (lines.length < sIdx) lines.push("");
                lines.splice(sIdx, deleteCount, ...newLines);
            } 
            else if (mode === 'insert_after') {
                // start行目の「後ろ」に挿入 = indexとしては sIdx + 1
                // 元のコードは eLine を使っていたが、LLMが end を省略すると NaN になるバグがあった
                const targetIdx = sIdx + 1; 
                while (lines.length < targetIdx) lines.push("");
                lines.splice(targetIdx, 0, ...newLines);
            }
            else if (mode === 'delete') {
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
            return `Edited ${path} (Mode: ${mode}, Lines: ${startLine}-${endLine})`;
        }
    }

    global.App.World.VirtualFileSystem = VirtualFileSystem;

})(window);