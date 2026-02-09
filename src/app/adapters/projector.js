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

		createContext(state) {
			// 1. Historyの最適化 (副作用あり: 古いスクショの削除)
			// state.history を直接変更する
			this._optimizeHistory(state.history);

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
				const parts = this._convertTurnToParts(turn);
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

		_convertTurnToParts(turn) {
			// A. テキストの場合
			if (typeof turn.content === 'string') {
				let text = turn.content;
				// 【修正】ユーザー入力ならタグで囲む
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
						if (c.output && c.output.image) return "";
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
					turn.content.forEach(c => {
						if (c.output && c.output.image) {
							parts.push({
								inlineData: {
									mimeType: c.output.mimeType || 'image/png',
									data: c.output.image // Base64
								}
							});
						}
					});
					return parts;
				}

				// 2. 通常のUser Input (Attachments / Images) の場合
				if (turn.role === Role.USER) {
					const parts = [];
					let textBuffer = "";

					// テキストバッファをタグで囲んで出力する関数
					const flushText = () => {
						if (textBuffer.trim()) {
							parts.push({
								text: `<user_input>\n${textBuffer.trim()}\n</user_input>`
							});
						}
						textBuffer = "";
					};

					for (const item of turn.content) {
						if (item.text) {
							textBuffer += item.text + "\n";
						} else if (item.inlineData) {
							// 画像が来たら、一旦溜まったテキストを吐き出す（Geminiはテキストと画像を混ぜて送信するため）
							flushText();
							parts.push({
								inlineData: item.inlineData
							});
						}
					}
					// 残りのテキストを吐き出す
					flushText();

					return parts;
				}

				// その他のケース（Fallback）
				return turn.content.map(c => {
					if (c.text) return {
						text: c.text
					};
					if (c.inlineData) return {
						inlineData: c.inlineData
					};
					return null;
				}).filter(Boolean);
			}

			return [];
		}

		/**
		 * 履歴内の古い画像を削除する（副作用メソッド）
		 * 最新の1枚以外の画像データを削除し、プレースホルダーに置き換える
		 */
		_optimizeHistory(history) {
			let foundLatestImage = false;

			// 後ろからスキャン
			for (let i = history.length - 1; i >= 0; i--) {
				const turn = history[i];
				if (!Array.isArray(turn.content)) continue;

				// ツール実行結果内の画像を探索
				if (turn.meta && turn.meta.type === TurnType.TOOL_EXECUTION) {
					turn.content.forEach(item => {
						if (item.output && item.output.image) {
							if (foundLatestImage) {
								// 2枚目以降（古いもの）は削除
								delete item.output.image;
								item.output.log += "\n[System: Old screenshot removed to save memory]";
							} else {
								// 最新の1枚
								foundLatestImage = true;
							}
						}
					});
				}
			}
		}
	}

	global.App.Adapters.MetaForgeProjector = MetaForgeProjector;

})(window);