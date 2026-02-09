// src/app/ui/media_viewer.js

(function(global) {
	global.App = global.App || {};
	global.App.UI = global.App.UI || {};

	const DOM = global.App.UI.DOM;

	class MediaViewer {
		constructor() {
			this.els = {};
			this._initElements();
			this._bindEvents();
		}

		_initElements() {
			['mediaOverlay', 'mediaImage', 'btnCloseMedia', 'mediaFilename']
			.forEach(key => {
				const id = DOM[key];
				if (id) this.els[key] = document.getElementById(id);
			});
		}

		_bindEvents() {
			if (this.els.btnCloseMedia) {
				this.els.btnCloseMedia.onclick = () => this.close();
			}
			if (this.els.mediaOverlay) {
				// Click outside to close
				this.els.mediaOverlay.onclick = (e) => {
					if (e.target === this.els.mediaOverlay) this.close();
				};
			}
		}

		open(path, base64) {
			if (this.els.mediaFilename) this.els.mediaFilename.textContent = path;

			// Handle Data URL or plain Base64
			let src = base64;
			if (!base64.startsWith('data:')) {
				// Determine mime type roughly
				let mime = 'image/png';
				if (path.endsWith('.svg')) mime = 'image/svg+xml';
				else if (path.endsWith('.jpg') || path.endsWith('.jpeg')) mime = 'image/jpeg';
				else if (path.endsWith('.gif')) mime = 'image/gif';
				src = `data:${mime};base64,${base64}`;
			}

			if (this.els.mediaImage) {
				this.els.mediaImage.src = src;
			}

			if (this.els.mediaOverlay) {
				this.els.mediaOverlay.classList.remove('hidden');
			}
		}

		close() {
			if (this.els.mediaOverlay) {
				this.els.mediaOverlay.classList.add('hidden');
			}
			if (this.els.mediaImage) {
				this.els.mediaImage.src = '';
			}
		}
	}

	global.App.UI.MediaViewer = MediaViewer;

})(window);