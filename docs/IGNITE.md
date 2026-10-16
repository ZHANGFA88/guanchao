# 市况台 · 10 分钟点火手册

在 Mac 上选好模型 Key 后，按本手册把整站跑起来。预计 10 分钟（Docker 镜像首次构建约占 6–8 分钟）。

## 前置条件

1. **Docker Desktop**（Mac 版）：https://www.docker.com/products/docker-desktop/ ——装好并启动（菜单栏鲸鱼图标稳定）。
2. **模型 Key**（四选一，对照 `docs/PROVIDERS.md`）：
   - 推荐 **千问 Qwen-Plus**：中文日报成稿最稳、价格最低（百炼兼容模式，开 `enable_thinking:false`）。
   - 备选：Gemini 2.5 Flash（英文/长上下文最强、极便宜）、DeepSeek（最便宜）、GPT-4o-mini（同价位不占优）。
3. 本仓库已克隆：`git clone https://github.com/ZHANGFA88/shikuang.git && cd shikuang`

## 三步点火

```bash
# 1. 填 Key：把 .env 的 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 三行按 PROVIDERS.md 的预设改好
#    （还没 .env？先跑 node scripts/init-env.ts 生成一个）
# 2. 点火
bash scripts/ignite.sh
# 3. 打开 http://localhost:3000
```

脚本会自动做：检查 Docker → 检查 `.env`（不存在则生成、Key 没填则逐项指出缺什么）→ `docker compose up -d --build` → 等 API 健康（`/api/health`，最多 180 秒，超时自动打印日志）→ 告诉你怎么观察首轮采集。

## 点火后验收清单

| # | 看什么 | 怎么看 | 预期 |
|---|---|---|---|
| 1 | 服务都起来了 | `docker compose ps`，db/api/worker/web 都是 running | 全绿 |
| 2 | 首页观测台有数据 | http://localhost:3000，首页「今天收录」数字上涨 | 47 源首轮回填中（每源最多约 30 条，实际取决于该源 feed 条数；Worker 日志 `docker compose logs -f worker` 可看采集进度） |
| 3 | 精选出条目 | 首页「精选」/「全部市场动态」 | 首批分析约 10–30 分钟后出现（采集→正文→评分流水线） |
| 4 | 日报出刊 | worker 每天 08:00 自动组刊（半小时一轮检查），看 `/daily` | 当天晚间灌入的数据，归次日 08:00 的日报 |
| 5 | 信源健康 | http://localhost:3000/admin（密码在 `.env` 的 `ADMIN_PASSWORD`） | 47 个源基本都是绿色 |
| 6 | 全站自检 | `node scripts/smoke.ts --base http://localhost:3000` | all checks passed |

## 成本与熔断

- 每笔模型调用框架都会记 **receipt**（回执）：调用结果未知时 30 分钟后自动放行重试一次，避免重复付费；异常会出现在后台的告警里。
- **模型调用有日熔断（默认开启，不靠 .env）**：上限存在数据库 `budgets` 表里、按服务商分别计（迁移预置，可在管理后台「设置」里调）：默认模型共用 `llm` 行 **40,000 次/日**；千问走 `dashscope` 行 **20,000 次/日**（另有每分钟 100 次、每小时 2,000 次的闸）。所有步骤（评分/理解/归组/摘要/日报）共用同一块额度，没有按步骤分开的上限。日常成本控制主要靠选便宜的模型（预设四家全是 Flash/Plus 级）；想更省，千问/Gemini 的 Flash 级优先，或按 `docs/PROVIDERS.md` 的 `LLM_REASONING_TOKENS` 调。
- **首日回填不会被熔断卡住**：47 源 × 每源最多约 30 条 ≈ 1,400 篇，每篇约 2–4 次模型调用，合计几千次，远低于 20,000 次/日的额度。真触发熔断时，文章只是进入等待重试（不丢数据），次日额度恢复后自动继续。
- 被墙的源（南华早报、巴伦周刊）走 Scrapling 推送器：先按 `docs/SCRAPLING.md` 做一次性安装，再跑 `bash scripts/setup-scrapling-cron.sh` 装成每 30 分钟的定时任务（卸载：同脚本加 `--uninstall`）。

## 常见故障

| 现象 | 原因与处理 |
|---|---|
| `ignite.sh` 报没找到 docker | Docker Desktop 没装或没启动，装好/启动后再跑 |
| 报 `LLM_API_KEY 还没填` | `.env` 三行没填完，按 `docs/PROVIDERS.md` 填好重跑 |
| 180 秒超时，日志里 api 连不上 db | 第一次构建慢，再等一两分钟后 `docker compose up -d` 重试；仍不行贴日志 |
| 端口 3000/3001/5432 被占 | 改 `.env` 的 `PORT`（web 对外端口），或停掉占用的进程 |
| Key 填错 | worker 日志里出现 401/认证失败；改 `.env` 后 `docker compose up -d` 重启即可 |
| 某个源 403 | 正常的墙，砍掉该源或转 Scrapling 推送（见上） |
| Docker 装不了（Plan B） | 数据库仍用 docker 起：`docker compose up -d db`；然后本机直跑三进程：`node scripts/migrate.ts && node scripts/seed.ts`，再分别起 `NODE_ENV=production node --env-file=.env apps/api/src/main.ts`（3001）、`NODE_ENV=production node --env-file=.env apps/worker/src/main.ts`、先 `npm run build -w @aihot/web` 再到 `apps/web` 下 `NODE_ENV=production node --env-file=../../.env server.ts`（3000）。注意直跑时 `.env` 的 `DATABASE_URL` 要指到本机 5432（docker 里的 `db:5432` 直跑解析不到） |

fusion-office 在本机运行时，它的财经快讯推送：`node scripts/push-finsight.mjs --serve http://127.0.0.1:8772`（`docs/PROVIDERS.md` 有说明）。
