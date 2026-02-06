// js/config.js

// --- REFERENCE CODE: js/gemini.js (FULL) ---
const REF_GEMINI_JS = `
// The current latest models are gemini-3-pro-preview or gemini-3-flash-preview.
// You must use one of them.

class GeminiClient {
    constructor(apiKey, modelName) {
        this.apiKey = apiKey;
        this.modelName = modelName;
        this.baseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
    }

    async generateStream(messages, onChunk, signal) {
        const url = \`\${this.baseUrl}/\${this.modelName}:streamGenerateContent?key=\${this.apiKey}\`;
        
        const payload = {
            contents: messages,
            generationConfig: {
                temperature: 1.0,  // This is suitable for gemini-3-pro/flash-preview.
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
            throw new Error(\`Gemini API Error: \${response.status} - \${err}\`);
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
                // Parse newline-delimited JSON or specialized stream format
                // Gemini API stream returns structure like: [{ "text": "..." }, ...]
                // But the raw chunks might be partial JSON.
                // We look for the "text" field in the buffer using simple string matching to avoid JSON.parse errors on partials.
                
                const textIdx = buffer.indexOf('"text"');
                if (textIdx === -1) break;

                const startQuote = buffer.indexOf('"', textIdx + 6);
                if (startQuote === -1) break;

                let endQuote = -1;
                let escaped = false;
                for (let i = startQuote + 1; i < buffer.length; i++) {
                    const char = buffer[i];
                    if (escaped) { escaped = false; continue; }
                    if (char === '\\\\') { escaped = true; continue; }
                    if (char === '"') { endQuote = i; break; }
                }

                if (endQuote === -1) break;

                const rawText = buffer.substring(startQuote + 1, endQuote);
                try {
                    // Re-add quotes to parse strictly as a JSON string to handle escapes correctly
                    const text = JSON.parse(\`"\${rawText}"\`);
                    onChunk(text);
                } catch (e) {
                    // ignore
                }

                buffer = buffer.substring(endQuote + 1);
            }
        }
    }
}
`.trim();

// --- REFERENCE CODE: js/lpml.js (FULL) ---
const REF_LPML_JS = `
class LPMLParser {
    
    static PATTERN_ATTRIBUTE = / ([^"'/<> -]+)=(?:"([^"]*)"|'([^']*)')/g;
    static PATTERN_TAG_START = \`<([^/>\\s\\n]+)((?: \${" [^\"'/<> -]+=(?:\"[^\"]*\"|'[^']*')"})*)\\s*>\`;
    static PATTERN_TAG_END = \`</([^/>\\s\\n]+)\\s*>\`;
    static PATTERN_TAG_EMPTY = \`<([^/>\\s\\n]+)((?: \${" [^\"'/<> -]+=(?:\"[^\"]*\"|'[^']*')"})*)\\s*/>\`;
    
    static PATTERN_TAG = new RegExp(\`(\${LPMLParser.PATTERN_TAG_START})|(\${LPMLParser.PATTERN_TAG_END})|(\${LPMLParser.PATTERN_TAG_EMPTY})\`, 'g');
    static PATTERN_PROTECT = /(\`[\\s\\S]*?\`|<!--[\\s\\S]*?-->|<![\\s\\S]*?>)/g;

    static _parseAttributes(text) {
        const attributes = {};
        const regex = new RegExp(LPMLParser.PATTERN_ATTRIBUTE);
        let match;
        while ((match = regex.exec(text)) !== null) {
            attributes[match[1]] = match[2] !== undefined ? match[2] : match[3];
        }
        return attributes;
    }

    static _restoreString(text, protectedMap) {
        if (!text.includes("__PROTECTED_")) return text;
        let result = text;
        for (const [placeholder, original] of Object.entries(protectedMap)) {
            result = result.replace(placeholder, original);
        }
        return result;
    }

    static _restoreProtectedContent(tree, protectedMap) {
        const restoredTree = [];
        for (let item of tree) {
            if (typeof item === 'string') {
                item = LPMLParser._restoreString(item, protectedMap);
                restoredTree.push(item);
            } else if (typeof item === 'object' && item !== null) {
                if (item.attributes) {
                    const newAttributes = {};
                    for (const [k, v] of Object.entries(item.attributes)) {
                        newAttributes[k] = LPMLParser._restoreString(v, protectedMap);
                    }
                    item.attributes = newAttributes;
                }
                if (Array.isArray(item.content)) {
                    item.content = LPMLParser._restoreProtectedContent(item.content, protectedMap);
                }
                restoredTree.push(item);
            }
        }
        return restoredTree;
    }

    static parse(text, strip = false, exclude = []) {
        const protectedContent = {};
        // 1. Protect code blocks and comments
        const protectedText = text.replace(LPMLParser.PATTERN_PROTECT, (match) => {
            const placeholder = \`__PROTECTED_\${Math.random().toString(36).substring(2, 15)}__\`;
            protectedContent[placeholder] = match;
            return placeholder;
        });

        const tree = [];
        let cursor = 0;
        let tagExclude = null;
        let stack = [{ tag: 'root', content: tree }];

        const regexTag = new RegExp(LPMLParser.PATTERN_TAG);
        let match;

        const regexStart = new RegExp(\`^\${LPMLParser.PATTERN_TAG_START}$\`);
        const regexEnd = new RegExp(\`^\${LPMLParser.PATTERN_TAG_END}$\`);
        const regexEmpty = new RegExp(\`^\${LPMLParser.PATTERN_TAG_EMPTY}$\`);

        while ((match = regexTag.exec(protectedText)) !== null) {
            const tagStr = match[0];
            const indTagStart = match.index;
            const indTagEnd = indTagStart + tagStr.length;

            const matchTagStart = tagStr.match(regexStart);
            const matchTagEnd = tagStr.match(regexEnd);
            const matchTagEmpty = tagStr.match(regexEmpty);

            if (tagExclude !== null) {
                if (matchTagEnd && matchTagEnd[1] === tagExclude) {
                    tagExclude = null;
                } else {
                    continue;
                }
            }

            let contentStr = protectedText.substring(cursor, indTagStart);
            if (strip) contentStr = contentStr.trim();
            if (contentStr) {
                stack[stack.length - 1].content.push(contentStr);
            }
            cursor = indTagEnd;

            if (matchTagStart) {
                const name = matchTagStart[1];
                if (exclude.includes(name)) tagExclude = name;
                
                const attributes = LPMLParser._parseAttributes(matchTagStart[2]);
                const element = { tag: name, attributes: attributes, content: [] };
                stack[stack.length - 1].content.push(element);
                stack.push(element);

            } else if (matchTagEmpty) {
                const name = matchTagEmpty[1];
                const attributes = LPMLParser._parseAttributes(matchTagEmpty[2]);
                const element = { tag: name, attributes: attributes, content: null };
                stack[stack.length - 1].content.push(element);

            } else if (matchTagEnd) {
                const name = matchTagEnd[1];
                let indStackStart = -1;
                for (let i = stack.length - 1; i > 0; i--) {
                    if (stack[i].tag === name) {
                        indStackStart = i;
                        break;
                    }
                }
                if (indStackStart === -1) {
                    stack[stack.length - 1].content.push(tagStr);
                } else {
                    stack = stack.slice(0, Math.max(1, indStackStart));
                }
            }
        }

        let remainingStr = protectedText.substring(cursor);
        if (strip) remainingStr = remainingStr.trim();
        if (remainingStr) {
            stack[stack.length - 1].content.push(remainingStr);
        }

        return LPMLParser._restoreProtectedContent(tree, protectedContent);
    }
}
`.trim();

const CONFIG = {
    // Model Name
    MODEL_NAME: "gemini-3-pro-preview",

    // Response Language (Japanese, English, etc.)
    LANGUAGE: "Japanese",
    
    // API Config
    GENERATION_CONFIG: {
        temperature: 1.0,
        maxOutputTokens: 65536,
    },

    // Initial VFS State
    DEFAULT_FILES: {
        "index.html": `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>New App</title>
    <style>
        body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f0f0f0; margin: 0; }
        .container { text-align: center; padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Welcome to MetaForge</h1>
        <p>Ask the AI to build something.</p>
    </div>
</body>
</html>`,

        // --- Knowledge Base (.sample) ---
        ".sample/gemini.js": REF_GEMINI_JS,
        ".sample/lpml.js": REF_LPML_JS,
        ".sample/README.txt": `
# MetaForge Sample Code
This directory contains the actual source code used by this tool.

- gemini.js: The client implementation for Gemini API streaming.
- lpml.js: The XML-like parser used to interpret your responses.

## Usage
If you (the AI) need to write a similar feature (e.g. connecting to an LLM or parsing tags),
you should <read_file> these files to understand the correct implementation.

## Note
If you use Gemini API, the model name must be set to "gemini-3-pro-preview" or "gemini-3-flash-preview".
These models are most powerful gemini models.
`.trim()
    }
};