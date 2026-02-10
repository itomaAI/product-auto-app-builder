// src/app/world/compiler.js

(function(global) {
	global.App = global.App || {};
	global.App.World = global.App.World || {};

	class Compiler {
		constructor() {
			this.blobUrls = [];
		}

		/**
		 * VFSの状態からプレビュー用のエントリーポイントURLを生成
		 * @param {VirtualFileSystem} vfs 
		 * @param {string} entryPath - デフォルトのエントリーポイント
		 * @returns {Promise<string|null>} index.htmlのBlob URL
		 */
		async compile(vfs, entryPath = 'index.html') {
			this.revokeAll(); // メモリリーク防止

			const filePaths = vfs.listFiles();
			const urlMap = {};

			// --- Phase 1: Assets (Non-HTML) のBlob化 ---
			for (const path of filePaths) {
				if (path.endsWith('.html')) continue;
				if (this._isIgnored(path)) continue;

				const content = vfs.readFile(path);
				const mimeType = this.getMimeType(path);

				let blob;
				if (mimeType.startsWith('image/') && content.startsWith('data:')) {
					const res = await fetch(content);
					blob = await res.blob();
				} else {
					blob = new Blob([content], {
						type: mimeType
					});
				}

				const url = URL.createObjectURL(blob);
				urlMap[path] = url;
				this.blobUrls.push(url);
			}

			// --- Phase 2: HTML の処理 ---
			let entryPointUrl = null;

			for (const path of filePaths) {
				if (!path.endsWith('.html')) continue;
				if (this._isIgnored(path)) continue;

				let htmlContent = vfs.readFile(path);

				// 相対パス解決とBlob URLへの置換
				htmlContent = this.processHtmlReferences(htmlContent, urlMap, path);

				// スクリーンショット撮影用ヘルパーの注入
				htmlContent = this.injectScreenshotHelper(htmlContent);

				const blob = new Blob([htmlContent], {
					type: 'text/html'
				});
				const url = URL.createObjectURL(blob);

				urlMap[path] = url;
				this.blobUrls.push(url);

				if (path === entryPath) {
					entryPointUrl = url;
				}
			}

			// 指定されたエントリポイントが見つからない場合のフォールバック
			if (!entryPointUrl) {
				if (urlMap['index.html']) {
					entryPointUrl = urlMap['index.html'];
				} else {
					const firstHtml = filePaths.find(p => p.endsWith('.html') && !this._isIgnored(p));
					if (firstHtml) entryPointUrl = urlMap[firstHtml];
				}
			}

			return entryPointUrl;
		}

		/**
		 * 無視すべきファイルかどうか判定
		 * 元のコードに合わせて .sample/ のみを除外対象とする
		 * (src/ などを除外すると、ユーザーが作成したソースコードが読み込めなくなるため)
		 */
		_isIgnored(path) {
			return path.startsWith('.sample/') || path.startsWith('.git/');
		}

		/**
		 * HTML内の参照リンクをBlob URLに書き換える
		 */
		processHtmlReferences(html, urlMap, currentFilePath) {
			const parser = new DOMParser();
			const doc = parser.parseFromString(html, 'text/html');

			// カレントディレクトリの取得
			const currentDir = currentFilePath.includes('/') ?
				currentFilePath.substring(0, currentFilePath.lastIndexOf('/')) :
				'';

			const replaceAttr = (selector, attr) => {
				doc.querySelectorAll(selector).forEach(el => {
					const originalVal = el.getAttribute(attr);
					if (!originalVal) return;

					// 1. 完全一致 (元コードのロジック + ルートパス指定)
					if (urlMap[originalVal]) {
						el.setAttribute(attr, urlMap[originalVal]);
						return;
					}

					// 2. 相対パス解決 (新機能)
					const resolvedPath = this._resolvePath(currentDir, originalVal);
					if (resolvedPath && urlMap[resolvedPath]) {
						el.setAttribute(attr, urlMap[resolvedPath]);
					}
				});
			};

			replaceAttr('script[src]', 'src');
			replaceAttr('link[href]', 'href');
			replaceAttr('img[src]', 'src');
			replaceAttr('a[href]', 'href');

			return doc.documentElement.outerHTML;
		}

		/**
		 * 相対パス解決ロジック
		 */
		_resolvePath(baseDir, relativePath) {
			// プロトコル付きやハッシュリンクは無視
			if (relativePath.match(/^(https?:|data:|blob:|mailto:|javascript:|#)/)) return null;

			// ルートパス指定 (/css/style.css)
			if (relativePath.startsWith('/')) {
				return relativePath.substring(1);
			}

			// 相対パス計算
			const stack = baseDir ? baseDir.split('/') : [];
			const parts = relativePath.split('/');

			for (const part of parts) {
				if (part === '' || part === '.') continue;
				if (part === '..') {
					if (stack.length > 0) stack.pop();
				} else {
					stack.push(part);
				}
			}

			return stack.join('/');
		}

		injectScreenshotHelper(html) {
			// 元のコードのヘルパー実装を使用
			const script = `
<script src="https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js"></script>
<script>
window.addEventListener('message', async (e) => {
    if (e.data.action === 'CAPTURE') {
        try {
            let attempts = 0;
            while (typeof htmlToImage === 'undefined' && attempts < 20) {
                await new Promise(r => setTimeout(r, 100));
                attempts++;
            }
            if (typeof htmlToImage === 'undefined') throw new Error('html-to-image failed to load');

            const data = await htmlToImage.toPng(document.body, { 
                backgroundColor: null,
                skipOnError: true,
                preferredFontFormat: 'woff2',
    
                filter: (node) => {
                    if (node.tagName === 'IMG') {
                        if (!node.src || node.src === '' || node.src === window.location.href) {
                            return false;
                        }
                    }
                    return true;
                }
            });

            parent.postMessage({ type: 'SCREENSHOT_RESULT', data }, '*');
        } catch (err) {
            console.error('Screenshot failed:', err);
            let msg = 'Unknown Error';
            if (err instanceof Error) {
                msg = err.message;
            } else if (err.target && err.target.tagName) {
                msg = 'Element load error: ' + err.target.tagName + (err.target.id ? '#' + err.target.id : '');
            } else {
                msg = String(err);
            }
            parent.postMessage({ type: 'SCREENSHOT_ERROR', message: msg }, '*');
        }
    }
});
</script>`;
			if (html.includes('</body>')) {
				return html.replace('</body>', `${script}</body>`);
			} else {
				return html + script;
			}
		}

		getMimeType(filename) {
			const ext = filename.split('.').pop().toLowerCase();
			const map = {
				'js': 'application/javascript',
				'css': 'text/css',
				'html': 'text/html',
				'json': 'application/json',
				'svg': 'image/svg+xml',
				'png': 'image/png',
				'jpg': 'image/jpeg',
				'jpeg': 'image/jpeg',
				'gif': 'image/gif',
				'webp': 'image/webp',
				'woff': 'font/woff',
				'woff2': 'font/woff2',
				'ttf': 'font/ttf',
				'mp3': 'audio/mpeg',
				'mp4': 'video/mp4'
			};
			return map[ext] || 'text/plain';
		}

		revokeAll() {
			this.blobUrls.forEach(url => URL.revokeObjectURL(url));
			this.blobUrls = [];
		}
	}

	global.App.World.Compiler = Compiler;

})(window);