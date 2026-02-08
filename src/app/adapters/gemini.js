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
            const generationConfig = (typeof CONFIG !== 'undefined' && CONFIG.GENERATION_CONFIG) 
                ? CONFIG.GENERATION_CONFIG 
                : { temperature: 1.0, maxOutputTokens: 65536 };

            const payload = {
                contents: messages,
                generationConfig: generationConfig
            };

            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
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
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;

                while (true) {
                    // JSONストリームのパース ( { "text": "..." } )
                    const textIdx = buffer.indexOf('"text"');
                    if (textIdx === -1) break;

                    const startQuote = buffer.indexOf('"', textIdx + 6);
                    if (startQuote === -1) break;

                    let endQuote = -1;
                    let escaped = false;
                    for (let i = startQuote + 1; i < buffer.length; i++) {
                        const char = buffer[i];
                        if (escaped) { escaped = false; continue; }
                        if (char === '\\') { escaped = true; continue; }
                        if (char === '"') { endQuote = i; break; }
                    }

                    if (endQuote === -1) break;

                    const rawText = buffer.substring(startQuote + 1, endQuote);
                    try {
                        const text = JSON.parse(`"${rawText}"`);
                        if (text) onChunk(text);
                    } catch (e) {
                        // ignore incomplete json
                    }

                    buffer = buffer.substring(endQuote + 1);
                }
            }
        }
    }

    global.App.Adapters.GeminiAdapter = GeminiAdapter;

})(window);