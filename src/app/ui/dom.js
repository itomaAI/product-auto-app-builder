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
		sidebar: 'sidebar',
		fileExplorer: 'file-explorer',
		explorerResizer: 'explorer-resizer',
		folderUpload: 'folder-upload',
		filesUpload: 'files-upload',
		contextUploadInput: 'context-upload-input',
		btnDownload: 'btn-download',
		contextMenu: 'context-menu',

		// Preview Area
		previewFrame: 'preview-frame',
		previewLoader: 'preview-loader',
		btnRefresh: 'btn-refresh',

		// Code Editor
		editorOverlay: 'editor-overlay',
		codeEditor: 'code-editor',
		editorFilename: 'editor-filename',
		btnCloseEditor: 'btn-close-editor',
		btnSaveEditor: 'btn-save-editor',

		// Media Viewer (NEW)
		mediaOverlay: 'media-overlay',
		mediaImage: 'media-image',
		btnCloseMedia: 'btn-close-media',
		mediaFilename: 'media-filename',

		// Header / Project
		apiKey: 'api-key',
		btnSaveKey: 'btn-save-key',
		modelStatus: 'model-status',
		projectName: 'current-project-name',
		projectRenameInput: 'project-rename-input',
		projectSelectTrigger: 'project-select-trigger',
        btnRenameProject: 'btn-rename-project',
		projectModal: 'project-modal',
		projectList: 'project-list',
		btnCloseModal: 'btn-close-modal',
		btnNewProject: 'btn-new-project',
		btnNewProjectModal: 'btn-new-project-modal',
		saveStatus: 'save-status',

        // Global
        resizeOverlay: 'resize-overlay', // ★追加
	};

})(window);