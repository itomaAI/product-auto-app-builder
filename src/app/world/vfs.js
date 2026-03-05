// src/app/world/vfs.js

(function(global) {
	global.App = global.App || {};
	global.App.World = global.App.World || {};

	class VirtualFileSystem {
		constructor(initialFiles = {}) {
			this.files = {};
			this.listeners = [];
			// 初期化データの一括ロード（マイグレーション含む）
			this.loadFiles(initialFiles);
		}

		subscribe(callback) {
			this.listeners.push(callback);
			return () => this.listeners = this.listeners.filter(cb => cb !== callback);
		}

		notify() {
			this.listeners.forEach(cb => cb(this.files));
		}

		// --- Helper: Normalize Path ---
		_norm(path) {
			if (!path) return "";
			return path.replace(/^\/+/, '');
		}

		// --- Helper: Data Migration (String -> Object) ---
		_migrate(entry) {
			const now = Date.now();
			// 文字列（旧形式）の場合
			if (typeof entry === 'string') {
				return {
					content: entry,
					meta: {
						created_at: now,
						updated_at: now
					}
				};
			}
			// 既にオブジェクトの場合 (安全策)
			if (entry && typeof entry === 'object' && typeof entry.content === 'string') {
				return {
					content: entry.content,
					meta: {
						created_at: entry.meta?.created_at || now,
						updated_at: entry.meta?.updated_at || now
					}
				};
			}
			// 不正データまたは空の場合
			return {
				content: "",
				meta: {
					created_at: now,
					updated_at: now
				}
			};
		}

		/**
		 * 外部データを一括ロードする（マイグレーション適用）
		 */
		loadFiles(filesObject) {
			Object.entries(filesObject).forEach(([path, entry]) => {
				this.files[this._norm(path)] = this._migrate(entry);
			});
			this.notify();
		}

		/**
		 * ファイルのメタデータを取得 (Compilerのキャッシュ判定用)
		 */
		stat(path) {
			const p = this._norm(path);
			if (this.exists(p)) {
				const f = this.files[p];
				return {
					path: p,
					size: f.content.length,
					updated_at: f.meta.updated_at,
					created_at: f.meta.created_at,
					type: 'file'
				};
			}
			if (this.isDirectory(p)) {
				return {
					path: p,
					size: 0,
					updated_at: 0,
					created_at: 0,
					type: 'folder'
				};
			}
			throw new Error(`Path not found: ${path}`);
		}

		exists(path) {
			return Object.prototype.hasOwnProperty.call(this.files, this._norm(path));
		}

		isDirectory(path) {
			let p = this._norm(path);
			if (!p) return true; // root is dir
			if (!p.endsWith('/')) p += '/';
			return Object.keys(this.files).some(key => key.startsWith(p));
		}

		readFile(path) {
			const p = this._norm(path);
			if (!this.exists(p)) throw new Error(`File not found: ${p}`);
			// ★ contentプロパティを返す
			return this.files[p].content;
		}

		writeFile(path, content) {
			let p = this._norm(path);
			if (!p) throw new Error("Cannot write to root path.");
			if (p.includes('..')) throw new Error("Invalid path: '..' is not allowed");

			const exists = this.exists(p);
			const now = Date.now();

			if (exists) {
				// 既存ファイルの更新（メタデータ維持・更新）
				this.files[p].content = content;
				this.files[p].meta.updated_at = now;
			} else {
				// 新規作成
				this.files[p] = {
					content: content,
					meta: {
						created_at: now,
						updated_at: now
					}
				};
			}

			this.notify();
			return exists ?
				`Overwrote ${p} (${content.length} chars)` :
				`Created ${p} (${content.length} chars)`;
		}

		createDirectory(path) {
			let p = this._norm(path);
			if (p.endsWith('/')) p = p.slice(0, -1);
			if (!p) return "Root directory always exists.";

			const keepFile = `${p}/.keep`;
			if (!this.exists(keepFile)) {
				// ★ writeFile経由で作成してオブジェクト構造を担保
				this.writeFile(keepFile, "");
				return `Created directory: ${p}`;
			}
			return `Directory already exists: ${p}`;
		}

		deleteFile(path) {
			const p = this._norm(path);
			if (this.exists(p)) {
				delete this.files[p];
				this.notify();
				return `Deleted file: ${p}`;
			}
			// ディレクトリ削除の試行
			return this.deleteDirectory(p);
		}

		deleteDirectory(path) {
			let p = this._norm(path);
			if (!p.endsWith('/')) p += '/';

			const keysToDelete = Object.keys(this.files).filter(k => k.startsWith(p));
			if (keysToDelete.length === 0) {
				return `Path ${p} not found or empty.`;
			}

			keysToDelete.forEach(k => delete this.files[k]);
			this.notify();
			return `Deleted directory ${p} (removed ${keysToDelete.length} files).`;
		}

		rename(oldPath, newPath) {
			const oldP = this._norm(oldPath);
			const newP = this._norm(newPath);

			// 1. File Rename
			if (this.exists(oldP)) {
				if (this.exists(newP)) throw new Error(`Destination ${newP} already exists.`);
				// オブジェクトの参照移動（メタデータ含む）
				this.files[newP] = this.files[oldP];
				delete this.files[oldP];
				this.notify();
				return `Renamed file: ${oldP} -> ${newP}`;
			}

			// 2. Directory Rename
			let oldDir = oldP.endsWith('/') ? oldP : oldP + '/';
			let newDir = newP.endsWith('/') ? newP : newP + '/';

			const targets = Object.keys(this.files).filter(k => k.startsWith(oldDir));
			if (targets.length > 0) {
				const conflict = targets.some(k => this.exists(k.replace(oldDir, newDir)));
				if (conflict) throw new Error(`Destination directory ${newP} conflicts with existing files.`);

				targets.forEach(k => {
					const dest = k.replace(oldDir, newDir);
					this.files[dest] = this.files[k];
					delete this.files[k];
				});
				this.notify();
				return `Moved directory: ${oldP} -> ${newP} (${targets.length} files moved).`;
			}

			throw new Error(`Source path ${oldP} not found.`);
		}

		copyFile(srcPath, destPath) {
			const src = this._norm(srcPath);
			const dest = this._norm(destPath);
			if (!this.exists(src)) throw new Error(`Source ${src} not found.`);
			if (this.exists(dest)) throw new Error(`Destination ${dest} already exists.`);
			
			// ★ writeFile経由でコンテンツをコピー（新規メタデータで作成）
			this.writeFile(dest, this.files[src].content);
			
			return `Copied: ${src} -> ${dest}`;
		}

		listFiles(options = {}) {
			const root = options.path ? this._norm(options.path) : "";
			const recursive = options.recursive !== false; // デフォルトtrue (MetaForge互換のため)
			// ※ MetaForgeの既存コードは引数なしで呼ぶことが多いので、デフォルト挙動は「全リスト」にするのが無難

			let result = Object.keys(this.files).sort();

			// パスフィルタ
			if (root) {
				const prefix = root.endsWith('/') ? root : root + '/';
				result = result.filter(p => p.startsWith(prefix));
			}

			// detail オプション対応 (Compilerで使用)
			if (options.detail) {
				return result.map(p => this.stat(p));
			}

			return result;
		}

		getTree() {
			const root = {
				name: "root",
				path: "",
				type: "folder",
				children: {}
			};

			Object.keys(this.files).sort().forEach(filePath => {
				const parts = filePath.split('/');
				let current = root;

				parts.forEach((part, index) => {
					const isLast = index === parts.length - 1;
					const fullPath = parts.slice(0, index + 1).join('/');

					if (!current.children[part]) {
						current.children[part] = {
							name: part,
							path: fullPath,
							type: isLast ? "file" : "folder",
							children: {}
						};
					}
					current = current.children[part];

					if (!isLast && current.type === "file") {
						current.type = "folder";
					}
				});
			});

			const toArray = (node) => {
				const children = Object.values(node.children).map(child => toArray(child));
				children.sort((a, b) => {
					if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
					return a.name.localeCompare(b.name);
				});
				return {
					name: node.name,
					path: node.path,
					type: node.type,
					children: children
				};
			};
			return toArray(root).children;
		}

		// --- Editing ---

		replaceContent(path, patternStr, replacement) {
			const p = this._norm(path);
			if (!this.exists(p)) throw new Error(`File not found: ${p}`);

			// ★ readFile経由で取得
			const content = this.readFile(path);
			const originalLength = content.length;

			let regex;
			try {
				regex = new RegExp(patternStr, 'm');
			} catch (e) {
				throw new Error(`Invalid RegExp: ${e.message}`);
			}

			if (!regex.test(content)) {
				// パターンの先頭だけ表示してヒントを与える
				const snippet = patternStr.length > 50 ? patternStr.slice(0, 50) + "..." : patternStr;
				throw new Error(`Pattern not found in ${p}. Search: "${snippet}"`);
			}

			const newContent = content.replace(regex, replacement);
			if (newContent === content) throw new Error(`Pattern matched but replacement resulted in no change.`);

			// ★ writeFile経由で保存 (updated_at更新)
			this.writeFile(p, newContent);
			return `Replaced pattern match in ${p}. (Size: ${originalLength} -> ${newContent.length} chars)`;
		}

		editLines(path, startLine, endLine, mode, newContent = "") {
			const p = this._norm(path);
			if (!this.exists(p)) throw new Error(`File not found: ${p}`);

			// ★ readFile経由で取得
			const content = this.readFile(path);
			let lines = content.split(/\r?\n/);

			let cleanContent = newContent;
			// Remove surrounding newlines for cleaner insertion
			if (cleanContent.startsWith('\n')) cleanContent = cleanContent.substring(1);
			if (cleanContent.endsWith('\n')) cleanContent = cleanContent.substring(0, cleanContent.length - 1);

			const newLines = cleanContent.split(/\r?\n/);

			const sLine = parseInt(startLine);
			const sIdx = Math.max(0, sLine - 1);
			const eLine = parseInt(endLine);

			let actionLog = "";

			if (mode === 'append') {
				// ★ Append Mode
				let updatedContent = content;
				if (updatedContent.length > 0 && !updatedContent.endsWith('\n')) {
					updatedContent += '\n'; // Ensure newline before appending
				}
				updatedContent += cleanContent;

				this.files[p] = updatedContent;
				actionLog = `Appended ${newLines.length} lines to end of file`;

			} else if (mode === 'replace') {
				if (isNaN(eLine)) throw new Error("Attribute 'end' is required for mode='replace'");
				const deleteCount = Math.max(0, eLine - sLine + 1);
				while (lines.length < sIdx) lines.push("");
				lines.splice(sIdx, deleteCount, ...newLines);
				actionLog = `Replaced lines ${sLine}-${eLine}`;
				this.files[p] = lines.join('\n');

			} else if (mode === 'insert') {
				while (lines.length < sIdx) lines.push("");
				lines.splice(sIdx, 0, ...newLines);
				actionLog = `Inserted ${newLines.length} lines at line ${sLine}`;
				this.files[p] = lines.join('\n');

			} else if (mode === 'delete') {
				if (isNaN(eLine)) throw new Error("Attribute 'end' is required for mode='delete'");
				const deleteCount = Math.max(0, eLine - sLine + 1);
				if (sIdx < lines.length) lines.splice(sIdx, deleteCount);
				actionLog = `Deleted lines ${sLine}-${eLine}`;
				this.files[p] = lines.join('\n');

			} else {
				throw new Error(`Unknown edit mode: ${mode}`);
			}

			// ★ writeFile経由で保存 (updated_at更新)
			this.writeFile(p, lines.join('\n'));
			return `Edited ${p}: ${actionLog}`;
		}
	}

	global.App.World.VirtualFileSystem = VirtualFileSystem;

})(window);