// js/lpml.js

class LPMLParser {
    
    static PATTERN_ATTRIBUTE = / ([^"'/<> -]+)=(?:"([^"]*)"|'([^']*)')/g;
    static PATTERN_ATTRIBUTE_NO_CAPTURE = " [^\"'/<> -]+=(?:\"[^\"]*\"|'[^']*')";
    
    static PATTERN_TAG_START = `<([^/>\\s\\n]+)((?:${" [^\"'/<> -]+=(?:\"[^\"]*\"|'[^']*')"})*)\\s*>`;
    static PATTERN_TAG_END = `</([^/>\\s\\n]+)\\s*>`;
    static PATTERN_TAG_EMPTY = `<([^/>\\s\\n]+)((?:${" [^\"'/<> -]+=(?:\"[^\"]*\"|'[^']*')"})*)\\s*/>`;
    
    static PATTERN_TAG = new RegExp(`(${LPMLParser.PATTERN_TAG_START})|(${LPMLParser.PATTERN_TAG_END})|(${LPMLParser.PATTERN_TAG_EMPTY})`, 'g');
    
    static PATTERN_PROTECT = /(`[\s\S]*?`|<!--[\s\S]*?-->|<![\s\S]*?>)/g;

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

        // 1. Protect phase
        const protectedText = text.replace(LPMLParser.PATTERN_PROTECT, (match) => {
            const placeholder = `__PROTECTED_${Math.random().toString(36).substring(2, 15)}__`;
            protectedContent[placeholder] = match;
            return placeholder;
        });

        const tree = [];
        let cursor = 0;
        let tagExclude = null;
        let stack = [{ tag: 'root', content: tree }];

        const regexTag = new RegExp(LPMLParser.PATTERN_TAG);
        let match;

        const regexStart = new RegExp(`^${LPMLParser.PATTERN_TAG_START}$`);
        const regexEnd = new RegExp(`^${LPMLParser.PATTERN_TAG_END}$`);
        const regexEmpty = new RegExp(`^${LPMLParser.PATTERN_TAG_EMPTY}$`);

        while ((match = regexTag.exec(protectedText)) !== null) {
            const tagStr = match[0];
            const indTagStart = match.index;
            const indTagEnd = indTagStart + tagStr.length;

            const matchTagStart = tagStr.match(regexStart);
            const matchTagEnd = tagStr.match(regexEnd);
            const matchTagEmpty = tagStr.match(regexEmpty);

            // Exclusion logic: Treat content inside specific tags as raw text
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
                if (exclude.includes(name)) {
                    tagExclude = name;
                }
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
                    console.warn(`Warning: Unmatched closing tag </${name}> found.`);
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