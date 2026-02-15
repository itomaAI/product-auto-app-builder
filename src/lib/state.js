// src/lib/state.js

(function(global) {
	global.REAL = global.REAL || {};

	class WorldState {
		/**
		 * @param {Object} vfs - 仮想ファイルシステムインスタンス (read/write I/Fを持つこと)
		 * @param {Object} memory - 永続化したいその他の変数 (Project IDなど)
		 */
		constructor(vfs, memory = {}) {
			this.vfs = vfs;
			this.memory = memory;

			// History H: ターンのリスト
			// 各ターン: { id, role, content, timestamp, meta }
			this.history = [];
		}

		/**
		 * 履歴にターンを追加する
		 * @param {string} role - REAL.Role.*
		 * @param {Array|string} content - テキストまたは構造化コンテンツ
		 * @param {Object} meta - UI用のメタデータ (例: { type: 'tool_log', visible: false })
		 */
		appendTurn(role, content, meta = {}) {
			const turn = {
				id: crypto.randomUUID(),
				timestamp: Date.now(),
				role: role,
				content: content, // Array of parts or string
				meta: meta
			};
			this.history.push(turn);
			return turn;
		}

		/**
		 * 指定されたIDのターンを削除する
		 * @param {string} id 
		 */
		deleteTurn(id) {
			this.history = this.history.filter(t => t.id !== id);
		}

		/**
		 * 履歴全体を取得 (参照渡し)
		 * ※ 破壊的操作が必要な場合(古いスクショ削除など)はこの参照経由で行う
		 */
		getHistory() {
			return this.history;
		}

		/**
		 * 直近のターンを取得
		 */
		getLastTurn() {
			if (this.history.length === 0) return null;
			return this.history[this.history.length - 1];
		}

		/**
		 * 状態のシリアライズ (保存用)
		 */
		snapshot() {
			return {
				history: JSON.parse(JSON.stringify(this.history)),
				memory: {
					...this.memory
				}
				// VFSの状態はVFS側で管理することを想定
			};
		}

		/**
		 * 状態の復元 (ロード用)
		 */
		restore(snapshotData) {
			this.history = snapshotData.history || [];
			this.memory = snapshotData.memory || {};
		}
	}

	global.REAL.WorldState = WorldState;

})(window);