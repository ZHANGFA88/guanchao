#!/usr/bin/env bash
# S1 收尾一键脚本（在 Mac 上、仓库根目录运行一次即可）：
#   cd ~/shikuang && git pull && bash scripts/finish-s1.sh
#
# 它会依次：重建服务（激活 .env 里的 INGEST_TOKEN 并带上最新代码）→ 健康检查 →
# 装雪球预热用的 patchright 浏览器 → 重装每 30 分钟的推送定时任务 →
# 干跑一遍推送器 → 正式推送一次 → 打印收尾状态。
# 全程输出同步写进仓库根目录的 finish-s1-result.txt，跑完不用贴输出——
# 主聊天会远程读这个文件验收。某一步失败不中断后面步骤，结果文件里如实留痕。
set -uo pipefail

cd "$(dirname "$0")/.."
RESULT="$PWD/finish-s1-result.txt"
exec > >(tee -a "$RESULT") 2>&1

echo "================ finish-s1 开始：$(date '+%Y-%m-%d %H:%M:%S') ================"
echo "当前版本：$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

echo "---- 1/6 重建服务（激活 INGEST_TOKEN + 最新代码）----"
docker compose up -d --build

echo "---- 2/6 健康检查 ----"
sleep 10
curl -s --max-time 15 "http://127.0.0.1:3001/api/site/pool" | head -c 300
echo ""

echo "---- 3/6 安装 patchright 浏览器（雪球预热用，已装会跳过下载）----"
.venv-scrapling/bin/python -m patchright install chromium

echo "---- 4/6 重装推送定时任务（每 30 分钟）----"
bash scripts/setup-scrapling-cron.sh --uninstall
bash scripts/setup-scrapling-cron.sh

echo "---- 5/6 推送器干跑（只抓不推）----"
.venv-scrapling/bin/python scripts/push-scrapling.py --dry-run

echo "---- 6/6 正式推送一次 ----"
.venv-scrapling/bin/python scripts/push-scrapling.py

echo "---- 收尾状态 ----"
docker compose ps
ls -la "$HOME/Library/Logs/push-scrapling.log" 2>/dev/null || echo "推送日志尚未产生（定时任务下个整点半小时内首跑后出现）"
echo "FINISH_S1_DONE $(date '+%Y-%m-%d %H:%M:%S')"
