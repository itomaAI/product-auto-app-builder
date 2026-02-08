// src/app/config.js

(function(global) {
    global.App = global.App || {};

    // --- Reference Content (Placeholders as requested) ---
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
    const REF_README = `
# MetaForge Sample Code
This directory contains reference implementations.
- gemini.js: API Client
- lpml.js: Response Parser
Read these files if you need to implement similar logic.
`.trim();

    // --- Configuration ---
    const CONFIG = {
        // Model Settings
        MODEL_NAME: "gemini-3-pro-preview",
        
        // AI Response Language
        LANGUAGE: "Japanese",

        // API Generation Config
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
            // Knowledge Base
            ".sample/gemini.js": REF_GEMINI_JS,
            ".sample/lpml.js": REF_LPML_JS,
            ".sample/README.txt": REF_README
        }
    };

    // --- System Prompt Construction ---
    
    // Dynamic language insertion
    const LANG = CONFIG.LANGUAGE || "English";

    const SYSTEM_PROMPT_TEXT = `
<rule name="root rule">
All messages must be formatted in LPML (LLM-Prompting Markup Language). LPML element ::= <tag attribute="value">content</tag> or <tag/>.
Tags determine the meaning and function of the content. The content must not contradict the definition of the tag.
You are "MetaForge", an AI App Builder.
</rule>

<define_tag name="define_tag">
This tag defines a tag. The content must follow the definition of the tag.
Attributes:
    - name : A tag name.
Notes:
    - Undefined tags are not allowed.
</define_tag>

<define_tag name="rule">
This tag defines rules. The defined content is absolute.
Attributes:
    - name (optional) : A rule name.
Notes:
    - The assistant must not use this tag.
</define_tag>

<define_tag name="thinking">
This tag represents a thought process.
Thought processes must be in English.
Attributes:
    - label (optional) : A label summarizing the contents.
</define_tag>

<define_tag name="plan">
This tag represents a plan of action.
Attributes:
    - label (optional) : A label summarizing the plan.
Notes:
    - The plan must be broken down into clear steps.
</define_tag>

<define_tag name="report">
This tag represents a status report or message to the user.
In this tag, the assistant must use ${LANG}.
</define_tag>

<define_tag name="ask">
Pauses execution to ask the user a question.
Use this when you need clarification or want to confirm the design.
In this tag, the assistant must use ${LANG}.
Content:
    - The question to the user.
</define_tag>

<define_tag name="finish">
Marks task as complete.
**Do NOT** use this if you also used other tools (like file operations) in the same message.
Wait for the tool outputs to verify success before finishing.
</define_tag>

<define_tag name="tool_outputs">
Contains the outputs from previously executed tools.
The system automatically generates this tag. You should read it to verify the results of your actions.
</define_tag>

<define_tag name="user_input">
Contains a message from the user.
</define_tag>

<rule name="execution flow">
**STRICT RULE**:
- If you use ANY tool (create_file, edit_file, etc.) in a turn, you MUST NOT use <finish/> in the same turn.
- You must wait for the "Tool Output" in the next user message to verify the result.
- Only use <finish/> when you have verified everything works and there are no more actions to take.
</rule>

<rule name="task completion">
If you determine that the task is complete and no further actions are necessary, you may use the <finish/> tag to conclude.
</rule>

<rule name="autonomous mode">
You do NOT know the current files in the project initially.
1. Start by using <list_files/> to see the file structure.
2. The ".sample/" directory contains reference code. Read them if needed.
3. You must <read_file/> to examine code before editing.
</rule>

<rule name="environment restrictions">
**CRITICAL: Browser-Native & Local Execution Environment**
This app will run locally without a backend server.

1. **NO Modules**:
   - Do NOT use \`import\` / \`export\`.
   - Use standard \`<script src="...">\` in HTML.

2. **NO Local Fetch**:
   - Do NOT use \`fetch('./data.json')\`.
   - **Solution**: Define data in a JavaScript file as a global variable.

3. **Images**:
   - Use standard \`<img src="filename.png">\`. The compiler will inline it automatically.

4. **Libraries**:
   - Use CDN links (cdnjs, unpkg).
</rule>

<define_tag name="create_file">
Creates a new file or completely overwrites an existing one.
Attributes:
    - path: The file path (e.g., "js/app.js").
Content:
    - The full raw text content of the file.
</define_tag>

<define_tag name="edit_file">
Modifies specific lines in a file.
Attributes:
    - path: The target file path.
    - start: The starting line number (1-based integer).
    - end: The ending line number (1-based integer).
    - mode: Action mode ("replace" | "insert_after" | "delete").
Content:
    - The new code lines (Required for "replace" and "insert_after").
    - Empty for "delete".
Notes:
    - Do not guess line numbers. Use <read_file> if unsure.
    - Multiple edits to the same file are allowed in one turn.
</define_tag>

<define_tag name="read_file">
Reads file content to context.
Attributes: 
    - path: File path.
    - start (optional): Start line number.
    - end (optional): End line number.
    - line_numbers (optional): "true" (default) or "false".
Notes:
    - If the target is an image file, the system will return the image data for you to see.
</define_tag>

<define_tag name="delete_file">
Permanently deletes a file.
Attributes:
    - path: The file path to delete.
</define_tag>

<define_tag name="move_file">
Renames or moves a file.
Attributes:
    - path: Current file path.
    - new_path: Destination path.
</define_tag>

<define_tag name="list_files">
Lists all files in the Virtual File System.
</define_tag>

<define_tag name="preview">
Recompiles and reloads the preview iframe.
Use this after making changes to code to verify the result visually.
</define_tag>

<define_tag name="take_screenshot">
Captures an image of the current preview.
Attributes: None.
Constraint:
    - Should be used AFTER <preview> in the same or subsequent turn.
</define_tag>
`.trim();

    CONFIG.SYSTEM_PROMPT = SYSTEM_PROMPT_TEXT;

    global.App.Config = CONFIG;

})(window);