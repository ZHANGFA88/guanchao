// 这个行业的分类体系：类别、标签词表、公司（主体）名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉结构抽取模型这一类收什么、
 * 和相邻类别的边界在哪（总的归类原则写在 prompts/structure.md 里）。
 * commentary 标出评论类：日报写过的事又有评论类的后续报道，只占一行快讯（报道它的信源够多时除外）。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（本站没有 industry 类别时放最后一节）。
 * feedLabel 是分类 RSS 标题里的名字（不写就用 label）。公开接口、RSS 和 MCP 里要把一类并进另一类发布，写在站点设置里（site/site.ts 的 PUBLIC_CATEGORIES）。
 */
export const CATEGORIES = [
  { key: "policy", label: "政策", feedLabel: "政策动态", section: "政策动态", guide: "央行、证监会、财政部、发改委、交易所等官方机构发布的政策、规则、公告与监管动作：利率与准备金调整、发行与交易规则、行业监管文件、处罚与窗口指导。媒体转述官方表态也算政策；纯解读归观点。" },
  { key: "macro", label: "宏观", feedLabel: "宏观市场", section: "宏观与市场", guide: "宏观经济数据（GDP、CPI、PMI、社融、进出口、就业）、汇率与利率走势、大盘与主要指数的主线行情、跨市场资金动向。单只股票的涨跌归公司，指数层面的异动与归因归宏观。" },
  { key: "company", label: "公司", feedLabel: "公司动态", section: "公司与行业", guide: "上市公司的公告、财报业绩、并购重组、增减持与回购、人事变动、产品与业务进展，以及某个行业（半导体、新能源、医药等）内部的竞争与供需变化。涉及多家公司的行业性事件归这里，不归宏观。" },
  { key: "global", label: "国际", feedLabel: "国际市场", section: "国际市场", guide: "海外央行与监管机构（美联储、欧央行、SEC 等）的动作、美股欧股日股的大事、跨境贸易与关税、地缘事件对市场的传导。主体在中国市场之外的归这里；外媒报道中国政策仍归政策。" },
  { key: "safety", label: "AI 安全", feedLabel: "AI 安全", section: "AI 安全", guide: "AI 安全与对齐的事件、研究、评测、事故与监管：模型越狱与滥用、数据泄露、安全评测结果、AI 治理法规。普通 AI 产品发布与 AI 公司经营动态不归这里（产品归公司、法规归政策，除非主题就是 AI 治理）。" },
  { key: "opinion", label: "观点", section: "观点与解读", guide: "分析师、媒体与业内人士的解读、评论、预测与策略观点：对政策的点评、对行情的归因与展望、机构研报的结论。重点是作者的判断；只有事实陈述而无判断的不归观点。", commentary: true },
] as const satisfies ReadonlyArray<{ key: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;

/**
 * 这个行业最受关注的一类发布。市场行业没有单一的“发布”概念，设成 null，报头不显示这个数。
 */
export const RELEASE: { category: string; tag: string; unit: string } | null = null;

/** 周报月报的总述可以直接写、不必在报道里找到出处的行业通用词（小写）。站名会自动算进去。 */
export const PLAIN_TERMS: readonly string[] = ["a股", "港股", "美股", "ipo", "etf", "gdp", "cpi", "ppi", "pmi", "lpr", "mlf", "社融", "涨停", "跌停", "市盈率", "央行", "证监会"];

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。
 */
export const ITEM_TYPES = ["policy_release", "market_event", "company_disclosure", "research_report", "industry_event", "opinion_analysis", "explainer"] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = [
  "政策/监管", "宏观数据", "行情异动", "公司公告", "财报业绩", "并购重组", "行业动态", "国际市场", "AI安全", "观点解读", "其他",
] as const;

/** 可选的主题标签。 */
export const TOPIC_TAGS = [
  "货币政策", "汇率", "利率", "房地产", "新能源", "半导体", "医药", "消费", "金融", "能源", "AI产业", "贸易关税", "财政", "就业",
] as const;

/** 可选的实体标签（机构、公司、指数）。 */
export const ENTITY_TAGS = ["中国人民银行", "证监会", "财政部", "发改委", "国家统计局", "美联储", "欧洲央行", "上交所", "深交所", "港交所", "腾讯", "阿里巴巴", "贵州茅台", "宁德时代", "英伟达", "苹果", "特斯拉"] as const;

/** 模型常写的近义词，统一成词表里的写法。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  货币政策: "政策/监管", 监管: "政策/监管", 法规: "政策/监管", 政策: "政策/监管",
  数据: "宏观数据", 经济数据: "宏观数据", 大盘: "行情异动", 异动: "行情异动", 暴涨: "行情异动", 暴跌: "行情异动", 涨停潮: "行情异动",
  公告: "公司公告", 披露: "公司公告", 财报: "财报业绩", 业绩: "财报业绩", 年报: "财报业绩", 季报: "财报业绩",
  收购: "并购重组", 并购: "并购重组", 重组: "并购重组", 行业: "行业动态", 动态: "行业动态",
  海外: "国际市场", 美股: "国际市场", 欧股: "国际市场", 全球: "国际市场",
  安全: "AI安全", 对齐: "AI安全", 解读: "观点解读", 分析: "观点解读", 评论: "观点解读", 研报: "观点解读", 策略: "观点解读",
  降准: "货币政策", 降息: "货币政策", 加息: "货币政策", 逆回购: "货币政策", MLF: "货币政策", LPR: "货币政策",
  罚没: "政策/监管", 罚单: "政策/监管", 立案调查: "政策/监管", 行政处罚: "政策/监管",
  净利润: "财报业绩", 业绩预告: "财报业绩", 扭亏: "财报业绩", 预亏: "财报业绩",
  回购: "公司公告", 增持: "公司公告", 减持: "公司公告",
  升值: "汇率", 贬值: "汇率", 关税: "贸易关税", 出口管制: "贸易关税",
  储能: "新能源", 光伏: "新能源", 锂电: "新能源", 芯片: "半导体",
};

// ── 公司与主体 ──────────────────────────────────────────────────────────────────────────

/**
 * 公司主题：id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。
 * aliases 给结构抽取模型看；otherNames 是机构自己的其他称呼（官方账号名、英文名），
 * 把事实的主体对到发布方时也认它们。
 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; otherNames?: string[] }> = {
  pbc: { name: "中国人民银行", displayTag: "中国人民银行", aliases: ["中国人民银行", "人民银行", "央行", "PBOC", "PBoC"] },
  csrc: { name: "证监会", displayTag: "证监会", aliases: ["证监会", "中国证监会", "CSRC"] },
  mof: { name: "财政部", displayTag: null, aliases: ["财政部", "MOF"] },
  ndrc: { name: "发改委", displayTag: null, aliases: ["发改委", "国家发展改革委", "NDRC"] },
  stats: { name: "国家统计局", displayTag: null, aliases: ["国家统计局", "统计局", "NBS"] },
  fed: { name: "美联储", displayTag: "美联储", aliases: ["美联储", "Federal Reserve", "Fed", "FOMC"] },
  ecb: { name: "欧洲央行", displayTag: null, aliases: ["欧洲央行", "ECB", "European Central Bank"] },
  sec: { name: "美国证监会 SEC", displayTag: null, aliases: ["SEC", "美国证监会", "美国证券交易委员会"] },
  tencent: { name: "腾讯", displayTag: null, aliases: ["腾讯", "Tencent", "腾讯控股"] },
  alibaba: { name: "阿里巴巴", displayTag: null, aliases: ["阿里巴巴", "阿里", "Alibaba"] },
  moutai: { name: "贵州茅台", displayTag: null, aliases: ["贵州茅台", "茅台", "Kweichow Moutai"] },
  catl: { name: "宁德时代", displayTag: null, aliases: ["宁德时代", "CATL"] },
  nvidia: { name: "英伟达", displayTag: null, aliases: ["英伟达", "NVIDIA", "Nvidia"] },
  apple: { name: "苹果", displayTag: null, aliases: ["苹果", "Apple", "AAPL"] },
  tesla: { name: "特斯拉", displayTag: null, aliases: ["特斯拉", "Tesla", "TSLA"] },
  openai: { name: "OpenAI", displayTag: null, aliases: ["OpenAI", "ChatGPT", "GPT"] },
  anthropic: { name: "Anthropic", displayTag: null, aliases: ["Anthropic", "Claude"] },
};

/**
 * 身份词典：摘要和标题里出现的机构/公司，必须在原文里也出现过，否则退回原标题、丢掉摘要（防止模型张冠李戴）。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "pbc", name: "中国人民银行", patterns: [/中国人民银行|人民银行|\bPBOC\b|央行(?!行)/i] },
  { id: "csrc", name: "证监会", patterns: [/证监会|\bCSRC\b/i] },
  { id: "mof", name: "财政部", patterns: [/财政部/] },
  { id: "ndrc", name: "发改委", patterns: [/发改委|国家发展改革委|\bNDRC\b/i] },
  { id: "stats", name: "国家统计局", patterns: [/国家统计局|统计局/] },
  { id: "fed", name: "美联储", patterns: [/美联储|Federal Reserve|\bFOMC\b|\bthe Fed\b/i] },
  { id: "ecb", name: "欧洲央行", patterns: [/欧洲央行|\bECB\b|European Central Bank/i] },
  { id: "sec", name: "美国证监会 SEC", patterns: [/\bSEC\b|美国证监会|美国证券交易委员会/] },
  { id: "tencent", name: "腾讯", patterns: [/腾讯|Tencent/i] },
  { id: "alibaba", name: "阿里巴巴", patterns: [/阿里巴巴|阿里(?!山)|Alibaba/i] },
  { id: "moutai", name: "贵州茅台", patterns: [/贵州茅台|茅台/] },
  { id: "catl", name: "宁德时代", patterns: [/宁德时代|\bCATL\b/i] },
  { id: "nvidia", name: "英伟达", patterns: [/英伟达|NVIDIA/i] },
  { id: "apple", name: "苹果", patterns: [/\bApple\b|苹果公司|AAPL/i] },
  { id: "tesla", name: "特斯拉", patterns: [/特斯拉|Tesla|\bTSLA\b/i] },
  { id: "openai", name: "OpenAI", patterns: [/openai|chatgpt/i] },
  { id: "anthropic", name: "Anthropic", patterns: [/anthropic|\bclaude\b/i] },
];

/** 这些域名上的文章，发布方就是对应的机构（托管平台如 GitHub、arXiv 不算）。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "pbc", domains: ["pbc.gov.cn"] },
  { entityId: "csrc", domains: ["csrc.gov.cn"] },
  { entityId: "mof", domains: ["mof.gov.cn"] },
  { entityId: "ndrc", domains: ["ndrc.gov.cn"] },
  { entityId: "stats", domains: ["stats.gov.cn"] },
  { entityId: "fed", domains: ["federalreserve.gov"] },
  { entityId: "ecb", domains: ["ecb.europa.eu"] },
  { entityId: "sec", domains: ["sec.gov"] },
];

/** 原文里的这些写法也算提到了对应机构。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [
  { entityId: "pbc", pattern: /央行(?=开展|宣布|发布|决定|将)/ },
];
