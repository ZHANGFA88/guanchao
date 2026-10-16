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
