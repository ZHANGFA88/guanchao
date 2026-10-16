# aisafetyhot 观测台动态机制研读（2026-10-16，源码 + 实机观察）

## 整体结构（一张卡三列）
- 顶部状态条：站名（科研观测台）+ 步骤序列 01 材料扫描 → 02 话题星图 → 03 新闻流 → 04 热点观察（当前步高亮，不自动轮转）+ 右侧状态丸（带呼吸点）。
- 卡内三列：左=材料扫描（待处理的论文/新闻/公众号条目纵列）；中=话题星图（SVG，约 480px 高）；右=扫描阅读（扫描结果卡 + 日志行纵列）。

## 核心循环：材料扫描（页面心跳）
- 每约 15–30 秒完成一次扫描：左列一条材料被高亮（红色描边）→ 一条粗对角连接线从材料画向星图对应话题节点（描边生长动画 aihot-draw）→ 右列顶部新增一张「扫描结果」卡（模糊+上浮入场 observatory-receive，日志行 scan-log-in 从顶部掉入闪琥珀色）。
- 数据契约 GET /api/site/monitor：{ topics:[{slug,name,group,total}], pairs:[[slugA,slugB,weight]...≤300], feed:{items,nextCursor}, stats:{sources,items,today}, generatedAt }。坐标前端按 group+total+pairs 现算；数据约 2 分钟刷新。
- feed 条目：{id,title,summary,source,at,kind,category,topics[],attention,labels[]}。

## 星图
- 节点极缓慢漂移（10 秒级截图才见偏移），无轮转/脉冲/扫光；连线静态细线。
- 悬停：节点与相连边变橙、其余边淡化；提示框=累计条数 + 「常一起出现」前三（带共现权重）。
- 点击：进入话题聚焦——状态丸变「话题聚焦 ▶ 继续」，右列切为该话题文章轮播（上一条 n/N 下一条 + 查看话题全部内容），chips 呈 pressed 态；点状态丸「继续」退出并重置回放。

## 暂停与状态机
- 页眉按钮「暂停动效/继续动效」为总开关；状态丸四态：收录回放 / 已暂停 / 阅读暂停（用户在读某条时自动）/ 话题聚焦。暂停时漂移、扫描、连接线全停。

## 计数与其它
- 「今天收录」每 120 秒向 /api/site/pool/today 对账，有新增时 900ms/个逐个跳上，旁有脉冲点（collected-rise）。
- 03 新闻流：来源 logo 网格 → 话题列表（带计数）→ 正在汇入卡片，三列间静态曲线（无流动画）；分组自动轮播（91/197 → 98/197 → 102/197），汇入列顶部有骨架占位卡（river-shimmer 微光）。
- 04 热点观察：热度柱 scaleY 生长（hot-watch-rise）。
- 全站动效令牌：--dur-1/2/3 + --ease-out-quart / --ease-exit；入场 fade/drop/zoom、退场 0.65 倍时长，成套的 aihot-* keyframes；列表实时更新用 live-*（from-above/below + appear/vanish）。

## 市况台复刻要点
- 同契约自建 /api/site/monitor（我们库里 topics/stories/pool 都能算出 topics/pairs/feed）。
- 星图词表换财经（机构/领域/形态三组），材料=财经快讯+政策文件+全球源（美股/港股必备：Yahoo Finance、MarketWatch、港媒财经等），扫描节奏与状态机照搬。

## 补充（2026-10-16 19:41 放大截图确认，第一轮研读漏项）
- **蜘蛛**：扫描瞬间，当前材料卡上会出现一只黑色「关节蜘蛛」——红色圆点为身，多条带关节圆点的折线为腿，腿脚锚在该材料的话题标签/卡片边缘，一条长腿斜跨进星图、落点为目标话题节点（红点）。它把「材料→话题」的归属关系画成了一只趴在卡片上的机械蜘蛛。复刻时必须有。
- **星图节点不是气泡**：每个话题是一团彩色粒子点云（条目颗粒按分类着色）+ 词名 + 计数（机构名下带数字），外圈有一层大圆边界；全景截图看像灰气泡，放大才看清。

## 实现状态（2026-10-16 20:05 已落地到本站）
- 后端：packages/backend/src/site/monitor.ts + GET /api/site/monitor、/api/site/pool/today。话题归属优先用框架自带 topicMembership（分析 tags+标题 pattern），无分析时回退标题词法匹配（实体 pattern + 标签 + TAG_SYNONYMS 同义词）；pairs 为同篇共现计数。
- 前端：apps/web/app/features/observatory/（StarMap 圆盘粒子图、Observatory 扫描回放与蜘蛛、motion-store 全局动效开关），首页 routes/home.tsx 改为观测台构图（总览头 + 计数跳字 + 03 新闻流 + 04 热点观察）；全站浅色主题改为暖纸令牌（app.css :root）。
- 已知差距：冷启动数据少时点云稀疏（按真实条数缩放）；热点观察仍用框架 HotTopics 组件（原站的热度曲线+讨论卡待后续）；材料卡摘要在推送快讯上为空（源数据只有标题）。
