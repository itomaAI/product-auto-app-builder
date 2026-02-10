// src/app/ui/media_viewer.js

(function(global) {
	global.App = global.App || {};
	global.App.UI = global.App.UI || {};

	const DOM = global.App.UI.DOM;

	class MediaViewer {
		constructor() {
			this.els = {};
			this.currentObjectUrl = null; // メモリリーク防止用
			this._initElements();
			this._bindEvents();
		}

		_initElements() {
			['mediaOverlay', 'mediaImage', 'btnCloseMedia', 'mediaFilename']
			.forEach(key => {
				const id = DOM[key];
				if (id) this.els[key] = document.getElementById(id);
			});
		}

		_bindEvents() {
			if (this.els.btnCloseMedia) {
				this.els.btnCloseMedia.onclick = () => this.close();
			}
			if (this.els.mediaOverlay) {
				// Overlayクリックで閉じる
				this.els.mediaOverlay.onclick = (e) => {
					if (e.target === this.els.mediaOverlay) this.close();
				};
			}
		}

		/**
		 * @param {string} path - ファイル名またはパス
		 * @param {string} base64 - Base64データ (DataURL形式またはRaw)
		 * @param {string|null} mimeType - 明示的なMIMEタイプ (省略可)
		 */
		open(path, base64, mimeType = null) {
			if (this.els.mediaFilename) this.els.mediaFilename.textContent = path;
			if (!this.els.mediaOverlay) return;

			this.closeResource(); // 前のBlobがあれば解放

			// 1. MIMEタイプの決定
			let mime = mimeType;
			if (!mime) {
				// DataURLヘッダがあればそこから取得
				const match = base64.match(/^data:(.*?);base64,/);
				if (match) {
					mime = match[1];
				} else {
					// 拡張子から推論
					if (path.toLowerCase().endsWith('.pdf')) mime = 'application/pdf';
					else mime = this._guessMime(path);
				}
			}

			// 2. 表示エリアのクリア
			if (this.els.mediaImage) {
				this.els.mediaImage.classList.add('hidden');
				this.els.mediaImage.src = '';
			}
			const existingContent = this.els.mediaOverlay.querySelectorAll('.dynamic-content');
			existingContent.forEach(el => el.remove());

			// 3. タイプ別表示ロジック
			if (mime === 'application/pdf') {
				// --- PDF ---
				const blob = this._base64ToBlob(base64, mime);
				this.currentObjectUrl = URL.createObjectURL(blob);

				const iframe = document.createElement('iframe');
				iframe.src = this.currentObjectUrl;
				iframe.className = "dynamic-content w-[90%] h-[80%] rounded shadow-lg border border-gray-700 bg-white";
				this.els.mediaOverlay.appendChild(iframe);

			} else if (mime.startsWith('image/')) {
				// --- 画像 ---
				let src = base64;
				if (!base64.startsWith('data:')) {
					src = `data:${mime};base64,${base64}`;
				}
				if (this.els.mediaImage) {
					this.els.mediaImage.src = src;
					this.els.mediaImage.classList.remove('hidden');
				}

			} else {
				// --- その他 (非対応) ---
				const div = document.createElement('div');
				div.className = "dynamic-content bg-gray-800 p-8 rounded-lg border border-gray-600 flex flex-col items-center text-center shadow-xl";

				div.innerHTML = `
                    <div class="text-4xl mb-4">📦</div>
                    <div class="text-lg font-bold text-gray-200 mb-2">Preview Not Available</div>
                    <div class="text-sm text-gray-400 mb-6 font-mono">${mime || 'Unknown Type'}</div>
                `;

				// ダウンロードボタン
				const btn = document.createElement('button');
				btn.className = "bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm transition flex items-center gap-2";
				btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg> Download File`;

				btn.onclick = () => {
					const link = document.createElement('a');
					// Data URLを構築してダウンロード
					const rawBase64 = base64.replace(/^data:.*?;base64,/, '');
					link.href = `data:${mime || 'application/octet-stream'};base64,${rawBase64}`;
					link.download = path.split('/').pop(); // ファイル名のみ抽出
					link.click();
				};

				div.appendChild(btn);
				this.els.mediaOverlay.appendChild(div);
			}

			this.els.mediaOverlay.classList.remove('hidden');
		}

		close() {
			if (this.els.mediaOverlay) {
				this.els.mediaOverlay.classList.add('hidden');
				// 動的生成物を掃除
				const contents = this.els.mediaOverlay.querySelectorAll('.dynamic-content');
				contents.forEach(el => el.remove());
			}
			if (this.els.mediaImage) {
				this.els.mediaImage.src = '';
				this.els.mediaImage.classList.add('hidden');
			}
			this.closeResource();
		}

		closeResource() {
			if (this.currentObjectUrl) {
				URL.revokeObjectURL(this.currentObjectUrl);
				this.currentObjectUrl = null;
			}
		}

		_guessMime(path) {
			if (path.endsWith('.svg')) return 'image/svg+xml';
			if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
			if (path.endsWith('.gif')) return 'image/gif';
			if (path.endsWith('.webp')) return 'image/webp';
			if (path.endsWith('.png')) return 'image/png';
			return ''; // 不明な場合は空文字を返す
		}

		_base64ToBlob(base64, mimeType) {
			const raw = base64.replace(/^data:.*?;base64,/, '');
			const byteCharacters = atob(raw);
			const byteNumbers = new Array(byteCharacters.length);
			for (let i = 0; i < byteCharacters.length; i++) {
				byteNumbers[i] = byteCharacters.charCodeAt(i);
			}
			const byteArray = new Uint8Array(byteNumbers);
			return new Blob([byteArray], {
				type: mimeType
			});
		}
	}

	global.App.UI.MediaViewer = MediaViewer;

})(window);