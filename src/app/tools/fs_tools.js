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
					base64 = parts[1];
					const match = meta.match(/:(.*?);/);
					if (match) mimeType = match[1];
				} else if (params.path.endsWith('.svg')) {
					base64 = btoa(unescape(encodeURIComponent(content)));
					mimeType = 'image/svg+xml';
				}

				return {
					log: `[read_file] Read binary file: ${params.path} (${mimeType})`,
					ui: `📦 Read Binary ${params.path}`,
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
			// Check if regex is explicitly enabled
			const useRegex = params.use_regex === 'true';

			// マーカー定義
			const MARKER_SEARCH = "<<<<SEARCH";
			const MARKER_DIVIDER = "====";
			const MARKER_END = ">>>>";

			if (content.split(MARKER_SEARCH).length > 2) {
				throw new Error(
					"Multiple replacement blocks detected in one <edit_file> tag. " +
					"Please split them into separate <edit_file> tags for safety."
				);
			}

			// Block Replacement Mode (Search & Replace)
			if (content.includes(MARKER_SEARCH) && content.includes(MARKER_DIVIDER) && content.includes(MARKER_END)) {

				const searchStart = content.indexOf(MARKER_SEARCH) + MARKER_SEARCH.length;
				const divStart = content.indexOf(MARKER_DIVIDER);
				const divEnd = divStart + MARKER_DIVIDER.length;
				const blockEnd = content.lastIndexOf(MARKER_END);

				if (divStart < searchStart || blockEnd < divEnd) {
					throw new Error("Invalid edit_file format: Markers are malformed or out of order.");
				}

				let patternStr = content.substring(searchStart, divStart);
				let replaceStr = content.substring(divEnd, blockEnd);

				// 改行トリム (プロンプトの都合で入る余計な改行を除去)
				if (patternStr.startsWith('\n')) patternStr = patternStr.substring(1);
				if (patternStr.endsWith('\n')) patternStr = patternStr.substring(0, patternStr.length - 1);

				if (replaceStr.startsWith('\n')) replaceStr = replaceStr.substring(1);
				if (replaceStr.endsWith('\n')) replaceStr = replaceStr.substring(0, replaceStr.length - 1);

				// ★ 変更点: 正規表現モードでない場合はエスケープする
				if (!useRegex) {
					// リテラル検索として扱うため、正規表現の特殊文字を全てエスケープする
					patternStr = escapeRegExp(patternStr);
				}

				// VFSのreplaceContentは RegExp(patternStr) を使う仕様なので、
				// リテラル検索の場合はエスケープ済みの文字列を渡すことで完全一致検索となる。
				const msg = vfs.replaceContent(params.path, patternStr, replaceStr);

				return {
					log: `[edit_file] ${msg}`,
					ui: `✏️ ${useRegex ? 'Regex' : 'Text'} Replace in ${params.path}`
				};
			}

			// Line-based Editing Mode (Fallback)
			if (!params.mode) {
				throw new Error("Attribute 'mode' is required when not using SEARCH/REPLACE blocks.");
			}

			const msg = vfs.editLines(
				params.path,
				params.start,
				params.end,
				params.mode,
				content
			);
			return {
				log: `[edit_file] ${msg}`,
				ui: `✏️ ${msg}`
			};
		});
	};

})(window);