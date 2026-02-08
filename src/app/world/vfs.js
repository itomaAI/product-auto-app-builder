// src/app/world/vfs.js

(function(global) {
	global.App = global.App || {};
	global.App.World = global.App.World || {};

	class VirtualFileSystem {
		constructor(initialFiles = {}) {
			this.files = {
				...initialFiles
			};
			this.listeners = [];
		}

		subscribe(callback) {
			this.listeners.push(callback);
			return () => this.listeners = this.listeners.filter(cb => cb !== callback);
		}

		notify() {
			this.listeners.forEach(cb => cb(this.files));
		}

		exists(path) {
			return Object.prototype.hasOwnProperty.call(this.files, path);
		}

		readFile(path) {
			if (!this.exists(path)) throw new Error(`File not found: ${path}`);
			return this.files[path];
		}

		readLines(path, startLine = 1, endLine = 999999) {
			const content = this.readFile(path);
			const lines = content.split(/\r?\n/);
			const s = Math.max(0, parseInt(startLine) - 1);
			const e = Math.min(lines.length, parseInt(endLine));
			return lines.slice(s, e);
		}

		writeFile(path, content) {
			this.files[path] = content;
			this.notify();
			return `Wrote ${content.length} chars to ${path}`;
		}

		deleteFile(path) {
			if (this.exists(path)) {
				delete this.files[path];
				this.notify();
				return `Deleted ${path}`;
			}
			return `File ${path} did not exist.`;
		}

		moveFile(oldPath, newPath) {
			if (!this.exists(oldPath)) throw new Error(`Source ${oldPath} not found.`);
			if (this.exists(newPath)) throw new Error(`Destination ${newPath} already exists.`);

			this.files[newPath] = this.files[oldPath];
			delete this.files[oldPath];
			this.notify();
			return `Moved ${oldPath} to ${newPath}`;
		}

		copyFile(srcPath, destPath) {
			if (!this.exists(srcPath)) throw new Error(`Source ${srcPath} not found.`);
			if (this.exists(destPath)) throw new Error(`Destination ${destPath} already exists.`);

			this.files[destPath] = this.files[srcPath];
			this.notify();
			return `Copied ${srcPath} to ${destPath}`;
		}

		listFiles() {
			return Object.keys(this.files).sort();
		}

		/**
		 * 正規表現による置換 (New)
		 * @param {string} path 
		 * @param {string} patternStr - 正規表現パターン文字列
		 * @param {string} replacement - 置換後の文字列
		 */
		replaceContent(path, patternStr, replacement) {
			if (!this.exists(path)) throw new Error(`File not found: ${path}`);

			const content = this.files[path];

			// フラグ 'm' (multiline) は必須。's' (dotAll) はブラウザ依存があるため、
			// 改行マッチには [\s\S] を使うようプロンプトで促す方が無難だが、
			// 最近のブラウザなら 's' も使えることが多い。一旦 'gm' とする。
			// 'g' (global) をつけるかどうかは議論の余地があるが、
			// コード編集で予期せぬ箇所まで変わるのは危険なので、まずは「最初の1箇所」だけ置換する仕様にする。

			let regex;
			try {
				regex = new RegExp(patternStr, 'm');
			} catch (e) {
				throw new Error(`Invalid Regular Expression: ${e.message}`);
			}

			if (!regex.test(content)) {
				// デバッグしやすいように、パターンの先頭一部だけエラーメッセージに含める
				const disp = patternStr.length > 50 ? patternStr.substring(0, 50) + "..." : patternStr;
				throw new Error(`Pattern not found in ${path}.\nPattern: ${disp}`);
			}

			// 置換実行
			// String.prototype.replace は正規表現を渡すと、最初のマッチのみ置換する（gフラグがない場合）
			const newContent = content.replace(regex, replacement);

			// 変更がなかった場合（testは通ったがreplaceで変わらなかった奇妙なケース）
			if (newContent === content) {
				throw new Error(`Pattern matched but replacement resulted in no change.`);
			}

			this.files[path] = newContent;
			this.notify();
			return `Replaced pattern match in ${path}`;
		}

		// --- 従来の行指定編集 (Fallback用) ---
		editLines(path, startLine, endLine, mode, newContent = "") {
			if (!this.exists(path)) throw new Error(`File not found: ${path}`);

			const content = this.files[path];
			let lines = content.split(/\r?\n/);

			// 1. Newline Sanitization
			let cleanContent = newContent;
			if (cleanContent.startsWith('\n')) cleanContent = cleanContent.substring(1);
			if (cleanContent.endsWith('\n')) cleanContent = cleanContent.substring(0, cleanContent.length - 1);

			const newLines = cleanContent.split(/\r?\n/);
			const sLine = parseInt(startLine);
			const sIdx = Math.max(0, sLine - 1);
			const eLine = parseInt(endLine);

			if (mode === 'replace') {
				if (isNaN(eLine)) throw new Error("Attribute 'end' is required for mode='replace'");
				const deleteCount = Math.max(0, eLine - sLine + 1);
				while (lines.length < sIdx) lines.push("");
				lines.splice(sIdx, deleteCount, ...newLines);
			} else if (mode === 'insert') {
				while (lines.length < sIdx) lines.push("");
				lines.splice(sIdx, 0, ...newLines);
			} else if (mode === 'delete') {
				if (isNaN(eLine)) throw new Error("Attribute 'end' is required for mode='delete'");
				const deleteCount = Math.max(0, eLine - sLine + 1);
				if (sIdx < lines.length) lines.splice(sIdx, deleteCount);
			} else {
				throw new Error(`Unknown edit mode: ${mode}`);
			}

			this.files[path] = lines.join('\n');
			this.notify();
			return `Edited ${path} (Mode: ${mode}, Lines: ${startLine}${mode === 'insert' ? '' : '-' + endLine})`;
		}
	}

	global.App.World.VirtualFileSystem = VirtualFileSystem;

})(window);