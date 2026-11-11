#!/bin/bash
# 在一次性 headless gnome-shell 里验证扩展加载与键位注册。
#
# 隔离要点：独立 XDG 目录 + keyfile 设置后端。不设 GSETTINGS_BACKEND=keyfile 时，
# gsettings 会去连 dconf，而 dconf 依赖 session bus 的服务，在 dbus-run-session
# 里往往起不来，结果 enabled-extensions 写不进去、扩展停在 INITIALIZED。
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UUID="powermode@local"
WORK="$ROOT/.tmp/nested"

rm -rf "$WORK"
mkdir -p "$WORK/data/gnome-shell/extensions" "$WORK/config" "$WORK/cache"
ln -sfn "$ROOT/extension/$UUID" "$WORK/data/gnome-shell/extensions/$UUID"

export XDG_DATA_HOME="$WORK/data"
export XDG_CONFIG_HOME="$WORK/config"
export XDG_CACHE_HOME="$WORK/cache"
export GSETTINGS_BACKEND=keyfile

gsettings set org.gnome.shell enabled-extensions "[\"$UUID\"]"
gsettings set org.gnome.shell disable-extension-version-validation true

echo "==== 隔离设置已写入 ===="
gsettings get org.gnome.shell enabled-extensions

LOG="$WORK/shell.log"
gnome-shell --headless --virtual-monitor 1600x1000 \
    --wayland-display=wayland-powermode > "$LOG" 2>&1 &
SHELL_PID=$!
cleanup() { kill "$SHELL_PID" 2>/dev/null; wait "$SHELL_PID" 2>/dev/null; }
trap cleanup EXIT

for _ in $(seq 1 80); do
    gdbus introspect --session --dest org.gnome.Shell.Extensions \
        --object-path /org/gnome/Shell/Extensions >/dev/null 2>&1 && break
    sleep 0.5
done
sleep 4

echo
echo "==== 扩展状态 ===="
gnome-extensions info "$UUID" 2>&1 | grep -E "已启用|状态" || echo "查不到"

echo
echo "==== 加载/键位报错 ===="
grep -iE "powermode|addKeybinding|toggle-shortcut|JS ERROR" "$LOG" | grep -v libmutter | head -10
echo "（空 = 加载与键位注册均正常）"
