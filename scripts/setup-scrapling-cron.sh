#!/usr/bin/env bash
# 把南华早报 / 巴伦周刊的 Scrapling 推送装成 macOS 定时任务（每 30 分钟一次）。
# 前置（一次性，已在 docs/SCRAPLING.md 里）：python3 -m venv .venv-scrapling
#   .venv-scrapling/bin/pip install "scrapling[fetchers]" ; .venv-scrapling/bin/scrapling install
# 用法：bash scripts/setup-scrapling-cron.sh        （安装/检查）
#       bash scripts/setup-scrapling-cron.sh --uninstall   （卸载）
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$PWD"
LABEL="com.shikuang.push-scrapling"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
PYTHON="$REPO/.venv-scrapling/bin/python"
LOG="$HOME/Library/Logs/push-scrapling.log"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "已卸载 launchd 定时任务（$LABEL）。"
  exit 0
fi

if [ ! -x "$PYTHON" ]; then
  echo "❌ 没找到 $PYTHON"
  echo "请先按 docs/SCRAPLING.md 的「在 Mac 上启用」完成一次性安装（venv + scrapling[fetchers]），再跑本脚本。"
  exit 1
fi

if [ -f "$PLIST" ]; then
  echo "定时任务已存在（$PLIST），跳过安装。如需重装：bash scripts/setup-scrapling-cron.sh --uninstall 后再跑。"
  exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd "$REPO" && "$PYTHON" scripts/push-scrapling.py &gt;&gt; "$LOG" 2&gt;&gt;&amp;1</string>
  </array>
  <key>StartInterval</key><integer>1800</integer>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
EOF

launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "✓ 已安装 launchd 定时任务：每 30 分钟跑一次 scripts/push-scrapling.py（日志 $LOG）。"
echo "  卸载：bash scripts/setup-scrapling-cron.sh --uninstall"
echo "注意：推送走 .env 里的 INGEST_TOKEN，市况台（docker compose）要保持运行。"
