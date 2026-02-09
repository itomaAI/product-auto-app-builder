// src/app/ui/tree_view.js

(function(global) {
	global.App = global.App || {};
	global.App.UI = global.App.UI || {};

	class TreeView {
		constructor(containerId, contextMenuId) {
			this.container = document.getElementById(containerId);
			this.contextMenu = document.getElementById(contextMenuId);
			this.events = {};
			this.expandedPaths = new Set();
			this.selectedPath = null;

			this._initGlobalEvents();
		}

		on(event, callback) {
			this.events[event] = callback;
		}

		render(treeData) {
			if (!this.container) return;
			this.container.innerHTML = '';
			const rootUl = document.createElement('ul');
			rootUl.className = 'tree-root text-sm font-mono text-gray-300';
			this._buildTree(rootUl, treeData, 0);
			this.container.appendChild(rootUl);
		}

		_buildTree(parentElement, nodes, indentLevel) {
			nodes.forEach(node => {
				const li = document.createElement('li');
				li.className = 'tree-node select-none';

				const div = document.createElement('div');
				div.className = `tree-content hover:bg-gray-700 cursor-pointer flex items-center py-0.5 px-2 border-l-2 border-transparent transition ${this.selectedPath === node.path ? 'bg-gray-700 border-blue-500' : ''}`;
				div.style.paddingLeft = `${indentLevel * 12 + 8}px`;
				div.dataset.path = node.path;
				div.dataset.type = node.type;

				const icon = node.type === 'folder' ?
					(this.expandedPaths.has(node.path) ? '📂' : '📁') :
					this._getFileIcon(node.name);

				div.innerHTML = `<span class="mr-2 opacity-80 text-xs">${icon}</span><span class="truncate">${node.name}</span>`;
				div.onclick = (e) => this._handleClick(e, node);
				div.oncontextmenu = (e) => this._handleContextMenu(e, node);

				li.appendChild(div);

				if (node.type === 'folder' && node.children) {
					const childUl = document.createElement('ul');
					childUl.className = `tree-children ${this.expandedPaths.has(node.path) ? 'block' : 'hidden'}`;
					this._buildTree(childUl, node.children, indentLevel + 1);
					li.appendChild(childUl);
				}
				parentElement.appendChild(li);
			});
		}

		_getFileIcon(filename) {
			if (filename.endsWith('.js')) return '📜';
			if (filename.endsWith('.html')) return '🌐';
			if (filename.endsWith('.css')) return '🎨';
			if (filename.endsWith('.json')) return '🔧';
			if (filename.match(/\.(png|jpg|jpeg|svg|gif|webp|ico)$/i)) return '🖼️';
			return '📄';
		}

		_handleClick(e, node) {
			e.stopPropagation();
			this.selectedPath = node.path;
			const allNodes = this.container.querySelectorAll('.tree-content');
			allNodes.forEach(el => {
				el.classList.remove('bg-gray-700', 'border-blue-500');
				if (el.dataset.path === node.path) el.classList.add('bg-gray-700', 'border-blue-500');
			});

			if (node.type === 'folder') {
				if (this.expandedPaths.has(node.path)) this.expandedPaths.delete(node.path);
				else this.expandedPaths.add(node.path);

				const li = e.currentTarget.parentElement;
				const ul = li.querySelector('ul');
				if (ul) {
					ul.classList.toggle('hidden');
					const iconSpan = e.currentTarget.querySelector('span:first-child');
					iconSpan.textContent = this.expandedPaths.has(node.path) ? '📂' : '📁';
				}
			} else {
				if (this.events['open']) this.events['open'](node.path);
			}
		}

		_handleContextMenu(e, node) {
			e.preventDefault();
			this.selectedPath = node.path;
			this._showContextMenu(e.pageX, e.pageY, node);
		}

		_showContextMenu(x, y, node) {
			if (!this.contextMenu) return;

			// 1. メニュー項目を構築
			this.contextMenu.innerHTML = '';
			const actions = [];

			if (node.type === 'folder') {
				actions.push({
					label: 'New File',
					action: () => this._promptCreate(node.path, 'file')
				});
				actions.push({
					label: 'New Folder',
					action: () => this._promptCreate(node.path, 'folder')
				});
				actions.push({
					label: 'Upload Here',
					action: () => {
						if (this.events['upload_request']) this.events['upload_request'](node.path);
					}
				});
				actions.push({
					separator: true
				});
			}

			// Copy/Duplicate
			actions.push({
				label: 'Duplicate',
				action: () => {
					if (this.events['duplicate']) this.events['duplicate'](node.path);
				}
			});

			actions.push({
				label: 'Rename (Move)',
				action: () => this._promptRename(node)
			});
			actions.push({
				label: 'Delete',
				action: () => this._confirmDelete(node),
				danger: true
			});

			actions.forEach(item => {
				if (item.separator) {
					const hr = document.createElement('hr');
					hr.className = "border-gray-600 my-1";
					this.contextMenu.appendChild(hr);
					return;
				}
				const btn = document.createElement('div');
				btn.className = `px-3 py-1 hover:bg-blue-600 cursor-pointer text-xs ${item.danger ? 'text-red-400 hover:text-white' : 'text-gray-200'}`;
				btn.textContent = item.label;
				btn.onclick = () => {
					this.contextMenu.classList.add('hidden');
					item.action();
				};
				this.contextMenu.appendChild(btn);
			});

			// 2. 表示してサイズを取得（位置計算のため）
			this.contextMenu.classList.remove('hidden');
			const rect = this.contextMenu.getBoundingClientRect();
			const winWidth = window.innerWidth;
			const winHeight = window.innerHeight;

			// 3. 画面からはみ出さないように補正
			let posX = x;
			let posY = y;

			// 右にはみ出るなら左側に表示
			if (posX + rect.width > winWidth) {
				posX = winWidth - rect.width - 5;
			}
			// 下にはみ出るなら上側に表示
			if (posY + rect.height > winHeight) {
				posY = winHeight - rect.height - 5;
			}

			this.contextMenu.style.left = `${posX}px`;
			this.contextMenu.style.top = `${posY}px`;
		}

		_initGlobalEvents() {
			document.addEventListener('click', (e) => {
				if (this.contextMenu && !this.contextMenu.contains(e.target)) {
					this.contextMenu.classList.add('hidden');
				}
			});
			if (this.container) {
				this.container.addEventListener('contextmenu', (e) => {
					if (e.target === this.container || e.target.classList.contains('tree-root')) {
						e.preventDefault();
						this._showContextMenu(e.pageX, e.pageY, {
							type: 'folder',
							path: '',
							name: 'root'
						});
					}
				});
			}
		}

		_promptCreate(parentPath, type) {
			const name = prompt(`Enter new ${type} name:`);
			if (!name) return;
			let fullPath = parentPath ? `${parentPath}/${name}` : name;
			fullPath = fullPath.replace(/^\/+/, '');

			if (type === 'folder' && this.events['create_folder']) {
				this.events['create_folder'](fullPath);
				if (parentPath) this.expandedPaths.add(parentPath);
			}
			if (type === 'file' && this.events['create_file']) {
				this.events['create_file'](fullPath);
				if (parentPath) this.expandedPaths.add(parentPath);
			}
		}

		_promptRename(node) {
			const newPath = prompt(`Edit path to rename/move:`, node.path);
			if (!newPath || newPath === node.path) return;
			if (this.events['rename']) this.events['rename'](node.path, newPath);
		}

		_confirmDelete(node) {
			if (confirm(`Delete ${node.name}?`)) {
				if (this.events['delete']) this.events['delete'](node.path);
			}
		}
	}

	global.App.UI.TreeView = TreeView;

})(window);