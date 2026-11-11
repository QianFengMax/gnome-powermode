import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/** 只有一个录键位的地方和一个通知开关，没有多余设置。 */
export default class PowerModePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: '快捷键',
            description: 'GTK 加速器写法：F24、<Super>p、<Control><Alt>p',
        });
        page.add(group);

        const keyRow = new Adw.EntryRow({title: '切换电源模式'});
        keyRow.text = settings.get_strv('toggle-shortcut')[0] ?? '';
        keyRow.connect('changed', () => {
            const t = keyRow.text.trim();
            settings.set_strv('toggle-shortcut', t ? [t] : []);
        });
        group.add(keyRow);

        const behavior = new Adw.PreferencesGroup({title: '行为'});
        page.add(behavior);

        const notifyRow = new Adw.SwitchRow({title: '切换后显示通知'});
        // 用 GSettings 双向绑定，改完即时生效，不用自己处理信号
        settings.bind('show-notification', notifyRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        behavior.add(notifyRow);

        // ---- 调度守护进程 ----
        const daemonGroup = new Adw.PreferencesGroup({
            title: '性能调度守护进程',
            description: '接管 CPU 调频。启用后扩展切换档位会真实改变频率。',
        });
        page.add(daemonGroup);

        this._daemonRow = new Adw.ActionRow({
            title: '调度状态',
            subtitle: this._daemonStatus(),
        });
        const startBtn = new Gtk.Button({
            label: '启动',
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
        });
        startBtn.connect('clicked', () => this._daemonStart(startBtn));
        const stopBtn = new Gtk.Button({
            label: '停止',
            valign: Gtk.Align.CENTER,
        });
        stopBtn.connect('clicked', () => this._daemonStop(stopBtn));
        this._daemonRow.add_suffix(startBtn);
        this._daemonRow.add_suffix(stopBtn);
        daemonGroup.add(this._daemonRow);


        // ---- fast 名单 ----
        const fastGroup = new Adw.PreferencesGroup({
            title: 'Fast 名单',
            description: '名单里的进程一运行就自动进性能档，例如游戏。每行一条：<进程名> <档位>',
        });
        page.add(fastGroup);

        const listRow = new Adw.ActionRow({
            title: '名单内容',
            subtitle: this._fastListSummary(),
        });
        const editBtn = new Gtk.Button({
            label: '编辑',
            valign: Gtk.Align.CENTER,
        });
        editBtn.connect('clicked', () => this._editFastList(listRow));
        listRow.add_suffix(editBtn);
        fastGroup.add(listRow);

        const presetRow = new Adw.ActionRow({
            title: '游戏预设',
            subtitle: '一键加入常见游戏与兼容层的规则',
        });
        const presetBtn = new Gtk.Button({
            label: '写入',
            valign: Gtk.Align.CENTER,
        });
        presetBtn.connect('clicked', () => this._writePreset(listRow));
        presetRow.add_suffix(presetBtn);
        fastGroup.add(presetRow);

        const uperfRow = new Adw.SwitchRow({

            title: '同步 uperf 调频守护',
            subtitle: '系统装有 uperf-linux 时，切换档位同时调整它的模式（真正控制 CPU 频率）',
        });
        settings.bind('sync-uperf', uperfRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        behavior.add(uperfRow);

        const about = new Adw.PreferencesGroup();
        about.add(new Adw.ActionRow({
            title: '循环顺序',
            subtitle: '省电 → 平衡 → 性能 → 省电（按系统实际可用档位）',
        }));
        page.add(about);
    }
}
