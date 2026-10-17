# 观测台总规格 SPEC-OBSERVATORY（产品架构真源）

- 状态：v1.0（2026-10-16 起草）
- 定名注记：站点于 2026-10-17 由 owner 定名「**观潮**」（暂定名「市况台」作废，仓库名 shikuang 不变）；本文档内历史称呼不回溯修改。
- 权限：本文件由产品架构维护，是市况台观测台模块划分、接口契约、数据流的唯一真源。**改契约先改本文档再改代码**；分身实现规格引用只能指向本文档章节 + 原站截图，不许自由转述（转述失真是 2026-10-16 返工的直接原因）。
- 截图优先规则：本规格与原站截图冲突时，**以原站截图为准**，并在附录记录冲突。

原站参照：aisafetyhot.com（AI Safety HOT 科研观测台）；原站研读笔记见 `docs/OBSERVATORY-STUDY.md`；截图证据在 `~/workspace/your_files/shikuang-compare/img/`。

---

## 1. 模块划分与数据流

```
信源 ingest（RSS/Scrapling/推送）
  ↓ articles（discovered_at）
MODEL_CALLS（worker：分析 analysis → 精选 selection → 故事归组 stories → 日报 publications）
  ↓ articles / analyses / stories / story_heat_hourly
后端 site/（packages/backend/src/site/ + packages/backend/src/publication/）
  ↓ /api/site/monitor · /api/site/pool/today · /api/site/hot · /api/site/timeline
首页观测台 UI（apps/web/app/features/observatory/）
  01 材料扫描（Observatory.tsx 左列）→ 02 话题星图（StarMap.tsx）
  → 03 新闻流河流（River.tsx）→ 04 热点观察（HotWatch.tsx）
  ↓
fusion-office 财经观测台面板（app/safety.html，嵌入消费，不许自建数据逻辑）
```

每层输入输出：

| 层 | 输入 | 输出 | 负责人 |
|---|---|---|---|
| 信源 ingest | RSS/Scrapling/推送订阅 | `articles` 行（标题/来源/时间/链接/摘要） | 主聊天+分身实现 |
| 分析精选（MODEL_CALLS） | `articles` | `analyses`（标签/评分/摘要）、精选集、`stories` 归组、`story_heat_hourly` 小时热度 | 主聊天+分身实现 |
| 后端接口 | 表：articles/analyses/stories/story_heat_hourly/sources/topics | monitor / pool/today / hot / timeline 四个契约（第 2 章） | 主聊天+分身实现 |
| 观测台 UI | 上述四接口 | 材料扫描/星图/河流/热点观察四块展示（第 3–5 章） | 主聊天+分身实现 |
| 面板嵌入 | `http://localhost:3000` 整页 | fusion-office 单面板直嵌（第 6 章） | 主聊天+分身实现 |
| 架构规格 | 用户需求 + 原站截图 | 本文档 | **产品架构**（不写实现代码） |

## 2. 接口契约

### 2.1 GET /api/site/monitor（观测台主数据）

`MonitorResponse`（`packages/contracts/src/site.ts`）：

- `topics: MonitorTopic[]` — `{slug, name, group, total}`。group ∈ company（机构）/ field（话题领域）/ genre（形态）。驱动星图节点与河流话题列。
- `pairs: [slugA, slugB, weight][]` — 话题同篇共现，最多 300 条，权重降序。驱动星图共现弧线。
- `feed.items: MonitorFeedItem[]` — `{id, title, summary|null, source, at, kind, topics[], url|null}`。材料扫描左列 + 扫描阅读 + 河流「正在汇入」共用。
- `river: {sources: [{id,name,kind,total,iconUrl}], flows: [{source, topic, n}]}` — 河流图数据。
- `stats: {sources, items, today}` — **全站采集总量。HotWatch 的「公开材料 N · 信源 M」只能取自这里，禁止从 timeline loader 硬凑字段。**
- `generatedAt` — 数据快照时间。

刷新节奏：后端缓存 `freshMs: 60_000`；前端（Observatory.tsx、River.tsx）每 **120 秒**轮询一次。原站为 300 秒，我方更快，保留，不许改慢。

话题归属算法（`packages/backend/src/site/monitor.ts`）：优先框架 `topicMembership`（分析 tags + 标题 pattern），无分析时回退标题词法匹配（实体 pattern + 标签 + `TAG_SYNONYMS` 同义词）；pairs 为同篇共现计数。

### 2.2 GET /api/site/pool/today（今日收录计数）

`{collectedToday: number}`。TodayCounter 每 120 秒对账，有新增时每 900ms 跳 +1（obs-rise 动画），页面隐藏时暂停。

### 2.3 GET /api/site/hot（热点条）

`HotStripEntry[]`（`loadHotStrip()`，`packages/backend/src/publication/hot.ts`）：

- `{rank, title, heat, trend, storyPublicId, itemId, participants, participantCount, spark, sparkAnchor, sourceCount}`
- `spark`：24 小时热度数组（老→新），无读数的小时为 `null`；`sparkAnchor`：最新槽位 ISO 时间，刻度从它向前推。
- `participants: HotParticipant[]`（`{name, kind, iconUrl}`）——**只存发声来源，后端不存社交帖子原文**（第 5 章禁令）。

### 2.4 GET /api/site/timeline（首页 loader 数据源）

`TimelineResponse`：`{filters, cards, nextCursor, hot, dayCounts}`。首页 `home.tsx` 的 `data.hot` 来自这里。

### 2.5 架构裁定（已定，不许改）

HotWatch 的「公开材料 N · 信源 M」只能来自 monitor 接口的 totals/stats（`stats.items` / `stats.sources`），**禁止从 timeline loader 硬凑字段**。`home.tsx` 调用处按此裁定收口：取 `/api/site/monitor` 的 stats 后传入 `HotWatch` 的 `stats` prop。——已收口（2026-10-17 复审通过，见附录 A.3）。

## 3. 蜘蛛交互规格

**架构裁定（2026-10-16 23:21，按证据等级定版，取代此前一切版本）：证据等级 = 原站源码审计 > 放大截图 > 全景截图推断 > 口头转述。** OBSERVATORY-STUDY.md「源码纠正」（原站 scan-engine JS 构建包逐行审计）为最高证据：蜘蛛是一只**常驻爬行生物**，由 `Spider.tsx`（Canvas 覆盖观测台区域）实现、`Observatory.tsx` 事件驱动调度，文件归 `features/observatory/`，不许另起顶层模块。此前两版均为截图误读、全部作废：①19:41 版「卡上蜘蛛+一条长腿斜跨进星图」——把星图共现弧线误读成长腿；②22:31 版「每卡一只小蜘蛛+右下角织网、8 腿」——同样误读。本站已按本节实现（Spider.tsx 常驻引擎），任何分身不许再按作废版本开工。

- **身体**：红点 r≈5.5 + 脉动光环（r 9±2，sin 呼吸）+ 两根朝向前端的短触须；身后拖 26 点丝带轨迹（3 条平行线，偏移 -7/0/+7 渐收，约 55% 透明）；身体按行进方向旋转（转向限速）。
- **腿**：6 条（每侧 3 条，纵向偏移 -8/0/8），两节逆运动学腿（每节 28px），膝关节圆点 r=2.4（白底黑边），足端圆点 r=1.8；腿持续重新锚定（锚点失效或超距时 120ms 内伸向新锚点；未锚定时足端自然外张约 38px）；锚点存元素引用、每帧重算几何（滚动跟随，不快照坐标）。
- **点触阅读**：爬到卡上后逐字段点触——移到字段中心 → 一条腿锚住字段 → 约 75ms 字段高亮 → 约 190ms 完成 → 下一字段；点触瞬间从字段左缘向身体射 3 条红色贝塞尔「吸取束」（热点色 55% 透明）。
- **彗星线程**：一张卡读完后，从它每个话题标签向星图对应话题节点射线程——二次贝塞尔（控制点抬高 90–150px），800ms 飞完，10 段拖尾（alpha 0.9→0、段间距 0.012），头部红点 r=2.6；落地时节点处扩散脉冲环（r→22）+「+1」上浮字；多标签错峰 0.12s。
- **时序**：事件驱动，无固定周期——读完一张 → 结果行追加进右列 → 爬向下一张；卡片高亮持续其点触全程；无目标时原地漂浮，永不消失。
- **星图联动与节点渲染**：引擎里未找到漂移代码，本站保留近乎不可察的极慢漂移（保守处理）；悬停共现边有 380ms 生长动画 + 红色热点沿边移动。节点 = 每个话题一团彩色粒子点云（条目颗粒按类着色）+ 分档字号词名 + 计数（**所有节点名下常驻数字**：话题计数为小字、随话题组色，扫描命中时与名称同变热点色 `#e0521f`；机构为灰字；数字带千分位逗号【架构改裁 2026-10-17 21:12，原站三帧实拍实证：安全评测 `384`、治理与政策 `1,096`、System Card 随扫描 `31→32` 递增；原 23:56 裁定据静态截图作出，被运行实帧推翻】），外圈一层大圆边界；不许做成纯文字标签或灰气泡。

## 4. 03 River（新闻流河流）规格

- **来源列**：纯 logo 圆形图标网格（约 5 列），无名称、无计数。`SourceAvatar` 组件：有 `icon_url` 走图，无则字母圆标兜底。信源 icon_url 已补齐 47 个（`industry/sources.json`，全部 47 条带 icon；补录脚本 `scripts/seed.ts`）。
- **话题列**：分「话题 | 机构」两组，无计数。**话题组**：彩色小圆点 + 名称；**机构组**：灰色「—」短横标记 + 名称（按 orig-flow.png 放大核对的截图裁定，见附录 A.5——原草稿两组同述「彩色小圆点」与截图不符，以截图为准）。
- **曲线**：约 1px 极细、浅灰为主、半透明；无流动动画；贝塞尔汇聚。
- **汇入卡**：logo + 来源名（左）+ 日期（右对齐）→ 2 行加粗标题 → 2 行摘要（`feed.summary`）→ 底部话题标签（左）+ `原文 ↗`（右）。
- **分页器**：`← 上一组 N / 总数 下一组 →` 手动翻页，**不许自动轮播**。
- **顶部小字行**：「窗口回放 · MM/DD — MM/DD」（取 feed 时间窗）。

## 5. 04 HotWatch（热点观察）规格

- **结构**（自上而下）：头部行（`04 / 热点观察 · 一个热点，多种声音` + 页签 01–05 在头部行内联、选中橙色 + `公开材料 N · 信源 M` + `全部热点 ↗`）→ 左详情列 → 右发声/讨论列 → 底部通栏横条（「热点」前缀 + 01–05 横向条目）。
- **左详情列**：`当前热点 NN` 橙色小字 → 大标题 → 摘要 → **热度时间轴** → 发声与引用计数 → `阅读完整事件与讨论 ↗`。
- **热度时间轴**（画法以 orig-hot.png 为准）：垂直灰色细柱 + 一根橙色高亮柱；x 轴起止时间戳；`N 个发声来源`（口径与发声者列裁定统一，2026-10-16 23:56 修订）。**数据血缘：`story_heat_hourly` 表 → `sparklines()`（`packages/backend/src/publication/stories.ts`）→ `HotStripEntry.spark`（24 小时数组）+ `sparkAnchor`。画真数据；空洞小时降透明度；数据不足如实标注「暂无足够热度数据」，不许编造曲线。**
- **右发声/讨论列【架构裁定 2026-10-16 23:39 定版：正式降级为「发声者列」】**：标题改 `发声来源 · 共 N 个`；**只显示发声来源（名+图标+类型）与计数，不设帖子流、不滚动**；后端未存社交帖子原文，严禁编造帖子内容。原「社区最新讨论」形态无限期搁置，仅当未来接入真实社交数据源（X 等）并先修订本节后才可恢复。无数据时显示「暂无发声数据」。
- **无热点数据**：`entries` 为空时整个 04 不渲染（`return null`），首页显示「热点还在形成中」占位行。

## 6. 面板嵌入契约（fusion-office 财经观测台）

面板只是嵌入方。`app/safety.html`：

- 单面板，无二级结构；`iframe#hotframe` 直嵌 `http://localhost:3000` 观测台整页；已改名为「财经观测台」。
- 高度 `calc(100vh - 165px)`，最小 640px。
- 探活状态丸：每 30 秒轮询（3 秒超时），运行中显示 `● 运行中`，未启动显示 `○ 未启动` 并隐藏 iframe、改显启动说明（含：克隆 `ZHANGFA88/shikuang` → `.env` 填模型 Key（GPT/Gemini/千问/DeepSeek）→ `docker compose up -d --build`）。
- **不许面板自建数据逻辑、不许二级存档目录**（已按用户令拆除原「每日简报/论文」存档层）。

## 7. 数据血缘表

| 界面元素 | 接口 | 字段/表 | 无数据时的降级显示 |
|---|---|---|---|
| 材料扫描卡 | /api/site/monitor | `feed.items` | 「正在等待第一批材料…」；接口失败：「观测台数据暂时不可用」 |
| 卡上话题标签 | /api/site/monitor | `topics`（slug→name） | 标签不渲染 |
| 星图节点/弧线 | /api/site/monitor | `topics` + `pairs` | 「星图加载中…」；失败：「星图加载失败」 |
| 悬停提示框 | /api/site/monitor | `topics.total` + `pairs` 共现前三 | 不弹出 |
| 今日收录计数 | /api/site/pool/today | `collectedToday`（表 articles） | 保持上次数字 |
| 河流来源网格 | /api/site/monitor | `river.sources`（`icon_url`） | 「来源还在汇集…」；无 icon 走字母圆标 |
| 河流汇入卡 | /api/site/monitor | `feed.items`（title/summary/url） | 「材料还在汇入…」 |
| 04 头部统计 | /api/site/monitor | `stats.items` / `stats.sources` | 隐藏统计行（禁止硬凑） |
| 04 热度时间轴 | /api/site/hot | `story_heat_hourly` → `spark`/`sparkAnchor` | 标注「暂无足够热度数据」 |
| 04 发声者列（§5 裁定降级） | /api/site/hot | `participants` | 「暂无发声数据」；严禁编造帖子 |
| 04 详情摘要 | /api/site/hot | `HotStripEntry.summary`（已裁定新增，待实现；后端从 story 摘要填充） | 空字符串时不渲染摘要行 |

## 8. 文件路径与命名规范

- 前端：`apps/web/app/features/observatory/`，组件 PascalCase（Observatory/StarMap/River/HotWatch/Spider），状态 store 为 motion-store.ts。
- 后端：`packages/backend/src/site/`（monitor.ts 等）；契约类型统一在 `packages/contracts/src/site.ts`；公开业务逻辑在 `packages/backend/src/publication/`（stories.ts / hot.ts）。
- 文档：`docs/`；行业配置：`industry/`（sources.json、taxonomy.ts）。
- 文件名一律 ASCII；**改契约先改本文档，再改代码**；契约类型改动同步改 `packages/contracts/src/site.ts` 与实现。

## 9. 验收门禁清单

未全部勾选通过，不许推仓、不许报完成：

- [ ] 截图逐项对位：每个修复项有「原站截图 vs 本站截图」对照，且由架构本人（或被明确授权者）看过，不许只贴本站单图。
- [ ] 数据血缘逐项可追溯：每个界面元素能说出接口/字段/表，无「不知道数据从哪来」的元素。
- [ ] `npm run typecheck` 通过。
- [ ] 测试数据验后删除干净（测试持仓/测试文章复位）。
- [ ] 模拟数据明确标注（模拟评判只许出现在卡片「模拟评判」标注内，不许混入真数据文案）。
- [ ] 无假数据/占位充数：04 讨论列无编造帖子，热度轴无编造曲线，空数据如实降级。

## 附录

### A. 规格冲突与裁定记录（架构裁定，用户为产品 owner 保留最终拍板）

1. **蜘蛛机制（已裁定 2026-10-16 23:21）**：冲突根源是主聊天 22:53 给用户的「审计结论」实为 22:31 的截图推断版（小蜘蛛），而非源码审计版；架构起草指令沿用了该转述，一并纠正。第 3 节已按 OBSERVATORY-STUDY.md「源码纠正」（scan-engine 逐行审计）定版为常驻爬行生物，两版截图推断全部作废。正在按小蜘蛛版施工的分身须立即停工，已写入的代码按第 3 节与现有 Spider.tsx 对账回退。
2. **星图节点渲染（已裁定）**：按原站截图与 STUDY 记录定版——粒子点云 + 分档字号词名 + 计数 + 外圈大圆边界，漂移为近乎不可察的极慢；已写入第 3 节末段。
3. **HotWatch stats 收口（已实现，2026-10-17 复审通过）**：`home.tsx` 已按 §2.5 只取 monitor 的 `stats.items`/`stats.sources` 传 `HotWatch`，取不到则隐藏统计行。
4. **HotWatch 详情摘要（已实现，2026-10-17 复审通过）**：选方案 b——契约 `HotStripEntry` 新增 `summary` 字段，后端在 publication 读取层（`loadHotStrip()`）从 story 现有摘要填充，无摘要时为空字符串、前端不渲染摘要行；第 7 章血缘表已含该行。
5. **03 机构组标记（截图裁定，D4 关闭）**：orig-flow.png 放大核对——话题组为彩色小圆点，机构组为灰色「—」短横；§4 已按此修订（草稿两组同述彩色圆点系文字转述之误，截图优先）。现实现终态与截图一致。
6. **星图计数范围（改裁 2026-10-17 21:12）**：所有节点名下常驻计数数字（数据源 `MonitorTopic.total`，现成字段）；话题=组色小字、扫描命中变热点色，机构=灰字。原 23:56 裁定（仅机构常驻）已被原站三帧实拍推翻作废。附带同批裁定：①扫描命中话题须在星图自动高亮（现实现仅点击聚焦有高亮，扫描无联动——须补 `scanSlug` 透传）；高亮清除时机（2026-10-17 21:30 裁定）：保留至下一张卡读完时替换/清除——引擎时序实测 done→release→下一卡 start 仅约一帧，「下一卡开始清除」会使高亮零帧不可见，前端组落地口径照准；②本站自加的「鼠标停右列暂停扫描」原站无此行为，冻结该偏离：扫描循环不因悬停右列而停。
7. **editorial 译名（已裁定 2026-10-16 23:56，修复 D7）**：`kind=editorial` 定版译「机构发声」；仅信源确为政府/央行等官方机构且有据时才可用「官方媒体」字样（contracts 语义仅 participation_mode，含机构博客等非官方源）。
8. **点火 PORT 口径（已裁定 2026-10-16 23:56，修复 D8）**：ignite.sh 解析 PORT 兼容纯端口与 `host:port` 两种写法并从 .env 推导；`.env.example` 注释须无歧义（复审实测三写法解析正确、全新 init-env 生成 0 条生效 PORT 行）。
9. **D9 撤回记录（架构误报，2026-10-17）**：复审曾提「init-env 写死生效 PORT=127.0.0.1:3000」一项，经评审组独立复现 + 架构亲验：`.env:144` 是行首带 `#` 的注释行、`scripts/init-env.ts` 全文 22 行无 PORT 无模板——前提不成立，D9 撤回，主聊天驳回成立。教训入档：提缺陷前先分清注释行与生效行，行号巧合不是证据。
10. **PWA 与演示视频（owner 令 2026-10-17 22:31，经评审组转达、架构落字）**：本站须支持添加到桌面——manifest（站名「观潮」、standalone）+ 图标全套（192/512/apple-touch-icon，从品牌资产出图）+ iOS meta，验收以生产构建实存与真机视口添加流程走通为准；自本批起，含动态修复的交付须附双视口（桌面+手机）演示视频逐帧可验，视频留证据区不入仓。
