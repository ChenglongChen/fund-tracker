#!/usr/bin/env bash
# 从 assets/FundTracker.png 生成 Mac App .icns（及 PWA 位图图标）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$ROOT/assets/FundTracker.png}"
OUT_DIR="$ROOT/apps/mac/build"
ICONSET="$OUT_DIR/icon.iconset"
ICNS="$OUT_DIR/icon.icns"
ICON_PNG="$OUT_DIR/icon.png"

if [[ ! -f "$SRC" ]]; then
  echo "找不到 $SRC，请先确保 assets/FundTracker.png 存在" >&2
  exit 1
fi

if ! command -v sips >/dev/null || ! command -v iconutil >/dev/null; then
  echo "需要 macOS 的 sips 与 iconutil" >&2
  exit 1
fi

TRIMMED="$OUT_DIR/icon-trimmed.png"
python3 "$ROOT/scripts/trim-icon-square.py" "$SRC" "$TRIMMED"
SRC="$TRIMMED"

rm -rf "$ICONSET"
mkdir -p "$ICONSET"

mk() {
  sips -z "$2" "$2" "$SRC" --out "$ICONSET/$1" >/dev/null
}

mk icon_16x16.png 16
mk icon_16x16@2x.png 32
mk icon_32x32.png 32
mk icon_32x32@2x.png 64
mk icon_128x128.png 128
mk icon_128x128@2x.png 256
mk icon_256x256.png 256
mk icon_256x256@2x.png 512
mk icon_512x512.png 512
# 512 源图放大到 1024 供 Retina 512 slot
sips -z 1024 1024 "$SRC" --out "$ICONSET/icon_512x512@2x.png" >/dev/null

iconutil -c icns "$ICONSET" -o "$ICNS"
rm -rf "$ICONSET"

# Mac App 用 512 PNG 生成 .icns
sips -z 512 512 "$SRC" --out "$ICON_PNG" >/dev/null

# PWA / iOS 用位图（512 + 180 apple-touch）
sips -z 512 512 "$SRC" --out "$ROOT/public/icon-512.png" >/dev/null
sips -z 180 180 "$SRC" --out "$ROOT/public/apple-touch-icon.png" >/dev/null

echo "已生成 $ICNS 与 $ICON_PNG"
echo "已更新 public/icon-512.png 与 public/apple-touch-icon.png"
