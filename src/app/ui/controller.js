// src/app/ui/controller.js

(function(global) {
	global.App = global.App || {};
	global.App.UI = global.App.UI || {};

	const {
		ChatComponent,
		EditorComponent,
		ExplorerComponent,
		MediaViewer,
		DOM
	} = global.App.UI;

	class UIController {
		constructor(vfs, state, compiler) {
			this.vfs = vfs;
			this.state = state;
			this.compiler = compiler;
			this.els = {};

			this._initElements();

			// Initialize Components
			this.chat = new ChatComponent();
			this.chat.setVfs(vfs); // ★ VFSを注入
			this.editor = new EditorComponent();
			this.mediaViewer = new MediaViewer(); // NEW
			this.explorer = new ExplorerComponent(vfs); // No State injection

			this._bindProjectUI();
			this._wireComponents();
			this._bindMobileUI(); // ★ モバイルUI制御の初期化
		}

		_initElements() {
			['projectSelectTrigger', 'projectRenameInput', 'projectName', 'btnRenameProject',
				'projectModal', 'btnCloseModal', 'projectList', 'previewFrame', 'previewLoader',
				// Mobile elements
				'sidebar', 'chatPanel', 'mobileOverlay', 'mobileNavFiles', 'mobileNavView', 'mobileNavChat'
			]
			.forEach(key => {
				const id = DOM[key];
				if (id) this.els[key] = document.getElementById(id);
			});
		}

		_wireComponents() {
			// 1. Explorer -> Open File
			this.explorer.on('open_file', (path, content) => {
				const BINARY_EXTS = /\.(png|jpg|jpeg|gif|webp|svg|ico|pdf|zip|tar|gz|7z|rar|mp3|wav|mp4|webm|ogg|woff|woff2|ttf|eot|otf)$/i;

				if (path.match(BINARY_EXTS)) {
					this.editor.close();
					this.mediaViewer.open(path, content);
				} else {
					this.mediaViewer.close();
					this.editor.open(path, content);
				}
				this._closeMobileDrawers(); // ★ ファイルを開いたらドロワーを閉じる
			});

			// 2. Explorer -> History Event (Immediate Update)
			this.explorer.on('history_event', (type, description) => {
				const lpml = `<event type="${type}">\n${description}\n</event>`;
				// 1. Update State
				this.state.appendTurn(global.REAL.Role.SYSTEM, lpml, {
					type: 'event_log'
				});
				// 2. Update Chat UI immediately
				this.chat.renderHistory(this.state.getHistory());
			});

			// 3. Chat -> Media Preview
			this.chat.on('preview_request', (name, base64, mimeType) => {
				this.mediaViewer.open(name, base64, mimeType);
				this._closeMobileDrawers(); // ★ プレビュー時も閉じる
			});

			// 4. Editor Save -> VFS & History
			this.editor.on('save', (path, content) => {
				this.vfs.writeFile(path, content);

				const lpml = `<event type="file_change">\nUser edited file content: ${path}\n</event>`;
				this.state.appendTurn(global.REAL.Role.SYSTEM, lpml, {
					type: 'event_log'
				});
				this.chat.renderHistory(this.state.getHistory());

				// Optional: Auto refresh preview on manual save
				this.refreshPreview();
			});
		}

		// --- Mobile UI Control ---
		_bindMobileUI() {
			const {
				sidebar,
				chatPanel,
				mobileOverlay,
				mobileNavFiles,
				mobileNavView,
				mobileNavChat
			} = this.els;
			if (!mobileNavFiles) return;

			const setActive = (target) => {
				[mobileNavFiles, mobileNavView, mobileNavChat].forEach(btn => {
					btn.classList.remove('text-blue-400', 'font-bold', 'bg-gray-700/50');
					btn.classList.add('text-gray-400');
				});
				target.classList.remove('text-gray-400');
				target.classList.add('text-blue-400', 'font-bold', 'bg-gray-700/50');
			};

			const toggleOverlay = (show) => {
				if (show) mobileOverlay.classList.remove('hidden');
				else mobileOverlay.classList.add('hidden');
			};

			// Files Tab: 左からスライドイン
			mobileNavFiles.addEventListener('click', () => {
				setActive(mobileNavFiles);

				// Open Sidebar
				sidebar.classList.remove('-translate-x-full');
				sidebar.classList.add('translate-x-0');

				// Close Chat
				chatPanel.classList.remove('translate-x-0');
				chatPanel.classList.add('translate-x-full');

				toggleOverlay(true);
			});

			// View Tab: 全て閉じる
			mobileNavView.addEventListener('click', () => {
				this._closeMobileDrawers();
			});

			// Chat Tab: 右からスライドイン
			mobileNavChat.addEventListener('click', () => {
				setActive(mobileNavChat);

				// Close Sidebar
				sidebar.classList.remove('translate-x-0');
				sidebar.classList.add('-translate-x-full');

				// Open Chat
				chatPanel.classList.remove('translate-x-full');
				chatPanel.classList.add('translate-x-0');

				toggleOverlay(true);
			});

			if (mobileOverlay) {
				mobileOverlay.addEventListener('click', () => {
					this._closeMobileDrawers();
				});
			}
		}

		_closeMobileDrawers() {
			const {
				sidebar,
				chatPanel,
				mobileOverlay,
				mobileNavView,
				mobileNavFiles,
				mobileNavChat
			} = this.els;
			if (!sidebar || !chatPanel) return;

			// Close Sidebar (戻す)
			sidebar.classList.remove('translate-x-0');
			sidebar.classList.add('-translate-x-full');

			// Close Chat (戻す)
			chatPanel.classList.remove('translate-x-0');
			chatPanel.classList.add('translate-x-full');

			if (mobileOverlay) mobileOverlay.classList.add('hidden');

			if (mobileNavView) {
				[mobileNavFiles, mobileNavView, mobileNavChat].forEach(btn => {
					if (btn) {
						btn.classList.remove('text-blue-400', 'font-bold', 'bg-gray-700/50');
						btn.classList.add('text-gray-400');
					}
				});
				mobileNavView.classList.remove('text-gray-400');
				mobileNavView.classList.add('text-blue-400', 'font-bold', 'bg-gray-700/50');
			}
		}

		// Ensure to copy previous implementations of these methods here.
		updateProjectName(name) {
			if (this.els.projectName) this.els.projectName.textContent = name;
			if (this.els.projectRenameInput) this.els.projectRenameInput.value = name;
		}

		toggleProjectModal(show) {
			if (!this.els.projectModal) return;
			if (show) {
				this.els.projectModal.classList.remove('hidden');
				document.dispatchEvent(new CustomEvent('request-project-list'));
			} else {
				this.els.projectModal.classList.add('hidden');
			}
		}

		renderProjectList(projects) {
			if (!this.els.projectList) return;
			this.els.projectList.innerHTML = '';
			if (projects.length === 0) {
				this.els.projectList.innerHTML = '<div class="text-gray-500 text-center text-xs p-4">No history yet.</div>';
				return;
			}
			projects.forEach(p => {
				const date = new Date(p.lastModified).toLocaleString();
				const div = document.createElement('div');
				div.className = `flex justify-between items-center p-3 mb-2 rounded border border-gray-600 bg-gray-700 hover:border-gray-500 transition`;
				div.innerHTML = `<div class="flex flex-col cursor-pointer flex-1"><span class="font-bold text-sm text-gray-200">${p.name || '(Untitled)'}</span><span class="text-[10px] text-gray-400">${date}</span></div>`;
				div.querySelector('div').onclick = () => {
					document.dispatchEvent(new CustomEvent('project-select', {
						detail: p.id
					}));
					this.toggleProjectModal(false);
				};
				const delBtn = document.createElement('button');
				delBtn.className = "ml-3 p-2 text-gray-500 hover:text-red-400 hover:bg-gray-800 rounded transition";
				delBtn.innerHTML = '✕';
				delBtn.onclick = (e) => {
					e.stopPropagation();
					if (confirm(`Delete project "${p.name}"?`)) document.dispatchEvent(new CustomEvent('project-delete', {
						detail: p.id
					}));
				};
				div.appendChild(delBtn);
				this.els.projectList.appendChild(div);
			});
		}

		_bindProjectUI() {
			// 1. プロジェクト名エリアクリック -> 履歴モーダル
			if (this.els.projectSelectTrigger) {
				this.els.projectSelectTrigger.addEventListener('click', (e) => {
					// 入力欄が表示されているときはモーダルを開かない
					if (!this.els.projectRenameInput.classList.contains('hidden')) return;
					this.toggleProjectModal(true);
				});
			}

			// 2. 鉛筆ボタンクリック -> リネーム開始
			const startRename = () => {
				if (!this.els.projectRenameInput) return;
				this.els.projectRenameInput.classList.remove('hidden');
				this.els.projectRenameInput.value = this.els.projectName.textContent;
				this.els.projectRenameInput.focus();
				this.els.projectRenameInput.select();
			};

			if (this.els.btnRenameProject) {
				this.els.btnRenameProject.addEventListener('click', (e) => {
					e.stopPropagation(); // 親へのバブリング停止
					startRename();
				});
			}

			// 3. リネーム確定/キャンセル
			if (this.els.projectRenameInput) {
				const finishRename = () => {
					const val = this.els.projectRenameInput.value.trim();
					if (val) {
						this.updateProjectName(val);
						document.dispatchEvent(new CustomEvent('project-rename', {
							detail: val
						}));
					}
					this.els.projectRenameInput.classList.add('hidden');
				};

				this.els.projectRenameInput.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						finishRename();
						this.els.projectRenameInput.blur();
					}
					if (e.key === 'Escape') {
						this.els.projectRenameInput.classList.add('hidden');
					}
				});

				// フォーカスが外れたら確定
				this.els.projectRenameInput.addEventListener('blur', finishRename);
			}

			if (this.els.btnCloseModal) this.els.btnCloseModal.addEventListener('click', () => this.toggleProjectModal(false));

			if (this.els.projectName) this.els.projectName.addEventListener('dblclick', () => {
				this.els.projectRenameInput.classList.remove('hidden');
				this.els.projectRenameInput.focus();
				this.els.projectName.classList.add('opacity-0');
			});
			if (this.els.projectRenameInput) {
				const finish = () => {
					const val = this.els.projectRenameInput.value.trim();
					if (val) {
						this.updateProjectName(val);
						document.dispatchEvent(new CustomEvent('project-rename', {
							detail: val
						}));
					}
					this.els.projectRenameInput.classList.add('hidden');
					this.els.projectName.classList.remove('opacity-0');
				};
				this.els.projectRenameInput.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') finish();
					if (e.key === 'Escape') finish();
				});
				this.els.projectRenameInput.addEventListener('blur', finish);
			}
		}

		async refreshPreview() {
			if (!this.els.previewLoader || !this.els.previewFrame) return;
			this.els.previewLoader.classList.remove('hidden');
			const loadPromise = new Promise(resolve => {
				const handler = () => {
					this.els.previewFrame.removeEventListener('load', handler);
					resolve();
				};
				this.els.previewFrame.addEventListener('load', handler);
			});
			try {
				const url = await this.compiler.compile(this.vfs);
				if (url) {
					this.els.previewFrame.src = url;
					await Promise.race([loadPromise, new Promise(r => setTimeout(r, 5000))]);
				} else {
					this.els.previewFrame.srcdoc = '<div style="color:#888;padding:20px">No index.html found</div>';
				}
			} catch (e) {
				console.error("Preview Error", e);
			} finally {
				setTimeout(() => this.els.previewLoader.classList.add('hidden'), 200);
			}
		}

		async captureScreenshot() {
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
				this.els.previewFrame.contentWindow.postMessage({
					action: 'CAPTURE'
				}, '*');
			});
		}

		setSaveStatus(state) {
			const el = document.getElementById(DOM.saveStatus);
			if (!el) return;
			if (state === 'saving') {
				el.textContent = 'Saving...';
				el.className = 'text-[10px] text-yellow-500 italic mr-2 self-center transition opacity-100';
			} else if (state === 'saved') {
				el.textContent = 'Saved';
				el.className = 'text-[10px] text-green-500 italic mr-2 self-center transition opacity-100';
				setTimeout(() => el.classList.add('opacity-0'), 2000);
			} else el.classList.add('opacity-0');
		}
	}

	global.App.UI.UIController = UIController;

})(window);