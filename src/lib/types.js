// src/lib/types.js

(function(global) {
    global.ALLA = global.ALLA || {};

    // --- Control Signals (制御シグナル) ---
    global.ALLA.Signal = {
        CONTINUE:  'SIGNAL_CONTINUE',   // 自律ループ継続
        HALT:      'SIGNAL_HALT',       // ユーザー入力待ち (ask等)
        TERMINATE: 'SIGNAL_TERMINATE'   // タスク完了 (finish等)
    };

    // --- Message Roles (ロール) ---
    global.ALLA.Role = {
        USER:   'user',   // 人間 または 環境入力
        MODEL:  'model',  // AI
        SYSTEM: 'system'  // ツール実行結果
    };

    // --- Turn Types (ターン種別 - UI表示用ヒント) ---
    global.ALLA.TurnType = {
        USER_INPUT:   'user_input',
        MODEL_THOUGHT: 'model_thought', // thinkingなど
        TOOL_EXECUTION: 'tool_execution',
        ERROR:        'error'
    };

})(window);