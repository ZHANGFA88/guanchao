#!/usr/bin/env bash
# 观潮一键点火：在本机把整站（数据库 + API + worker + 网页）跑起来。
# 前置：先在 .env 里填好模型 Key（见 docs/IGNITE.md 与 docs/PROVIDERS.md）。
# 用法：bash scripts/ignite.sh
set -euo pipefail

cd "$(dirname "$0")/.."
PORT_WEB="${PORT:-3000}"

step() { echo; echo "== $1 =="; }
fail() { echo "❌ $1" >&2; echo "$2" >&2; exit 1; }

# ① Docker 与 docker compose
step "① 检查 Docker"
command -v docker >/dev/null 2>&1 || fail "没找到 docker。" "请先安装 Docker Desktop：https://www.docker.com/products/docker-desktop/（Mac 版按提示安装并启动），装好后再跑本脚本。"
docker info >/dev/null 2>&1 || fail "Docker 没在运行。" "请先启动 Docker Desktop（等鲸鱼图标稳定），再跑本脚本。"
docker compose version >/dev/null 2>&1 || fail "docker compose 插件不可用。" "Docker Desktop 自带 compose 插件，重装新版 Docker Desktop 后再跑本脚本。"
echo "✓ docker 与 docker compose 就绪"

# ② .env 存在且 Key 已填
step "② 检查 .env 与模型 Key"
if [ ! -f .env ]; then
  echo ".env 不存在，先生成一个（不覆盖已有文件）。"
  command -v node >/dev/null 2>&1 || fail "没找到 node。" "需要 node 来跑 init-env：https://nodejs.org/ 安装 LTS 版后重试。"
  node scripts/init-env.ts || fail "init-env 生成失败。" "把上面的报错贴给我看看。"
fi
# 取值：忽略注释与空行
envval() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^"//;s/"$//'; }
API_KEY="$(envval LLM_API_KEY)"
MODEL="$(envval LLM_MODEL)"
BASE_URL="$(envval LLM_BASE_URL)"
bad_key=0
case "${API_KEY:-}" in
  ""|*"YOUR"*|*"你的"*|*"填写"*|*"待填"*) bad_key=1 ;;
esac
if [ "$bad_key" = 1 ]; then
  fail ".env 里 LLM_API_KEY 还没填。" "按 docs/PROVIDERS.md 任选一家（推荐千问），把 .env 的 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 三行填好后重跑本脚本。"
fi
[ -n "${MODEL:-}" ] || fail ".env 里 LLM_MODEL 是空的。" "按 docs/PROVIDERS.md 填上模型名（如 qwen-plus / gemini-2.5-flash / deepseek-flash / gpt-4o-mini）后重跑。"
echo "✓ Key 已填：${BASE_URL:-（未填 BASE_URL，默认 DeepSeek）} / 模型 ${MODEL}"
for flag in COLLECT_ENABLED MODEL_CALLS_ENABLED; do
  v="$(envval "$flag")"
  [ "$v" = "true" ] || fail ".env 里 ${flag} 不是 true。" "把它改成 true 再重跑，否则采集与模型调用不会启动。"
done
echo "✓ 采集与模型调用开关都开着"
# Web 端口以 .env 的 PORT 为准（docker compose 发布端口读的也是它）：兼容纯端口（3000）
# 与 host:port（127.0.0.1:3000）两种写法，取冒号后的末尾数字段；.env 没写时沿用上面的默认/环境值。
# PORT 是可选键：.env 里没有生效的 PORT 行（init-env 的标准产物就只有注释示例）时，
# 不许让 grep 落空借 pipefail+set -e 把脚本静默杀掉——判空兜底并提示一声。
# 必填键（LLM_API_KEY 等）不在此列：取空仍由各自的显式校验报错退出，不许静默吞错。
ENV_PORT="$(envval PORT || true)"
if [ -n "${ENV_PORT:-}" ]; then
  PORT_WEB="${ENV_PORT##*:}"
else
  echo "· .env 未设 PORT，Web 端口用默认 ${PORT_WEB}（要改就在 .env 里加一行 PORT=端口）"
fi
echo "✓ Web 端口：${PORT_WEB}（健康检查与下方地址都按这个端口）"

# ③ 启动
step "③ docker compose up -d --build"
docker compose up -d --build

# ④ 等待健康
step "④ 等待服务就绪（最多 180 秒）"
ok=0
for i in $(seq 1 36); do
  if curl -fsS --max-time 5 "http://127.0.0.1:${PORT_WEB}/api/health" >/dev/null 2>&1; then ok=1; break; fi
  printf "."
  sleep 5
done
echo
[ "$ok" = 1 ] || {
  echo "⚠️ 180 秒后 API 还没就绪，打印最近日志排查："
  docker compose logs --tail=40 api worker web db 2>&1 | tail -60
  fail "服务没起来。" "把上面的日志贴给我，或者按 docs/IGNITE.md 的「常见故障」一节处理。"
}
echo "✓ API 健康（/api/health 返回正常）"

# ⑤ 首轮观察提示
step "⑤ 首轮采集与 seed 观察"
echo "现在 worker 正在抓 42 个直采信源的首轮回填（每个源最多回填约 30 条，当天的新文章优先；另外 16 个信源走推送通道，见 docs/SCRAPLING.md）。"
echo "观察方法（二选一）："
echo "  - 看日志：docker compose logs -f worker   （采集进度）"
echo "  - 看页面：打开 http://localhost:${PORT_WEB} ，首页「今天收录」数字会开始往上涨"
echo "  - 管理后台：http://localhost:${PORT_WEB}/admin  （密码在 .env 的 ADMIN_PASSWORD）"

step "完成"
echo "✓ 观潮已点火：http://localhost:${PORT_WEB}"
echo "接下来按 docs/IGNITE.md 的「点火后验收清单」逐项确认。"
