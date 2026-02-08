// src/app/adapters/projector.js

(function(global) {
    global.App = global.App || {};
    global.App.Adapters = global.App.Adapters || {};

    const Role = global.ALLA.Role;

    class MetaForgeProjector extends global.ALLA.ContextProjector {
        /**
         * @param {string} systemPrompt 
         */
        constructor(systemPrompt) {
            super();
            this.systemPrompt = systemPrompt;
        }

        createContext(state) {
            // 1. Historyの最適化 (副作用あり: 古いスクショの削除)
            // state.history を直接変更する
            this._optimizeHistory(state.history);

            // 2. APIメッセージの構築
            const apiMessages = [];

            // System Prompt (User Roleとして先頭に追加)
            apiMessages.push({
                role: 'user',
                parts: [{ text: this.systemPrompt }]
            });

            // History Mapping
            for (const turn of state.history) {
                const parts = this._convertTurnToParts(turn);
                if (!parts || parts.length === 0) continue;

                // Role Mapping
                let apiRole = 'user';
                if (turn.role === Role.MODEL) apiRole = 'model';
                if (turn.role === Role.SYSTEM) apiRole = 'user'; // System output is User input for LLM

                apiMessages.push({
                    role: apiRole,
                    parts: parts
                });
            }

            return apiMessages;
        }

        _convertTurnToParts(turn) {
            // A. テキストの場合
            if (typeof turn.content === 'string') {
                return [{ text: turn.content }];
            }

            // B. 配列の場合 (Mixed content)
            if (Array.isArray(turn.content)) {
                // Tool Output (Results) の場合
                if (turn.meta && turn.meta.type === global.ALLA.TurnType.TOOL_EXECUTION) {
                    // <tool_outputs> タグでラップする
                    const logText = turn.content.map(c => {
                        // 画像が含まれる場合は除外して、テキストログだけにする（画像は別途処理するか、ここには含めない）
                        // ※MetaForge仕様: ツール結果に画像が含まれる場合、それはプレビューのスクショである
                        if (c.output && c.output.image) return ""; 
                        // ToolRegistryが返す { log: "..." } を使う想定
                        if (c.output && c.output.log) return c.output.log;
                        return "";
                    }).join('\n');
                    
                    const parts = [];
                    if (logText.trim()) {
                        parts.push({ text: `<tool_outputs>\n${logText}\n</tool_outputs>` });
                    }

                    // 画像パートの追加 (Screenshots)
                    turn.content.forEach(c => {
                        if (c.output && c.output.image) {
                            parts.push({
                                inlineData: {
                                    // 【修正後】ツールから渡された mimeType を優先し、なければ png にする
                                    mimeType: c.output.mimeType || 'image/png',
                                    
                                    data: c.output.image // Base64
                                }
                            });
                        }
                    });
                    return parts;
                }

                // 通常のUser Input (Attachments) の場合
                return turn.content.map(c => {
                    if (c.text) return { text: c.text };
                    if (c.inlineData) return { inlineData: c.inlineData };
                    return null;
                }).filter(Boolean);
            }

            return [];
        }

        /**
         * 履歴内の古い画像を削除する（副作用メソッド）
         * 最新の1枚以外の画像データを削除し、プレースホルダーに置き換える
         */
        _optimizeHistory(history) {
            let foundLatestImage = false;

            // 後ろからスキャン
            for (let i = history.length - 1; i >= 0; i--) {
                const turn = history[i];
                if (!Array.isArray(turn.content)) continue;

                // ツール実行結果内の画像を探索
                if (turn.meta && turn.meta.type === global.ALLA.TurnType.TOOL_EXECUTION) {
                    turn.content.forEach(item => {
                        if (item.output && item.output.image) {
                            if (foundLatestImage) {
                                // 2枚目以降（古いもの）は削除
                                delete item.output.image;
                                item.output.log += "\n[System: Old screenshot removed to save memory]";
                            } else {
                                // 最新の1枚
                                foundLatestImage = true;
                            }
                        }
                    });
                }
                
                // ユーザーアップロード画像も同様に処理すべきだが、
                // 元のMetaForge仕様では「スクリーンショット(_isScreenshot)」のみが対象だったため
                // ここではツール出力画像(Screenshot)に限定する。
            }
        }
    }

    global.App.Adapters.MetaForgeProjector = MetaForgeProjector;

})(window);