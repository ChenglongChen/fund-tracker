
#!/usr/bin/env bash
# 从 public/icon-512.png 生成 Mac App .icns
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$ROOT/public/icon-512.png}"
OUT_DIR="$ROOT/apps/mac/build"
ICONSET="$OUT_DIR/icon.iconset"
ICNS="$OUT_DIR/icon.icns"

if [[ ! -f "$SRC" ]]; then
  echo "找不到 $SRC，请先确保 public/icon-512.png 存在" >&2
  exit 1
fi

if ! command -v sips >/dev/null || ! command -v iconutil >/dev/null; then
  echo "需要 macOS 的 sips 与 iconutil" >&2
  exit 1
fi

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

echo "已生成 $ICNS"
