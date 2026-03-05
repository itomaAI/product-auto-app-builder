// src/lib/engine.js

(function(global) {
	global.REAL = global.REAL || {};

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
			if (this.listeners[event]) this.listeners[event].push(callback);
		}

		_emit(event, data) {
			if (this.listeners[event]) this.listeners[event].forEach(cb => cb(data));
		}

		/**
		 * ユーザー入力を注入してループを開始/再開する (Phase 2 -> Phase 1)
		 * @param {string|Array} inputContent - ユーザーの入力
		 */
		async injectUserTurn(inputContent) {
			// 1. User Turn 追加
			const turn = this.state.appendTurn(global.REAL.Role.USER, inputContent, {
				type: global.REAL.TurnType.USER_INPUT
			});
			this._emit('turn_end', {
				role: global.REAL.Role.USER,
				turn
			});

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

			const Signal = global.REAL.Signal;
			let currentSignal = Signal.CONTINUE;
			let loopCount = 0;
			const MAX_LOOPS = 1000;

			// 前のターンでエラーが発生したかを追跡するフラグ
			let lastTurnHadError = false;

			try {
				// --- THE LOOP ---
				while (currentSignal === Signal.CONTINUE) {

					// 1. 無限ループ防止チェック
					if (loopCount >= MAX_LOOPS) {
						console.warn(`Max autonomous loops (${MAX_LOOPS}) reached.`);
						this.state.appendTurn(global.REAL.Role.SYSTEM, `System Alert: Maximum autonomous turn limit (${MAX_LOOPS}) reached. Stopping execution.`, {
							type: global.REAL.TurnType.ERROR
						});
						currentSignal = Signal.HALT;
						break;
					}
					loopCount++;

					// 2. Context Projection (Ω -> Prompt)
					const messages = await this.projector.createContext(this.state);

					// 3. Generation (Prompt -> RawText)
					this._emit('turn_start', {
						role: global.REAL.Role.MODEL
					});

					let rawResponse = "";
					await this.llm.generateStream(messages, (chunk) => {
						rawResponse += chunk;
						this._emit('stream_chunk', chunk);
					}, this.abortController.signal);

					// History Update (LLM Output)
					this.state.appendTurn(global.REAL.Role.MODEL, rawResponse, {
						type: global.REAL.TurnType.MODEL_THOUGHT
					});

					// 4. Interpretation (RawText -> Actions)
					const actions = this.parser.parse(rawResponse);

					// アクションが無い場合の判定ロジック
					if (actions.length === 0) {
						if (lastTurnHadError) {
							// 前のターンでエラーだったのに、今回何もアクションしなかった場合
							// システム側から叱咤してループを強制継続させる
							const retryMsg = "System: The previous tool execution failed. You MUST retry with a corrected action or fix the error. Do not finish without resolving the issue.";

							this.state.appendTurn(global.REAL.Role.SYSTEM, retryMsg, {
								type: global.REAL.TurnType.ERROR
							});

							// UIに反映させるためイベント発火
							this._emit('turn_end', {
								role: global.REAL.Role.SYSTEM,
								results: [{
									actionType: 'system_retry',
									output: {
										ui: "⚠️ Retry Requested: Action required to fix error."
									}
								}]
							});

							// フラグをリセットして再試行
							lastTurnHadError = false;
							continue;
						} else {
							// 通常終了 (Wait User)
							currentSignal = Signal.HALT;
							break;
						}
					}

					// 5. Execution (Actions -> Ω', Results, Signal)
					this._emit('turn_start', {
						role: global.REAL.Role.SYSTEM
					});

					const results = [];
					let dominantSignal = Signal.CONTINUE; // 最も強いシグナルを優先
					let hasError = false; // 今回のターンのエラー判定

					for (const action of actions) {
						// ツールの実行
						const {
							result,
							signal
						} = await this.tools.execute(action, this.state);

						results.push({
							actionType: action.type,
							output: result
						});

						// エラー判定: Registryが error: true を返しているかチェック
						if (result && result.error) {
							hasError = true;
						}

						// シグナル優先度処理: TERMINATE > HALT > CONTINUE
						if (signal === Signal.TERMINATE) {
							dominantSignal = Signal.TERMINATE;
						} else if (signal === Signal.HALT && dominantSignal !== Signal.TERMINATE) {
							dominantSignal = Signal.HALT;
						}
					}

					// エラー発生時のFinishキャンセル (Finish無視ロジック)
					// エラーがあるのに終了しようとした場合、強制的にCONTINUEにする
					if (hasError && dominantSignal === Signal.TERMINATE) {
						dominantSignal = Signal.CONTINUE;
						results.push({
							actionType: 'system_override',
							output: {
								log: "System Notice: <finish> signal was IGNORED because a tool execution failed. You must verify the error and retry.",
								ui: "🚫 Finish Cancelled: Error detected."
							}
						});
					}

					// 次のループ判定のためにエラー状態を保存
					lastTurnHadError = hasError;

					// History Update (System Output / Tool Logs)
					this.state.appendTurn(global.REAL.Role.SYSTEM, results, {
						type: global.REAL.TurnType.TOOL_EXECUTION
					});
					this._emit('turn_end', {
						role: global.REAL.Role.SYSTEM,
						results
					});

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
					this.state.appendTurn(global.REAL.Role.SYSTEM, `System Error: ${error.message}`, {
						type: global.REAL.TurnType.ERROR
					});
					this._emit('loop_stop', {
						reason: 'error',
						error
					});
				}
			} finally {
				this.isRunning = false;
				this.abortController = null;
				// ループが停止した理由を通知
				if (currentSignal === Signal.HALT) {
					this._emit('loop_stop', {
						reason: 'halt'
					}); // ユーザー入力待ち
				} else if (currentSignal === Signal.TERMINATE) {
					this._emit('loop_stop', {
						reason: 'terminate'
					}); // 完了
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

	global.REAL.Engine = Engine;

})(window);