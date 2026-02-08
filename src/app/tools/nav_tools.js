// src/app/tools/nav_tools.js

(function(global) {
    global.App = global.App || {};
    global.App.Tools = global.App.Tools || {};

    global.App.Tools.registerNavTools = function(registry, vfs) {

        registry.register('list_files', async (params, state) => {
            const files = vfs.listFiles();
            // .sample ディレクトリなどは除外するか、あるいは隠しファイルとして扱うか
            // LLMには全容を見せるためそのまま返す
            return {
                log: `[list_files] ${files.join(', ')}`,
                ui: `📂 Listed ${files.length} files`
            };
        });

        registry.register('delete_file', async (params, state) => {
            const msg = vfs.deleteFile(params.path);
            return {
                log: `[delete_file] ${msg}`,
                ui: `🗑️ ${msg}`
            };
        });

        registry.register('move_file', async (params, state) => {
            try {
                const msg = vfs.moveFile(params.path, params.new_path);
                return {
                    log: `[move_file] ${msg}`,
                    ui: `🚚 ${msg}`
                };
            } catch (e) {
                throw new Error(e.message);
            }
        });

    };

})(window);