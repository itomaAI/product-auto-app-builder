// js/vfs.js

class VirtualFileSystem {
    constructor(initialFiles = {}) {
        this.files = { ...initialFiles };
        this.listeners = [];
    }

    // Listen for changes
    addListener(callback) {
        this.listeners.push(callback);
    }

    _notify() {
        this.listeners.forEach(cb => cb());
    }

    exists(path) {
        return Object.prototype.hasOwnProperty.call(this.files, path);
    }

    readFile(path) {
        if (!this.exists(path)) throw new Error(`File not found: ${path}`);
        return this.files[path];
    }

    readLines(path, startLine, endLine) {
        const content = this.readFile(path);
        const lines = content.split(/\r?\n/);
        
        const s = Math.max(0, startLine - 1);
        const e = Math.min(lines.length, endLine);
        
        if (s >= lines.length) return [];
        return lines.slice(s, e);
    }

    writeFile(path, content) {
        this.files[path] = content;
        this._notify();
        return `Wrote ${content.length} chars to ${path}`;
    }

    deleteFile(path) {
        if (this.exists(path)) {
            delete this.files[path];
            this._notify();
            return `Deleted ${path}`;
        }
        return `File ${path} did not exist.`;
    }

    moveFile(oldPath, newPath) {
        if (!this.exists(oldPath)) return `Error: Source ${oldPath} not found.`;
        if (this.exists(newPath)) return `Error: Destination ${newPath} already exists. Delete it first if you want to overwrite.`;
        
        this.files[newPath] = this.files[oldPath];
        delete this.files[oldPath];
        this._notify();
        return `Moved ${oldPath} to ${newPath}`;
    }

    listFiles() {
        return Object.keys(this.files).sort();
    }

    editLines(path, startLine, endLine, mode, newContent = "") {
        if (!this.exists(path)) throw new Error(`File not found: ${path}`);

        const content = this.files[path];
        let lines = content.split(/\r?\n/);
        const newLines = newContent ? newContent.split(/\r?\n/) : [];
        
        const sLine = parseInt(startLine);
        const eLine = parseInt(endLine);
        const sIdx = Math.max(0, sLine - 1);

        if (mode === 'replace') {
            const deleteCount = Math.max(0, eLine - sLine + 1);
            while (lines.length < sIdx) lines.push("");
            lines.splice(sIdx, deleteCount, ...newLines);
        } 
        else if (mode === 'insert_after') {
            const targetIdx = eLine; // Insert after this line
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
        this._notify();
        return `Edited ${path} (Mode: ${mode}, Lines: ${startLine}-${endLine})`;
    }
}