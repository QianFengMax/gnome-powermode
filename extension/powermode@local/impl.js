import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * 电源模式快捷键的实现体。
 *
 * 单独成文件是为了热重载：extension.js 是代理，每次 enable 都用带新 query
 * 的 URI 重新 import 这个文件，于是改代码只要 disable/enable 就生效，
 * 不用注销。详见 extension.js 里的说明。
 *
 * ## 外观
 *
 * 复用 shell 的 OsdWindowManager.showAll()，和亮度/音量条完全相同
 * （屏幕中下胶囊 + 图标 + 进度条）。进度条位置表示档位。
 */

const PPD_NAME = 'org.freedesktop.UPower.PowerProfiles';
const PPD_PATH = '/org/freedesktop/UPower/PowerProfiles';
const IFACE_PROPS = 'org.freedesktop.DBus.Properties';
const KEY = 'toggle-shortcut';

/** 档位元数据。顺序即进度条位置。 */
const META = {
    'power-saver': {
        icon: 'power-profile-power-saver-symbolic',
        label: '省电',
        color: '#2EC27E',
    },
    'balanced': {
        icon: 'power-profile-balanced-symbolic',
        label: '平衡',
        color: '#00B4D8',
    },
    'performance': {
        icon: 'power-profile-performance-symbolic',
        label: '性能',
        color: '#E01B24',
    },
};

const FALLBACK = ['power-saver', 'balanced', 'performance'];

export class Impl {
    constructor(ext) {
        this._ext = ext;
        this._settings = null;
        this._proxy = null;
        this._keyBound = false;
    }

    enable() {
        this._settings = this._ext.getSettings();

        this._proxy = new Gio.DBusProxy({
            g_connection: Gio.DBus.system,
            g_name: PPD_NAME,
            g_object_path: PPD_PATH,
            g_interface_name: PPD_NAME,
            g_flags: Gio.DBusProxyFlags.NONE,
        });
        this._proxy.init_async(GLib.PRIORITY_DEFAULT, null);

        this._bind();
    }

    disable() {
        this._unbind();
        this._proxy = null;
        this._settings = null;
    }

    _bind() {
        if (this._keyBound)
            return;
        // mutter 的键位表在整个 shell 生命周期内持久。重复 addKeybinding 只会
        // 打出 "Trying to re-add keybinding" 并被静默忽略，回调挂不上。
        // removeKeybinding 对未注册的键名是安全的。
        try {
            Main.wm.removeKeybinding(KEY);
        } catch {
            // 本来就没注册
        }
        try {
            Main.wm.addKeybinding(KEY, this._settings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.ALL,
                () => this._cycle());
            this._keyBound = true;
        } catch (e) {
            console.error('[powermode] 注册键位失败: ' + e.message);
        }
    }

    _unbind() {
        if (!this._keyBound)
            return;
        try {
            Main.wm.removeKeybinding(KEY);
        } catch (e) {
            console.error('[powermode] 摘除键位失败: ' + e.message);
        }
        this._keyBound = false;
    }

    /** 可用档位；服务未就绪时退回标准三档。 */
    _profiles() {
        try {
            const cached = this._proxy?.get_cached_property('Profiles');
            if (cached) {
                const list = [];
                for (const entry of cached.deep_unpack()) {
                    const p = entry?.['Profile'];
                    if (p)
                        list.push(typeof p === 'string' ? p : p.deep_unpack());
                }
                if (list.length)
                    return list;
            }
        } catch {
            // 属性还没加载
        }
        return FALLBACK;
    }

    _current() {
        try {
            return this._proxy?.get_cached_property('ActiveProfile')?.deep_unpack();
        } catch {
            return undefined;
        }
    }

    _cycle() {
        const list = this._profiles();
        const i = list.indexOf(this._current());
        const next = list[(i + 1) % list.length];

        Gio.DBus.system.call(
            PPD_NAME, PPD_PATH, IFACE_PROPS, 'Set',
            new GLib.Variant('(ssv)',
                [PPD_NAME, 'ActiveProfile', new GLib.Variant('s', next)]),
            null, Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                try {
                    conn.call_finish(res);
                } catch (e) {
                    logError(e, 'powermode: 切换电源模式失败');
                    return;
                }
                this._showOsd(next);
            });
    }

    /**
     * 用系统 OSD 显示档位，与亮度/音量同一组件。
     *
     * showAll(icon, label, level, maxLevel)：level/maxLevel 决定进度条填充，
     * 这里用档位序号/总档数。icon 必须是 Gio.Icon，传字符串在部分版本不认。
     */
    _showOsd(profile) {
        if (!this._settings?.get_boolean('show-notification'))
            return;

        const list = this._profiles();
        const meta = META[profile] ??
            {icon: 'power-profile-balanced-symbolic', label: profile, color: '#FFFFFF'};
        const idx = Math.max(0, list.indexOf(profile));

        Main.osdWindowManager.showAll(
            new Gio.ThemedIcon({name: meta.icon}),
            meta.label, idx + 1, list.length);

        // 必须放在 showAll 之后：它会先把 maximumValue 设成 list.length，
        // 而 overdriveStart 不允许超过 maximumValue，提前设会直接抛错。
        // 内联样式是挂在 actor 上的，放在后面照样对后续重算生效。
        this._prepareBars(meta.color, list.length, idx + 1);
    }

    /**
     * 给所有 OSD 进度条染色。
     *
     * BarLevel 是 St.DrawingArea，颜色不走普通 CSS 类，而是在
     * vfunc_style_changed() 里从主题节点读自定义属性：
     *
     *   -barlevel-background-color          轨道底色
     *   -barlevel-active-background-color   已填充段
     *   -barlevel-overdrive-color           过载段（value 超过 overdriveStart 时）
     *
     * 直接改实例字段 _barLevelActiveColor 不可靠：它会在样式重算时被
     * 从主题重新读回，而 style-changed 信号与默认 vfunc 的先后顺序不确定，
     * 结果就是同一个档位有时彩色、有时白色。
     *
     * 所以改走内联样式：把这两个自定义属性写进 actor 的 style，主题节点
     * 自己就带着颜色，任何一次重算读到的都是它，不存在竞争。
     *
     * 另外要把 overdriveStart 抬到最大值，否则 value > 1 时后半段走
     * overdrive 颜色，进度条会被切成两截。
     */
    _prepareBars(colorHex, maxLevel, targetValue) {
        const wins = Main.osdWindowManager?._osdWindows;
        if (!wins)
            return;

        const css = '-barlevel-active-background-color: ' + colorHex + '; ' +
                    '-barlevel-overdrive-color: ' + colorHex + ';';

        for (const win of wins) {
            const bar = win?._level;
            if (!bar)
                continue;
            try {
                // 颜色先挂上：set_style 不受 maximumValue 影响，任何时候都安全
                bar.set_style(css);

                // 校准填充量。
                // BarLevel 的 value setter 会用「当前」_maxValue 夹紧入参，
                // 而 setLevel() 在 OSD 可见时走 ease_property 动画，上一轮
                // 动画未结束就可能把值拉回旧档位，出现「性能档只填 2/3」。
                // 这里直接写死最终值：maxValue 已由 showAll 设好，再设一次
                // value 是即时生效的，动画只是加了过渡。
                if (targetValue != null && bar.maximumValue > 0) {
                    // 先掐掉可能还在跑的 ease_property 动画，它会持续把
                    // value 往回拉；不掐的话设了也会被覆盖。
                    try {
                        bar.remove_transition('value');
                    } catch {
                        // 没有进行中的过渡
                    }
                    if (bar.value !== targetValue)
                        bar.value = targetValue;
                }


                // overdrive 起点抬到满格，让整条填充段同色。
                // 它不允许超过 maximumValue（会抛错），所以先比一下；
                // 万一这时 maximumValue 还没被 showAll 设好，就下一帧再补。
                const apply = () => {
                    try {
                        if (maxLevel != null && maxLevel <= bar.maximumValue &&
                            bar.overdriveStart !== maxLevel)
                            bar.overdriveStart = maxLevel;
                    } catch {
                        // 值仍不合法就放弃这轮，颜色已经生效，只是可能分截
                    }
                };

                if (maxLevel != null && maxLevel > bar.maximumValue) {
                    // 等 showAll 把 maximumValue 设好再补
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        apply();
                        return GLib.SOURCE_REMOVE;
                    });
                } else {
                    apply();
                }
            } catch (e) {
                console.error('[powermode] 染色失败: ' + e.message);
            }
        }
    }
}
