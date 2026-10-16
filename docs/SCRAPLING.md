# 被墙信源：Scrapling 推送器

南华早报（SCMP）的 RSS 对普通请求一律 403——它挡的是机器人指纹，不是内容本身。框架的 RSS 采集器过不去，所以这两个源改走「隐身浏览器抓取 → 推送入库」：

- 信源：`push-scmp-business`（商业）、`push-scmp-hk`（香港），类型 external。
- 脚本：`scripts/push-scrapling.py`，用 [Scrapling](https://github.com/D4Vinci/Scrapling)（BSD-3）的 StealthyFetcher 以真实浏览器指纹打开 feed，只取标题、链接、时间、摘要（与 RSS 订阅等价，不抓正文），经 `/api/ingest/items` 入库，与财经快讯推送器同一条路。

## 在 Mac 上启用（一次性）

```bash
cd shikuang
python3 -m venv .venv-scrapling
.venv-scrapling/bin/pip install "scrapling[fetchers]"
.venv-scrapling/bin/scrapling install
.venv-scrapling/bin/python scripts/push-scrapling.py
```

跑通后每 30 分钟执行一次即可，例如 crontab 加一行：

```
*/30 * * * * cd /path/to/shikuang && .venv-scrapling/bin/python scripts/push-scrapling.py >> /tmp/push-scrapling.log 2>&1
```

注意：推送器走的是 INGEST_TOKEN（在 .env 里），市况台服务要在运行中。
