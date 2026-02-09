// src/app/ui/explorer.js

(function(global) {
	global.App = global.App || {};
	global.App.UI = global.App.UI || {};

	const DOM = global.App.UI.DOM;
	const TreeView = global.App.UI.TreeView;

	class ExplorerComponent {
		constructor(vfs) {
			this.vfs = vfs;
			this.events = {};
			this.currentContextUploadPath = "";

			this.treeView = new TreeView(DOM.fileExplorer, DOM.contextMenu);
			this.sidebar = document.getElementById(DOM.sidebar);
			this.resizer = document.getElementById(DOM.explorerResizer);
			this.contextUploadInput = document.getElementById(DOM.contextUploadInput);

			// デバッグ: 要素が見つからない場合のアラート
			if (!this.contextUploadInput) {
				console.error(`ExplorerComponent: #${DOM.contextUploadInput} not found in DOM.`);
			}

			this._bindVFS();
			this._bindTreeEvents();
			this._bindUploads();
			this._initResizer();
		}

		on(event, callback) {
			this.events[event] = callback;
		}

		_bindVFS() {
			this.vfs.subscribe(() => {
				const treeData = this.vfs.getTree();
				this.treeView.render(treeData);
			});
			// Initial
			this.treeView.render(this.vfs.getTree());
		}

		_bindTreeEvents() {
			this.treeView.on('open', (path) => {
				const content = this.vfs.readFile(path);
				if (this.events['open_file']) this.events['open_file'](path, content);
			});

			this.treeView.on('create_file', (path) => {
				try {
					const msg = this.vfs.writeFile(path, "");
					this._emitHistoryEvent('file_created', `User created empty file: ${path}`);
					if (this.events['open_file']) this.events['open_file'](path, "");
				} catch (e) {
					alert(e.message);
				}
			});

			this.treeView.on('create_folder', (path) => {
				try {
					const msg = this.vfs.createDirectory(path);
					this._emitHistoryEvent('folder_created', msg);
				} catch (e) {
					alert(e.message);
				}
			});

			this.treeView.on('rename', (oldPath, newPath) => {
				try {
					// VFS.rename が成功するとメッセージを返す
					const msg = this.vfs.rename(oldPath, newPath);
					this._emitHistoryEvent('file_moved', `User action: ${msg}`);
				} catch (e) {
					alert(e.message);
				}
			});

			this.treeView.on('delete', (path) => {
				try {
					const msg = this.vfs.deleteFile(path);
					this._emitHistoryEvent('file_deleted', `User action: ${msg}`);
				} catch (e) {
					alert(e.message);
				}
			});

			// Context Menu Upload Request
			this.treeView.on('upload_request', (path) => {
				this.currentContextUploadPath = path;
				if (this.contextUploadInput) {
					this.contextUploadInput.value = ""; // Reset to allow same file selection
					this.contextUploadInput.click();
				} else {
					alert("Upload input element not found.");
				}
			});
		}

		_bindUploads() {
			// General Uploads
			const folderInput = document.getElementById(DOM.folderUpload);
			if (folderInput) folderInput.onchange = (e) => this._handleUpload(e, true, "");

			const filesInput = document.getElementById(DOM.filesUpload);
			if (filesInput) filesInput.onchange = (e) => this._handleUpload(e, false, "");

			// Context Menu Upload
			if (this.contextUploadInput) {
				this.contextUploadInput.onchange = (e) => {
					this._handleUpload(e, false, this.currentContextUploadPath);
					// Reset path after upload
					this.currentContextUploadPath = "";
				};
			}
		}

		async _handleUpload(e, isFolder, targetDir = "") {
			const files = Array.from(e.target.files);
			const uploadedPaths = [];

			for (const file of files) {
				let relPath = file.name;

				if (targetDir) {
					relPath = `${targetDir}/${file.name}`;
				} else if (isFolder && file.webkitRelativePath) {
					relPath = file.webkitRelativePath;
				}

				// Remove leading slashes
				relPath = relPath.replace(/^\/+/, '');

				let content;
				if (file.type.startsWith('image/') || file.type === 'application/pdf') {
					content = await this._fileToBase64(file);
				} else {
					content = await file.text();
				}

				try {
					this.vfs.writeFile(relPath, content);
					uploadedPaths.push(relPath);
				} catch (err) {
					console.error(err);
				}
			}

			if (uploadedPaths.length > 0) {
				const limit = 5;
				const fileList = uploadedPaths.slice(0, limit).join(', ');
				const more = uploadedPaths.length > limit ? `, ... (+${uploadedPaths.length - limit} files)` : '';
				const desc = `User uploaded files to "${targetDir || 'root'}":\nFiles: ${fileList}${more}`;
				this._emitHistoryEvent('file_created', desc);
			}
			e.target.value = "";
		}

		_fileToBase64(file) {
			return new Promise((r, j) => {
				const reader = new FileReader();
				reader.readAsDataURL(file);
				reader.onload = () => r(reader.result);
				reader.onerror = j;
			});
		}

		_emitHistoryEvent(type, description) {
			if (this.events['history_event']) {
				this.events['history_event'](type, description);
			}
		}

        _initResizer() {
            if (!this.resizer || !this.sidebar) return;
            
            let isResizing = false;
            
            const start = (e) => {
                isResizing = true;
                document.body.style.cursor = 'col-resize';
                this.resizer.classList.add('resizing');
                
                // 【修正】リサイズ中は iframe のイベントを無効化して吸い込みを防止
                if (this.previewFrame) {
                    this.previewFrame.style.pointerEvents = 'none';
                }

                e.preventDefault();
            };
            
            const stop = () => {
                if (!isResizing) return;
                isResizing = false;
                document.body.style.cursor = '';
                this.resizer.classList.remove('resizing');
                
                // 【修正】リサイズ終了後に iframe を有効化
                if (this.previewFrame) {
                    this.previewFrame.style.pointerEvents = '';
                }
            };
            
            const move = (e) => {
                if (!isResizing) return;
                const newWidth = e.clientX;
                // 幅制限 (min 150px, max 600px)
                if (newWidth > 150 && newWidth < 600) {
                    this.sidebar.style.width = `${newWidth}px`;
                }
            };

            this.resizer.addEventListener('mousedown', start);
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', stop);
            // マウスが画面外に出た場合の保険
            document.addEventListener('mouseleave', stop);
        }
    }


	global.App.UI.ExplorerComponent = ExplorerComponent;

})(window);