// src/app/ui/chat.js

(function(global) {
	global.App = global.App || {};
	global.App.UI = global.App.UI || {};

	const DOM = global.App.UI.DOM;

	class ChatComponent {
		constructor() {
			this.els = {};
			this.events = {};
			this.pendingUploads = [];
			this.currentStreamEl = null;
			this.currentStreamContent = "";

			this._initElements();
			this._bindEvents();
			this._initResizer();
		}

		on(event, callback) {
			this.events[event] = callback;
		}

		_initElements() {
			['chatHistory', 'chatInput', 'btnSend', 'btnStop', 'btnClear',
				'aiTyping', 'filePreviewArea', 'chatFileUpload', 'chatResizer', 'previewFrame'
			]
			.forEach(key => {
				const id = DOM[key];
				if (id) this.els[key] = document.getElementById(id);
			});
		}

		_bindEvents() {
			// Send
			const handleSend = () => {
				const text = this.els.chatInput.value.trim();
				if (!text && this.pendingUploads.length === 0) return;

				if (this.events['send']) {
					this.events['send'](text, [...this.pendingUploads]);
				}

				this.els.chatInput.value = '';
				this.clearUploadPreviews();
				this.pendingUploads = [];
			};

			if (this.els.btnSend) this.els.btnSend.onclick = handleSend;
			if (this.els.chatInput) {
				this.els.chatInput.onkeydown = (e) => {
					if (e.ctrlKey && e.key === 'Enter') handleSend();
				};
			}

			// Stop
			if (this.els.btnStop) {
				this.els.btnStop.onclick = () => {
					if (this.events['stop']) this.events['stop']();
				};
			}

			// Clear
			if (this.els.btnClear) {
				this.els.btnClear.onclick = () => {
					if (this.events['clear']) this.events['clear']();
				};
			}

			// File Upload (Button)
			if (this.els.chatFileUpload) {
				this.els.chatFileUpload.onchange = (e) => {
					Array.from(e.target.files).forEach(f => {
						this.pendingUploads.push(f);
					});
					this._refreshPreviews(); // リスト更新
					e.target.value = "";
				};
			}

			// ★ 追加: File Upload (Drag & Drop to Chat Input)
			const dropZone = this.els.chatInput ? this.els.chatInput.parentElement : null;
			if (dropZone) {
				// デフォルト動作の無効化
				['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
					dropZone.addEventListener(eventName, (e) => {
						e.preventDefault();
						e.stopPropagation();
					}, false);
				});

				// ハイライト表示
				dropZone.addEventListener('dragover', () => {
					dropZone.classList.add('ring-2', 'ring-blue-500', 'bg-gray-800');
				});

				// ハイライト解除
				['dragleave', 'drop'].forEach(eventName => {
					dropZone.addEventListener(eventName, () => {
						dropZone.classList.remove('ring-2', 'ring-blue-500', 'bg-gray-800');
					});
				});

				// ドロップ処理
				dropZone.addEventListener('drop', (e) => {
					const files = e.dataTransfer.files;
					if (files.length > 0) {
						Array.from(files).forEach(f => {
							this.pendingUploads.push(f);
						});
						this._refreshPreviews(); // リスト更新
					}
				});
			}
		}

		_initResizer() {
			const resizer = this.els.chatResizer;
			const panel = document.getElementById('chat-panel');
			const iframe = this.els.previewFrame;
			const overlay = document.getElementById(DOM.resizeOverlay);

			if (!resizer || !panel) return;

			let isResizing = false;
			const start = (e) => {
				isResizing = true;
				document.body.style.cursor = 'col-resize';
				resizer.classList.add('resizing');

				if (overlay) overlay.classList.remove('hidden');
				if (iframe) iframe.style.pointerEvents = 'none';
				e.preventDefault();
			};
			const stop = () => {
				if (!isResizing) return;
				isResizing = false;
				document.body.style.cursor = '';
				resizer.classList.remove('resizing');

				if (overlay) overlay.classList.add('hidden');
				if (iframe) iframe.style.pointerEvents = '';
			};
			const move = (e) => {
				if (!isResizing) return;
				const w = document.body.clientWidth - e.clientX;
				if (w > 300 && w < 800) panel.style.width = `${w}px`;
				e.preventDefault();
			};

			resizer.onmousedown = start;
			document.onmousemove = move;
			document.onmouseup = stop;
			window.onblur = stop;
		}

		// --- Public UI Methods ---

		setProcessing(isProcessing) {
			if (this.els.btnSend) this.els.btnSend.classList.toggle('hidden', isProcessing);
			if (this.els.btnStop) this.els.btnStop.classList.toggle('hidden', !isProcessing);
			if (this.els.aiTyping) this.els.aiTyping.classList.toggle('hidden', !isProcessing);
			if (this.els.chatInput) {
				this.els.chatInput.disabled = isProcessing;
				if (!isProcessing) this.els.chatInput.focus();
			}
		}

		renderHistory(history) {
			if (!this.els.chatHistory) return;
			this.els.chatHistory.innerHTML = '';
			history.forEach(turn => this._appendTurn(turn));
			this.scrollToBottom(true);
		}

		startStreaming() {
			const div = document.createElement('div');
			div.className = "relative group p-3 rounded-lg text-sm mb-2 border border-transparent bg-gray-700 text-gray-200 mr-4 transition";
			div.innerHTML = `<div class="flex justify-between items-center mb-1 opacity-50 text-[10px] font-bold uppercase">MODEL (Streaming...)</div><div class="msg-content whitespace-pre-wrap break-all font-mono"></div>`;
			this.els.chatHistory.appendChild(div);
			this.scrollToBottom(true);
			this.currentStreamEl = div.querySelector('.msg-content');
			this.currentStreamContent = "";
		}

		updateStreaming(chunk) {
			if (!this.currentStreamEl) return;
			this.currentStreamContent += chunk;
			this.currentStreamEl.textContent = this.currentStreamContent;
			this.scrollToBottom(false);
		}

		finalizeStreaming() {
			if (!this.currentStreamEl) return;
			this.currentStreamEl.classList.remove('whitespace-pre-wrap');
			this.currentStreamEl.innerHTML = this._formatLPML(this.currentStreamContent);
			const header = this.currentStreamEl.parentElement.querySelector('div:first-child');
			if (header) header.textContent = 'MODEL';
			this.currentStreamEl = null;
			this.currentStreamContent = "";
			this.scrollToBottom(true);
		}

		scrollToBottom(force = false) {
			const el = this.els.chatHistory;
			if (!el) return;
			const threshold = 100;
			const isAtBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + threshold;
			if (force || isAtBottom) {
				el.scrollTop = el.scrollHeight;
			}
		}

		// --- Internal Helpers ---

		_appendTurn(turn) {
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
			// Model messages handle whitespace inside LPML formatter
			const isFormatted = role === 'model' || (role === 'system' && typeof content === 'string' && content.includes('<event'));
			body.className = isFormatted ? "break-all" : "whitespace-pre-wrap break-all";

			if (typeof content === 'string') {
				if (role === 'model' || (role === 'system' && content.includes('<event'))) {
					body.innerHTML = this._formatLPML(content);
				} else {
					body.textContent = content;
				}
			} else if (Array.isArray(content)) {
				content.forEach(item => {
					if (item.text) {
						const p = document.createElement('div');
						// Hack: Check if text looks like LPML (for system events or structured logs)
						if (item.text.trim().startsWith('<')) p.innerHTML = this._formatLPML(item.text);
						else p.textContent = item.text;
						body.appendChild(p);
					} else if (item.output) {
						const p = document.createElement('div');
						p.className = "mb-1";
						const uiText = item.output.ui || item.output.log || "";

						// 【修正】HTML文字列ではなくtextContentを使用してタグ消失を防ぐ
						if (item.output.ui) {
							const span = document.createElement('span');
							span.className = "text-blue-300 font-bold";
							span.textContent = uiText;
							p.appendChild(span);
						} else {
							p.textContent = uiText;
						}

						body.appendChild(p);

						// 【修正】画像以外のメディアもハンドリング
						if (item.output.image) {
							this._appendMedia(body, item.output.image, item.output.mimeType);
						}
					} else if (item.inlineData) {
						// 【修正】画像以外のメディアもハンドリング
						this._appendMedia(body, item.inlineData.data, item.inlineData.mimeType);
					}
				});
			}
			div.appendChild(body);
			this.els.chatHistory.appendChild(div);
		}

		// 【新設】メディアの種類に応じて表示を切り替えるメソッド
		_appendMedia(container, base64, mimeType) {
			// デフォルトは画像として扱う (screenshot等でmimeTypeがない場合)
			let mime = mimeType;
			if (!mime) {
				// Base64ヘッダがあればそこから取得
				const match = base64.match(/^data:(.*?);base64,/);
				if (match) {
					mime = match[1];
					// ヘッダ付きBase64の場合は本文だけ抽出
					base64 = base64.split(',')[1];
				} else {
					mime = 'image/png';
				}
			}

			if (mime.startsWith('image/')) {
				const img = document.createElement('img');
				img.src = `data:${mime};base64,${base64}`;
				img.className = "h-24 rounded border border-gray-600 cursor-pointer hover:opacity-80 bg-gray-900 mt-2 object-contain";
				img.onclick = () => {
					if (this.events['preview_request']) {
						this.events['preview_request']('Image Preview', base64, mime);
					}
				};
				container.appendChild(img);
			} else {
				// 画像以外 (PDF, ZIP, Textなど)
				const div = document.createElement('div');
				div.className = "flex items-center gap-3 p-3 mt-2 rounded border border-gray-600 bg-gray-800 max-w-xs hover:bg-gray-700 transition select-none cursor-pointer";

				let icon = '📄';
				if (mime.includes('pdf')) icon = '📕';
				else if (mime.includes('zip') || mime.includes('compressed')) icon = '📦';
				else if (mime.includes('text') || mime.includes('json') || mime.includes('javascript')) icon = '📝';
				else if (mime.includes('audio')) icon = '🎵';
				else if (mime.includes('video')) icon = '🎬';

				const ext = mime.split('/')[1] || 'FILE';

				div.innerHTML = `
					<div class="text-2xl">${icon}</div>
					<div class="flex flex-col overflow-hidden">
						<span class="text-xs text-gray-300 font-bold font-mono uppercase truncate">${ext}</span>
						<span class="text-[10px] text-gray-500 truncate">BINARY DATA</span>
					</div>
				`;

				div.onclick = () => {
					if (this.events['preview_request']) {
						const ext = mime.split('/')[1] || 'file';
						this.events['preview_request'](`Attachment.${ext}`, base64, mime);
					}
				};

				container.appendChild(div);
			}
		}

		// ★ 変更: プレビューエリアの一括更新（削除機能付き）
		_refreshPreviews() {
			if (!this.els.filePreviewArea) return;
			this.els.filePreviewArea.innerHTML = "";

			if (this.pendingUploads.length === 0) {
				this.els.filePreviewArea.classList.add('hidden');
				return;
			}

			this.els.filePreviewArea.classList.remove('hidden');

			this.pendingUploads.forEach((file, index) => {
				const div = document.createElement('div');
				div.className = "bg-gray-800 border border-gray-600 rounded pl-2 pr-1 py-1 text-xs flex items-center gap-2 text-gray-300 animate-fade-in select-none group";

				// ファイル名
				const span = document.createElement('span');
				span.className = "truncate max-w-[150px]";
				span.textContent = `📎 ${file.name}`;
				span.title = file.name;
				div.appendChild(span);

				// 削除ボタン
				const btn = document.createElement('button');
				btn.className = "text-gray-500 hover:text-red-400 hover:bg-gray-700 rounded px-1 transition cursor-pointer flex items-center justify-center w-5 h-5 ml-1";
				btn.innerHTML = "×";
				btn.title = "Remove file";
				btn.onclick = (e) => {
					e.stopPropagation();
					this.pendingUploads.splice(index, 1);
					this._refreshPreviews(); // 再描画
				};
				div.appendChild(btn);

				this.els.filePreviewArea.appendChild(div);
			});
		}

		clearUploadPreviews() {
			if (!this.els.filePreviewArea) return;
			this.els.filePreviewArea.innerHTML = "";
			this.els.filePreviewArea.classList.add('hidden');
		}

		_formatLPML(text) {
			const escape = (str) => {
				const div = document.createElement('div');
				div.textContent = str;
				return div.innerHTML;
			};

			// 【修正】ホワイトリスト廃止・汎用タグパターンマッチ
			const TAG_NAME_PATTERN = '[a-zA-Z0-9_\\-]+';
			const TAG_REGEX = new RegExp(
				`&lt;(${TAG_NAME_PATTERN})([^&]*)&gt;([\\s\\S]*?)&lt;\\/\\1&gt;|` +
				`&lt;(${TAG_NAME_PATTERN})([^&]*)\\/&gt;`,
				'g'
			);

			let safeText = escape(text);
			const parts = [];
			let lastIndex = 0;
			let match;

			while ((match = TAG_REGEX.exec(safeText)) !== null) {
				const gap = safeText.substring(lastIndex, match.index);
				if (gap.trim()) parts.push(`<div class="text-gray-400 text-xs my-1 whitespace-pre-wrap">${gap}</div>`);
				parts.push(this._createTagHTML(match));
				lastIndex = TAG_REGEX.lastIndex;
			}
			const remaining = safeText.substring(lastIndex);
			if (remaining.trim()) parts.push(`<div class="text-gray-400 text-xs my-1 whitespace-pre-wrap">${remaining}</div>`);
			return parts.join('');
		}

		_createTagHTML(match) {
			const tagName = match[1] || match[4];
			const attributes = match[2] || match[5] || "";
			const innerContent = match[3] || "";

			let title = tagName;
			let colorClass = "border-gray-600 bg-gray-800";
			let isOpen = false;

			if (tagName === 'thinking') {
				title = "💭 Thinking";
				colorClass = "border-blue-900 bg-blue-900/20";
			} else if (tagName === 'plan') {
				title = "📅 Plan";
				colorClass = "border-green-900 bg-green-900/20";
			} else if (tagName === 'event') {
				title = "⚡ System Event";
				colorClass = "border-purple-900 bg-purple-900/20";
			} else if (tagName === 'report' || tagName === 'ask') {
				title = tagName === 'ask' ? "❓ Question" : "📢 Report";
				colorClass = "border-indigo-900 bg-indigo-900/40";
				isOpen = true;
			} else if (tagName === 'finish') {
				title = "✅ Completed";
				colorClass = "border-green-600 bg-green-900/60";
				isOpen = true;
			} else if (['create_file', 'edit_file'].includes(tagName)) {
				const pathMatch = attributes.match(/path=["']?([^"'\s]+)["']?/);
				title = `📝 ${tagName}: ${pathMatch ? pathMatch[1] : ''}`;
				colorClass = "border-yellow-900 bg-yellow-900/20";
			} else if (['read_file', 'list_files', 'delete_file', 'move_file', 'preview', 'take_screenshot'].includes(tagName)) {
				title = `🔧 ${tagName}`;
				colorClass = "border-gray-600 bg-gray-800";
			} else {
				// 【修正】未知のタグのフォールバック
				title = `⚙️ ${tagName}`;
				colorClass = "border-gray-600 bg-gray-700/50";
			}

			const openAttr = isOpen ? 'open' : '';
			let displayContent = innerContent.trim();
			if (attributes.trim()) displayContent = `<div class="text-[10px] text-gray-500 mb-1 border-b border-gray-700 pb-1">Attrs: ${attributes.trim()}</div>${displayContent}`;

			if (!displayContent) {
				// 自己終了タグ等の表示
				return `<div class="text-xs font-mono py-1 px-2 rounded border ${colorClass} mb-2 inline-block opacity-80" title="Tool Call">&lt;${tagName}${attributes} /&gt;</div>`;
			}

			return `<details ${openAttr} class="mb-2 rounded border ${colorClass} overflow-hidden group">
                <summary class="cursor-pointer p-2 text-xs font-bold text-gray-300 bg-black/20 hover:bg-black/40 select-none flex items-center gap-2">
                    <span class="group-open:rotate-90 transition-transform">▶</span> ${title}
                </summary>
                <div class="p-2 text-xs font-mono overflow-x-auto bg-black/10 whitespace-pre-wrap">${displayContent}</div>
            </details>`;
		}
	}

	global.App.UI.ChatComponent = ChatComponent;

})(window);