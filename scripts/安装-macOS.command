#!/usr/bin/env bash
# 双击安装「赫朝录音改名」到这台 Mac 的 Premiere。装完重启 Premiere。
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/com.hechao.voiceover-namer"
[ -d "$src" ] || src="$here/../extension/com.hechao.voiceover-namer"
dest="$HOME/Library/Application Support/Adobe/CEP/extensions/com.hechao.voiceover-namer"

mkdir -p "$(dirname "$dest")"
rm -rf "$dest"
cp -R "$src" "$dest"
find "$dest" -name .DS_Store -delete
xattr -dr com.apple.quarantine "$dest" 2>/dev/null || true

# 允许没签名的扩展（Premiere 2019–2026 用到的 CSXS 9–13 都开）
for v in 9 10 11 12 13; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done

# 删掉老版本（UXP 插件，从来没在 PR 25.0 上跑起来过）
rm -rf "$HOME/Library/Application Support/Adobe/UXP/Plugins/External/com.hechao.premiere.voiceover-namer"

echo
echo "装好了。重启 Premiere 就会在后台自动改名。"
echo "想看录音列表：窗口 → 扩展 → 赫朝录音改名"
