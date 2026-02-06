// js/gemini.js

class GeminiClient {
    constructor(apiKey, modelName) {
        this.apiKey = apiKey;
        this.modelName = modelName;
        this.baseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
    }

    async generateStream(messages, onChunk, signal) {
        const url = `${this.baseUrl}/${this.modelName}:streamGenerateContent?key=${this.apiKey}`;
        
        const payload = {
            contents: messages,
            generationConfig: {
                temperature: 0.5,
                maxOutputTokens: 65536
            }
        };

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Gemini API Error: ${response.status} - ${err}`);
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
                    onChunk(text);
                } catch (e) {
                    // ignore incomplete json
                }

                buffer = buffer.substring(endQuote + 1);
            }
        }
    }
}