# Power Mode Shortcut · 电源模式快捷键

一个快捷键，在系统电源模式之间循环。用系统 OSD 显示，和亮度/音量条是同款。

只为 GNOME Shell 做一件事：把某个键绑到「切换电源模式」。

## 外观

按一下，屏幕中下方弹出和亮度/音量相同的胶囊，进度条按档位染色：

| 档位 | 颜色 |
|---|---|
| 省电 power-saver | 绿 `#2EC27E` |
| 平衡 balanced | 水蓝 `#00B4D8` |
| 性能 performance | 红 `#E01B24` |

图标保持系统配色，轨道底色保持主题默认。

## 兼容性

走标准 D-Bus 接口 `org.freedesktop.UPower.PowerProfiles`，所以两种后端都能用：

- **power-profiles-daemon**（GNOME 默认）
- **tlp-pd**（TLP 1.7+）

可用档位也是运行时从接口读的，不写死——系统有几档就循环几档。

## 安装

```bash
./scripts/install.sh
```

Wayland 下新扩展需要**注销重登一次**才会被 shell 扫描到。之后改代码只要
`disable` + `enable`，不用再注销（`extension.js` 是重载代理，实现在
`impl.js`，每次启用都带新 query 重新 import）。

## 改键位

图形界面：扩展应用 → Power Mode Shortcut → 设置

命令行（GTK 加速器写法）：

```bash
# 扩展自带的 schema 不在系统目录，命令行要指过去
export GSETTINGS_SCHEMA_DIR="$HOME/.local/share/gnome-shell/extensions/powermode@local/schemas"

gsettings set org.gnome.shell.extensions.powermode toggle-shortcut "['F24']"
gsettings set org.gnome.shell.extensions.powermode toggle-shortcut "['<Super>p']"
gsettings set org.gnome.shell.extensions.powermode toggle-shortcut "[]"   # 解绑
```

改完立即生效，不用重载——mutter 会监听这个 settings 键。

## 验证

```bash
# 当前模式
busctl --system get-property org.freedesktop.UPower.PowerProfiles \
  /org/freedesktop/UPower/PowerProfiles org.freedesktop.UPower.PowerProfiles ActiveProfile
```

## 省电设计

这是本扩展最在意的地方：

| 措施 | 效果 |
|---|---|
| 键位交给 `Main.wm.addKeybinding` | 抓键与匹配都在 mutter 的 C 层，**空闲时零 JS 执行** |
| `Gio.DBusProxy` 属性缓存 | 读当前模式走缓存，按快捷键**不需要额外 D-Bus 往返** |
| 只用异步 `call()` | 主线程同步 D-Bus 会卡住合成器，直接掉帧 |
| `IGNORE_AUTOREPEAT` | 按住不重复触发 |

**没有定时器、没有轮询、不开 evdev、不起子进程。**

## 实现上踩过的坑

都在 `impl.js` 的注释里，这里汇总：

### 1. mutter 的键位表跨 enable/disable 持久

重复 `addKeybinding` 只会打一句 `Trying to re-add keybinding` 然后**静默忽略**，
回调根本挂不上，按键完全无效。所以注册前要先无条件 `removeKeybinding` 一次
（对未注册的键名是安全的）。

### 2. BarLevel 有过载段

进度条绘制分两段：

```js
cr.setSourceColor(_barLevelActiveColor);     // 0 → overdriveStart
cr.setSourceColor(_barLevelOverdriveColor);  // overdriveStart → value
```

`overdriveStart` 默认是 `1`。如果 `maxLevel` 是 3，2/3 和 3/3 档的后半段
就会走 overdrive 颜色，进度条被切成「白 + 彩」两截。必须把 `overdriveStart`
抬到满格，两个颜色给同一个。

### 3. 直接改实例字段会被竞争覆盖

`_barLevelActiveColor` 会在 `vfunc_style_changed()` 里从主题节点重新读取，
而 `style-changed` 信号与默认 vfunc 的先后顺序不确定——结果就是同一个档位
有时彩色、有时白色。必须改走 `set_style()` 内联 CSS，让主题节点自己带上颜色。

### 4. overdriveStart 不允许超过 maximumValue

`showAll()` 会先把 `maximumValue` 设成档位总数，而 `_reset()` 之后它是 1。
如果在 `showAll()` 之前设 `overdriveStart = 3`，会直接抛
`Tried to set overdrive value to 3, which is a number greater than 1`。
所以染色必须在 `showAll()` 之后做。

### 5. setLevel 的动画会把值拉回来

OSD 可见时 `setLevel()` 走 `ease_property` 做 100ms 过渡。快速连按时，
上一轮的过渡还在跑，会持续把 `value` 拉回旧档位，出现「性能档只填 2/3」。
需要先 `remove_transition('value')` 再硬设。


## 与 uperf 调频守护的配合

这台机器（以及许多装了 uperf-linux 的 ARM 设备）上，电源管理分两层：

| 层 | 谁提供 | 作用 |
|---|---|---|
| UPower PowerProfiles | tlp-pd | **只是状态标记**，切换不改变任何 CPU 参数 |
| uperf-linux | 系统级调频守护 | **真正控制** 每簇 scaling_max_freq |

实测：uperf 从 balance 切到 performance 会把 policy0 上限从 1459MHz
抬到 2016MHz、policy7 从 2093MHz 抬到 2957MHz；而只切 GNOME 档位则毫无变化。

所以扩展在切换档位时会同时调用 uperf 的 D-Bus `SetMode`。
命名不一致，映射关系是：

| GNOME (UPower) | uperf |
|---|---|
| `power-saver` | `powersave` |
| `balanced` | `balance` |
| `performance` | `performance` |

首次按键会探测 uperf 是否存在，缺失则静默降级，只切 GNOME 档位。
运行中掉线会重置探测状态，下次按键重试。

设置页有「同步 uperf 调频守护」开关（默认开）。关掉后只切 GNOME 档位，
适合想自己用 `uperfctl` 手动控制调频的场景。

### 验证

```bash
# uperf 当前模式
busctl --system get-property org.uperflinux.Daemon /org/uperflinux/Daemon   org.uperflinux.Daemon CurrentMode

# CPU 上限是否真的变了
cat /sys/devices/system/cpu/cpufreq/policy0/scaling_max_freq
```

## 已知限制

- 如果底层后端（如 TLP 在部分 ARM 设备上）没有真正接管 CPU 调频，
  模式值会变但功耗不变。这时它是「模式标记」而非实际省电。
  用 `cat /sys/devices/system/cpu/cpufreq/policy0/scaling_governor` 可确认。

## 许可

MIT
