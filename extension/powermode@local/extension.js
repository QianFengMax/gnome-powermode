import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

/**
 * 重载代理。
 *
 * GNOME Shell 用 await import(extensionJs.get_uri()) 加载扩展，ESM 按 URI 缓存，
 * 所以 disable/enable 只会重跑 enable()、不会重新读文件——改代码必须注销。
 *
 * 这里每次 enable 都用带新 query 的 URI 动态加载 impl.js。GJS 支持这种写法
 * （生成独立模块实例、读到最新内容，父模块的静态子导入也一并刷新），
 * 于是「改代码 -> disable -> enable」即可生效。
 *
 * ## 自动重载
 *
 * 监视扩展目录：impl.js 或 schemas/gschemas.compiled 一变就自己重载，
 * 连 disable/enable 都不用手动敲。防抖 300ms，避免保存时多次触发。
 *
 * 注意：只有 extension.js 本身被缓存，改它仍需注销一次。
 */
export default class PowerModeExtension extends Extension {
    async enable() {
        this._reloadId = 0;
        this._monitor = null;
        this._monitorId = 0;

        await this._loadImpl();
        this._watch();
    }

    disable() {
        this._unwatch();
        try {
            this._impl?.disable();
        } catch (e) {
            console.error('[powermode] disable 出错: ' + e.message);
        }
        this._impl = null;
        this._mod = null;
    }

    /** 用带新 query 的 URI 加载实现；query 变了才绕过 ESM 缓存。 */
    async _loadImpl() {
        const uri = this.dir.get_uri() + '/impl.js?t=' + GLib.get_monotonic_time();
        let mod;
        try {
            mod = await import(uri);
        } catch (e) {
            console.error('[powermode] 加载 impl.js 失败: ' + e.message);
            throw new Error('加载 impl.js 失败: ' + e.message);
        }
        if (typeof mod.Impl !== 'function')
            throw new Error('impl.js 没有导出 Impl');

        this._mod = mod;
        this._impl = new mod.Impl(this);
        await this._impl.enable();
    }

    /**
     * 监视扩展目录。
     *
     * 监视目录而不是文件：编辑器和工具常用原子重命名保存，
     * 文件监视在替换后会失去目标，之后就收不到通知了。
     */
    _watch() {
        this._unwatch();
        try {
            const dir = Gio.File.new_for_path(this.dir.get_path());
            this._monitor = dir.monitor_directory(
                Gio.FileMonitorFlags.WATCH_MOVES, null);
            this._monitorId = this._monitor.connect('changed', (_m, file) => {
                if (!file)
                    return;
                const base = file.get_basename();
                const parent = file.get_parent()?.get_basename() ?? '';
                // impl.js 改动，或 schemas 下的编译产物更新
                if (base === 'impl.js' ||
                    (parent === 'schemas' && base === 'gschemas.compiled'))
                    this._queueReload();
            });
        } catch (e) {
            console.error('[powermode] 监视失败: ' + e.message);
        }
    }

    _unwatch() {
        if (this._reloadId) {
            GLib.source_remove(this._reloadId);
            this._reloadId = 0;
        }
        if (this._monitor) {
            if (this._monitorId) {
                this._monitor.disconnect(this._monitorId);
                this._monitorId = 0;
            }
            this._monitor.cancel();
            this._monitor = null;
        }
    }

    /** 防抖：编辑器保存时可能连发几个事件。 */
    _queueReload() {
        if (this._reloadId)
            GLib.source_remove(this._reloadId);
        this._reloadId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._reloadId = 0;
            this._reload().catch(e =>
                console.error('[powermode] 重载失败: ' + e.message));
            return GLib.SOURCE_REMOVE;
        });
    }

    async _reload() {
        const old = this._impl;
        this._impl = null;
        this._mod = null;
        try {
            await old?.disable();
        } catch (e) {
            console.error('[powermode] 旧实例停止失败: ' + e.message);
        }
        await this._loadImpl();
        console.log('[powermode] 已热重载');
    }
}
