#!/usr/bin/env bash
# 把浏览器采集推送装成 macOS 定时任务：全量每 30 分钟一次；快讯子集（新浪7×24+华尔街见闻）每 5 分钟单独一轮。
# 前置（一次性，已在 docs/SCRAPLING.md 里）：python3 -m venv .venv-scrapling
#   .venv-scrapling/bin/pip install "scrapling[fetchers]" ; .venv-scrapling/bin/scrapling install
# 用法：bash scripts/setup-scrapling-cron.sh        （安装/检查）
#       bash scripts/setup-scrapling-cron.sh --uninstall   （卸载）
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$PWD"
LABEL="com.shikuang.push-scrapling"
FAST_LABEL="com.shikuang.push-scrapling-fast"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
FAST_PLIST="$HOME/Library/LaunchAgents/${FAST_LABEL}.plist"
PYTHON="$REPO/.venv-scrapling/bin/python"
LOG="$HOME/Library/Logs/push-scrapling.log"
FAST_LOG="$HOME/Library/Logs/push-scrapling-fast.log"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)/$FAST_LABEL" 2>/dev/null || true
  rm -f "$PLIST" "$FAST_PLIST"
  echo "已卸载 launchd 定时任务（$LABEL / $FAST_LABEL）。"
  exit 0
fi

if [ ! -x "$PYTHON" ]; then
  echo "❌ 没找到 $PYTHON"
  echo "请先按 docs/SCRAPLING.md 的「在 Mac 上启用」完成一次性安装（venv + scrapling[fetchers]），再跑本脚本。"
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"

write_plist() {
  # $1=plist 路径 $2=label $3=间隔秒 $4=推送器参数 $5=日志
  cat > "$1" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$2</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd "$REPO" && "$PYTHON" scripts/push-scrapling.py $4 &gt;&gt; "$5" 2&gt;&amp;1</string>
  </array>
  <key>StartInterval</key><integer>$3</integer>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
EOF
}

if [ -f "$PLIST" ]; then
  echo "全量定时任务已存在（$PLIST），跳过。"
else
  write_plist "$PLIST" "$LABEL" 1800 "" "$LOG"
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "✓ 已安装全量任务：每 30 分钟跑一次 scripts/push-scrapling.py（日志 $LOG）。"
fi

if [ -f "$FAST_PLIST" ]; then
  echo "快讯定时任务已存在（$FAST_PLIST），跳过。"
else
  write_plist "$FAST_PLIST" "$FAST_LABEL" 300 "--only push-sina724,push-wallstreetcn" "$FAST_LOG"
  launchctl bootstrap "gui/$(id -u)" "$FAST_PLIST"
  echo "✓ 已安装快讯任务：每 5 分钟只跑快讯子集（--only push-sina724,push-wallstreetcn，日志 $FAST_LOG）。"
fi

echo "  卸载：bash scripts/setup-scrapling-cron.sh --uninstall"
echo "注意：推送走 .env 里的 INGEST_TOKEN，观潮（docker compose）要保持运行。"
