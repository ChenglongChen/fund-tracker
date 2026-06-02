#!/usr/bin/env bash
# Install built Fund Tracker.app to /Applications/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Fund Tracker.app"
CANDIDATES=(
  "$ROOT/build/mac/mac-arm64/$APP_NAME"
  "$ROOT/build/mac/mac/$APP_NAME"
  "$ROOT/build/mac/$APP_NAME"
)

SRC=""
for c in "${CANDIDATES[@]}"; do
  if [[ -d "$c" ]]; then
    SRC="$c"
    break
  fi
done

if [[ -z "$SRC" ]]; then
  echo "未找到 $APP_NAME，请先运行: npm run mac:build" >&2
  exit 1
fi

DEST="/Applications/$APP_NAME"
if [[ -d "$DEST" ]]; then
  echo "移除旧版 $DEST"
  rm -rf "$DEST"
fi

echo "安装 $SRC → $DEST"
cp -R "$SRC" "$DEST"
echo "已安装到 $DEST"
echo "可从启动台或 Spotlight 打开「Fund Tracker」"
