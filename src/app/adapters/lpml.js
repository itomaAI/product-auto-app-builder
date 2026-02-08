// src/app/adapters/lpml.js

(function(global) {
    global.App = global.App || {};
    global.App.Adapters = global.App.Adapters || {};

    // 既存のRegexロジックをカプセル化
    class LPMLRegexParser {
        static PATTERN_ATTRIBUTE = / ([^"'/<> -]+)=(?:"([^"]*)"|'([^']*)')/g;
        static PATTERN_TAG_START = `<([^/>\\s\\n]+)((?:${" [^\"'/<> -]+=(?:\"[^\"]*\"|'[^']*')"})*)\\s*>`;
        static PATTERN_TAG_END = `</([^/>\\s\\n]+)\\s*>`;
        static PATTERN_TAG_EMPTY = `<([^/>\\s\\n]+)((?:${" [^\"'/<> -]+=(?:\"[^\"]*\"|'[^']*')"})*)\\s*/>`;
        static PATTERN_TAG = new RegExp(`(${LPMLRegexParser.PATTERN_TAG_START})|(${LPMLRegexParser.PATTERN_TAG_END})|(${LPMLRegexParser.PATTERN_TAG_EMPTY})`, 'g');
        static PATTERN_PROTECT = /(`[\s\S]*?`|<!--[\s\S]*?-->|<![\s\S]*?>)/g;

        static parseAttributes(text) {
            const attributes = {};
            const regex = new RegExp(LPMLRegexParser.PATTERN_ATTRIBUTE);
            let match;
            while ((match = regex.exec(text)) !== null) {
                attributes[match[1]] = match[2] !== undefined ? match[2] : match[3];
            }
            return attributes;
        }

        static restoreString(text, protectedMap) {
            if (!text.includes("__PROTECTED_")) return text;
            let result = text;
            for (const [placeholder, original] of Object.entries(protectedMap)) {
                result = result.replace(placeholder, original);
            }
            return result;
        }

        static restoreTree(tree, protectedMap) {
            return tree.map(item => {
                if (typeof item === 'string') return LPMLRegexParser.restoreString(item, protectedMap);
                if (item.attributes) {
                    for (const k in item.attributes) item.attributes[k] = LPMLRegexParser.restoreString(item.attributes[k], protectedMap);
                }
                if (Array.isArray(item.content)) item.content = LPMLRegexParser.restoreTree(item.content, protectedMap);
                return item;
            });
        }

        static parseToTree(text, exclude = []) {
            const protectedContent = {};
            const protectedText = text.replace(LPMLRegexParser.PATTERN_PROTECT, (match) => {
                const placeholder = `__PROTECTED_${Math.random().toString(36).substring(2, 15)}__`;
                protectedContent[placeholder] = match;
                return placeholder;
            });

            const tree = [];
            let cursor = 0;
            let tagExclude = null;
            let stack = [{ tag: 'root', content: tree }];
            
            const regexTag = new RegExp(LPMLRegexParser.PATTERN_TAG);
            let match;
            const regexStart = new RegExp(`^${LPMLRegexParser.PATTERN_TAG_START}$`);
            const regexEnd = new RegExp(`^${LPMLRegexParser.PATTERN_TAG_END}$`);
            const regexEmpty = new RegExp(`^${LPMLRegexParser.PATTERN_TAG_EMPTY}$`);

            while ((match = regexTag.exec(protectedText)) !== null) {
                const tagStr = match[0];
                const indTagStart = match.index;
                const indTagEnd = indTagStart + tagStr.length;

                // Exclude処理 (create_fileの中身などはパースしない)
                const matchTagStart = tagStr.match(regexStart);
                const matchTagEnd = tagStr.match(regexEnd);

                if (tagExclude !== null) {
                    if (matchTagEnd && matchTagEnd[1] === tagExclude) tagExclude = null;
                    else continue;
                }

                const contentStr = protectedText.substring(cursor, indTagStart).trim();
                if (contentStr) stack[stack.length - 1].content.push(contentStr);
                cursor = indTagEnd;

                if (matchTagStart) {
                    const name = matchTagStart[1];
                    if (exclude.includes(name)) tagExclude = name;
                    const el = { tag: name, attributes: LPMLRegexParser.parseAttributes(matchTagStart[2]), content: [] };
                    stack[stack.length - 1].content.push(el);
                    stack.push(el);
                } else if (tagStr.match(regexEmpty)) {
                    const matchEmpty = tagStr.match(regexEmpty);
                    const el = { tag: matchEmpty[1], attributes: LPMLRegexParser.parseAttributes(matchEmpty[2]), content: null };
                    stack[stack.length - 1].content.push(el);
                } else if (matchTagEnd) {
                    const name = matchTagEnd[1];
                    let idx = stack.length - 1;
                    while(idx > 0 && stack[idx].tag !== name) idx--;
                    if (idx > 0) stack = stack.slice(0, idx);
                }
            }
            const remaining = protectedText.substring(cursor).trim();
            if (remaining) stack[stack.length - 1].content.push(remaining);

            return LPMLRegexParser.restoreTree(tree, protectedContent);
        }
    }

    // --- Adapter Implementation ---

    class LPMLAdapter extends global.ALLA.ParserAdapter {
        constructor() {
            super();
            // これらの中身はタグとしてパースせず、raw textとして扱う
            this.excludeTags = ['create_file', 'edit_file']; 
        }

        parse(text) {
            const tree = LPMLRegexParser.parseToTree(text, this.excludeTags);
            
            // ツリー構造をフラットなActionリストに変換
            // Note: ルート直下の要素のみをAction候補とする（ネストされたタグはコンテンツ扱い）
            let rawActions = tree.filter(item => typeof item === 'object');

            // 1. 分類 (Immediate vs Interrupt)
            const edits = [];
            const others = [];
            const interrupts = [];

            for (const item of rawActions) {
                const action = {
                    type: item.tag,
                    params: { ...item.attributes, content: this._extractContent(item.content) },
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

            edits.sort((a, b) => {
                const pathA = a.params.path || "";
                const pathB = b.params.path || "";
                if (pathA !== pathB) return pathA.localeCompare(pathB);
                
                const startA = parseInt(a.params.start || 0);
                const startB = parseInt(b.params.start || 0);

                if (startB !== startA) return startB - startA;
                return 0; 
            });

            // 3. 結合 (Others -> Edits -> Interrupts)
            // ※ Interruptがあっても、その前の作業は実行する仕様
            return [...others, ...edits, ...interrupts];
        }

        _extractContent(content) {
            if (!content) return "";
            if (Array.isArray(content)) {
                return content.map(c => typeof c === 'string' ? c : "").join("");
            }
            return String(content);
        }
    }

    global.App.Adapters.LPMLAdapter = LPMLAdapter;

})(window);