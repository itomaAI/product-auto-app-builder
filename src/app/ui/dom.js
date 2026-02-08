// src/app/ui/dom.js

(function(global) {
    global.App = global.App || {};
    global.App.UI = global.App.UI || {};

    global.App.UI.DOM = {
        // Chat Area
        chatHistory: 'chat-history',
        chatInput: 'chat-input',
        btnSend: 'btn-send',
        btnStop: 'btn-stop',
        btnClear: 'btn-clear-chat',
        aiTyping: 'ai-typing',
        filePreviewArea: 'file-preview-area',
        chatFileUpload: 'chat-file-upload',
        chatResizer: 'chat-resizer',

        // File Explorer
        fileList: 'file-list',
        folderUpload: 'folder-upload',
        filesUpload: 'files-upload',
        btnDownload: 'btn-download',

        // Preview Area
        previewFrame: 'preview-frame',
        previewLoader: 'preview-loader',
        btnRefresh: 'btn-refresh',
        urlBar: 'url-bar-text', // New: URL表示用

        // Code Editor
        editorOverlay: 'editor-overlay',
        codeEditor: 'code-editor',
        editorFilename: 'editor-filename',
        btnCloseEditor: 'btn-close-editor',

        // Header / Settings
        apiKey: 'api-key',
        btnSaveKey: 'btn-save-key',
        modelStatus: 'model-status', // New: 現在のモデル表示
        
        // Project Management
        projectName: 'current-project-name',
        projectRenameInput: 'project-rename-input',
        projectSelectTrigger: 'project-select-trigger',
        projectModal: 'project-modal',
        projectList: 'project-list',
        btnCloseModal: 'btn-close-modal',
        btnNewProject: 'btn-new-project',
        btnNewProjectModal: 'btn-new-project-modal',
        saveStatus: 'save-status'
    };

})(window);