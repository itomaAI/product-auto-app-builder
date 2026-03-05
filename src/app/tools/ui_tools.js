// src/app/tools/ui_tools.js

(function(global) {
	global.App = global.App || {};
	global.App.Tools = global.App.Tools || {};

	const Signal = global.REAL.Signal;

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
			// 描画が安定するまで少し待つ
			await new Promise(r => setTimeout(r, 1000));

			try {
				const base64 = await uiController.captureScreenshot();

				// ★ VFSへ保存 (コンテキスト圧迫回避)
				const timestamp = Date.now();
				const filename = `screenshot_${timestamp}.png`;
				const dir = '.cache/media';
				const path = `${dir}/${filename}`;

				// VFSはDataURL形式で保存する
				const dataUrl = `data:image/png;base64,${base64}`;
				state.vfs.writeFile(path, dataUrl);

				return {
					log: `[take_screenshot] Captured and saved to ${path}`,
					ui: `📸 Screenshot Captured`,
					media: {
						path: path,
						mimeType: 'image/png',
						metadata: {}
					}
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