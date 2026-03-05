// src/app/main.js

document.addEventListener('DOMContentLoaded', async () => {
	// Shortcuts
	const {
		REAL,
		App
	} = window;
	const {
		Engine,
		WorldState
	} = REAL;
	const {
		Config
	} = App;
	const {
		VirtualFileSystem,
		Compiler
	} = App.World;
	const {
		UIController,
		DOM
	} = App.UI;
	const {
		Registry
	} = App.Tools;
	const {
		GeminiAdapter,
		LPMLAdapter,
		MetaForgeProjector,
		StorageAdapter
	} = App.Adapters;

	// --- 1. Initialize Infrastructure ---
	const storage = new StorageAdapter();
	const compiler = new Compiler();
	const parser = new LPMLAdapter();
	const projector = new MetaForgeProjector(Config.SYSTEM_PROMPT);

	// --- 2. Initialize Model (Domain) ---
	const vfs = new VirtualFileSystem({});
	const state = new WorldState(vfs);

	// --- 3. Initialize UI (View & Controllers) ---
	const ui = new UIController(vfs, state, compiler);

	// --- 4. Initialize Tools ---
	const registry = new Registry();
	App.Tools.registerFSTools(registry, vfs);
	App.Tools.registerNavTools(registry, vfs);
	App.Tools.registerUITools(registry, ui);

	// 検索ツールの登録
	if (App.Tools.registerSearchTools) {
		App.Tools.registerSearchTools(registry, vfs);
	}

	// --- 5. Initialize Engine (Logic) ---
	let apiKey = localStorage.getItem('metaforge_api_key') || '';
	if (apiKey && document.getElementById(DOM.apiKey)) {
		document.getElementById(DOM.apiKey).value = apiKey;
	}
	if (document.getElementById(DOM.modelStatus)) {
		document.getElementById(DOM.modelStatus).innerText = Config.MODEL_NAME;
	}

	const createLLM = () => new GeminiAdapter(apiKey, Config.MODEL_NAME);
	const engine = new Engine(state, projector, createLLM(), parser, registry);


	// --- 6. Helper Functions ---
	const fileToBase64 = (file) => {
		return new Promise((r, j) => {
			const reader = new FileReader();
			reader.readAsDataURL(file);
			reader.onload = () => r(reader.result);
			reader.onerror = j;
		});
	};


	// --- 7. Project Management Logic ---
	let currentProjectId = null;
	let currentProjectName = "Untitled";
	let saveDebounceTimer = null;

	const loadProjectData = (project) => {
		currentProjectId = project.id;
		currentProjectName = project.name;

		// VFS Restore (Migration via loadFiles)
		Object.keys(vfs.files).forEach(k => delete vfs.files[k]);
		vfs.loadFiles(project.files || {});
		// notify is called within loadFiles

		// History Restore
		state.history = project.chatHistory || [];

		// UI Update
		ui.chat.renderHistory(state.getHistory());
		ui.refreshPreview();
		ui.updateProjectName(currentProjectName);
	};

	const createNewProject = async () => {
		const id = crypto.randomUUID();
		const project = {
			id: id,
			name: new Date().toLocaleString(),
			files: {
				...Config.DEFAULT_FILES
			},
			chatHistory: []
		};
		await storage.saveProject(project.id, project.name, project.files, project.chatHistory);
		await storage.setLastProjectId(id);
		loadProjectData(project);
	};

	const triggerAutoSave = () => {
		if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
		ui.setSaveStatus('saving');

		// プロジェクトの上書き保存のみ実行 (定時スナップショットは行わない)
		saveDebounceTimer = setTimeout(async () => {
			if (!currentProjectId) return;
			await storage.saveProject(
				currentProjectId,
				currentProjectName,
				vfs.files,
				state.getHistory()
			);
			ui.setSaveStatus('saved');
		}, 1000);
	};


	// --- 8. Event Wiring ---

	engine.on('turn_start', (data) => {
		if (data.role === REAL.Role.MODEL) {
			ui.chat.setProcessing(true);
			ui.chat.startStreaming();
		}
	});

	engine.on('stream_chunk', (chunk) => {
		ui.chat.updateStreaming(chunk);
	});

	engine.on('turn_end', (data) => {
		if (data.role === REAL.Role.MODEL) {
			ui.chat.finalizeStreaming();
		} else {
			ui.chat.renderHistory(state.getHistory());
		}
		triggerAutoSave();
	});

	engine.on('loop_stop', (data) => {
		if (ui.chat.currentStreamEl) ui.chat.finalizeStreaming();
		ui.chat.setProcessing(false);
		ui.chat.renderHistory(state.getHistory());
		triggerAutoSave();
		if (data.reason === 'error') alert('Engine Error. See console.');
	});

	// VFS -> AutoSave
	vfs.subscribe(() => {
		triggerAutoSave();
	});

	// UI -> Project Operations
	document.addEventListener('project-rename', (e) => {
		currentProjectName = e.detail;
		triggerAutoSave();
	});
	document.addEventListener('request-project-list', async () => {
		const projects = await storage.getAllProjectsMetadata();
		ui.renderProjectList(projects);
	});
	document.addEventListener('project-select', async (e) => {
		const id = e.detail;
		if (id === currentProjectId) return;
		const project = await storage.getProject(id);
		if (project) {
			loadProjectData(project);
			await storage.setLastProjectId(id);
		}
	});
	document.addEventListener('project-delete', async (e) => {
		const id = e.detail;
		await storage.deleteProject(id);
		const projects = await storage.getAllProjectsMetadata();
		ui.renderProjectList(projects);

		if (id === currentProjectId) {
			if (projects.length > 0) {
				const nextId = projects[0].id;
				const nextProject = await storage.getProject(nextId);
				if (nextProject) {
					loadProjectData(nextProject);
					await storage.setLastProjectId(nextId);
				} else {
					await createNewProject();
				}
			} else {
				await createNewProject();
			}
		}
	});

	const btnNew = document.getElementById(DOM.btnNewProject);
	if (btnNew) btnNew.onclick = async () => {
		if (confirm("Create new project?")) await createNewProject();
	};
	const btnNewModal = document.getElementById(DOM.btnNewProjectModal);
	if (btnNewModal) btnNewModal.onclick = async () => {
		await createNewProject();
		ui.toggleProjectModal(false);
	};

	// Chat UI -> Engine
	ui.chat.on('send', async (text, files) => {
		ui.chat.setProcessing(true);

		const content = [];
		const CACHE_DIR = '.cache/media';

		// 1. Attachments first
		for (const file of files) {
			const isText = file.type.startsWith('text/') || file.name.match(/\.(js|py|html|json|css|md|txt|xml|yml|sh)$/);
			
			// ファイル読み込み
			const dataUrl = await fileToBase64(file); // data:mime;base64,...

			// キャッシュディレクトリ確保
			if (!vfs.exists(CACHE_DIR) && vfs.createDirectory) {
				vfs.createDirectory(CACHE_DIR);
			}

			// ファイル保存 (バイナリもテキストもVFS上ではDataURLまたはテキストとして保存可能)
			const timestamp = Date.now();
			const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
			const path = `${CACHE_DIR}/${timestamp}_${safeName}`;

			try {
				if (isText) {
					// テキストの場合は内容を展開してプロンプトに含める (AIが読めるように)
					// 同時にVFSにも保存しておく（後で参照できるように）
					const textContent = await file.text();
					vfs.writeFile(path, textContent);
					
					content.push({
						text: `<user_attachment name="${file.name}" path="${path}">\n${textContent}\n</user_attachment>`
					});
				} else {
					// バイナリの場合はVFSに保存し、参照のみを渡す
					vfs.writeFile(path, dataUrl); // DataURL形式で保存

					content.push({
						media: {
							path: path,
							mimeType: file.type || 'application/octet-stream',
							metadata: {}
						}
					});

					// user_inputの外に配置されるよう、独立したtextパーツとして表示用タグを追加してもよいが
					// ここでは media オブジェクトだけで十分 (Projectorが処理する)
				}
			} catch (e) {
				console.error(`Failed to save attachment: ${path}`, e);
				alert(`Failed to upload ${file.name}: ${e.message}`);
				ui.chat.setProcessing(false);
				return;
			}
		}

		// 2. User Text Input last
		if (text) {
			content.push({
				text
			});
		}

		engine.llm = createLLM();

		try {
			await engine.injectUserTurn(content);
		} catch (e) {
			console.error(e);
			ui.chat.setProcessing(false);
			alert("Error: " + e.message);
		}
	});

	ui.chat.on('stop', () => {
		engine.stop();
		ui.chat.setProcessing(false);
	});

	ui.chat.on('clear', () => {
		if (confirm("Clear chat history and media cache?")) {
			// 1. History Clear
			state.history = [];
			ui.chat.renderHistory([]);

			// 2. Media Cache Purge
			try {
				const cacheDir = '.cache/media';
				// ディレクトリごと削除してファイルをクリーンアップ
				const msg = vfs.deleteDirectory(cacheDir);
				console.log("[System] Cache cleared:", msg);
			} catch (e) {
				console.warn("[System] Failed to clear media cache:", e);
			}

			triggerAutoSave();
		}
	});

	// メッセージ削除イベント
	ui.chat.on('delete_turn', (id) => {
		state.deleteTurn(id);
		ui.chat.renderHistory(state.getHistory());
		triggerAutoSave();
	});

	const btnDownload = document.getElementById(DOM.btnDownload);
	if (btnDownload) btnDownload.onclick = async () => {
		if (typeof JSZip === 'undefined') {
			alert('JSZip not loaded');
			return;
		}
		const zip = new JSZip();
		vfs.listFiles().forEach(path => {
			if (!path.startsWith('.sample/')) {
				const content = vfs.readFile(path);
				if (content.startsWith('data:')) {
					zip.file(path, content.split(',')[1], {
						base64: true
					});
				} else {
					zip.file(path, content);
				}
			}
		});
		const blob = await zip.generateAsync({
			type: 'blob'
		});
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		const safeName = currentProjectName.replace(/[/\\?%*:|"<>]/g, '_');
		a.download = `${safeName}.zip`;
		a.click();
	};

	const btnSaveKey = document.getElementById(DOM.btnSaveKey);
	if (btnSaveKey) btnSaveKey.onclick = () => {
		apiKey = document.getElementById(DOM.apiKey).value.trim();
		localStorage.setItem('metaforge_api_key', apiKey);
		alert('API Key Saved');
	};

	const btnRefresh = document.getElementById(DOM.btnRefresh);
	if (btnRefresh) btnRefresh.onclick = () => ui.refreshPreview();


	// --- 9. Boot Sequence ---
	console.log("MetaForge v2.4 (REAL+DI) Booting...");
	try {
		const lastId = await storage.getLastProjectId();
		if (lastId) {
			const project = await storage.getProject(lastId);
			if (project) {
				loadProjectData(project);
			} else {
				await createNewProject();
			}
		} else {
			await createNewProject();
		}
	} catch (e) {
		console.error("Boot Error:", e);
		vfs.loadFiles(Config.DEFAULT_FILES);
		ui.refreshPreview();
	}
});