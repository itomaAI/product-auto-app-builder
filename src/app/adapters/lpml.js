// src/app/adapters/lpml.js

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

		static PATTERN_TAG = new RegExp(`(${LPMLRegexParser.PATTERN_TAG_START})|(${LPMLRegexParser.PATTERN_TAG_END})|(${LPMLRegexParser.PATTERN_TAG_EMPTY})`, 'g');

		// 保護対象: バッククォート囲み(コードブロック)、またはコメント
		// 属性値のクォート("...")は保護しないことで属性パースとの競合を防ぐ
		static PATTERN_PROTECT = /(`[\s\S]*?`|<!--[\s\S]*?-->|<![\s\S]*?>)/g;

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
				const placeholder = `__PROTECTED_${Math.random().toString(36).substring(2, 15)}__`;
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
			this.excludeTags = ['create_file', 'edit_file', 'ask', 'thinking', 'plan'];
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
				// これにより VFS 側で `replacement.replace` が特殊文字として誤爆するのを防ぐ
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
		 * Regexブロック内のReplacementパートにある `$` を `$$` にエスケープする
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