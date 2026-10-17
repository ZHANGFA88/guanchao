# 浏览器采集：推送通道（16 个 external 信源）

框架的直采（RSS/网页列表）过不去的源，走「浏览器/接口抓取 → 推送入库」这条通道：脚本在本机（Mac）上把标题、链接、时间（、摘要）推进 `/api/ingest/items`，与财经快讯推送器同一条路。服务端按 url 去重，可重复运行。信源在 `industry/sources.json` 里注册为 `kind: "external"`，框架采集器会跳过它们、只等推送。

脚本：`scripts/push-scrapling.py`，三种模式：

| 模式 | 原理 | 信源 |
|---|---|---|
| feed | RSS 被指纹墙挡住，用隐身浏览器打开 feed 地址再按 RSS 解析 | 南华早报 SCMP 商业/香港、巴伦周刊 |
| page | 无可用 RSS：打开列表页/首页，按文章链接规律抽标题+链接 | 第一财经、财新网、每日经济新闻、证券时报、FT中文网、21世纪经济报道、经济观察报 |
| api | 站点公开 JSON 接口直读 | 华尔街见闻快讯 |
| signal | 免费讨论源，推给 `hot_signal` 信源（只供热点讨论证据、永不成条） | 东方财富股吧、雪球、Hacker News |

抓取优先 Scrapling 的 StealthyFetcher（Camoufox 真实浏览器指纹），失败依次回退 DynamicFetcher、普通请求。page 模式只搬标题与链接（与 RSS 订阅等价，不抓正文）；链接里带日期的源用链接日期作发布时间并只收最近 2–3 天，其余用抓取时刻近似。

新增 8 源已于 2026-10-17 逐站实测抽取（条数/次）：华尔街见闻快讯 30、第一财经 20、财新 25、每经 25、证券时报 25、FT中文网 20、21世纪 9、经济观察报 20。试过未纳入（候选）：澎湃（403 待隐身浏览器在 Mac 上验）、智通财经/格隆汇（前端渲染，列表规律待验）、信报、HK01（频道地址失效待找）、路透（401 硬墙，隐身浏览器亦难过）、界面（财经频道定位未确认）。

## 讨论信号（signal 模式，2026-10-17 增）

X 的讨论层在框架里走 SocialData 付费服务；免费替代走同一条推送通道、注册成 `hot_signal` 信源——框架归组逻辑对这类源写死「只给热点提供讨论证据、永不单独成条」，靠帖子标题（与正文开头）同报道做文本归组，不挑数据来源：

- **东方财富股吧**（push-guba）：盯 12 个高关注 A 股股吧（名单在脚本 `GUBA_BOARDS`），解析列表页内嵌 JSON，只收评论 ≥10 或阅读 ≥2 万的帖，每吧最多 3 条。已实测 36 条/次。
- **雪球**（push-xueqiu）：全站讨论时间线接口。必须靠隐身浏览器「导航」打开接口地址才能过阿里云 WAF（普通请求拿到的是挑战页，脚本识别后本轮跳过、不影响其他源）。接口契约已用真实浏览器实测拿到帖子 JSON；Camoufox 在 Mac 上的首跑表现待点火时确认。
- **Hacker News**（push-hn）：官方 Firebase 接口，免费免 Key；头条前 40 里只收分数 ≥120 的讨论帖（标题+讨论页链接），已实测 19 条/次。管 AI/科技话题的国际讨论。

## 在 Mac 上启用（一次性）

```bash
cd shikuang
python3 -m venv .venv-scrapling
.venv-scrapling/bin/pip install "scrapling[fetchers]"
.venv-scrapling/bin/scrapling install
.venv-scrapling/bin/python scripts/push-scrapling.py --dry-run   # 先看抓取是否正常（只抓不推）
.venv-scrapling/bin/python scripts/push-scrapling.py             # 正式推一次
bash scripts/setup-scrapling-cron.sh                             # 装成每 30 分钟自动跑
```

注意：推送器走 `.env` 里的 `INGEST_TOKEN`，且观潮服务要在运行中；feed 模式的三个源必须靠隐身浏览器，在无浏览器的环境里会失败跳过（其余源不受影响）。
