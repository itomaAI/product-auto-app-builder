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

			// ドラッグ中の情報
			this.dragSrcPath = null;

			this._initGlobalEvents();
			this._initRootDropZone(); // ルートへのドロップ対応
		}

		on(event, callback) {
			this.events[event] = callback;
		}

		render(treeData) {
			if (!this.container) return;
			// コンテナ自体のスタイル（ルートドロップ用）をリセット
			this.container.classList.remove('bg-gray-700', 'border-2', 'border-dashed', 'border-blue-500');
			// ★ 他のスタイルも念のためリセット
			this.container.classList.remove('bg-gray-800', 'ring-2', 'ring-blue-500', 'ring-inset');

			this.container.innerHTML = '';
			// コンテナ全体をルートドロップ領域として機能させるため高さを確保
			const rootUl = document.createElement('ul');
			rootUl.className = 'tree-root text-sm font-mono text-gray-300 min-h-full pb-4';
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

				// --- Drag & Drop Events ---
				div.draggable = true;
				div.addEventListener('dragstart', (e) => this._handleDragStart(e, node));

				// フォルダのみドロップ対象にする
				if (node.type === 'folder') {
					div.addEventListener('dragover', (e) => this._handleDragOver(e, div));
					div.addEventListener('dragleave', (e) => this._handleDragLeave(e, div));
					div.addEventListener('drop', (e) => this._handleDrop(e, node, div));
				}

				const icon = node.type === 'folder' ?
					(this.expandedPaths.has(node.path) ? '📂' : '📁') :
					this._getFileIcon(node.name);

				div.innerHTML = `<span class="mr-2 opacity-80 text-xs pointer-events-none">${icon}</span><span class="truncate pointer-events-none">${node.name}</span>`;
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

		// --- Drag & Drop Handlers ---

		_handleDragStart(e, node) {
			e.stopPropagation();
			this.dragSrcPath = node.path;
			e.dataTransfer.effectAllowed = 'move';
			// アプリ内移動用のデータ
			e.dataTransfer.setData('application/json', JSON.stringify({
				path: node.path,
				type: node.type
			}));
			e.target.style.opacity = '0.5';
		}

		_handleDragOver(e, element) {
			// 内部移動の場合のみハンドリングする
			if (e.dataTransfer.types.includes('application/json')) {
				e.preventDefault(); // ドロップ許可
				e.stopPropagation();
				e.dataTransfer.dropEffect = 'move';
				element.classList.add('bg-blue-900', 'text-white'); // ハイライト
			}
			// 外部ファイルの場合は何もしない（親へ任せる）
		}

		_handleDragLeave(e, element) {
			// 内部移動の場合のみハンドリングする
			if (e.dataTransfer.types.includes('application/json')) {
				e.preventDefault();
				e.stopPropagation();
				element.classList.remove('bg-blue-900', 'text-white');
			}
		}

		_handleDrop(e, targetNode, element) {
			element.classList.remove('bg-blue-900', 'text-white');

			// 内部移動の場合のみ処理し、止める
			if (e.dataTransfer.types.includes('application/json')) {
				e.preventDefault();
				e.stopPropagation();

				// JSONデータがない場合は無視
				const rawData = e.dataTransfer.getData('application/json');
				if (!rawData) return;

				const data = JSON.parse(rawData);
				const srcPath = data.path;
				const destFolder = targetNode.path;

				this._emitMove(srcPath, destFolder);
			}
			// 外部ファイルの場合はスルーする（親へバブリングさせる）
		}

		_initRootDropZone() {
			if (!this.container) return;

			this.container.addEventListener('dragover', (e) => {
				// 内部移動の場合のみ独自スタイルを適用して止める
				if (e.dataTransfer.types.includes('application/json')) {
					e.preventDefault();
					e.stopPropagation(); // 親(Sidebar)へのバブリングを防止
					e.dataTransfer.dropEffect = 'move'; // 親のcopyを上書き

					// フォルダノード上のイベントは stopPropagation されているため、
					// ここに到達するイベント＝「ファイルの上」または「余白」＝「ルートへのドロップ」とみなす
					this.container.classList.add('bg-gray-800', 'ring-2', 'ring-blue-500', 'ring-inset');
				}
				// 外部ファイルの場合は何もしない
			});

			this.container.addEventListener('dragleave', (e) => {
				// 内部移動の場合のみハンドリング
				if (e.dataTransfer.types.includes('application/json')) {
					e.preventDefault();
					e.stopPropagation(); // 親へのバブリング防止

					// 子要素（ファイルノードなど）に入っただけなら解除しない
					if (!this.container.contains(e.relatedTarget)) {
						this.container.classList.remove('bg-gray-800', 'ring-2', 'ring-blue-500', 'ring-inset');
					}
				}
			});

			this.container.addEventListener('drop', (e) => {
				// 内部移動の場合のみ処理
				if (e.dataTransfer.types.includes('application/json')) {
					e.preventDefault();
					e.stopPropagation(); // 親(Sidebar)のアップロード処理発動を防止

					this.container.classList.remove('bg-gray-800', 'ring-2', 'ring-blue-500', 'ring-inset');

					const rawData = e.dataTransfer.getData('application/json');
					if (!rawData) return;

					const data = JSON.parse(rawData);
					// ルートへ移動
					this._emitMove(data.path, "");
				}
				// 外部ファイルの場合は何もせず親(Sidebar)へイベントを流す
			});

			// ドラッグ終了時にスタイルを戻す (これはdocument全体なのでそのまま)
			document.addEventListener('dragend', (e) => {
				if (e.target && e.target.classList && e.target.classList.contains('tree-content')) {
					e.target.style.opacity = '1';
				}
				// 安全策：強制的にリセット
				if (this.container) {
					this.container.classList.remove('bg-gray-800', 'ring-2', 'ring-blue-500', 'ring-inset');
				}
			});
		}

		_emitMove(srcPath, destFolder) {
			const fileName = srcPath.split('/').pop();
			const newPath = destFolder ? `${destFolder}/${fileName}` : fileName;

			if (srcPath === newPath) return;
			const currentDir = srcPath.substring(0, srcPath.lastIndexOf('/'));
			if (currentDir === destFolder) return;

			// 同じ場所への移動は無視
			if (destFolder === srcPath) return;

			// 親フォルダを自分のサブフォルダに移動しようとしていないかチェック
			if (destFolder.startsWith(srcPath + '/')) {
				alert("Cannot move a folder into its own subfolder.");
				return;
			}

			if (this.events['move']) {
				this.events['move'](srcPath, newPath);
			}
		}

		_getFileIcon(filename) {
			if (filename.endsWith('.js')) return '📜';
			if (filename.endsWith('.html')) return '🌐';
			if (filename.endsWith('.css')) return '🎨';
			if (filename.endsWith('.json')) return '🔧';
			if (filename.match(/\.(png|jpg|jpeg|svg|gif|webp|ico)$/i)) return '🖼️';
			if (filename.endsWith('.pdf')) return '📕';
			if (filename.endsWith('.zip')) return '📦';
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

			// Download
			actions.push({
				label: 'Download',
				action: () => {
					if (this.events['download']) this.events['download'](node.path);
				}
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

			this.contextMenu.classList.remove('hidden');
			const rect = this.contextMenu.getBoundingClientRect();
			const winWidth = window.innerWidth;
			const winHeight = window.innerHeight;

			let posX = x;
			let posY = y;

			if (posX + rect.width > winWidth) {
				posX = winWidth - rect.width - 5;
			}
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