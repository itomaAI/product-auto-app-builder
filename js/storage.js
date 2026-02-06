// js/storage.js

class StorageManager {
    constructor(dbName = 'metaforge_db', storeName = 'projects') {
        this.dbName = dbName;
        this.storeName = storeName;
        this.db = null;
        this.initPromise = this._initDB();
    }

    _initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onerror = (event) => {
                console.error("IndexedDB error:", event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                // Store for projects: keyPath is 'id'
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                    store.createIndex('lastModified', 'lastModified', { unique: false });
                }
                // Store for global settings (e.g. lastProjectId)
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
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['settings'], 'readonly');
            const store = transaction.objectStore('settings');
            const request = store.get('lastProjectId');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async setLastProjectId(id) {
        await this.ready();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['settings'], 'readwrite');
            const store = transaction.objectStore('settings');
            const request = store.put(id, 'lastProjectId');
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // --- Projects ---

    async saveProject(project) {
        // project: { id, name, lastModified, files: {...}, chatHistory: [...] }
        await this.ready();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(project);
            request.onsuccess = () => resolve(project.id);
            request.onerror = () => reject(request.error);
        });
    }

    async getProject(id) {
        await this.ready();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAllProjectsMetadata() {
        await this.ready();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.openCursor();
            const projects = [];

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    // Extract only metadata to save memory in list view
                    const { id, name, lastModified } = cursor.value;
                    projects.push({ id, name, lastModified });
                    cursor.continue();
                } else {
                    // Sort by lastModified desc
                    projects.sort((a, b) => b.lastModified - a.lastModified);
                    resolve(projects);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    async deleteProject(id) {
        await this.ready();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}