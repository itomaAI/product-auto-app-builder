// src/app/tools/ui_tools.js

(function(global) {
	global.App = global.App || {};
	global.App.Tools = global.App.Tools || {};

	const Signal = global.ALLA.Signal;

	global.App.Tools.registerUITools = function(registry, uiController) {

		// --- Preview & Screenshot ---

		registry.register('preview', async (params, state) => {
			// VFSを渡してリフレッシュ
			// (VFSはStateから取るか、MainでBindされたものを使うかだが、
			//  uiController.refreshPreview(state.vfs) と呼べるようにする)
			await uiController.refreshPreview(state.vfs);
			return {
				log: `[preview] Refreshed.`,
				ui: `🔄 Preview Refreshed`
			};
		});

		registry.register('take_screenshot', async (params, state) => {
			// まずプレビューを確実に最新にする
			await uiController.refreshPreview(state.vfs);

			// 少し待機 (レンダリング待ち)
			await new Promise(r => setTimeout(r, 500));

			try {
				const base64 = await uiController.captureScreenshot();
				return {
					log: `[take_screenshot] Captured.`,
					ui: `📸 Screenshot Captured`,
					image: base64 // ProjectorがinlineDataにする
				};
			} catch (e) {
				return {
					log: `[take_screenshot] Failed: ${e.message}`,
					ui: `⚠️ Screenshot Failed: ${e.message}`
				};
			}
		});

		// --- Control Signals ---

		registry.register('ask', async (params, state) => {
			return {
				log: `[ask] Pausing for user input: ${params.content}`,
				ui: `❓ ${params.content}`, // UIには質問文を表示
				signal: Signal.HALT
			};
		}, Signal.HALT);

		registry.register('finish', async (params, state) => {
			return {
				log: `[finish] Task completed.`,
				ui: `✅ Task Completed: ${params.content || ""}`,
				signal: Signal.TERMINATE
			};
		}, Signal.TERMINATE);

		registry.register('report', async (params, state) => {
			return {
				log: `[report] ${params.content}`,
				ui: `📢 ${params.content}`,
				signal: Signal.CONTINUE
			};
		});

		// --- Meta Tools (Thinking) ---
		// これらは何もしない（思考ログはEngineがHistoryに残すため、ToolとしてはNo-Op）
		registry.register('thinking', async () => null);
		registry.register('plan', async () => null);
	};

})(window);