// src/app/world/storage.js

(function(global) {
    global.App = global.App || {};
    global.App.World = global.App.World || {};

    class StorageManager {
        constructor(dbName = 'metaforge_alla_db', storeName = 'projects') {
            this.dbName = dbName;
            this.storeName = storeName;
            this.db = null;
            this.initPromise = this._initDB();
        }

        _initDB() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this.dbName, 1);

                request.onerror = (e) => {
                    console.error("IndexedDB error:", e.target.error);
                    reject(e.target.error);
                };

                request.onsuccess = (e) => {
                    this.db = e.target.result;
                    resolve(this.db);
                };

                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    // Projects Store
                    if (!db.objectStoreNames.contains(this.storeName)) {
                        const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                        store.createIndex('lastModified', 'lastModified', { unique: false });
                    }
                    // Global Settings Store
                    if (!db.objectStoreNames.contains('settings')) {
                        db.createObjectStore('settings');
                    }
                };
            });
        }

        async ready() {
            await this.initPromise;
        }

        // --- Settings (Last Project ID) ---

        async getLastProjectId() {
            await this.ready();
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction(['settings'], 'readonly');
                const req = tx.objectStore('settings').get('lastProjectId');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }

        async setLastProjectId(id) {
            await this.ready();
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction(['settings'], 'readwrite');
                const req = tx.objectStore('settings').put(id, 'lastProjectId');
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        }

        // --- Project CRUD ---

        /**
         * プロジェクト全体を保存
         * @param {string} id 
         * @param {string} name 
         * @param {Object} vfsFiles - VFS.files
         * @param {Object} stateSnapshot - WorldState.snapshot()
         */
        async saveProject(id, name, vfsFiles, stateSnapshot) {
            await this.ready();
            const project = {
                id: id,
                name: name,
                lastModified: Date.now(),
                files: vfsFiles,
                state: stateSnapshot
            };
            
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction([this.storeName], 'readwrite');
                const req = tx.objectStore(this.storeName).put(project);
                req.onsuccess = () => resolve(id);
                req.onerror = () => reject(req.error);
            });
        }

        async getProject(id) {
            await this.ready();
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction([this.storeName], 'readonly');
                const req = tx.objectStore(this.storeName).get(id);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }

        async getAllProjectsMetadata() {
            await this.ready();
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction([this.storeName], 'readonly');
                const store = tx.objectStore(this.storeName);
                const req = store.openCursor();
                const projects = [];

                req.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        const { id, name, lastModified } = cursor.value;
                        projects.push({ id, name, lastModified });
                        cursor.continue();
                    } else {
                        projects.sort((a, b) => b.lastModified - a.lastModified);
                        resolve(projects);
                    }
                };
                req.onerror = () => reject(req.error);
            });
        }

        async deleteProject(id) {
            await this.ready();
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction([this.storeName], 'readwrite');
                const req = tx.objectStore(this.storeName).delete(id);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        }
    }

    global.App.World.StorageManager = StorageManager;

})(window);