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

			// CONFIG依存またはデフォルト値
			const generationConfig = (typeof CONFIG !== 'undefined' && CONFIG.GENERATION_CONFIG) ?
				CONFIG.GENERATION_CONFIG :
				{
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

				// Robust JSON Stream Parser
				// Gemini returns an array of JSON objects: [{...}, {...}, ...]
				// We parse top-level objects by counting braces.

				let braceCount = 0;
				let inString = false;
				let escaped = false;
				let start = -1;

				// Process buffer to extract full JSON objects
				for (let i = 0; i < buffer.length; i++) {
					const char = buffer[i];

					if (inString) {
						if (char === '\\') {
							escaped = !escaped;
						} else if (char === '"' && !escaped) {
							inString = false;
						} else {
							escaped = false;
						}
						continue;
					}

					if (char === '"') {
						inString = true;
						continue;
					}

					if (char === '{') {
						if (braceCount === 0) start = i;
						braceCount++;
					} else if (char === '}') {
						braceCount--;
						if (braceCount === 0 && start !== -1) {
							// Found a complete JSON object
							const jsonStr = buffer.substring(start, i + 1);
							try {
								const parsed = JSON.parse(jsonStr);
								if (parsed.candidates && parsed.candidates[0] && parsed.candidates[0].content && parsed.candidates[0].content.parts) {
									const parts = parsed.candidates[0].content.parts;
									for (const part of parts) {
										if (part.text) {
											onChunk(part.text);
										}
									}
								}
							} catch (e) {
								console.warn("JSON Parse Warning:", e);
							}

							// Advance buffer
							buffer = buffer.substring(i + 1);
							i = -1; // Reset loop index to start of new buffer
							start = -1;
						}
					}
				}
			}
		}
	}

	global.App.Adapters.GeminiAdapter = GeminiAdapter;

})(window);