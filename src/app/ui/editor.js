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
			this.editorInstance = null; // Monaco Instance

			this._initElements();
			this._initMonaco(); // 初期化開始
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

		_initMonaco() {
			if (typeof require === 'undefined') {
				console.error('Monaco loader not found');
				return;
			}

			// Monaco Editorのパス設定
			require.config({
				paths: {
					'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs'
				}
			});

			require(['vs/editor/editor.main'], () => {
				if (!this.els.codeEditor) return;

				// エディタ作成
				this.editorInstance = monaco.editor.create(this.els.codeEditor, {
					value: '',
					language: 'javascript',
					theme: 'vs-dark', // ダークテーマ
					automaticLayout: true, // コンテナリサイズに追従
					minimap: {
						enabled: true
					},
					fontSize: 14,
					scrollBeyondLastLine: false
				});

				// Ctrl+S のバインディング
				this.editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
					this._save();
				});
			});
		}

		_bindEvents() {
			if (this.els.btnCloseEditor) {
				this.els.btnCloseEditor.onclick = () => this.close();
			}
			if (this.els.btnSaveEditor) {
				this.els.btnSaveEditor.onclick = () => this._save();
			}
			// Monaco側でハンドルするため textarea の keydown イベントは削除
		}

		open(path, content) {
			if (path.match(/\.(png|jpg|jpeg|gif|webp|svg|ico)$/i)) {
				alert("Image preview is not supported in text editor.");
				return;
			}

			this.currentPath = path;
			if (this.els.editorFilename) this.els.editorFilename.textContent = path;

			if (this.els.editorOverlay) this.els.editorOverlay.classList.remove('hidden');

			// Monacoに値をセット
			if (this.editorInstance) {
				const model = this.editorInstance.getModel();
				if (model) {
					// 言語モードの判定
					const ext = path.split('.').pop();
					const langMap = {
						'js': 'javascript',
						'html': 'html',
						'css': 'css',
						'json': 'json',
						'md': 'markdown'
					};
					const lang = langMap[ext] || 'plaintext';

					monaco.editor.setModelLanguage(model, lang);
					this.editorInstance.setValue(content);
				}
			} else {
				// ロードが間に合わなかった場合のフォールバック（稀）
				console.warn("Editor not ready yet");
			}
		}

		close() {
			if (this.els.editorOverlay) this.els.editorOverlay.classList.add('hidden');
			this.currentPath = null;
		}

		_save() {
			if (!this.currentPath || !this.editorInstance) return;

			const content = this.editorInstance.getValue(); // 値の取得

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