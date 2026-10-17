# 设计纸 · 按标的检索的存取层（可搜索留存）

> 后端组设计纸（2026-10-17 22:01 owner 亲令第 3 段）。状态：**已定版（2026-10-17 架构裁定回填），未施工、未建表**。施工另行立项排期，契约以本文裁定为准。
> 目标：财经新闻/研报抓回后，可按标的（首个样本 SPCX/SpaceX）随时全文检索调出，留存不设短期过期。

## 1. 现状基线（可复用，不另起炉灶）

- 留存：articles/publications 已全量落 PG；operations/retention 只清 job_runs（30/90 天）、delivery_leases、反馈截图，**不删 articles**——「不设短期过期」与现有 retention 天然相容，只需在设计里明确标的层数据豁免任何未来文章清理策略。
- 检索：公开池已有 `q` 查询参数（/api/site pool）与 /api/site/search/suggestions；DB 已启用 pg_trgm（迁移 0001）。但现有 q 是池内过滤，非标的维度，无标的标签、无研报面字段。
- 组织：topics 是编辑话题（人工/模型归组），粒度是事件主题，不是标的；标的层与 topics 正交，不复用、不混淆。

## 2. 数据落点（拟，待裁）

- **关注列表**：`industry/watchlist.ts`（或 site 配置）声明标的：`{ symbol, name, entityType: listed|private|index, keywords: [...], negativeKeywords: [...], peers: [...] }`。配置即代码、随仓版本管理，增删标的走 PR，不做后台动态配置（YAGNI，待标的数量 >20 再议）。
- **命中落点（核心契约问题）**：拟新表 `article_symbols(article_id, symbol, matched_on, confidence, created_at)`，多对多。一条新闻可命中多标的；命中来源分三档：`rule`（关键词规则）、`analysis`（分析层顺带产出）、`manual`（人工订正）。
  - 备选（不推荐）：articles 加 `symbols text[]` 列——查询快但订正/审计差、无法记命中来源与置信度。请架构在两案中裁一。
- **全文检索**：一期用 pg_trgm + ILIKE 在 title/title_zh/summary/summary_zh/excerpt 上检索（中文无分词问题，子串命中即可），命中标签表为精确召回主路径、全文检索为补充；二期再评估 tsvector（英文）或外部引擎，**一期不引入新基础设施**。

## 3. 命中规则（SPCX 样本）

关键词组（拟）：强信号（单独命中即入）：`SpaceX`、`SPCX`、`Starlink`、`星链`、`Space Exploration Technologies`；弱信号（须共现）：`马斯克`/`Elon Musk` + （火箭|发射|卫星|星舰|Starship|猎鹰|Falcon|NASA 合同|卫星互联网）任一；排除：单独 Musk（默认归 Tesla/Neuralink 等其他实体语境）、`SPAC`（与 SPCX 形近，必须词边界匹配，防 SPAC 类新闻误入）。
研报面：B 类源（EDGAR/研报中心等）入池后走同一命中管线，publication 侧以 source 类别区分「新闻/研报」呈现，不另建研报表（G1 层靠 source 分类 + 标的层透出）。

## 4. 检索方式（拟对外契约，待裁）

守仓规：**只走 publication 读取层**，不新开旁路出口。
- 拟新增：`GET /api/site/symbols`（关注列表+各标的计数/最新时间）、`GET /api/site/symbols/:symbol/items`（按标的分页调出，支持 q 二次全文检索、kind=news|research 过滤、时间范围）。
- 拟增量字段：条目型响应加 `symbols: string[]`（与 titleZh 同为增量字段，旧客户端不受影响）。
- MCP/agent 出口是否同步透出 symbols，请架构一并裁（默认建议同步，保持各出口一致）。

## 5. 管线位置

命中计算放在 worker：ingest/采集入库后、与分析并行的一个轻任务（规则档零模型成本，入库即打标，保证「抓回来就能搜到」不等分析）；分析完成时可补 analysis 档订正。规则变更后支持全量重跑打标（幂等，按 article_id+symbol 覆盖）。

## 6. 架构裁定（2026-10-17，已定版）

1. **落点**：新表 `article_symbols`（多对多 + 命中来源 + 置信度），不走 articles 加列——审计性优先。§2 备选案作废。
2. **契约**：publication 层加法新增 `/api/site/symbols` 与 `/api/site/symbols/:symbol/items`，条目增量 `symbols[]` 字段，旧端不受影响。**MCP 本期不同步**，S2 再议。
3. **watchlist 位置**：`industry/watchlist.ts`（合仓规：本站专属物放 industry/）。
4. **弱信号口径**：照准 §3——强信号单独命中；弱信号（马斯克/Musk）必须与火箭/发射/Starship/SpaceX 语境共现；SPAC 词边界防误入保留。不走 LLM 判读优先。
5. **研报呈现**：研报/研究类本期**只进标的库与搜索结果，不进精选与日报主链**——先保已验收的日报口径，质量抽样后再议入主链。§4 中 kind 过滤照此口径。

## 7. SPCX 注记（防误期，架构确认）

SpaceX 为非上市公司，**在 SEC EDGAR 无申报主体**，不存在「抓 SpaceX 自己的申报」这回事；SPCX 标的的相关面来自：A 类快讯与现有 58 源的关键词命中、关联语境（发射服务/卫星互联网/竞争对手如蓝色起源）、以及 B 类源中关联上市公司申报的提及段落。另 2026-10-17 架构裁定增补：**SpaceX 官方 YouTube 频道列入 SPCX 聚合源**（频道官方 RSS 实测可用，发射直播/回放天然命中强信号；随标的库施工一并接入，财经类 YouTube 频道另列第二批候选）。标的库对 SPCX 的价值在聚合与检索，不在专源。owner 所持 SPCX 为 SpaceX 相关敞口标的（具体载体以其账户为准），关键词组按 §3 执行。
