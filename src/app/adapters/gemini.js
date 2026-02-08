// src/app/adapters/gemini.js

(function(global) {
	global.App = global.App || {};
	global.App.Adapters = global.App.Adapters || {};

	class GeminiAdapter extends global.ALLA.LLMAdapter {
		/**
		 * @param {string} apiKey 
		 * @param {string} modelName 
		 */
		constructor(apiKey, modelName) {
			super();
			this.apiKey = apiKey;
			this.modelName = modelName;
			this.baseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
		}

		/**
		 * @param {Array} messages - Gemini形式のメッセージ配列 [{ role, parts }, ...]
		 * @param {Function} onChunk - (text) => void
		 * @param {AbortSignal} signal
		 */
		async generateStream(messages, onChunk, signal) {
			const url = `${this.baseUrl}/${this.modelName}:streamGenerateContent?key=${this.apiKey}`;

			const generationConfig = (typeof CONFIG !== 'undefined' && CONFIG.GENERATION_CONFIG) ?
				CONFIG.GENERATION_CONFIG : {
					temperature: 1.0,
					maxOutputTokens: 65536
				};

			const payload = {
				contents: messages,
				generationConfig: generationConfig
			};

			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify(payload),
				signal
			});

			if (!response.ok) {
				const errText = await response.text();
				throw new Error(`Gemini API Error: ${response.status} - ${errText}`);
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			try {
				while (true) {
					const {
						done,
						value
					} = await reader.read();
					if (done) break;

					const chunk = decoder.decode(value, {
						stream: true
					});
					buffer += chunk;

					// --- Robust Text Extraction Logic ---
					// JSON構造を真面目にパースするのではなく、"text" フィールドを
					// 文字列として直接探しに行くことで、断片的なデータやパースエラーに強くする。

					while (true) {
						// 1. "text" キーを探す
						const textKeyIdx = buffer.indexOf('"text"');
						if (textKeyIdx === -1) break;

						// 2. その後の値の開始クォートを探す
						// "text" : "..." のような形式を想定
						let startQuote = -1;
						for (let i = textKeyIdx + 6; i < buffer.length; i++) {
							if (buffer[i] === '"') {
								startQuote = i;
								break;
							}
						}
						if (startQuote === -1) break;

						// 3. 終了クォートを探す（エスケープを考慮）
						let endQuote = -1;
						let escaped = false;
						for (let i = startQuote + 1; i < buffer.length; i++) {
							const char = buffer[i];
							if (escaped) {
								escaped = false;
								continue;
							}
							if (char === '\\') {
								escaped = true;
								continue;
							}
							if (char === '"') {
								endQuote = i;
								break;
							}
						}

						if (endQuote === -1) {
							// まだデータが届ききっていないので待つ
							break;
						}

						// 4. 文字列を抽出してデコード
						const rawText = buffer.substring(startQuote + 1, endQuote);
						try {
							// JSON文字列としてパースすることで、\n や \" を正しく戻す
							// 文字列だけをクォートで囲んでパースさせる
							const text = JSON.parse(`"${rawText}"`);
							if (text) onChunk(text);
						} catch (e) {
							console.warn("Stream Text Parse Error:", e);
						}

						// 5. 処理した部分までバッファを進める
						buffer = buffer.substring(endQuote + 1);
					}
				}
			} catch (e) {
				if (e.name === 'AbortError') throw e;
				console.error("Stream Reading Error:", e);
				throw e;
			}
		}
	}

	global.App.Adapters.GeminiAdapter = GeminiAdapter;

})(window);