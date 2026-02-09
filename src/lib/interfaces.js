// src/lib/interfaces.js

(function(global) {
	global.REAL = global.REAL || {};

	/**
	 * Generator (G): LLMクライアント
	 */
	class LLMAdapter {
		/**
		 * @param {Array} messages - コンテキスト
		 * @param {Function} onChunk - ストリーミング用コールバック (chunk) => void
		 * @returns {Promise<string>} - 完了時のフルテキスト
		 */
		async generateStream(messages, onChunk) {
			throw new Error("LLMAdapter.generateStream must be implemented");
		}
	}

	/**
	 * Interpreter (I): パーサー
	 */
	class ParserAdapter {
		/**
		 * @param {string} text - LLMの生出力
		 * @returns {Array} - アクションオブジェクトの配列 [{ type, params, raw }]
		 */
		parse(text) {
			throw new Error("ParserAdapter.parse must be implemented");
		}
	}

	/**
	 * Executor (E): ツール実行管理
	 */
	class ToolRegistry {
		/**
		 * @param {Object} action - アクションオブジェクト
		 * @param {WorldState} state - 世界状態
		 * @returns {Promise<{result: any, signal: string}>}
		 */
		async execute(action, state) {
			throw new Error("ToolRegistry.execute must be implemented");
		}
	}

	/**
	 * Projector (P): コンテキスト構築
	 */
	class ContextProjector {
		/**
		 * 世界状態からLLMに送るメッセージ配列を作成する
		 * ここでシステムプロンプトの注入や、古い画像の削除(フィルタリング)を行う
		 * @param {WorldState} state 
		 * @returns {Array} messages
		 */
		createContext(state) {
			throw new Error("ContextProjector.createContext must be implemented");
		}
	}

	global.REAL.LLMAdapter = LLMAdapter;
	global.REAL.ParserAdapter = ParserAdapter;
	global.REAL.ToolRegistry = ToolRegistry;
	global.REAL.ContextProjector = ContextProjector;

})(window);