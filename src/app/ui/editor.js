// src/app/ui/editor.js

(function(global) {
    global.App = global.App || {};
    global.App.UI = global.App.UI || {};

    const DOM = global.App.UI.DOM;

    class EditorComponent {
        constructor() {
            this.els = {};
            this.events = {};
            this.currentPath = null;
            
            this._initElements();
            this._bindEvents();
        }

        on(event, callback) {
            this.events[event] = callback;
        }

        _initElements() {
            ['editorOverlay', 'codeEditor', 'editorFilename', 'btnCloseEditor', 'btnSaveEditor']
            .forEach(key => {
                const id = DOM[key];
                if (id) this.els[key] = document.getElementById(id);
            });
        }

        _bindEvents() {
            if (this.els.btnCloseEditor) {
                this.els.btnCloseEditor.onclick = () => this.close();
            }
            if (this.els.btnSaveEditor) {
                this.els.btnSaveEditor.onclick = () => this._save();
            }
            if (this.els.codeEditor) {
                this.els.codeEditor.onkeydown = (e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                        e.preventDefault();
                        this._save();
                    }
                };
            }
        }

        open(path, content) {
            // Check for binary/image
            if (path.match(/\.(png|jpg|jpeg|gif|webp|svg|ico)$/i)) {
                alert("Image preview is not supported in text editor. Please use the Preview pane.");
                return;
            }

            this.currentPath = path;
            if (this.els.editorFilename) this.els.editorFilename.textContent = path;
            if (this.els.codeEditor) this.els.codeEditor.value = content;
            if (this.els.editorOverlay) this.els.editorOverlay.classList.remove('hidden');
        }

        close() {
            if (this.els.editorOverlay) this.els.editorOverlay.classList.add('hidden');
            this.currentPath = null;
        }

        _save() {
            if (!this.currentPath) return;
            const content = this.els.codeEditor.value;
            
            if (this.events['save']) {
                this.events['save'](this.currentPath, content);
            }

            // Visual Feedback
            if (this.els.btnSaveEditor) {
                const originalText = this.els.btnSaveEditor.textContent;
                this.els.btnSaveEditor.textContent = "Saved!";
                this.els.btnSaveEditor.classList.add('bg-green-600');
                setTimeout(() => {
                    this.els.btnSaveEditor.textContent = originalText;
                    this.els.btnSaveEditor.classList.remove('bg-green-600');
                }, 1000);
            }
        }
    }

    global.App.UI.EditorComponent = EditorComponent;

})(window);