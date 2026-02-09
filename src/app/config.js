// src/app/config.js

(function(global) {
    global.App = global.App || {};

    // --- Reference Content (Placeholders as requested) ---
    const REF_GEMINI_JS = `
// The current latest models are gemini-3-pro-preview or gemini-3-flash-preview.
// You must use one of them.

// src/app/adapters/gemini.js

(function(global) {
	global.App = global.App || {};
	global.App.Adapters = global.App.Adapters || {};

	class GeminiAdapter extends global.REAL.LLMAdapter {
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
			const url = \`\${this.baseUrl}/\${this.modelName}:streamGenerateContent?key=\${this.apiKey}\`;

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
				throw new Error(\`Gemini API Error: \${response.status} - \${errText}\`);
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
							// JSON文字列としてパースすることで、\\n や \\" を正しく戻す
							// 文字列だけをクォートで囲んでパースさせる
							const text = JSON.parse(\`"\${rawText}"\`);
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
`.trim();

// --- REFERENCE CODE: js/lpml.js (FULL) ---
    const REF_LPML_JS = `
(function(global) {
	global.App = global.App || {};
	global.App.Adapters = global.App.Adapters || {};

	/**
	 * Python版のロジックを忠実に移植した堅牢なパーサー
	 * - JSON.parseを使わず正規表現キャプチャで属性を取得するためエラーに強い
	 * - 除外タグ（Raw Block）内のタグ類似文字列を正しく無視する
	 */
	class LPMLRegexParser {
		// Group 1: Key, Group 2: Double Quoted Value, Group 3: Single Quoted Value
		static PATTERN_ATTRIBUTE = / ([^"'/<> -]+)=(?:"([^"]*)"|'([^']*)')/g;

		static ATTR_PART_NO_CAPTURE = " [^\"'/<> -]+=(?:\"[^\"]*\"|'[^']*')";

		static PATTERN_TAG_START = '<([^/>\\s\\n]+)((?:' + LPMLRegexParser.ATTR_PART_NO_CAPTURE + ')*)\\s*>';
		static PATTERN_TAG_END = '</([^/>\\s\\n]+)\\s*>';
		static PATTERN_TAG_EMPTY = '<([^/>\\s\\n]+)((?:' + LPMLRegexParser.ATTR_PART_NO_CAPTURE + ')*)\\s*/>';

		static PATTERN_TAG = new RegExp(\`(\${LPMLRegexParser.PATTERN_TAG_START})|(\${LPMLRegexParser.PATTERN_TAG_END})|(\${LPMLRegexParser.PATTERN_TAG_EMPTY})\`, 'g');

		// 保護対象: バッククォート囲み(コードブロック)、またはコメント
		// 属性値のクォート("...")は保護しないことで属性パースとの競合を防ぐ
		static PATTERN_PROTECT = /(\`[\s\S]*?\`|<!--[\s\S]*?-->|<![\s\S]*?>)/g;

		static parseAttributes(text) {
			const attributes = {};
			const regex = new RegExp(LPMLRegexParser.PATTERN_ATTRIBUTE);
			let match;
			while ((match = regex.exec(text)) !== null) {
				const key = match[1];
				// JSON.parseせず、そのままの値を使用（改行や特殊文字で死なない）
				const value = match[2] !== undefined ? match[2] : match[3];
				attributes[key] = value || "";
			}
			return attributes;
		}

		static restoreString(text, protectedMap) {
			if (!text.includes("__PROTECTED_")) return text;
			let result = text;
			for (const [placeholder, original] of Object.entries(protectedMap)) {
				// 特殊文字($)の誤作動回避のため関数渡し
				result = result.replace(placeholder, () => original);
			}
			return result;
		}

		static restoreTree(tree, protectedMap) {
			return tree.map(item => {
				if (typeof item === 'string') return LPMLRegexParser.restoreString(item, protectedMap);
				if (item.attributes) {
					for (const k in item.attributes) item.attributes[k] = LPMLRegexParser.restoreString(item.attributes[k], protectedMap);
				}
				if (Array.isArray(item.content)) {
					item.content = LPMLRegexParser.restoreTree(item.content, protectedMap);
				}
				return item;
			});
		}

		static parseToTree(text, exclude = []) {
			const protectedContent = {};

			// 1. Protect phase
			const protectedText = text.replace(LPMLRegexParser.PATTERN_PROTECT, (match) => {
				const placeholder = \`__PROTECTED_\${Math.random().toString(36).substring(2, 15)}__\`;
				protectedContent[placeholder] = match;
				return placeholder;
			});

			const tree = [];
			let cursor = 0;
			let tagExclude = null;
			let stack = [{
				tag: 'root',
				content: tree
			}];

			const regexTag = new RegExp(LPMLRegexParser.PATTERN_TAG);
			let match;

			// 完全一致判定用
			const regexStart = new RegExp('^' + LPMLRegexParser.PATTERN_TAG_START + '$');
			const regexEnd = new RegExp('^' + LPMLRegexParser.PATTERN_TAG_END + '$');
			const regexEmpty = new RegExp('^' + LPMLRegexParser.PATTERN_TAG_EMPTY + '$');

			while ((match = regexTag.exec(protectedText)) !== null) {
				const tagStr = match[0];
				const indTagStart = match.index;
				const indTagEnd = indTagStart + tagStr.length;

				const matchTagStart = tagStr.match(regexStart);
				const matchTagEnd = tagStr.match(regexEnd);
				const matchTagEmpty = tagStr.match(regexEmpty);

				// --- 除外モード（Raw Block）処理 ---
				// Python版ロジック: 終了タグが見つかるまでカーソルを進めずループを回す
				if (tagExclude !== null) {
					if (matchTagEnd && matchTagEnd[1] === tagExclude) {
						tagExclude = null;
						// ここでcontinueせず標準処理へ流すことで、
						// 「タグの手前までのテキスト」＋「終了タグ」を処理させる
					} else {
						// 除外タグ内なので、このタグ(tagStr)はただのテキストとして無視
						continue;
					}
				}

				// テキスト抽出（trimしない）
				const contentStr = protectedText.substring(cursor, indTagStart);
				if (contentStr.length > 0) {
					stack[stack.length - 1].content.push(contentStr);
				}

				cursor = indTagEnd;

				if (matchTagStart) {
					const name = matchTagStart[1];
					if (exclude.includes(name)) tagExclude = name;

					const el = {
						tag: name,
						attributes: LPMLRegexParser.parseAttributes(matchTagStart[2]),
						content: []
					};
					stack[stack.length - 1].content.push(el);
					stack.push(el);

				} else if (matchTagEmpty) {
					const name = matchTagEmpty[1];
					const el = {
						tag: name,
						attributes: LPMLRegexParser.parseAttributes(matchTagEmpty[2]),
						content: null
					};
					stack[stack.length - 1].content.push(el);

				} else if (matchTagEnd) {
					const name = matchTagEnd[1];
					let idx = stack.length - 1;
					while (idx > 0 && stack[idx].tag !== name) idx--;

					if (idx > 0) {
						stack = stack.slice(0, idx);
					} else {
						// 対応する開始タグがない場合はテキスト扱い
						stack[stack.length - 1].content.push(tagStr);
					}
				}
			}

			const remaining = protectedText.substring(cursor);
			if (remaining.length > 0) stack[stack.length - 1].content.push(remaining);

			return LPMLRegexParser.restoreTree(tree, protectedContent);
		}
	}

	class LPMLAdapter extends global.REAL.ParserAdapter {
		constructor() {
			super();
			// 中身をパースせずテキストとして扱うタグ
			this.excludeTags = ['create_file', 'edit_file', 'ask', 'think'];
		}

		parse(text) {
			const tree = LPMLRegexParser.parseToTree(text, this.excludeTags);

			let rawActions = tree.filter(item => typeof item === 'object');
			const edits = [];
			const others = [];
			const interrupts = [];

			for (const item of rawActions) {
				// コンテンツの結合と正規化
				let contentText = this._extractContent(item.content);

				// 【重要】VFSの replaceContent 対策
				// Regexモードのブロックが含まれている場合、置換文字列内の $ を $$ にエスケープする
				// これにより VFS 側で \`replacement.replace\` が特殊文字として誤爆するのを防ぐ
				if (item.tag === 'edit_file' && contentText.includes('<<<<SEARCH')) {
					contentText = this._escapeRegexReplacement(contentText);
				}

				const action = {
					type: item.tag,
					params: {
						...item.attributes,
						content: contentText
					},
					raw: item
				};

				if (['ask', 'finish'].includes(action.type)) {
					interrupts.push(action);
				} else if (action.type === 'edit_file') {
					edits.push(action);
				} else {
					others.push(action);
				}
			}

			// 【重要】編集適用のソート順序ロジック修正
			edits.sort((a, b) => {
				const pathA = a.params.path || "";
				const pathB = b.params.path || "";

				// 1. ファイルパス順
				if (pathA !== pathB) return pathA.localeCompare(pathB);

				// 同一ファイル内の順序制御
				const isLineA = 'start' in a.params; // start属性があれば行編集
				const isLineB = 'start' in b.params;

				if (isLineA && isLineB) {
					// A. 両方とも行指定編集の場合:
					// 行番号が大きい順（下から上）に適用しないと座標がズレる
					const startA = parseInt(a.params.start || 0);
					const startB = parseInt(b.params.start || 0);
					return startB - startA;
				}

				if (isLineA && !isLineB) {
					// B. 行指定編集(A) と Regex置換(B) の場合:
					// 行指定編集を優先（先）にする。
					// 理由: Regex置換で行数や内容が変わると、固定座標の行指定は壊滅するため。
					return -1; // Aを前に
				}

				if (!isLineA && isLineB) {
					// C. Regex置換(A) と 行指定編集(B) の場合:
					// 行指定編集(B)を優先。
					return 1; // Bを前に
				}

				// D. 両方ともRegex置換の場合:
				// LLMが出力した順序（出現順）を維持する。
				return 0;
			});

			return [...others, ...edits, ...interrupts];
		}

		/**
		 * Regexブロック内のReplacementパートにある \`$\` を \`$$\` にエスケープする
		 */
		_escapeRegexReplacement(content) {
			// Regex: <<<<SEARCH (pattern) ==== (replacement) >>>>
			// フラグ: g (複数ブロック対応)
			return content.replace(
				/(<<<<SEARCH\s*[\s\S]*?\s*====\s*)([\s\S]*?)(\s*>>>>)/g,
				(match, prefix, replacement, suffix) => {
					// JSのreplaceで $ は特殊意味を持つため、リテラルの $ ($$) に置換
					const safeReplacement = replacement.replace(/\$/g, '$$$$');
					return prefix + safeReplacement + suffix;
				}
			);
		}

		_extractContent(content) {
			if (!content) return "";
			if (Array.isArray(content)) {
				// Rawモードでパースしているため、基本的には文字列のみが入っているはず
				return content.map(c => typeof c === 'string' ? c : "").join("");
			}
			return String(content);
		}
	}

	global.App.Adapters.LPMLAdapter = LPMLAdapter;

})(window);
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

<define_tag name="event">
Represents an external event or user action that changed the environment state.
Attributes:
    - type: The type of event (e.g., "file_change", "file_created", "file_deleted", "file_moved").
Content:
    - Description of the change.
Notes:
    - This tag is injected by the System. You should use this information to update your context but do NOT execute it.
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
Stops the autonomous execution loop between the LLM and the System.
Use this tag when you decide there are no more tools to execute in the current turn.
Constraint:
    - You **MUST NOT** use this tag if you are using ANY other tools (create_file, preview, etc.) in the same message.
</define_tag>

<define_tag name="tool_outputs">
Contains the outputs from previously executed tools.
The system automatically generates this tag. You should read it to verify the results of your actions.
</define_tag>

<define_tag name="user_input">
Contains a message from the user.
</define_tag>

<rule name="execution flow">
**STRICT RULES for Loop Control**:
1. **Tool Use = Continue**: If you use any tool (file operations, preview, etc.), do **NOT** use <finish/>. The system needs to run the tool and report back to you in the next turn.
2. **No Tool = Finish**: If you have no further tools to run (e.g., you are just answering a question, or you have verified the previous tool outputs and have nothing left to do), you **MUST** use <finish/> to stop the loop.
</rule>

<rule name="task planning">
For complex tasks, create detailed plans and TODO lists under the .plan/ directory, and proceed based on them.
Clearly state the purpose, procedures, and completion criteria for each step in the plan.
This plan is preserved beyond the current context and can be referenced in subsequent turns.
Enhance task execution accuracy and consistency through plan creation and reference.
It is advisable to seek user review after creating the plan.
Update the TODO list as the plan progresses, marking completed steps.
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
Modifies a file.
Attributes:
    - path: Target file path.
Content:
    **OPTION 1: Regex Replacement (RECOMMENDED)**
    Use strict markers to define the search pattern and replacement string.

    Constraint:
    - **You MUST provide only ONE replacement block per <edit_file> tag.**
    - If you need to modify multiple locations, use multiple <edit_file> tags.

    Format:
    <<<<SEARCH
    (Regex pattern)
    ====
    (Replacement)
    >>>>

    **OPTION 2: Line-based Editing (Use ONLY for appending or creating structure)**
    Attributes required: mode="replace"|"insert"|"delete", start, end.
    - mode="insert": Inserts content BEFORE the line specified in 'start'.
    - mode="replace": Overwrites lines from 'start' to 'end'.
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