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

			// File Upload
			if (this.els.chatFileUpload) {
				this.els.chatFileUpload.onchange = (e) => {
					Array.from(e.target.files).forEach(f => {
						this.pendingUploads.push(f);
						this.renderUploadPreview(f);
					});
					e.target.value = "";
				};
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
						if (item.output.ui) p.innerHTML = `<span class="text-blue-300 font-bold">${uiText}</span>`;
						else p.textContent = uiText;
						body.appendChild(p);
						if (item.output.image) this._appendImage(body, item.output.image);
					} else if (item.inlineData) {
						this._appendImage(body, item.inlineData.data);
					}
				});
			}
			div.appendChild(body);
			this.els.chatHistory.appendChild(div);
		}

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

		_formatLPML(text) {
			const escape = (str) => {
				const div = document.createElement('div');
				div.textContent = str;
				return div.innerHTML;
			};

			const ALLOWED_TAGS = [
				'thinking', 'plan', 'report', 'ask', 'finish',
				'create_file', 'edit_file', 'read_file', 'delete_file', 'move_file',
				'list_files', 'preview', 'take_screenshot',
				'tool_outputs', 'user_input', 'event'
			].join('|');

			const TAG_REGEX = new RegExp(
				`&lt;(${ALLOWED_TAGS})([^&]*)&gt;([\\s\\S]*?)&lt;\\/\\1&gt;|` +
				`&lt;(${ALLOWED_TAGS})([^&]*)\\/&gt;`,
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
			}

			const openAttr = isOpen ? 'open' : '';
			let displayContent = innerContent.trim();
			if (attributes.trim()) displayContent = `<div class="text-[10px] text-gray-500 mb-1 border-b border-gray-700 pb-1">Attrs: ${attributes.trim()}</div>${displayContent}`;

			if (!displayContent) return `<div class="text-xs font-mono py-1 px-2 rounded border ${colorClass} mb-2 inline-block">&lt;${tagName}${attributes} /&gt;</div>`;

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