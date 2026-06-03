#!/usr/bin/env bash
# 本地开发：编译 Swift 壳 + 使用仓库根目录与本机 node（不打包 sidecar）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SWIFT_DIR="$ROOT/apps/mac/FundTracker"
DEV_APP="$ROOT/build/mac-dev/Fund Tracker.app"
SDK="$(xcrun --show-sdk-path)"
ARCH="$(uname -m)"

npm run build --prefix "$ROOT"

rm -rf "$DEV_APP"
mkdir -p "$DEV_APP/Contents/MacOS" "$DEV_APP/Contents/Resources"

xcrun swiftc -Onone -g \
  -target "${ARCH}-apple-macos13.0" \
  -sdk "$SDK" \
  -framework SwiftUI -framework AppKit -framework WebKit -framework Combine \
  -parse-as-library \
  "$SWIFT_DIR/FundTrackerApp.swift" \
  "$SWIFT_DIR/AppModel.swift" \
  "$SWIFT_DIR/ContentView.swift" \
  "$SWIFT_DIR/DesktopSettings.swift" \
  "$SWIFT_DIR/FundTrackerBridge.swift" \
  "$SWIFT_DIR/ServerProcess.swift" \
  "$SWIFT_DIR/WindowPlacement.swift" \
  -o "$DEV_APP/Contents/MacOS/Fund Tracker"

cp "$SWIFT_DIR/Info.plist" "$DEV_APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable 'Fund Tracker'" "$DEV_APP/Contents/Info.plist" 2>/dev/null || true
cp "$SWIFT_DIR/boot.html" "$DEV_APP/Contents/Resources/boot.html"

if [[ -f "$ROOT/apps/mac/build/icon.icns" ]]; then
  cp "$ROOT/apps/mac/build/icon.icns" "$DEV_APP/Contents/Resources/AppIcon.icns"
fi

export FUND_TRACKER_APP_ROOT="$ROOT"
open "$DEV_APP"
echo "已启动开发版 Mac App（FUND_TRACKER_APP_ROOT=$ROOT）"
