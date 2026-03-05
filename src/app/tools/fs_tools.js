// src/app/tools/fs_tools.js

(function(global) {
	global.App = global.App || {};
	global.App.Tools = global.App.Tools || {};

	// Helper to escape regex special characters for literal search
	function escapeRegExp(string) {
		return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	global.App.Tools.registerFSTools = function(registry, vfs) {

		registry.register('read_file', async (params, state) => {
			const BINARY_EXTS = /\.(png|jpg|jpeg|gif|webp|svg|ico|bmp|pdf|zip|tar|gz|7z|rar|mp3|wav|mp4|webm|ogg)$/i;
			const isBinary = params.path.match(BINARY_EXTS);
			const content = vfs.readFile(params.path);

			if (isBinary) {
				let base64 = content;
				let mimeType = 'application/octet-stream';

				if (params.path.match(/\.pdf$/i)) mimeType = 'application/pdf';
				else if (params.path.match(/\.zip$/i)) mimeType = 'application/zip';
				else if (params.path.match(/\.(mp4|webm)$/i)) mimeType = 'video/mp4';

				if (content.startsWith('data:')) {
					const parts = content.split(',');
					const meta = parts[0];
					// base64 = parts[1]; // 実体は返さない
					const match = meta.match(/:(.*?);/);
					if (match) mimeType = match[1];
				} else if (params.path.endsWith('.svg')) {
					// base64 = btoa(unescape(encodeURIComponent(content)));
					mimeType = 'image/svg+xml';
				}

				// ★ media オブジェクトを返す
				return {
					log: `[read_file] Read binary file: ${params.path} (${mimeType})`,
					ui: `📦 Read Binary ${params.path}`,
					media: {
						path: params.path,
						mimeType: mimeType,
						metadata: {}
					}
				};
			}

			const lines = content.split(/\r?\n/);
			const showNum = params.line_numbers !== 'false';
			const s = parseInt(params.start || 1);
			const e = parseInt(params.end || 999999);

			const sliced = lines.slice(Math.max(0, s - 1), Math.min(lines.length, e));
			const contentStr = showNum ?
				sliced.map((l, i) => `${s + i} | ${l}`).join('\n') :
				sliced.join('\n');

			return {
				log: `[read_file] ${params.path}:\n${contentStr}`,
				ui: `📖 Read ${params.path} (${sliced.length} lines)`
			};
		});

		// --- create_file ---
		registry.register('create_file', async (params, state) => {
			let content = params.content || "";

			// ★ 修正: 先頭と末尾の改行を最大1つ削除 (LPMLのタグ直後に入る改行対策)
			if (content.startsWith('\n')) content = content.slice(1);
			else if (content.startsWith('\r\n')) content = content.slice(2);

			if (content.endsWith('\n')) content = content.slice(0, -1);
			else if (content.endsWith('\r\n')) content = content.slice(0, -2);

			const msg = vfs.writeFile(params.path, content);
			return {
				log: `[create_file] ${msg}`,
				ui: `📝 Created ${params.path}`
			};
		});

		// --- edit_file ---
		registry.register('edit_file', async (params, state) => {
			const content = params.content || "";
			// Check if regex is explicitly enabled
			const useRegex = params.use_regex === 'true';

			// Line-based Editing Mode
			if (params.mode) {
				const msg = vfs.editLines(
					params.path,
					params.start,
					params.end,
					params.mode,
					content
				);
				return {
					log: `[edit_file] ${msg}`,
					ui: `✏️ Edited ${params.path} (${params.mode})`
				};
			}

			// Block Replacement Mode (Itera-style: Variable Length Markers & Multi-block)
			// Matches <<<<SEARCH, <<<<<SEARCH, etc.
			if (/<{4,}SEARCH/.test(content)) {
				const blocks = [];
				const startRegex = /^(<{4,})SEARCH[^\r\n]*$/gm;
				let startMatch;

				// ステートマシン風に文字列を順次スキャンし、文字数が完全一致するマーカーだけを抽出
				while ((startMatch = startRegex.exec(content)) !== null) {
					const len = startMatch[1].length;
					const headerEnd = startMatch.index + startMatch[0].length;

					let contentStart = headerEnd;
					if (content[contentStart] === '\r') contentStart++;
					if (content[contentStart] === '\n') contentStart++;

					// 開始マーカーと同じ文字数の '=' だけの行を探す
					const midRegex = new RegExp(`^={${len}}$`, 'gm');
					midRegex.lastIndex = contentStart;
					const midMatch = midRegex.exec(content);

					if (!midMatch) continue; // みつからなければ次の SEARCH ブロックへ

					let patternStr = content.substring(contentStart, midMatch.index);
					// 直前の改行を除去
					if (patternStr.endsWith('\n')) patternStr = patternStr.slice(0, -1);
					if (patternStr.endsWith('\r')) patternStr = patternStr.slice(0, -1);

					const midEnd = midMatch.index + midMatch[0].length;
					let replaceStart = midEnd;
					if (content[replaceStart] === '\r') replaceStart++;
					if (content[replaceStart] === '\n') replaceStart++;

					// 開始マーカーと同じ文字数の '>' だけの行を探す
					const endRegex = new RegExp(`^>{${len}}$`, 'gm');
					endRegex.lastIndex = replaceStart;
					const endMatch = endRegex.exec(content);

					if (!endMatch) continue;

					let replaceStr = content.substring(replaceStart, endMatch.index);
					// 直前の改行を除去
					if (replaceStr.endsWith('\n')) replaceStr = replaceStr.slice(0, -1);
					if (replaceStr.endsWith('\r')) replaceStr = replaceStr.slice(0, -1);

					blocks.push({
						patternStr,
						replaceStr
					});

					// 次の検索開始位置を終了マーカーの後に設定
					startRegex.lastIndex = endMatch.index + endMatch[0].length;
				}

				if (blocks.length === 0) {
					throw new Error("Invalid edit block format. Ensure you use SEARCH, ====, and >>>> markers correctly (at least 4 chars, matching lengths, isolated on their own lines).");
				}

				let currentFileContent = vfs.readFile(params.path);
				let replaceCount = 0;

				for (let i = 0; i < blocks.length; i++) {
					let {
						patternStr,
						replaceStr
					} = blocks[i];

					if (!useRegex) {
						// リテラル検索として扱うため、正規表現の特殊文字を全てエスケープする
						patternStr = patternStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
					}

					let regex;
					try {
						// VFSの改行コード差異を吸収するため、必要に応じて調整が必要かもしれないが
						// 基本的には 'm' フラグで複数行マッチを行う
						regex = new RegExp(patternStr, 'm');
					} catch (e) {
						throw new Error(`Invalid RegExp in block ${i + 1}: ${e.message}`);
					}

					if (!regex.test(currentFileContent)) {
						// ヒントとしてパターンの先頭を表示
						const snippet = patternStr.length > 50 ? patternStr.slice(0, 50) + "..." : patternStr;
						throw new Error(`Search pattern not found in ${params.path} for block ${i + 1}. Search: "${snippet}"`);
					}

					// $ のエスケープ処理 (置換テキスト内の $ が正規表現の後方参照として誤爆するのを防ぐ)
					const safeReplaceStr = replaceStr.replace(/\$/g, '$$$$');
					const newContent = currentFileContent.replace(regex, safeReplaceStr);

					if (newContent === currentFileContent) {
						throw new Error(`Replacement resulted in no change for block ${i + 1}.`);
					}

					currentFileContent = newContent;
					replaceCount++;
				}

				// すべての置換が成功した場合のみ書き込む
				vfs.writeFile(params.path, currentFileContent);

				const blockMsg = replaceCount > 1 ? ` (${replaceCount} blocks updated)` : '';
				return {
					log: `[edit_file] Replaced content in ${params.path}${blockMsg}`,
					ui: `✏️ ${useRegex ? 'Regex' : 'Text'} Replace in ${params.path}`
				};
			}

			// Fallback error if no mode and no blocks found
			throw new Error("Invalid <edit_file> content. Use SEARCH markers or specify 'mode' attribute.");
		});
	};

})(window);