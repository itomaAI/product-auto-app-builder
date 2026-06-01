// src/app/initial_files.js

(function(global) {
    global.App = global.App || {};

    // --- Reference Content ---

    const REF_GEMINI_JS = `
// The current latest models are gemini-3.1-pro-preview or gemini-3-flash-preview.
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
							if (char === '\\\\') {
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

		static ATTR_PART_NO_CAPTURE = " [^\\"'/<> -]+=(?:\\"[^\\"]*\\"|'[^']*')";

		static PATTERN_TAG_START = '<([^/>\\s\\n]+)((?:' + LPMLRegexParser.ATTR_PART_NO_CAPTURE + ')*)\\s*>';
		static PATTERN_TAG_END = '</([^/>\\s\\n]+)\\s*>';
		static PATTERN_TAG_EMPTY = '<([^/>\\s\\n]+)((?:' + LPMLRegexParser.ATTR_PART_NO_CAPTURE + ')*)\\s*/>';

		static PATTERN_TAG = new RegExp(\`(\${LPMLRegexParser.PATTERN_TAG_START})|(\${LPMLRegexParser.PATTERN_TAG_END})|(\${LPMLRegexParser.PATTERN_TAG_EMPTY})\`, 'g');

		// 保護対象: バッククォート囲み(コードブロック)、またはコメント
		// 属性値のクォート("...")は保護しないことで属性パースとの競合を防ぐ
		static PATTERN_PROTECT = /(\`[\\s\\S]*?\`|<!--[\\s\\S]*?-->|<![\\s\\S]*?>)/g;

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

    const DEFAULT_INDEX_HTML = `<!DOCTYPE html>
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
</html>`;

    // Initialize Default Files Map
    global.App.InitialFiles = {
        "index.html": DEFAULT_INDEX_HTML,
        // Knowledge Base
        ".sample/gemini.js": REF_GEMINI_JS,
        ".sample/lpml.js": REF_LPML_JS,
        ".sample/README.txt": REF_README
    };

})(window);