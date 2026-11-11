#!/bin/bash
# 安装到当前用户。
# 关键一步是 glib-compile-schemas —— GNOME Shell 只认扩展目录里编译好的
# gschemas.compiled，没有它 getSettings() 会直接抛错。
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UUID="powermode@local"
SRC="$ROOT/extension/$UUID"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

command -v glib-compile-schemas >/dev/null || { echo "缺少 glib-compile-schemas" >&2; exit 1; }
glib-compile-schemas "$SRC/schemas"
echo "schema 已编译"

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
ln -sfn "$SRC" "$DEST"
echo "已链接: $DEST"

if gnome-extensions list 2>/dev/null | grep -qx "$UUID"; then
    gnome-extensions enable "$UUID" 2>/dev/null && echo "已启用" || true
else
    echo "shell 尚未扫描到（Wayland 下需注销重登一次）"
fi

echo
echo "当前键位: $(GSETTINGS_SCHEMA_DIR="$SRC/schemas" gsettings get org.gnome.shell.extensions.powermode toggle-shortcut)"

