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
		 * @returns {Promise<string|null>} index.htmlのBlob URL
		 */
		async compile(vfs) {
			this.revokeAll(); // メモリリーク防止

			const filePaths = vfs.listFiles();
			const urlMap = {};

			// 1. Assets (HTML以外) のBlob化
			for (const path of filePaths) {
				if (path.endsWith('.html')) continue;
				if (path.startsWith('.sample/')) continue;

				const content = vfs.readFile(path);
				const mimeType = this.getMimeType(path);

				// 画像データ(Base64)の場合とテキストの場合がある
				let blob;
				if (mimeType.startsWith('image/') && content.startsWith('data:')) {
					// DataURLならそのままfetchしてBlob化（あるいは直接使う手もあるが、URL統一のためBlob化）
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

			// 2. HTML の処理 (リンク解決 & スクリプト注入)
			let entryPointUrl = null;

			for (const path of filePaths) {
				if (!path.endsWith('.html')) continue;
				if (path.startsWith('.sample/')) continue;

				let htmlContent = vfs.readFile(path);
				htmlContent = this.processHtmlReferences(htmlContent, urlMap);
				htmlContent = this.injectScreenshotHelper(htmlContent);

				const blob = new Blob([htmlContent], {
					type: 'text/html'
				});
				const url = URL.createObjectURL(blob);

				urlMap[path] = url;
				this.blobUrls.push(url);

				if (path === 'index.html') {
					entryPointUrl = url;
				}
			}

			// index.htmlが無い場合は最初のHTMLを返す
			if (!entryPointUrl) {
				const firstHtml = filePaths.find(p => p.endsWith('.html') && !p.startsWith('.sample/'));
				if (firstHtml) entryPointUrl = urlMap[firstHtml];
			}

			return entryPointUrl;
		}

		processHtmlReferences(html, urlMap) {
			const parser = new DOMParser();
			const doc = parser.parseFromString(html, 'text/html');

			const replaceAttr = (selector, attr) => {
				doc.querySelectorAll(selector).forEach(el => {
					const val = el.getAttribute(attr);
					// 相対パス解決 (簡易版: ファイル名一致のみ)
					// 本来はディレクトリ解決が必要だが、現状はフラットに近い構造で動作させる
					if (urlMap[val]) el.setAttribute(attr, urlMap[val]);
				});
			};

			replaceAttr('script[src]', 'src');
			replaceAttr('link[href]', 'href');
			replaceAttr('img[src]', 'src');
			replaceAttr('a[href]', 'href');

			return doc.documentElement.outerHTML;
		}

		injectScreenshotHelper(html) {
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
    
                // ▼▼▼ 追加: 問題のある要素を除外するフィルタ ▼▼▼
                filter: (node) => {
                    // imgタグの場合、src属性を確認
                    if (node.tagName === 'IMG') {
                        // srcがない、空文字、または現在のページURLと同じ（src=""の挙動）場合は除外
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

            // エラーの詳細を文字列化して親へ送る
            let msg = 'Unknown Error';
            if (err instanceof Error) {
                msg = err.message;
            } else if (err.target && err.target.tagName) {
                // Eventオブジェクトの場合 (画像のロードエラーなど)
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
			if (filename.endsWith('.js')) return 'application/javascript';
			if (filename.endsWith('.css')) return 'text/css';
			if (filename.endsWith('.json')) return 'application/json';
			if (filename.endsWith('.svg')) return 'image/svg+xml';
			if (filename.endsWith('.png')) return 'image/png';
			if (filename.endsWith('.jpg')) return 'image/jpeg';
			if (filename.endsWith('.html')) return 'text/html';
			return 'text/plain';
		}

		revokeAll() {
			this.blobUrls.forEach(url => URL.revokeObjectURL(url));
			this.blobUrls = [];
		}
	}

	global.App.World.Compiler = Compiler;

})(window);