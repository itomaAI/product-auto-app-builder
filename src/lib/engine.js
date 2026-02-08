// src/lib/engine.js

(function(global) {
    global.ALLA = global.ALLA || {};

    class Engine {
        /**
         * @param {WorldState} state - 世界状態 Ω
         * @param {ContextProjector} projector - 射影関数 P
         * @param {LLMAdapter} llm - 生成関数 G
         * @param {ParserAdapter} parser - 解釈関数 I
         * @param {ToolRegistry} tools - 実行関数 E
         */
        constructor(state, projector, llm, parser, tools) {
            this.state = state;
            this.projector = projector;
            this.llm = llm;
            this.parser = parser;
            this.tools = tools;

            this.isRunning = false;
            this.abortController = null;
            
            // イベント通知用 (UI更新など)
            this.listeners = {
                'turn_start': [],
                'stream_chunk': [],
                'turn_end': [],
                'loop_stop': [] // HALT or TERMINATE
            };
        }

        on(event, callback) {
            if(this.listeners[event]) this.listeners[event].push(callback);
        }

        _emit(event, data) {
            if(this.listeners[event]) this.listeners[event].forEach(cb => cb(data));
        }

        /**
         * ユーザー入力を注入してループを開始/再開する (Phase 2 -> Phase 1)
         * @param {string|Array} inputContent - ユーザーの入力
         */
        async injectUserTurn(inputContent) {
            // 1. User Turn 追加
            this.state.appendTurn(global.ALLA.Role.USER, inputContent, { type: global.ALLA.TurnType.USER_INPUT });
            
            // 2. ループ開始
            await this.run();
        }

        /**
         * 自律ループ (Phase 1)
         */
        async run() {
            if (this.isRunning) return; // 二重起動防止
            this.isRunning = true;
            this.abortController = new AbortController();

            const Signal = global.ALLA.Signal;
            let currentSignal = Signal.CONTINUE;

            try {
                // --- THE LOOP ---
                while (currentSignal === Signal.CONTINUE) {
                    
                    // 1. Context Projection (Ω -> Prompt)
                    const messages = this.projector.createContext(this.state);
                    
                    // 2. Generation (Prompt -> RawText)
                    this._emit('turn_start', { role: global.ALLA.Role.MODEL });
                    
                    let rawResponse = "";
                    await this.llm.generateStream(messages, (chunk) => {
                        rawResponse += chunk;
                        this._emit('stream_chunk', chunk);
                    }, this.abortController.signal);

                    // History Update (LLM Output)
                    this.state.appendTurn(global.ALLA.Role.MODEL, rawResponse, { type: global.ALLA.TurnType.MODEL_THOUGHT });
                    
                    // 3. Interpretation (RawText -> Actions)
                    const actions = this.parser.parse(rawResponse);
                    
                    // アクションが無い場合 -> ループ終了(思考のみ)とするか、CONTINUEするか
                    // ここでは「ツール呼び出しがない＝発話終了」として HALT (Wait User) に倒すのが一般的
                    if (actions.length === 0) {
                        currentSignal = Signal.HALT;
                        break;
                    }

                    // 4. Execution (Actions -> Ω', Results, Signal)
                    this._emit('turn_start', { role: global.ALLA.Role.SYSTEM });
                    
                    const results = [];
                    let dominantSignal = Signal.CONTINUE; // 最も強いシグナルを優先

                    for (const action of actions) {
                        // ツールの実行
                        const { result, signal } = await this.tools.execute(action, this.state);
                        
                        // 結果を蓄積 (Tool Output)
                        results.push({
                            actionType: action.type,
                            output: result
                        });

                        // シグナル優先度処理: TERMINATE > HALT > CONTINUE
                        if (signal === Signal.TERMINATE) {
                            dominantSignal = Signal.TERMINATE;
                        } else if (signal === Signal.HALT && dominantSignal !== Signal.TERMINATE) {
                            dominantSignal = Signal.HALT;
                        }
                    }

                    // History Update (System Output / Tool Logs)
                    this.state.appendTurn(global.ALLA.Role.SYSTEM, results, { type: global.ALLA.TurnType.TOOL_EXECUTION });
                    this._emit('turn_end', { role: global.ALLA.Role.SYSTEM, results });

                    // 次のループへのシグナル決定
                    currentSignal = dominantSignal;
                    
                    // 安全のため少し待機 (UI描画などのため)
                    await new Promise(r => setTimeout(r, 10));
                }

            } catch (error) {
                if (error.name === 'AbortError') {
                    console.log('Loop aborted.');
                } else {
                    console.error('Engine Error:', error);
                    this.state.appendTurn(global.ALLA.Role.SYSTEM, `System Error: ${error.message}`, { type: global.ALLA.TurnType.ERROR });
                    this._emit('loop_stop', { reason: 'error', error });
                }
            } finally {
                this.isRunning = false;
                this.abortController = null;
                // ループが停止した理由を通知
                if (currentSignal === Signal.HALT) {
                    this._emit('loop_stop', { reason: 'halt' }); // ユーザー入力待ち
                } else if (currentSignal === Signal.TERMINATE) {
                    this._emit('loop_stop', { reason: 'terminate' }); // 完了
                }
            }
        }

        /**
         * 強制停止
         */
        stop() {
            if (this.abortController) {
                this.abortController.abort();
            }
        }
    }

    global.ALLA.Engine = Engine;

})(window);