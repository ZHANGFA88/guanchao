# 浏览器采集：推送通道（20 个 external 信源）

框架的直采（RSS/网页列表）过不去的源，走「浏览器/接口抓取 → 推送入库」这条通道：脚本在本机（Mac）上把标题、链接、时间（、摘要）推进 `/api/ingest/items`，与财经快讯推送器同一条路。服务端按 url 去重，可重复运行。信源在 `industry/sources.json` 里注册为 `kind: "external"`，框架采集器会跳过它们、只等推送。

脚本：`scripts/push-scrapling.py`，四种模式：

| 模式 | 原理 | 信源 |
|---|---|---|
| feed | RSS：普通请求优先拿原始字节；403/429 时依次升级 curl_cffi（chrome 指纹伪装）→ 隐身浏览器 → 动态渲染 | 南华早报 SCMP 商业/香港（Mac 上普通请求直连即通、各 50 条）、巴伦周刊（四路均 403，如实跳过） |
| page | 无可用 RSS：隐身浏览器打开列表页/首页，按文章链接规律抽标题+链接 | 第一财经、财新网、每日经济新闻、证券时报、FT中文网、21世纪经济报道、经济观察报 |
| api | 站点公开 JSON 接口：普通请求优先读原始 JSON | 华尔街见闻快讯、新浪财经7×24（框架 SSRF 拦其域名解析故走推送）、SEC EDGAR（browse-edgar Atom 三路合并，UA 用申报串 `GuanchaoBot/1.0 (+https://github.com/ZHANGFA88/shikuang)`，架构裁定不许编造邮箱）、港交所披露易（titleSearchServlet，result 为字符串化 JSON 需二次解包）、巨潮资讯（hisAnnouncement form POST，深沪两市；近 24h、每轮上限 200 条） |
| signal | 免费讨论源，推给 `hot_signal` 信源（只供热点讨论证据、永不成条） | 东方财富股吧、雪球（patchright 首页预热种 xq_a_token cookie 后调 API）、Hacker News |

抓取链（2026-10-17 Mac 两次干跑定版）：feed/api 普通请求优先（RSS XML 和 JSON 不能被浏览器包装成 HTML，否则解析全灭），403/429 时依次升级 curl_cffi（chrome 伪装）→ StealthyFetcher → DynamicFetcher；page 模式浏览器渲染优先；雪球走 patchright 首页预热种 `xq_a_token` cookie 后在同一上下文调 API。page 模式只搬标题与链接（与 RSS 订阅等价，不抓正文）；链接里带日期的源用链接日期作发布时间并只收最近 2–3 天，其余用抓取时刻近似。

新增 8 源已于 2026-10-17 逐站实测抽取（条数/次）：华尔街见闻快讯 30、第一财经 20、财新 25、每经 25、证券时报 25、FT中文网 20、21世纪 9、经济观察报 20。试过未纳入（候选）：澎湃（403 待隐身浏览器在 Mac 上验）、智通财经/格隆汇（前端渲染，列表规律待验）、信报、HK01（频道地址失效待找）、路透（401 硬墙，隐身浏览器亦难过）、界面（财经频道定位未确认）。

### SEC EDGAR 启用（需联系邮箱，2026-10-17 增）

SEC 公平访问政策要求申报 UA 为「应用名 + 真实联系邮箱」形态，无邮箱一律 403（实测）。推送器读环境变量 `EDGAR_CONTACT_UA` 作为完整申报串，形态如 `GuanchaoBot/1.0 you@example.org`——**邮箱值由 owner 本地填，不落仓**：在 Mac 上把该变量注入推送器的运行环境（launchd 任务的环境或跑推送器前的 shell 导出）。未注入时 EDGAR 源自动跳过并打印原因，其余源不受影响。

## 讨论信号（signal 模式，2026-10-17 增）

X 的讨论层在框架里走 SocialData 付费服务；免费替代走同一条推送通道、注册成 `hot_signal` 信源——框架归组逻辑对这类源写死「只给热点提供讨论证据、永不单独成条」，靠帖子标题（与正文开头）同报道做文本归组，不挑数据来源：

- **东方财富股吧**（push-guba）：盯 12 个高关注 A 股股吧（名单在脚本 `GUBA_BOARDS`），解析列表页内嵌 JSON，只收评论 ≥10 或阅读 ≥2 万的帖，每吧最多 3 条。已实测 36 条/次。
- **雪球**（push-xueqiu）：全站讨论时间线接口。脚本先用 patchright 无头打开雪球首页预热、等 `xq_a_token` cookie 种下，再在同一浏览器上下文里调该 API（普通请求拿到的是阿里云 WAF 挑战页，脚本识别后本轮跳过、不影响其他源）。接口契约已用真实浏览器实测拿到帖子 JSON；Camoufox/patchright 浏览器在 Mac 上的首跑表现待点火时确认。
- **Hacker News**（push-hn）：官方 Firebase 接口，免费免 Key；头条前 40 里只收分数 ≥120 的讨论帖（标题+讨论页链接），已实测 19 条/次。管 AI/科技话题的国际讨论。

## 在 Mac 上启用（一次性）

```bash
cd shikuang
python3 -m venv .venv-scrapling
.venv-scrapling/bin/pip install "scrapling[fetchers]"
.venv-scrapling/bin/scrapling install
.venv-scrapling/bin/python scripts/push-scrapling.py --dry-run   # 先看抓取是否正常（只抓不推）
.venv-scrapling/bin/python scripts/push-scrapling.py             # 正式推一次
bash scripts/setup-scrapling-cron.sh                             # 装定时：全量每 30 分钟 + 快讯子集（新浪7×24/华尔街见闻，--only）每 5 分钟单独一轮
```

注意：推送器走 `.env` 里的 `INGEST_TOKEN`，且观潮服务要在运行中；feed 模式里巴伦四路均 403 会如实跳过（其余源不受影响）。

### 正式推送的前置：先设 INGEST_TOKEN（Mac 首跑就栽在这）

正式推送（非 `--dry-run`）前必须做两件事，缺一不可：

1. 在仓库根目录的 `.env` 里加一行（至少 16 位随机字符，没有就用 `openssl rand -hex 16` 生成一个）：
   `INGEST_TOKEN=<生成的随机串>`
2. 重建或重启 api 服务让新配置生效（`.env` 只在启动时读一次）：
   `cd ~/shikuang && docker compose up -d --build`

`--dry-run` 只抓不推、不需要 token；正式推送时没配 token，脚本会退出并提示 `INGEST_TOKEN missing in .env`。
