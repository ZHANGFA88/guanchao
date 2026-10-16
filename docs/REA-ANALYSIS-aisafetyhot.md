# REA 实测逆向：aisafetyhot.com 架构与接口清单（研究笔记，非规格）

> 性质：2026-10-17 对原站公开前端的只读逆向研究。**不构成规格变更，SPEC-OBSERVATORY.md 一字未动。**
> 工具：morluto/rea（rea-agents 6.5.0，CDP 接管浏览器）。证据在主聊天工作区 `~/workspace/rea-lab/`（抓包/分析 JSON、导出的站点脚本）。

## 一、前端技术指纹（实测）

- React 运行时 + Vite 构建（React Router v7 一脉）
- 脚本按功能拆包，chunk 名即模块划分：`scan-engine`（观测台扫描引擎）、`NewsRiver`/`NewsRiverFlow`（河流）、`SignalThread`（蜘蛛的丝线）、`Discussions`、`QuotedPost`、`LiveCounters`、`paper-topics`、`source-directory`
- 全站不公开 source map
- Cloudflare RUM 统计（beacon.min.js + POST /cdn-cgi/rum）
- 图片经签名代理：`/api/img-proxy?u=...&mode=avatar-48&exp=...&sig=...`

## 二、路由表（从其 bundle 静态提取，49 条）

```
:lang?  :lang?/all  :lang?/featured  :lang?/papers  :lang?/papers/more
:lang?/all/search-busy  :lang?/items/:id  :lang?/items/:id/original
:lang?/hot  :lang?/story/:publicId
:lang?/daily  :lang?/daily/archive  :lang?/daily/:key
:lang?/weekly  :lang?/weekly/:key  :lang?/monthly  :lang?/monthly/:key
:lang?/topics  :lang?/topics/:slug  :lang?/topics/:slug/page/:page
:lang?/conferences  :lang?/about  :lang?/agent  :lang?/terms  :lang?/privacy
:lang?/changelog  :lang?/board  :lang?/newsletter
:lang?/newsletter/confirm  :lang?/newsletter/unsubscribe
:lang?/more  :lang?/starred
admin/login  admin  admin/content  admin/content/:id  admin/sources
admin/sources/new  admin/sources/:id  admin/feedback  admin/newsletter
admin/runs  admin/models  admin/selectbench  admin/selectbench/:runId
admin/settings  admin/audit
```

## 三、客户端真实调用的接口（场景抓包 + JS 源码 grep 双重实证）

| 接口 | 用途 | 说明 |
|---|---|---|
| `GET /api/site/monitor?lang=zh` | 观测台数据 | 预加载；topics(50)/pairs/feed/stats |
| `GET /api/site/monitor/feed?cursor=` | 材料扫描流分页 | 独立分页，返回 nextCursor |
| `GET /api/site/overview?lang=zh` | 03 河流快照 | 返回 sources[102]/topics[50]/cards[197]/coverage；**周期性快照**，非实时（实测快照时间为 3 天前） |
| `GET /api/site/timeline?cursor=` | 精选流 | 400 时换参数自动重试 |
| `GET /api/site/pool?...` | 全部动态 | 客户端拼参数：page/after/tab |
| `GET /api/site/pool/today` | 今日收录数 | 返回 `{collectedToday}`，页面可见时轮询 |
| `GET /api/site/stories/{publicId}` | 事件详情 | |
| `GET /api/site/groups/{factId}/reports` | 同事件报道聚合 | |
| `GET /api/site/live` | 访客/星标计数 | localStorage 键 `aihot-live-seen` |
| `POST /api/site/search/query` `{q}` → `GET /api/site/search/query/{id}` | 搜索 | **异步任务式**：提交拿 id，每 1 秒轮询 state 至非 pending（约 45 次上限）；`search-busy` 页即为此等待态 |

公开 API（`/api/v1/*`）、Agent/MCP（`/api/v1/agent/*`、`/api/mcp`）、RSS/订阅见此前研读，REA 本轮未重复覆盖。

## 四、与先前研读的对照

- 补上：`/overview` 接口的存在与快照性质、搜索的异步工作机制、完整路由表（含 topics 详情页与整套 admin）、客户端轮询细节
- 纠正：此前“列表页客户端分页 XHR 未能确认”——现已由抓包 + JS 源码双重实证（monitor/feed 独立分页、pool 客户端拼参）
- 不变：公开页数据来自预生成存储、读者打开页面不触发模型调用的架构结论依然成立

## 五、未覆盖 / 局限

- REA 对 monitor/overview 的响应体超保留预算未存档，overview 结构已另行直访接口核对
- bundle 静态分析不执行 JS；服务端逻辑不可见（符合预期）
- MCP 工具未实际调用验证
