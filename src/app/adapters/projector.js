// src/app/adapters/projector.js

(function(global) {
	global.App = global.App || {};
	global.App.Adapters = global.App.Adapters || {};

	const Role = global.REAL.Role;
	const TurnType = global.REAL.TurnType;

	class MetaForgeProjector extends global.REAL.ContextProjector {
		/**
		 * @param {string} systemPrompt 
		 */
		constructor(systemPrompt) {
			super();
			this.systemPrompt = systemPrompt;
		}

		async createContext(state) {
			// 1. Historyの最適化 (副作用あり: VFSからの削除を含む)
			// ガベージコレクションのために VFS を渡す
			this._optimizeHistory(state.history, state.vfs);

			// APIキーの取得 (localStorageから)
			const apiKey = localStorage.getItem('metaforge_api_key');

			// 2. APIメッセージの構築
			const apiMessages = [];

			// System Prompt (User Roleとして先頭に追加)
			apiMessages.push({
				role: 'user',
				parts: [{
					text: this.systemPrompt
				}]
			});

			// History Mapping
			for (const turn of state.history) {
				// ★ awaitを追加して非同期処理（アップロード）を待つ
				const parts = await this._convertTurnToParts(turn, state.vfs, apiKey);
				if (!parts || parts.length === 0) continue;

				// Role Mapping
				let apiRole = 'user';
				if (turn.role === Role.MODEL) apiRole = 'model';
				// System output (Tool results) is User input for LLM
				if (turn.role === Role.SYSTEM) apiRole = 'user';

				apiMessages.push({
					role: apiRole,
					parts: parts
				});
			}

			return apiMessages;
		}

		async _convertTurnToParts(turn, vfs, apiKey) {
			// A. テキストの場合
			if (typeof turn.content === 'string') {
				let text = turn.content;
				// ユーザー入力ならタグで囲む
				if (turn.role === Role.USER) {
					text = `<user_input>\n${text}\n</user_input>`;
				}
				return [{
					text: text
				}];
			}

			// B. 配列の場合 (Mixed content)
			if (Array.isArray(turn.content)) {
				// 1. Tool Output (Results) の場合
				if (turn.meta && turn.meta.type === TurnType.TOOL_EXECUTION) {
					// <tool_outputs> タグでラップする
					const logText = turn.content.map(c => {
						// 画像が含まれる場合は除外して、テキストログだけにする
						if (c.output && (c.output.image || c.output.media)) return "";
						// ToolRegistryが返す { log: "..." } を使う
						if (c.output && c.output.log) return c.output.log;
						return "";
					}).join('\n').trim();

					const parts = [];
					if (logText) {
						parts.push({
							text: `<tool_outputs>\n${logText}\n</tool_outputs>`
						});
					}

					// 画像パートの追加 (Screenshots)
					for (const c of turn.content) {
						if (c.output) {
							// 新しい media 形式 (VFS path + upload)
							if (c.output.media) {
								const fileData = await this._resolveMediaFile(c.output.media, vfs, apiKey);
								if (fileData) parts.push({
									fileData
								});
							}
							// 古い image 形式 (Base64 Inline)
							else if (c.output.image) {
								parts.push({
									inlineData: {
										mimeType: c.output.mimeType || 'image/png',
										data: c.output.image // Base64
									}
								});
							}
						}
					}
					return parts;
				}

				// 2. 通常のUser Input (Attachments / Images) の場合
				if (turn.role === Role.USER) {
					const parts = [];
					let userInputBuffer = "";

					// テキストバッファをタグで囲んで出力する関数
					const flushUserInput = () => {
						if (userInputBuffer.trim()) {
							parts.push({
								text: `<user_input>\n${userInputBuffer.trim()}\n</user_input>`
							});
						}
						userInputBuffer = "";
					};

					for (const item of turn.content) {
						if (item.text) {
							const trimmed = item.text.trim();
							// user_attachment または user_input タグで始まる場合は、
							// すでに構造化されているとみなし、バッファをフラッシュしてそのまま追加する
							if (trimmed.startsWith('<user_attachment') || trimmed.startsWith('<user_input')) {
								flushUserInput();
								parts.push({
									text: item.text
								});
							} else {
								userInputBuffer += item.text + "\n";
							}
						} else if (item.media) {
							// ★ 新しい User Media (VFS path)
							flushUserInput();
							const fileData = await this._resolveMediaFile(item.media, vfs, apiKey);
							if (fileData) {
								parts.push({
									fileData
								});
							} else {
								// VFSから消えている場合の代替テキスト
								parts.push({
									text: `\n[System: The image file '${item.media.path}' could not be loaded from VFS.]\n`
								});
							}
						} else if (item.inlineData) {
							// 古い形式のサポート
							flushUserInput();
							parts.push({
								inlineData: item.inlineData
							});
						}
					}
					// 残りのテキストを吐き出す
					flushUserInput();

					return parts;
				}

				// その他のケース（Fallback）
				const fallbackParts = [];
				for (const c of turn.content) {
					if (c.text) fallbackParts.push({
						text: c.text
					});
					else if (c.inlineData) fallbackParts.push({
						inlineData: c.inlineData
					});
				}
				return fallbackParts;
			}

			return [];
		}

		/**
		 * メディアオブジェクトを Gemini API 用の fileData に変換する
		 * 必要に応じてアップロードを行い、メタデータをキャッシュする
		 */
		async _resolveMediaFile(mediaObj, vfs, apiKey) {
			// 1. キャッシュと有効期限のチェック
			const geminiMeta = mediaObj.metadata?.gemini;
			if (geminiMeta && geminiMeta.fileUri && geminiMeta.expirationTime) {
				const expires = new Date(geminiMeta.expirationTime);
				const now = new Date();
				// 有効期限まで余裕があればキャッシュを使用 (1時間余裕を見る)
				if (expires > new Date(now.getTime() + 60 * 60 * 1000)) {
					return {
						fileUri: geminiMeta.fileUri,
						mimeType: mediaObj.mimeType
					};
				}
			}

			// 2. VFSから実体読み込み
			if (!vfs || !vfs.exists(mediaObj.path)) return null;

			// readFileはDataURL文字列を返す仕様 (既存実装に基づく)
			const content = vfs.readFile(mediaObj.path);

			// APIキーがない場合はアップロード不可
			if (!apiKey) return null;

			try {
				// 3. Gemini File API へアップロード
				const uploadResult = await this._uploadToGemini(content, mediaObj.mimeType, apiKey);

				// 4. メタデータを更新 (参照元のオブジェクトを書き換える)
				// これにより次回以降はキャッシュが使われる
				if (!mediaObj.metadata) mediaObj.metadata = {};
				mediaObj.metadata.gemini = {
					fileUri: uploadResult.fileUri,
					expirationTime: uploadResult.expirationTime,
					name: uploadResult.name
				};

				return {
					fileUri: uploadResult.fileUri,
					mimeType: mediaObj.mimeType
				};
			} catch (e) {
				console.error("[Projector] File upload failed:", e);
				return null;
			}
		}

		/**
		 * Gemini File API (Resumable Upload) の実行
		 */
		async _uploadToGemini(dataUrl, mimeType, apiKey) {
			// Data URL から Blob を生成
			const res = await fetch(dataUrl);
			const blob = await res.blob();
			const size = blob.size;

			// Step 1: 初期化リクエスト (Resumable Upload URLの取得)
			const initUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;
			const initHeaders = {
				'X-Goog-Upload-Protocol': 'resumable',
				'X-Goog-Upload-Command': 'start',
				'X-Goog-Upload-Header-Content-Length': size.toString(),
				'X-Goog-Upload-Header-Content-Type': mimeType,
				'Content-Type': 'application/json'
			};

			// メタデータ (表示名など)
			const metadata = {
				file: {
					display_name: 'metaforge_media'
				}
			};

			const initRes = await fetch(initUrl, {
				method: 'POST',
				headers: initHeaders,
				body: JSON.stringify(metadata)
			});

			if (!initRes.ok) {
				const errText = await initRes.text();
				throw new Error(`Upload init failed (${initRes.status}): ${errText}`);
			}

			const uploadUrl = initRes.headers.get('x-goog-upload-url');
			if (!uploadUrl) throw new Error("No upload URL returned from Gemini API");

			// Step 2: バイナリデータの送信
			const uploadHeaders = {
				'Content-Length': size.toString(),
				'X-Goog-Upload-Offset': '0',
				'X-Goog-Upload-Command': 'upload, finalize'
			};

			const uploadRes = await fetch(uploadUrl, {
				method: 'POST',
				headers: uploadHeaders,
				body: blob
			});

			if (!uploadRes.ok) {
				const errText = await uploadRes.text();
				throw new Error(`Binary upload failed (${uploadRes.status}): ${errText}`);
			}

			const result = await uploadRes.json();
			return {
				fileUri: result.file.uri,
				name: result.file.name,
				expirationTime: result.file.expirationTime
			};
		}

		/**
		 * 履歴内の古い画像を削除する（副作用メソッド）
		 * 最新の1枚以外の画像データをVFSおよび履歴から削除し、プレースホルダーに置き換える
		 */
		_optimizeHistory(history, vfs) {
			let foundLatestImage = false;

			// 後ろからスキャン
			for (let i = history.length - 1; i >= 0; i--) {
				const turn = history[i];
				if (!Array.isArray(turn.content)) continue;

				turn.content.forEach(item => {
					// 1. 新しい media 形式 (VFS参照)
					// Tool output (screenshot) or User input (upload)
					const mediaObj = (item.output && item.output.media) ? item.output.media : item.media;

					if (mediaObj) {
						if (foundLatestImage) {
							// 2枚目以降（古いもの）は削除
							const path = mediaObj.path;

							// VFSから物理削除
							// 安全のため .cache/media/ 内のファイルのみを対象とする
							if (vfs && path && path.includes('.cache/media/')) {
								try {
									if (vfs.exists(path)) {
										vfs.deleteFile(path);
										console.log(`[Projector] GC: Removed old media ${path}`);
									}
								} catch (e) {
									console.warn(`[Projector] GC Failed for ${path}`, e);
								}
							}

							// 履歴オブジェクトからの参照削除
							if (item.output) {
								delete item.output.media;
								item.output.log = (item.output.log || "") + "\n[System: Old screenshot/media removed to save memory]";
							} else {
								delete item.media;
								item.text = (item.text || "") + "\n[System: Old media removed]";
							}
						} else {
							// 最新の1枚
							foundLatestImage = true;
						}
					}

					// 2. 古い image 形式 (Base64 Inline) - 後方互換
					if (item.output && item.output.image) {
						if (foundLatestImage) {
							delete item.output.image;
							item.output.log = (item.output.log || "") + "\n[System: Old screenshot removed to save memory]";
						} else {
							foundLatestImage = true;
						}
					}
				});
			}
		}
	}

	global.App.Adapters.MetaForgeProjector = MetaForgeProjector;

})(window);