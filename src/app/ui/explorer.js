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

			// Upload Inputs
			this.contextUploadInput = document.getElementById(DOM.contextUploadInput);
			this.folderInput = document.getElementById(DOM.folderUpload);
			this.filesInput = document.getElementById(DOM.filesUpload);

			// New: Open Project Folder
			this.btnOpenFolder = document.getElementById(DOM.btnOpenFolder);
			this.projectOpenInput = document.getElementById(DOM.projectOpenInput);

			this.previewFrame = document.getElementById(DOM.previewFrame);

			if (!this.contextUploadInput) {
				console.warn(`ExplorerComponent: #${DOM.contextUploadInput} not found.`);
			}

			this._bindVFS();
			this._bindTreeEvents();
			this._bindUploads();
			this._initResizer();
		}

		on(event, callback) {
			this.events[event] = callback;
		}

		// --- ★ NEW: 共通除外ロジック ---
		_shouldIgnore(path) {
			// .git フォルダ、.DS_Store、node_modules を無視
			if (path.startsWith('.git/') || path.includes('/.git/')) return true;
			if (path === '.DS_Store' || path.endsWith('/.DS_Store')) return true;
			if (path.startsWith('node_modules/') || path.includes('/node_modules/')) return true;
			return false;
		}

		_bindVFS() {
			this.vfs.subscribe(() => {
				const treeData = this.vfs.getTree();
				this.treeView.render(treeData);
			});
			this.treeView.render(this.vfs.getTree());
		}

		_bindTreeEvents() {
			this.treeView.on('open', (path) => {
				const content = this.vfs.readFile(path);
				if (this.events['open_file']) this.events['open_file'](path, content);
			});

			this.treeView.on('create_file', (path) => {
				try {
					this.vfs.writeFile(path, "");
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

			this.treeView.on('duplicate', (path) => {
				try {
					const dotIndex = path.lastIndexOf('.');
					let base, ext;
					if (dotIndex !== -1) {
						base = path.substring(0, dotIndex);
						ext = path.substring(dotIndex);
					} else {
						base = path;
						ext = "";
					}

					let newPath = `${base}_copy${ext}`;
					let counter = 1;
					while (this.vfs.exists(newPath)) {
						newPath = `${base}_copy${counter}${ext}`;
						counter++;
					}

					const msg = this.vfs.copyFile(path, newPath);
					this._emitHistoryEvent('file_created', `User duplicated file: ${msg}`);
				} catch (e) {
					alert(e.message);
				}
			});

			this.treeView.on('rename', (oldPath, newPath) => {
				try {
					const msg = this.vfs.rename(oldPath, newPath);
					this._emitHistoryEvent('file_moved', `User action: ${msg}`);
				} catch (e) {
					alert(e.message);
				}
			});

			this.treeView.on('move', (srcPath, destPath) => {
				try {
					const msg = this.vfs.rename(srcPath, destPath);
					this._emitHistoryEvent('file_moved', `User moved file (drag&drop): ${msg}`);
				} catch (e) {
					alert(`Move failed: ${e.message}`);
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

			this.treeView.on('download', (path) => {
				try {
					const content = this.vfs.readFile(path);
					this._downloadFile(path, content);
				} catch (e) {
					alert(`Download failed: ${e.message}`);
				}
			});

			this.treeView.on('upload_request', (path) => {
				this.currentContextUploadPath = path;
				if (this.contextUploadInput) {
					this.contextUploadInput.value = "";
					this.contextUploadInput.click();
				}
			});
		}

		_bindUploads() {
			// 1. Existing Upload Handlers (Append Mode)
			if (this.folderInput) this.folderInput.onchange = (e) => this._handleUploadAppend(e, true, "");
			if (this.filesInput) this.filesInput.onchange = (e) => this._handleUploadAppend(e, false, "");
			if (this.contextUploadInput) {
				this.contextUploadInput.onchange = (e) => {
					this._handleUploadAppend(e, false, this.currentContextUploadPath);
					this.currentContextUploadPath = "";
				};
			}

			// 2. Open Project Folder (Replace Mode)
			if (this.btnOpenFolder && this.projectOpenInput) {
				this.btnOpenFolder.onclick = () => {
					this.projectOpenInput.value = "";
					this.projectOpenInput.click();
				};

				this.projectOpenInput.onchange = async (e) => {
					const files = Array.from(e.target.files);
					if (files.length === 0) return;

					if (!confirm(`Warning: This will DELETE all current files and replace them with the contents of "${files[0].webkitRelativePath.split('/')[0]}".\n\nContinue?`)) {
						e.target.value = "";
						return;
					}

					// Clear VFS
					Object.keys(this.vfs.files).forEach(k => delete this.vfs.files[k]);

					const uploadedPaths = [];
					for (const file of files) {
						let relPath = file.webkitRelativePath;
						const parts = relPath.split('/');
						if (parts.length > 1) {
							relPath = parts.slice(1).join('/');
						} else {
							relPath = file.name;
						}

						// ★ 修正: 共通除外ロジックを使用
						const normalizedPath = relPath.replace(/^\/+/, '');
						if (!normalizedPath || this._shouldIgnore(normalizedPath)) continue;

						let content;
						try {
							if (this._isBinary(file)) {
								content = await this._fileToBase64(file);
							} else {
								content = await file.text();
							}

							this.vfs.files[normalizedPath] = content;
							uploadedPaths.push(normalizedPath);
						} catch (err) {
							console.error(`Failed to import ${relPath}:`, err);
						}
					}

					this.vfs.notify();
					this._emitHistoryEvent('project_imported',
						`User opened folder (cleared previous state). Imported ${uploadedPaths.length} files.`);

					e.target.value = "";
				};
			}

			// 3. Sidebar Drag & Drop (Recursive Folder Upload)
			if (this.sidebar) {
				['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
					this.sidebar.addEventListener(eventName, (e) => {
						e.preventDefault();
						e.stopPropagation();
					}, false);
				});

				this.sidebar.addEventListener('dragover', (e) => {
					e.dataTransfer.dropEffect = 'copy';
					this.sidebar.classList.add('bg-gray-700');
				});
				this.sidebar.addEventListener('dragleave', () => {
					this.sidebar.classList.remove('bg-gray-700');
				});

				this.sidebar.addEventListener('drop', async (e) => {
					this.sidebar.classList.remove('bg-gray-700');

					const items = e.dataTransfer.items;
					if (!items) return;

					const promises = [];
					// FileSystemEntry API (webkitGetAsEntry) を使用してディレクトリを走査
					for (let i = 0; i < items.length; i++) {
						const item = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
						if (item) {
							promises.push(this._traverseFileTree(item, ""));
						}
					}

					const fileEntries = (await Promise.all(promises)).flat();
					if (fileEntries.length > 0) {
						this._batchWriteFiles(fileEntries);
					}
				});
			}
		}

		// --- Helper: Recursive File Traversal ---
		_traverseFileTree(item, path) {
			return new Promise((resolve) => {
				path = path || "";
				if (item.isFile) {
					item.file((file) => {
						file.fullPath = path + file.name;
						resolve([file]);
					});
				} else if (item.isDirectory) {
					// ★ 修正: ディレクトリ単位で .git / node_modules ならこれ以上掘り下げない最適化
					if (item.name === '.git' || item.name === 'node_modules') {
						resolve([]);
						return;
					}

					const dirReader = item.createReader();
					const entries = [];

					const readEntries = () => {
						dirReader.readEntries(async (results) => {
							if (!results.length) {
								const childPromises = entries.map(entry =>
									this._traverseFileTree(entry, path + item.name + "/")
								);
								const childFiles = (await Promise.all(childPromises)).flat();
								resolve(childFiles);
							} else {
								entries.push(...results);
								readEntries();
							}
						});
					};
					readEntries();
				}
			});
		}

		async _batchWriteFiles(files) {
			const uploadedPaths = [];
			for (const file of files) {
				let relPath = file.fullPath || file.name;
				relPath = relPath.replace(/^\/+/, '');

				// ★ 修正: 共通除外ロジックを使用
				if (this._shouldIgnore(relPath)) continue;

				let content;
				try {
					if (this._isBinary(file)) {
						content = await this._fileToBase64(file);
					} else {
						content = await file.text();
					}

					this.vfs.writeFile(relPath, content);
					uploadedPaths.push(relPath);
				} catch (err) {
					console.error(`Failed to import ${relPath}:`, err);
				}
			}

			if (uploadedPaths.length > 0) {
				const limit = 5;
				const fileList = uploadedPaths.slice(0, limit).join(', ');
				const more = uploadedPaths.length > limit ? `, ... (+${uploadedPaths.length - limit} files)` : '';
				this._emitHistoryEvent('file_created', `User dropped files/folders:\n${fileList}${more}`);
			}
		}

		async _handleUploadAppend(e, isFolder, targetDir = "") {
			const files = Array.from(e.target.files);
			const uploadedPaths = [];
			for (const file of files) {
				let relPath = file.name;
				if (targetDir) relPath = `${targetDir}/${file.name}`;
				else if (isFolder && file.webkitRelativePath) relPath = file.webkitRelativePath;
				relPath = relPath.replace(/^\/+/, '');

				// ★ 修正: 共通除外ロジックを追加 (これでボタンからのアップロードも除外対応)
				if (this._shouldIgnore(relPath)) continue;

				let content;
				if (this._isBinary(file)) content = await this._fileToBase64(file);
				else content = await file.text();
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
			if (e.target && e.target.value !== undefined) {
				e.target.value = "";
			}
		}

		_downloadFile(path, content) {
			let blob;
			if (content.startsWith('data:')) {
				const parts = content.split(',');
				const mimeString = parts[0].split(':')[1].split(';')[0];
				const byteString = atob(parts[1]);
				const ab = new ArrayBuffer(byteString.length);
				const ia = new Uint8Array(ab);
				for (let i = 0; i < byteString.length; i++) {
					ia[i] = byteString.charCodeAt(i);
				}
				blob = new Blob([ab], {
					type: mimeString
				});
			} else {
				blob = new Blob([content], {
					type: 'text/plain'
				});
			}

			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = path.split('/').pop();
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		}

		_isBinary(file) {
			return file.type.startsWith('image/') ||
				file.type === 'application/pdf' ||
				file.type.includes('zip') ||
				file.type.includes('compressed') ||
				file.type.startsWith('audio/') ||
				file.type.startsWith('video/') ||
				file.name.match(/\.(png|jpg|jpeg|gif|webp|svg|ico|bmp|pdf|woff|woff2|ttf|eot|otf|zip|tar|gz|7z|rar|mp3|wav|mp4|webm|ogg)$/i);
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
			const overlay = document.getElementById(DOM.resizeOverlay);
			let isResizing = false;
			const start = (e) => {
				isResizing = true;
				document.body.style.cursor = 'col-resize';
				this.resizer.classList.add('resizing');
				if (overlay) overlay.classList.remove('hidden');
				if (this.previewFrame) this.previewFrame.style.pointerEvents = 'none';
				e.preventDefault();
			};
			const stop = () => {
				if (!isResizing) return;
				isResizing = false;
				document.body.style.cursor = '';
				this.resizer.classList.remove('resizing');
				if (overlay) overlay.classList.add('hidden');
				if (this.previewFrame) this.previewFrame.style.pointerEvents = '';
			};
			const move = (e) => {
				if (!isResizing) return;
				const newWidth = e.clientX;
				if (newWidth > 150 && newWidth < 600) {
					this.sidebar.style.width = `${newWidth}px`;
				}
			};
			this.resizer.addEventListener('mousedown', start);
			document.addEventListener('mousemove', move);
			document.addEventListener('mouseup', stop);
			document.addEventListener('mouseleave', stop);
		}
	}

	global.App.UI.ExplorerComponent = ExplorerComponent;

})(window);