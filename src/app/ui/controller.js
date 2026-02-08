// src/app/ui/controller.js

(function(global) {
	global.App = global.App || {};
	global.App.UI = global.App.UI || {};

	const DOM = global.App.UI.DOM;

	class UIController {
		constructor(compiler) {
			this.compiler = compiler;
			this.els = {};
			this.pendingUploads = [];
			this.isEditorOpen = false;

			// Streaming State
			this.currentStreamEl = null;
			this.currentStreamContent = "";

			this._initElements();
			this._bindInternalEvents();
			this._initResizer();
		}

		_initElements() {
			for (const [key, id] of Object.entries(DOM)) {
				const el = document.getElementById(id);
				if (el) this.els[key] = el;
			}
		}

		_bindInternalEvents() {
			if (this.els.projectSelectTrigger) {
				this.els.projectSelectTrigger.addEventListener('click', (e) => {
					if (e.target === this.els.projectRenameInput) return;
					this.toggleProjectModal(true);
				});
			}
			if (this.els.btnCloseModal) this.els.btnCloseModal.addEventListener('click', () => this.toggleProjectModal(false));
			if (this.els.projectModal) this.els.projectModal.addEventListener('click', (e) => {
				if (e.target === this.els.projectModal) this.toggleProjectModal(false);
			});
			if (this.els.projectName) this.els.projectName.addEventListener('dblclick', () => this._startRename());
			if (this.els.projectRenameInput) {
				this.els.projectRenameInput.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') this._finishRename();
					if (e.key === 'Escape') this._cancelRename();
				});
				this.els.projectRenameInput.addEventListener('blur', () => this._finishRename());
			}
			if (this.els.btnCloseEditor) this.els.btnCloseEditor.addEventListener('click', () => this.closeEditor());
			if (this.els.chatFileUpload) {
				this.els.chatFileUpload.addEventListener('change', (e) => {
					Array.from(e.target.files).forEach(f => {
						this.pendingUploads.push(f);
						this.renderUploadPreview(f);
					});
					e.target.value = "";
				});
			}
		}

		_initResizer() {
			const resizer = document.getElementById('chat-resizer');
			const panel = document.getElementById('chat-panel');
			if (!resizer || !panel) return;
			let isResizing = false;
			const startResize = (e) => {
				isResizing = true;
				document.body.style.cursor = 'col-resize';
				resizer.classList.add('resizing');
				e.preventDefault();
			};
			const stopResize = () => {
				isResizing = false;
				document.body.style.cursor = '';
				resizer.classList.remove('resizing');
			};
			const resize = (e) => {
				if (!isResizing) return;
				const w = document.body.clientWidth - e.clientX;
				if (w > 300 && w < 800) panel.style.width = `${w}px`;
			};
			resizer.addEventListener('mousedown', startResize);
			document.addEventListener('mousemove', resize);
			document.addEventListener('mouseup', stopResize);
		}

		// --- Project Management UI ---
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
		_startRename() {
			if (this.els.projectRenameInput) {
				this.els.projectRenameInput.classList.remove('hidden');
				this.els.projectRenameInput.focus();
				this.els.projectName.classList.add('opacity-0');
			}
		}
		_finishRename() {
			if (this.els.projectRenameInput) {
				const val = this.els.projectRenameInput.value.trim();
				if (val) {
					this.updateProjectName(val);
					document.dispatchEvent(new CustomEvent('project-rename', {
						detail: val
					}));
				}
				this._cancelRename();
			}
		}
		_cancelRename() {
			if (this.els.projectRenameInput) {
				this.els.projectRenameInput.classList.add('hidden');
				this.els.projectName.classList.remove('opacity-0');
			}
		}
		setSaveStatus(state) {
			const el = this.els.saveStatus;
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

		// --- 2. Chat & Streaming ---

		startStreaming() {
			const div = document.createElement('div');
			// ストリーミング中はプレースホルダーとしてシンプルに表示
			div.className = "relative group p-3 rounded-lg text-sm mb-2 border border-transparent bg-gray-700 text-gray-200 mr-4 transition";
			div.innerHTML = `<div class="flex justify-between items-center mb-1 opacity-50 text-[10px] font-bold uppercase">MODEL (Streaming...)</div><div class="msg-content whitespace-pre-wrap break-all font-mono"></div>`;

			this.els.chatHistory.appendChild(div);
			this.scrollToBottom();

			this.currentStreamEl = div.querySelector('.msg-content');
			this.currentStreamContent = "";
		}

		updateStreaming(chunk) {
			if (!this.currentStreamEl) return;
			this.currentStreamContent += chunk;
			this.currentStreamEl.textContent = this.currentStreamContent;
			this.scrollToBottom();
		}

		finalizeStreaming() {
			if (!this.currentStreamEl) return;

			// 親コンテナの whitespace-pre-wrap を削除して隙間をなくす
			this.currentStreamEl.classList.remove('whitespace-pre-wrap');

			// タグごとに分割して整形
			this.currentStreamEl.innerHTML = this._formatLPML(this.currentStreamContent);

			const header = this.currentStreamEl.parentElement.querySelector('div:first-child');
			if (header) header.textContent = 'MODEL';

			this.currentStreamEl = null;
			this.currentStreamContent = "";
			this.scrollToBottom();
		}

		renderHistory(history) {
			if (!this.els.chatHistory) return;
			this.els.chatHistory.innerHTML = '';
			history.forEach(turn => this.appendTurn(turn));
			this.scrollToBottom();
		}

		appendTurn(turn) {
			if (turn.meta && turn.meta.visible === false) return;

			const role = turn.role;
			const content = turn.content;

			const div = document.createElement('div');
			const baseClass = "relative group p-3 rounded-lg text-sm mb-2 border border-transparent transition";

			if (role === 'user') {
				div.className = `${baseClass} bg-blue-900 text-blue-100 ml-4`;
			} else if (role === 'model') {
				div.className = `${baseClass} bg-gray-700 text-gray-200 mr-4`;
			} else {
				div.className = `${baseClass} bg-gray-800 text-gray-400 text-xs mx-8 font-mono border-gray-600`;
			}

			const header = document.createElement('div');
			header.className = "flex justify-between items-center mb-1 opacity-50 text-[10px] font-bold uppercase";
			header.textContent = role;
			div.appendChild(header);

			const body = document.createElement('div');

			// Model以外は pre-wrap を適用。Modelは内部で制御するため外す。
			if (role === 'model') {
				body.className = "break-all"; // whitespace-pre-wrap は付けない
			} else {
				body.className = "whitespace-pre-wrap break-all";
			}

			if (typeof content === 'string') {
				if (role === 'model') {
					body.innerHTML = this._formatLPML(content);
				} else {
					body.textContent = content;
				}
			} else if (Array.isArray(content)) {
				content.forEach(item => {
					if (item.text) {
						const p = document.createElement('p');
						p.textContent = item.text;
						body.appendChild(p);
					} else if (item.output) {
						const p = document.createElement('div');
						p.className = "mb-1";
						const uiText = item.output.ui || item.output.log || "";
						if (item.output.ui) {
							p.innerHTML = `<span class="text-blue-300 font-bold">${uiText}</span>`;
						} else {
							p.textContent = uiText;
						}
						body.appendChild(p);

						if (item.output.image) {
							this._appendImage(body, item.output.image);
						}
					} else if (item.inlineData) {
						this._appendImage(body, item.inlineData.data);
					} else if (item.text && item.text.startsWith('<user_attachment')) {
						const fileBadge = document.createElement('div');
						fileBadge.className = "text-xs bg-gray-900 px-2 py-1 rounded border border-gray-600 text-yellow-300 font-mono inline-block my-1";
						const nameMatch = item.text.match(/name="([^"]+)"/);
						fileBadge.textContent = `📎 ${nameMatch ? nameMatch[1] : 'File'}`;
						body.appendChild(fileBadge);
					}
				});
			}

			div.appendChild(body);
			this.els.chatHistory.appendChild(div);
			this.scrollToBottom();
		}

		// --- Helper: LPML Formatter ---

		_formatLPML(text) {
			// 1. 安全なエスケープ (textContent使用)
			const escape = (str) => {
				const div = document.createElement('div');
				div.textContent = str;
				return div.innerHTML;
			};

			// 2. 正規表現定義
			// <tag attrs...>content</tag> または <tag attrs... />
			const TAG_REGEX = /&lt;([a-zA-Z0-9_]+)([^&]*)&gt;([\s\S]*?)&lt;\/\1&gt;|&lt;([a-zA-Z0-9_]+)([^&]*)\/&gt;/g;

			let safeText = escape(text);

			const parts = [];
			let lastIndex = 0;
			let match;

			while ((match = TAG_REGEX.exec(safeText)) !== null) {
				// マッチの手前にあるテキスト（隙間）
				const gap = safeText.substring(lastIndex, match.index);

				// 隙間が空白のみなら無視（これでタグ間の隙間が消える）
				// 意味のあるテキストが含まれている場合のみ表示
				if (gap.trim()) {
					parts.push(`<div class="text-gray-400 text-xs my-1 whitespace-pre-wrap">${gap}</div>`);
				}

				// タグ部分のHTML変換
				const tagHTML = this._createTagHTML(match);
				parts.push(tagHTML);

				lastIndex = TAG_REGEX.lastIndex;
			}

			// 残りのテキスト
			const remaining = safeText.substring(lastIndex);
			if (remaining.trim()) {
				parts.push(`<div class="text-gray-400 text-xs my-1 whitespace-pre-wrap">${remaining}</div>`);
			}

			return parts.join('');
		}

		_createTagHTML(match) {
			// match: [full, tag, attrs, content, emptyTag, emptyAttrs]
			const tagName = match[1] || match[4];
			const attributes = match[2] || match[5] || "";
			const innerContent = match[3] || "";

			let title = tagName;
			let colorClass = "border-gray-600 bg-gray-800";
			let isOpen = false;

			if (tagName === 'thinking') {
				title = "💭 Thinking Process";
				colorClass = "border-blue-900 bg-blue-900/20";
				isOpen = false;
			} else if (tagName === 'plan') {
				title = "📅 Plan";
				colorClass = "border-green-900 bg-green-900/20";
				isOpen = false;
			} else if (tagName === 'create_file' || tagName === 'edit_file') {
				const pathMatch = attributes.match(/path=["']?([^"'\s]+)["']?/);
				const path = pathMatch ? pathMatch[1] : "unknown";
				title = `📝 ${tagName === 'create_file' ? 'Create' : 'Edit'}: ${path}`;
				colorClass = "border-yellow-900 bg-yellow-900/20";
				isOpen = false;
			} else if (tagName === 'read_file') {
				title = "📖 Read File";
				colorClass = "border-gray-600 bg-gray-800";
				isOpen = false;
			} else if (tagName === 'report' || tagName === 'ask') {
				title = tagName === 'ask' ? "❓ Question" : "📢 Report";
				colorClass = "border-indigo-900 bg-indigo-900/40";
				isOpen = true; // ユーザーへのメッセージは開く
			} else if (tagName === 'finish') {
				title = "✅ Task Completed";
				colorClass = "border-green-600 bg-green-900/60";
				isOpen = true;
			}

			const openAttr = isOpen ? 'open' : '';

			let displayContent = innerContent.trim();
			// 属性情報の表示
			if (attributes.trim()) {
				displayContent = `<div class="text-[10px] text-gray-500 mb-1 border-b border-gray-700 pb-1">Attributes: ${attributes.trim()}</div>${displayContent}`;
			}

			// 空タグまたは中身なしの場合
			if (!displayContent) {
				return `<div class="text-xs font-mono py-1 px-2 rounded border ${colorClass} mb-2 inline-block">&lt;${tagName}${attributes} /&gt;</div>`;
			}

			// <details> でラップ。内部は pre-wrap で改行維持
			return `
            <details ${openAttr} class="mb-2 rounded border ${colorClass} overflow-hidden group">
                <summary class="cursor-pointer p-2 text-xs font-bold text-gray-300 bg-black/20 hover:bg-black/40 select-none flex items-center gap-2">
                    <span class="group-open:rotate-90 transition-transform">▶</span> ${title}
                </summary>
                <div class="p-2 text-xs font-mono overflow-x-auto bg-black/10 whitespace-pre-wrap">${displayContent}</div>
            </details>`;
		}

		// ... (Existing _appendImage, renderUploadPreview, clearUploadPreviews, scrollToBottom, setProcessing methods) ...
		_appendImage(container, base64) {
			const img = document.createElement('img');
			img.src = `data:image/png;base64,${base64}`;
			img.className = "h-24 rounded border border-gray-600 cursor-pointer hover:opacity-80 bg-gray-900 mt-2 object-contain";
			img.onclick = () => {
				const w = window.open("");
				w.document.write(`<img src="${img.src}" style="max-width:100%">`);
			};
			container.appendChild(img);
		}
		renderUploadPreview(file) {
			if (!this.els.filePreviewArea) return;
			this.els.filePreviewArea.classList.remove('hidden');
			const div = document.createElement('div');
			div.className = "bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs flex items-center gap-2 text-gray-300 animate-fade-in";
			div.innerHTML = `<span>📎 ${file.name}</span>`;
			this.els.filePreviewArea.appendChild(div);
		}
		clearUploadPreviews() {
			if (!this.els.filePreviewArea) return;
			this.els.filePreviewArea.innerHTML = "";
			this.els.filePreviewArea.classList.add('hidden');
		}
		scrollToBottom() {
			if (this.els.chatHistory) this.els.chatHistory.scrollTop = this.els.chatHistory.scrollHeight;
		}
		setProcessing(isProcessing) {
			if (this.els.btnSend) this.els.btnSend.classList.toggle('hidden', isProcessing);
			if (this.els.btnStop) this.els.btnStop.classList.toggle('hidden', !isProcessing);
			if (this.els.aiTyping) this.els.aiTyping.classList.toggle('hidden', !isProcessing);
			if (this.els.chatInput) {
				this.els.chatInput.disabled = isProcessing;
				if (!isProcessing) this.els.chatInput.focus();
			}
		}
		renderFileList(files) {
			if (!this.els.fileList) return;
			this.els.fileList.innerHTML = '';
			files.forEach(path => {
				const li = document.createElement('li');
				li.className = 'cursor-pointer hover:bg-gray-700 p-1 rounded px-2 flex items-center gap-2 truncate text-gray-300 transition';
				li.innerHTML = `<span>📄</span> ${path}`;
				li.onclick = () => {
					this.els.fileList.dispatchEvent(new CustomEvent('file-open', {
						detail: path,
						bubbles: true
					}));
				};
				this.els.fileList.appendChild(li);
			});
		}
		openEditor(path, content) {
			if (this.els.editorFilename) this.els.editorFilename.textContent = path;
			if (this.els.codeEditor) this.els.codeEditor.value = content;
			if (this.els.editorOverlay) this.els.editorOverlay.classList.remove('hidden');
			this.isEditorOpen = true;
			const closeBtn = document.getElementById('btn-close-editor');
			if (closeBtn) closeBtn.onclick = () => this.closeEditor();
		}
		closeEditor() {
			if (this.els.editorOverlay) this.els.editorOverlay.classList.add('hidden');
			this.isEditorOpen = false;
		}
		async refreshPreview(vfs) {
			if (!this.els.previewLoader) return;
			this.els.previewLoader.classList.remove('hidden');
			const loadPromise = new Promise(resolve => {
				const handler = () => {
					this.els.previewFrame.removeEventListener('load', handler);
					resolve();
				};
				this.els.previewFrame.addEventListener('load', handler);
			});
			try {
				const url = await this.compiler.compile(vfs);
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
	}

	global.App.UI.UIController = UIController;

})(window);