// js/compiler.js

class Compiler {
    constructor(vfs) {
        this.vfs = vfs;
        this.blobUrls = [];
    }

    async compile() {
        this.revokeAll();

        const filePaths = this.vfs.listFiles();
        const urlMap = {};

        // 1. Assets
        for (const path of filePaths) {
            if (path.endsWith('.html')) continue;
            if (path.startsWith('.sample/')) continue; 

            const content = this.vfs.readFile(path);
            const mimeType = this.getMimeType(path);
            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);
            urlMap[path] = url;
            this.blobUrls.push(url);
        }

        // 2. HTML
        let entryPointUrl = null;

        for (const path of filePaths) {
            if (!path.endsWith('.html')) continue;
            if (path.startsWith('.sample/')) continue;

            let htmlContent = this.vfs.readFile(path);
            htmlContent = this.processHtmlReferences(htmlContent, urlMap);

            // INJECT SCREENSHOT HELPER
            htmlContent = this.injectScreenshotHelper(htmlContent);

            const blob = new Blob([htmlContent], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            
            urlMap[path] = url;
            this.blobUrls.push(url);

            if (path === 'index.html') {
                entryPointUrl = url;
            }
        }

        if (!entryPointUrl && filePaths.length > 0) {
             const firstHtml = filePaths.find(p => p.endsWith('.html') && !p.startsWith('.sample/'));
             if (firstHtml) entryPointUrl = urlMap[firstHtml];
        }

        return entryPointUrl;
    }

    processHtmlReferences(html, urlMap) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const replaceAttr = (selector, attr) => {
            doc.querySelectorAll(selector).forEach(el => {
                const val = el.getAttribute(attr);
                if (urlMap[val]) el.setAttribute(attr, urlMap[val]);
            });
        };

        replaceAttr('script[src]', 'src');
        replaceAttr('link[href]', 'href');
        replaceAttr('img[src]', 'src');
        replaceAttr('a[href]', 'href');

        return doc.documentElement.outerHTML;
    }

    // Injects html2canvas and the listener for 'CAPTURE' message
    injectScreenshotHelper(html) {
        const script = `
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<script>
window.addEventListener('message', async (e) => {
    if (e.data.action === 'CAPTURE') {
        try {
            // Wait for html2canvas to load if it hasn't yet (up to 2 seconds)
            let attempts = 0;
            while (typeof html2canvas === 'undefined' && attempts < 20) {
                await new Promise(r => setTimeout(r, 100));
                attempts++;
            }

            if (typeof html2canvas === 'undefined') throw new Error('html2canvas failed to load');
            
            const canvas = await html2canvas(document.body, { 
                useCORS: true, 
                logging: false,
                allowTaint: true,
                backgroundColor: null 
            });
            const data = canvas.toDataURL('image/png');
            parent.postMessage({ type: 'SCREENSHOT_RESULT', data }, '*');
        } catch (err) {
            parent.postMessage({ type: 'SCREENSHOT_ERROR', message: err.message }, '*');
        }
    }
});
</script>
        `;
        // Insert before </body>
        if (html.includes('</body>')) {
            return html.replace('</body>', `${script}</body>`);
        } else {
            return html + script;
        }
    }

    getMimeType(filename) {
        if (filename.endsWith('.js')) return 'application/javascript';
        if (filename.endsWith('.css')) return 'text/css';
        if (filename.endsWith('.json')) return 'application/json';
        if (filename.endsWith('.svg')) return 'image/svg+xml';
        if (filename.endsWith('.png')) return 'image/png';
        if (filename.endsWith('.html')) return 'text/html';
        return 'text/plain';
    }

    revokeAll() {
        this.blobUrls.forEach(url => URL.revokeObjectURL(url));
        this.blobUrls = [];
    }
}