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
	// Start with empty, will be populated by loadProject
	const vfs = new VirtualFileSystem({});
	const state = new WorldState(vfs);

	// --- 3. Initialize UI (View & Controllers) ---
	// Inject VFS and State here. UI components can now bind to them directly.
	const ui = new UIController(vfs, state, compiler);

	// --- 4. Initialize Tools ---
	const registry = new Registry();
	App.Tools.registerFSTools(registry, vfs);
	App.Tools.registerNavTools(registry, vfs);
	App.Tools.registerUITools(registry, ui);

	// --- 5. Initialize Engine (Logic) ---
	// LLM Init
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

		// VFS Restore
		// Replace content of existing VFS instance so bindings remain valid
		// Clear existing
		Object.keys(vfs.files).forEach(k => delete vfs.files[k]);
		// Set new
		Object.assign(vfs.files, project.files);
		vfs.notify();

		// History Restore
		// Replace history in state
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

	// Engine -> UI (Streaming)
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
			// System/User turns re-render
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

		// 1. 削除実行
		await storage.deleteProject(id);

		// 2. プロジェクトリスト更新
		const projects = await storage.getAllProjectsMetadata();
		ui.renderProjectList(projects);

		// 3. 開いていたプロジェクトを削除した場合の移動処理
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

	// New Project Button
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
		if (text) content.push({
			text
		});

		for (const file of files) {
			if (file.type.startsWith('text/') || file.name.match(/\.(js|py|html|json|css|md|txt)$/)) {
				const textContent = await file.text();
				content.push({
					text: `<user_attachment name="${file.name}">\n${textContent}\n</user_attachment>`
				});
			} else {
				const dataUrl = await fileToBase64(file);
				const base64 = dataUrl.split(',')[1];
				content.push({
					inlineData: {
						mimeType: file.type,
						data: base64
					}
				});
			}
		}

		engine.llm = createLLM(); // Refresh Key

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
		if (confirm("Clear chat history?")) {
			state.history = [];
			ui.chat.renderHistory([]);
			triggerAutoSave();
		}
	});

	// Download ZIP
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
		a.download = `${currentProjectName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.zip`;
		a.click();
	};

	// API Key Save
	const btnSaveKey = document.getElementById(DOM.btnSaveKey);
	if (btnSaveKey) btnSaveKey.onclick = () => {
		apiKey = document.getElementById(DOM.apiKey).value.trim();
		localStorage.setItem('metaforge_api_key', apiKey);
		alert('API Key Saved');
	};

	// Manual Refresh
	const btnRefresh = document.getElementById(DOM.btnRefresh);
	if (btnRefresh) btnRefresh.onclick = () => ui.refreshPreview();


	// --- 9. Boot Sequence ---
	console.log("MetaForge v2.3 (REAL+DI) Booting...");
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
		// Fallback
		Object.assign(vfs.files, Config.DEFAULT_FILES);
		vfs.notify();
		ui.refreshPreview();
	}
});