// src/app/adapters/storage.js

(function(global) {
	global.App = global.App || {};
	global.App.Adapters = global.App.Adapters || {};

	class StorageAdapter {
		constructor(dbName = 'metaforge_real_db', storeName = 'projects') {
			this.dbName = dbName;
			this.storeName = storeName;
			this.db = null;
			this.initPromise = this._initDB();
		}

		_initDB() {
			return new Promise((resolve, reject) => {
				const request = indexedDB.open(this.dbName, 1);
				request.onerror = (e) => reject(e.target.error);
				request.onsuccess = (e) => {
					this.db = e.target.result;
					resolve(this.db);
				};
				request.onupgradeneeded = (e) => {
					const db = e.target.result;
					if (!db.objectStoreNames.contains(this.storeName)) {
						const store = db.createObjectStore(this.storeName, {
							keyPath: 'id'
						});
						store.createIndex('lastModified', 'lastModified', {
							unique: false
						});
					}
					if (!db.objectStoreNames.contains('settings')) {
						db.createObjectStore('settings');
					}
				};
			});
		}

		async ready() {
			await this.initPromise;
		}

		// --- Settings (Global) ---

		async getLastProjectId() {
			await this.ready();
			return new Promise((resolve) => {
				const tx = this.db.transaction(['settings'], 'readonly');
				const req = tx.objectStore('settings').get('lastProjectId');
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => resolve(null);
			});
		}

		async setLastProjectId(id) {
			await this.ready();
			const tx = this.db.transaction(['settings'], 'readwrite');
			tx.objectStore('settings').put(id, 'lastProjectId');
		}

		// --- Projects ---

		/**
		 * 世界の状態を丸ごと保存する
		 * @param {string} id Project ID
		 * @param {string} name Project Name
		 * @param {Object} vfsData VFS.files
		 * @param {Array} history WorldState.history
		 */
		async saveProject(id, name, vfsData, history) {
			await this.ready();
			const project = {
				id: id,
				name: name,
				lastModified: Date.now(),
				files: vfsData,
				chatHistory: history // REALのhistory構造をそのまま保存
			};

			return new Promise((resolve, reject) => {
				const tx = this.db.transaction([this.storeName], 'readwrite');
				const req = tx.objectStore(this.storeName).put(project);
				req.onsuccess = () => resolve(id);
				req.onerror = (e) => reject(e.target.error);
			});
		}

		async getProject(id) {
			await this.ready();
			return new Promise((resolve, reject) => {
				const tx = this.db.transaction([this.storeName], 'readonly');
				const req = tx.objectStore(this.storeName).get(id);
				req.onsuccess = () => resolve(req.result);
				req.onerror = (e) => reject(e.target.error);
			});
		}

		async getAllProjectsMetadata() {
			await this.ready();
			return new Promise((resolve) => {
				const tx = this.db.transaction([this.storeName], 'readonly');
				const store = tx.objectStore(this.storeName);
				const req = store.openCursor();
				const projects = [];

				req.onsuccess = (e) => {
					const cursor = e.target.result;
					if (cursor) {
						const {
							id,
							name,
							lastModified
						} = cursor.value;
						projects.push({
							id,
							name,
							lastModified
						});
						cursor.continue();
					} else {
						projects.sort((a, b) => b.lastModified - a.lastModified);
						resolve(projects);
					}
				};
			});
		}

		async deleteProject(id) {
			await this.ready();
			const tx = this.db.transaction([this.storeName], 'readwrite');
			tx.objectStore(this.storeName).delete(id);
		}
	}

	global.App.Adapters.StorageAdapter = StorageAdapter;

})(window);