
#!/usr/bin/env bash
# 将 fund-tracker 项目 data/ 同步到 Mac App 本地数据目录
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/data"
DEST="${FUND_TRACKER_MAC_DATA_DIR:-$HOME/Library/Application Support/@fund-tracker/mac/data}"

FILES=(
  portfolio.json
  app-state.json
  day-display-state.json
  impact-snapshots.json
  valuation-profiles.json
)

if [[ ! -d "$SRC" ]]; then
  echo "未找到 $SRC" >&2
  exit 1
fi

mkdir -p "$DEST"
BACKUP="$DEST/.backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP"

echo "源: $SRC"
echo "目标: $DEST"

for f in "${FILES[@]}"; do
  if [[ -f "$SRC/$f" ]]; then
    if [[ -f "$DEST/$f" ]]; then
      cp "$DEST/$f" "$BACKUP/$f"
    fi
    cp "$SRC/$f" "$DEST/$f"
    echo "  ✓ $f"
  fi
done

echo "旧数据备份: $BACKUP"
echo "完成。请重启 Fund Tracker App 使数据生效。"
