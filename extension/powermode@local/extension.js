import GLib from 'gi://GLib';

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
 * 注意：只有这一个文件被缓存。改它本身仍需注销一次；改 impl.js 不用。
 */
export default class PowerModeExtension extends Extension {
    async enable() {
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

    disable() {
        try {
            this._impl?.disable();
        } catch (e) {
            console.error('[powermode] disable 出错: ' + e.message);
        }
        this._impl = null;
        this._mod = null;
    }
}
