// src/app/tools/fs_tools.js

(function(global) {
	global.App = global.App || {};
	global.App.Tools = global.App.Tools || {};

	global.App.Tools.registerFSTools = function(registry, vfs) {

		// --- read_file (画像拡張子追加済み) ---
		registry.register('read_file', async (params, state) => {
			const isImage = params.path.match(/\.(png|jpg|jpeg|gif|webp|svg|ico|bmp)$/i);
			const content = vfs.readFile(params.path);

			if (isImage) {
				let base64 = content;
				let mimeType = 'image/png';

				if (content.startsWith('data:')) {
					const parts = content.split(',');
					const meta = parts[0];
					base64 = parts[1];
					const match = meta.match(/:(.*?);/);
					if (match) mimeType = match[1];
				} else if (params.path.endsWith('.svg')) {
					base64 = btoa(unescape(encodeURIComponent(content)));
					mimeType = 'image/svg+xml';
				}

				return {
					log: `[read_file] Read image file: ${params.path}`,
					ui: `🖼️ Read Image ${params.path}`,
					image: base64,
					mimeType: mimeType
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
			const msg = vfs.writeFile(params.path, params.content);
			return {
				log: `[create_file] ${msg}`,
				ui: `📝 Created ${params.path}`
			};
		});

		// --- edit_file ---
		registry.register('edit_file', async (params, state) => {
			const content = params.content || "";

			// マーカー定義 (Regex Replacement Mode)
			const MARKER_SEARCH = "<<<<SEARCH";
			const MARKER_DIVIDER = "====";
			const MARKER_END = ">>>>";

			// 1. ガード処理: 1つのタグに複数の置換ブロックが含まれていたらエラーにする
			// (splitして3つ以上になる = マーカーが2回以上出現している)
			if (content.split(MARKER_SEARCH).length > 2) {
				throw new Error(
					"Multiple replacement blocks detected in one <edit_file> tag. " +
					"Please split them into separate <edit_file> tags for safety."
				);
			}

			// 2. 正規表現置換モード (マーカーが存在する場合)
			if (content.includes(MARKER_SEARCH) && content.includes(MARKER_DIVIDER) && content.includes(MARKER_END)) {

				const searchStart = content.indexOf(MARKER_SEARCH) + MARKER_SEARCH.length;
				const divStart = content.indexOf(MARKER_DIVIDER);
				const divEnd = divStart + MARKER_DIVIDER.length;
				const blockEnd = content.lastIndexOf(MARKER_END);

				// 構造チェック
				if (divStart < searchStart || blockEnd < divEnd) {
					throw new Error("Invalid edit_file format: Markers are malformed or out of order.");
				}

				// 文字列抽出
				let patternStr = content.substring(searchStart, divStart);
				let replaceStr = content.substring(divEnd, blockEnd);

				// 前後の改行トリム（マーカー行の改行を除去）
				// 先頭/末尾の改行を1つだけ除去する
				if (patternStr.startsWith('\n')) patternStr = patternStr.substring(1);
				if (patternStr.endsWith('\n')) patternStr = patternStr.substring(0, patternStr.length - 1);

				if (replaceStr.startsWith('\n')) replaceStr = replaceStr.substring(1);
				if (replaceStr.endsWith('\n')) replaceStr = replaceStr.substring(0, replaceStr.length - 1);

				// VFS呼び出し (正規表現置換)
				const msg = vfs.replaceContent(params.path, patternStr, replaceStr);
				return {
					log: `[edit_file] ${msg}`,
					ui: `✏️ Regex Replace in ${params.path}`
				};
			}

			// 3. 行指定モード (Fallback / Legacy)
			if (!params.mode) {
				throw new Error("Attribute 'mode' is required when not using SEARCH/REPLACE blocks.");
			}

			// VFS呼び出し (行編集)
			const msg = vfs.editLines(
				params.path,
				params.start,
				params.end,
				params.mode,
				content // 生コンテンツを渡す (vfs側で改行サニタイズされる)
			);
			return {
				log: `[edit_file] ${msg}`,
				ui: `✏️ ${msg}`
			};
		});
	};

})(window);