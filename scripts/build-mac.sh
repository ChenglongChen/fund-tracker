#!/usr/bin/env bash
# 构建 Swift 轻壳 Mac App：WKWebView + Node sidecar（不改 server/ 业务逻辑）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_VERSION="${FUND_TRACKER_NODE_VERSION:-20.18.0}"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) NODE_DIST="darwin-arm64" ;;
  x86_64) NODE_DIST="darwin-x64" ;;
  *) echo "不支持的架构: $ARCH" >&2; exit 1 ;;
esac

STAGING="$ROOT/build/mac-staging/app"
EXPORT_DIR="$ROOT/build/mac/mac-arm64"
APP="$EXPORT_DIR/Fund Tracker.app"
SWIFT_DIR="$ROOT/apps/mac/FundTracker"
ICON_DIR="$ROOT/apps/mac/build"
SDK="$(xcrun --show-sdk-path)"

echo "==> 1/5 构建 Web UI"
cd "$ROOT"
npm run build

echo "==> 2/5 准备 Node sidecar + API 包"
rm -rf "$STAGING"
mkdir -p "$STAGING/node/bin" "$STAGING/node_modules/@fund-tracker"

cp -R "$ROOT/dist" "$STAGING/dist"
cp -R "$ROOT/server" "$STAGING/server"
cp "$ROOT/package.json" "$STAGING/package.json"

for pkg in api-client core storage; do
  cp -R "$ROOT/packages/$pkg" "$STAGING/node_modules/@fund-tracker/$pkg"
done

find "$STAGING/server" -name '*.test.js' -delete 2>/dev/null || true

NODE_CACHE="$ROOT/build/cache/node-v${NODE_VERSION}-${NODE_DIST}"
if [[ ! -x "$NODE_CACHE/bin/node" ]]; then
  mkdir -p "$(dirname "$NODE_CACHE")"
  TAR="node-v${NODE_VERSION}-${NODE_DIST}.tar.gz"
  URL="https://nodejs.org/dist/v${NODE_VERSION}/${TAR}"
  echo "    下载 Node ${NODE_VERSION} (${NODE_DIST})…"
  rm -rf "/tmp/node-v${NODE_VERSION}-${NODE_DIST}"
  curl -fsSL "$URL" -o "/tmp/${TAR}"
  tar xzf "/tmp/${TAR}" -C /tmp
  mv "/tmp/node-v${NODE_VERSION}-${NODE_DIST}" "$NODE_CACHE"
  rm -f "/tmp/${TAR}"
fi

cp "$NODE_CACHE/bin/node" "$STAGING/node/bin/node"
chmod +x "$STAGING/node/bin/node"

echo "    node: $(du -sh "$STAGING/node/bin/node" | awk '{print $1}')"

echo "==> 3/5 编译 Swift 壳"
bash "$ROOT/scripts/sync-mac-icon.sh"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

xcrun swiftc -O \
  -target "${ARCH}-apple-macos13.0" \
  -sdk "$SDK" \
  -framework SwiftUI \
  -framework AppKit \
  -framework WebKit \
  -framework Combine \
  -parse-as-library \
  "$SWIFT_DIR/FundTrackerApp.swift" \
  "$SWIFT_DIR/AppModel.swift" \
  "$SWIFT_DIR/ContentView.swift" \
  "$SWIFT_DIR/DesktopSettings.swift" \
  "$SWIFT_DIR/FundTrackerBridge.swift" \
  "$SWIFT_DIR/ServerProcess.swift" \
  "$SWIFT_DIR/WindowPlacement.swift" \
  -o "$APP/Contents/MacOS/Fund Tracker"

cp "$SWIFT_DIR/Info.plist" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable 'Fund Tracker'" "$APP/Contents/Info.plist" 2>/dev/null || true
cp "$SWIFT_DIR/boot.html" "$APP/Contents/Resources/boot.html"

if [[ -f "$ICON_DIR/icon.icns" ]]; then
  cp "$ICON_DIR/icon.icns" "$APP/Contents/Resources/AppIcon.icns"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile AppIcon" "$APP/Contents/Info.plist" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string AppIcon" "$APP/Contents/Info.plist"
fi

echo "==> 4/5 嵌入 runtime"
cp -R "$STAGING" "$APP/Contents/Resources/app"

echo "==> 5/5 完成"
du -sh "$APP"
du -sh "$APP/Contents/MacOS/Fund Tracker" "$APP/Contents/Resources/app/node/bin/node" 2>/dev/null || true
echo "完成: $APP"
