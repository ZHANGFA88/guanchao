# 接入单 · 第一批 6 源落地（58 → 64）

> 后端组接入单（2026-10-17 架构照准落地批）。形态判定依据 = 框架级实测（cloudrun 实例，用框架自己的 fetchRss/fetchJsonList 走 egress），非仅裸连通。完工后**整批一次推仓**，推前把批次构成报架构核批，不零散推。

## 逐源定案

| 源 | 记账 | 形态 | 框架实测记录 | 字段映射 / 要点 |
|----|------|------|--------------|------------------|
| 东方财富快讯直采 | A 快讯 +1 | **json_list 直采** | fetchJsonList ✅ 10 条/10.2s；urlTemplate 构造的原文链接实测 200 且标题吻合 | url=getFastNewsList（fastColumn=102），itemsPath=data.fastNewsList，titlePaths=[title]，summaryPaths=[summary]，urlTemplate=`https://finance.eastmoney.com/a/{raw:code}.html`，publishedAtPath=showTime（+08 口径已验），externalIdPath=code。间隔建议 5 分钟。与 push-finflash 汇聚**互备不下线**：finflash 仍含东财+新浪两路汇聚，直采上线后在 finflash 侧标注重复来源关系，观察一周再议去重（接入时在 sources.json 备注字段与 SCRAPLING/来源文档写明） |
| 新浪财经 7×24 直采 | A 快讯 +1 | **external 推送**（push-scrapling api 模式新增 parse_sina） | fetchJsonList ❌ `Blocked private address for zhibo.sina.com.cn`（框架 SSRF 拦 fake-IP 解析）；python 直连 ✅ 2.2s | zhibo/feed（zhibo_id=152），items=result.data.feed.list，title/summary=rich_text（快讯全文即标题面，与既有快讯源同口径），url=docurl，publishedAt=create_time（+08），去重 docurl/id。推送器 30 分钟 cron 与其分钟级时效不匹配——见下方「时效注记」 |
| SEC EDGAR | B 研报/公告 +1 | **external 推送**（api/feed 模式新增 parse_edgar） | fetchRss ❌ fetch failed/23s（框架 UA 不符 SEC 公平访问政策：须声明机构+联系方式的 UA）；python 带合规 UA ✅ 0.9s | browse-edgar atom 三路（8-K/10-Q/10-K，count=20）合并推送；**pusher UA 必须用合规声明串**（如 `Guanchao Research admin@<owner 域名>`，落地时向架构确认联系串）；标题=申报类型+公司名，url=申报文档链接，publishedAt=atom updated。efts 全文检索不作信源（是检索工具，归标的库设计用） |
| 港交所披露易 | B +1 | **external 推送**（api 模式新增 parse_hkex） | 页面为 JSF 壳；titleSearchServlet.do 直返 JSON ✅ 1.8s（result 字段为字符串化 JSON，json_list 无法解嵌套 → 推送） | servlet 参数：market=SEHK、rowRange=100、按日窗增量（fromDate/toDate）；标题=SHORT_TEXT 清洗，url 按 NEWS_ID 拼文档链接，publishedAt=DATE_TIME 字段（接入时实测确认字段名） |
| 巨潮资讯 | B +1 | **external 推送**（api 模式新增 parse_cninfo） | https POST hisAnnouncement/query ✅ 1.1–1.9s（form 编码，json_list 的 bodyJson 只发 JSON → 推送）；两日窗 1,130 条 | column=szse+sh 轮询，tabName=fulltext，seDate 按日增量；标题=announcementTitle，url=adjunctUrl 拼 `http://static.cninfo.com.cn/`，publishedAt=announcementTime（epoch_ms）。量级大（约 500+ 条/日），推送侧只取近 24h + 限量 200/轮，防灌爆分析队列 |
| arXiv q-fin | B +1 | **rss 直采** | fetchRss ✅ 5 条/7.5s，标题/链接/时间解析正确 | feedUrl=export.arxiv.org api query（cat:q-fin.GN+q-fin.ST+q-fin.PM 多类目合并查询，max_results=50，submittedDate 降序）；间隔 6 小时（日更源）；原 arXiv API 返回 Atom，框架 RSS 解析已验 |

## 时效注记（快讯两源）

推送器现行 cron 为 30 分钟一轮（Mac launchd），新浪/东财若全走推送则时效被 cron 吃掉。定案：东财走框架直采（interval 5 分钟，框架调度原生支持）✅ 时效达标；新浪因 SSRF 只能推送——落地时把推送器 cron 中**快讯类源单独拆 5 分钟一轮**（api 模式源子集参数，如 `--only push-sina724,push-wallstreetcn`），其余源维持 30 分钟。此项涉 scripts/setup-scrapling-cron.sh 与 SCRAPLING.md，入本批构成。

## 批次构成（推前报架构核批的清单，先行预告）

1. `industry/sources.json`：+6 条（json_list×1 东财、rss×1 arXiv、external×4 新浪/EDGAR/披露易/巨潮），字段与既有同类条目同形；分类/互备关系注记写在源名括号与本文档（框架 config 校验不收自定义 `_aihot` 键，实测后改此口径）。
2. `scripts/push-scrapling.py`：新增 parse_sina / parse_edgar / parse_hkex / parse_cninfo 四个 api 解析器 + APIS 注册；EDGAR 合规 UA。
3. `scripts/setup-scrapling-cron.sh` + `docs/SCRAPLING.md`：快讯子集 5 分钟轮 + 新源说明同步。
4. `docs/FIN-SOURCES-AND-CRAWLER-PLAN.md` §D 状态回填（6 源已接入/总源数 64）。
5. 云端实例接入自验：6 源逐源样本证据（每源 ≥3 条真实条目入池截图/计数）后才报推仓核批。

## 不在本批

金十/财联社（挂起，见 §D）、第二批候选、标的库施工（另行排期）、CRAWLER-STUDY 补强实现（另立项）。
