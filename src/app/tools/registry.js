// src/app/tools/registry.js

(function(global) {
    global.App = global.App || {};
    global.App.Tools = global.App.Tools || {};

    class ToolRegistry extends global.ALLA.ToolRegistry {
        constructor() {
            super();
            this.tools = new Map();
        }

        /**
         * ツール定義を登録
         * @param {string} name 
         * @param {Function} impl - (params, state) => Promise<{log, ui, ...}>
         * @param {string} signalType - デフォルトのシグナル (CONTINUE/HALT/TERMINATE)
         */
        register(name, impl, signalType = global.ALLA.Signal.CONTINUE) {
            this.tools.set(name, { impl, signalType });
        }

        /**
         * Engineからの呼び出し口
         */
        async execute(action, state) {
            const toolDef = this.tools.get(action.type);
            
            // 未知のツールの場合
            if (!toolDef) {
                return {
                    result: { log: `Error: Unknown tool <${action.type}>` },
                    signal: global.ALLA.Signal.CONTINUE
                };
            }

            try {
                // 実行
                // params: LPMLからパースされた属性
                // state: Ω (VFS含む)
                const output = await toolDef.impl(action.params, state);
                
                // シグナルの決定
                // ツール実装が明示的にSignalを返した場合はそれを使う（例: ask）
                // そうでなければ登録時のデフォルトを使う
                const signal = (output && output.signal) ? output.signal : toolDef.signalType;

                return {
                    result: output, // { log: "...", ui: "...", image: "..." }
                    signal: signal
                };

            } catch (err) {
                console.error(`Tool Execution Error <${action.type}>:`, err);
                return {
                    result: { 
                        log: `Error executing <${action.type}>: ${err.message}`,
                        ui: `❌ Error: ${err.message}`
                    },
                    signal: global.ALLA.Signal.CONTINUE
                };
            }
        }
    }

    global.App.Tools.Registry = ToolRegistry;

})(window);