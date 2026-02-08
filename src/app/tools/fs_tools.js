// src/app/tools/fs_tools.js

(function(global) {
    global.App = global.App || {};
    global.App.Tools = global.App.Tools || {};

    global.App.Tools.registerFSTools = function(registry, vfs) {
        
        // --- read_file ---
        registry.register('read_file', async (params, state) => {
            // 画像判定
            const isImage = params.path.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i);
            const content = vfs.readFile(params.path);

            if (isImage) {
                // 画像の場合はBase64データとして返す
                // contentが "data:image/png;base64,..." 形式の場合と、生テキスト(SVG)の場合がある
                let base64 = content;
                let mimeType = 'image/png'; // デフォルト

                if (content.startsWith('data:')) {
                    const parts = content.split(',');
                    const meta = parts[0]; // data:image/png;base64
                    base64 = parts[1];
                    const match = meta.match(/:(.*?);/);
                    if (match) mimeType = match[1];
                } else if (params.path.endsWith('.svg')) {
                    // SVGはテキストとして読んだほうがいいかもしれないが、
                    // ここでは画像として扱うリクエストなのでBase64化する
                    base64 = btoa(unescape(encodeURIComponent(content)));
                    mimeType = 'image/svg+xml';
                }

                return {
                    log: `[read_file] Read image file: ${params.path}`,
                    ui: `🖼️ Read Image ${params.path}`,
                    image: base64, // Projectorが拾う
                    mimeType: mimeType
                };
            }

            // テキストの場合
            const lines = content.split(/\r?\n/);
            const showNum = params.line_numbers !== 'false';
            const s = parseInt(params.start || 1);
            const e = parseInt(params.end || 999999);
            
            const sliced = lines.slice(Math.max(0, s - 1), Math.min(lines.length, e));
            const contentStr = showNum 
                ? sliced.map((l, i) => `${s + i} | ${l}`).join('\n')
                : sliced.join('\n');

            return {
                log: `[read_file] ${params.path}:\n${contentStr}`,
                ui: `📖 Read ${params.path} (${sliced.length} lines)`
            };
        });

        // --- create_file ---
        registry.register('create_file', async (params, state) => {
            const msg = vfs.writeFile(params.path, params.content);
            return {
                log: `[create_file] ${msg}`,
                ui: `📝 Created ${params.path}`
            };
        });

        // --- edit_file ---
        registry.register('edit_file', async (params, state) => {
            const msg = vfs.editLines(
                params.path, params.start, params.end, params.mode, params.content
            );
            return {
                log: `[edit_file] ${msg}`,
                ui: `✏️ ${msg}`
            };
        });
    };

})(window);