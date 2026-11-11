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

        const about = new Adw.PreferencesGroup();
        about.add(new Adw.ActionRow({
            title: '循环顺序',
            subtitle: '省电 → 平衡 → 性能 → 省电（按系统实际可用档位）',
        }));
        page.add(about);
    }
}
