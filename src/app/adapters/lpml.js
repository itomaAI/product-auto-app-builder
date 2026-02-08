// src/app/adapters/lpml.js

(function(global) {
	global.App = global.App || {};
	global.App.Adapters = global.App.Adapters || {};

	class LPMLRegexParser {
		// Python版に合わせた正規表現定義
		// Group 1: Key, Group 2: Double Quoted Value, Group 3: Single Quoted Value
		static PATTERN_ATTRIBUTE = / ([^"'/<> -]+)=(?:"([^"]*)"|'([^']*)')/g;

		// 正規表現構築用パーツ
		static ATTR_PART_NO_CAPTURE = " [^\"'/<> -]+=(?:\"[^\"]*\"|'[^']*')";

		// タグ定義
		static PATTERN_TAG_START = '<([^/>\\s\\n]+)((?:' + LPMLRegexParser.ATTR_PART_NO_CAPTURE + ')*)\\s*>';
		static PATTERN_TAG_END = '</([^/>\\s\\n]+)\\s*>';
		static PATTERN_TAG_EMPTY = '<([^/>\\s\\n]+)((?:' + LPMLRegexParser.ATTR_PART_NO_CAPTURE + ')*)\\s*/>';

		// 統合正規表現
		static PATTERN_TAG = new RegExp(`(${LPMLRegexParser.PATTERN_TAG_START})|(${LPMLRegexParser.PATTERN_TAG_END})|(${LPMLRegexParser.PATTERN_TAG_EMPTY})`, 'g');

		// 保護対象: バッククォート囲み、またはコメントのみ（属性値のクォートは保護しない）
		// Python: r'(`.*?`|<!--.*?-->|<!.*?>)' flags=re.DOTALL
		// JSの . (dot) は改行を含まないため、[\s\S] で代用
		static PATTERN_PROTECT = /(`[\s\S]*?`|<!--[\s\S]*?-->|<![\s\S]*?>)/g;

		/**
		 * 属性文字列をパースしてオブジェクトを返す
		 * Python: _parse_attributes 相当
		 */
		static parseAttributes(text) {
			const attributes = {};
			const regex = new RegExp(LPMLRegexParser.PATTERN_ATTRIBUTE);
			let match;
			while ((match = regex.exec(text)) !== null) {
				const key = match[1];
				// Python版ロジック: 単純にキャプチャされた側を採用（エスケープ解除等はしない仕様）
				const value = match[2] !== undefined ? match[2] : match[3];
				attributes[key] = value || "";
			}
			return attributes;
		}

		static restoreString(text, protectedMap) {
			if (!text.includes("__PROTECTED_")) return text;
			let result = text;
			for (const [placeholder, original] of Object.entries(protectedMap)) {
				// replaceの第二引数に関数を渡して特殊文字($)の誤作動を防ぐ
				result = result.replace(placeholder, () => original);
			}
			return result;
		}

		static restoreTree(tree, protectedMap) {
			return tree.map(item => {
				if (typeof item === 'string') {
					return LPMLRegexParser.restoreString(item, protectedMap);
				}
				if (item.attributes) {
					// Python版修正: 属性値の中身も復元対象
					for (const k in item.attributes) {
						item.attributes[k] = LPMLRegexParser.restoreString(item.attributes[k], protectedMap);
					}
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
			// ランダムIDを使って置換
			const protectedText = text.replace(LPMLRegexParser.PATTERN_PROTECT, (match) => {
				const placeholder = `__PROTECTED_${Math.random().toString(36).substring(2, 15)}__`;
				protectedContent[placeholder] = match;
				return placeholder;
			});

			const tree = [];
			let cursor = 0;
			let tagExclude = null;

			// スタック初期化
			let stack = [{
				tag: 'root',
				content: tree
			}];

			const regexTag = new RegExp(LPMLRegexParser.PATTERN_TAG);
			let match;

			// 個別のタグ判定用正規表現（^...$ で完全一致判定）
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

				// --- 除外モード（Raw Block）中の処理 ---
				if (tagExclude !== null) {
					// 終了タグかどうかだけをチェック
					if (matchTagEnd && matchTagEnd[1] === tagExclude) {
						// 除外モード終了
						tagExclude = null;
						// ここでcontinueせず、下の「標準処理」に流して
						// 「終了タグまでのテキスト」と「終了タグ自体」を処理させる
					} else {
						// 除外モード継続中
						// カーソルを進めずにループを継続することで、
						// 現在のタグ（タグに見える文字列）を「テキストの一部」として扱う。
						// cursor変数は更新されないため、次回の有効なタグ（終了タグ）が見つかったときに
						// まとめて contentStr として取得される。
						continue;
					}
				}

				// --- テキストコンテンツの抽出 ---
				const contentStr = protectedText.substring(cursor, indTagStart);

				// Python版に準拠: 空文字でなければ追加（strip=False相当）
				if (contentStr.length > 0) {
					stack[stack.length - 1].content.push(contentStr);
				}

				// カーソル更新
				cursor = indTagEnd;

				// --- タグの処理 ---
				if (matchTagStart) {
					const name = matchTagStart[1];
					if (exclude.includes(name)) {
						tagExclude = name;
					}

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
					// スタックを遡って対応する開始タグを探す
					let idx = stack.length - 1;
					while (idx > 0 && stack[idx].tag !== name) {
						idx--;
					}

					if (idx > 0) {
						// 見つかった場合、そこまでスタックを解消
						stack = stack.slice(0, idx);
					} else {
						// 対応する開始タグがない場合（Warning相当）
						// タグをただの文字列としてコンテンツに追加
						stack[stack.length - 1].content.push(tagStr);
					}
				}
			}

			// 残りのテキストを追加
			const remaining = protectedText.substring(cursor);
			if (remaining.length > 0) {
				stack[stack.length - 1].content.push(remaining);
			}

			return LPMLRegexParser.restoreTree(tree, protectedContent);
		}
	}

	class LPMLAdapter extends global.ALLA.ParserAdapter {
		constructor() {
			super();
			// これらタグの中身はパースせず生のテキストとして扱う
			this.excludeTags = ['create_file', 'edit_file', 'ask', 'think'];
		}

		parse(text) {
			const tree = LPMLRegexParser.parseToTree(text, this.excludeTags);

			// アダプターロジック：ツリー構造をフラットなアクションリストに変換
			// 注: ここは元の仕様に合わせて adjustment が必要かもしれません
			let rawActions = tree.filter(item => typeof item === 'object');
			const edits = [];
			const others = [];
			const interrupts = [];

			for (const item of rawActions) {
				const action = {
					type: item.tag,
					params: {
						...item.attributes,
						// 配列コンテンツを文字列に結合
						content: this._extractContent(item.content)
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

			// edit_file のソート順序ロジック（必要に応じて）
			edits.sort((a, b) => {
				const pathA = a.params.path || "";
				const pathB = b.params.path || "";
				if (pathA !== pathB) return pathA.localeCompare(pathB);
				const startA = parseInt(a.params.start || 0);
				const startB = parseInt(b.params.start || 0);
				return startB - startA;
			});

			return [...others, ...edits, ...interrupts];
		}

		_extractContent(content) {
			if (!content) return "";
			if (Array.isArray(content)) {
				return content.map(c => {
					if (typeof c === 'string') return c;
					// ネストされたタグがある場合、元の形式に戻すか無視するか
					// Rawモード(exclude)でパースしている場合、ここは文字列になっているはず
					return "";
				}).join("");
			}
			return String(content);
		}
	}

	global.App.Adapters.LPMLAdapter = LPMLAdapter;

})(window);