// 本地模拟模型（仅供联调/演示）：实现 OpenAI 兼容 /v1/chat/completions，按系统提示词识别流水线步骤
// （prefilter/score/structure/understand/summarize/group/report），用关键词规则给出结构合法的回答。
// 不是真模型：评分与文案都是规则拼装，只用于验证流水线与版式。真部署请换 LLM_* 为真实服务商。
import http from "node:http";

const PORT = 8790;

const RULES = [
  { re: /央行|证监会|财政部|发改委|监管|立案|处罚|罚没|政策|降准|降息|国务院|交易所.{0,6}(发布|通知|规则)/, cat: "政策/监管", catKey: "policy", type: "policy_release", score: 83 },
  { re: /净利润|营收|业绩|财报|预增|预亏|年报|季报|中报|每股收益/, cat: "财报业绩", catKey: "company", type: "company_disclosure", score: 80 },
  { re: /回购|增持|减持|IPO|上市|备案|并购|收购|重组|分红|配股/, cat: "公司公告", catKey: "company", type: "company_disclosure", score: 77 },
  { re: /AI安全|人工智能安全|对齐|越狱|护栏|大模型安全|模型评测|红队/, cat: "AI安全", catKey: "safety", type: "research_report", score: 79 },
  { re: /指数|涨停|跌停|大涨|大跌|涨幅|跌幅|收盘|开盘|成交额|国债收益率|产能利用率|PMI|CPI|GDP|非农/, cat: "宏观数据", catKey: "macro", type: "market_event", score: 71 },
  { re: /半导体|芯片|光伏|新能源|锂电|医药|房地产|关税|贸易/, cat: "行业动态", catKey: "company", type: "industry_event", score: 69 },
];
const GENERIC = { cat: "其他", catKey: "company", type: "industry_event", score: 64 };

function pickRule(text) {
  for (const r of RULES) if (r.re.test(text)) return r;
  return GENERIC;
}

function extractTitle(user) {
  const m = user.match(/【标题】\s*(.+)/) || user.match(/原始标题：\s*(.+)/) || user.match(/标题：\s*(.+)/) || user.match(/title[:：]\s*(.+)/i);
  if (m) return m[1].trim().slice(0, 120);
  const line = user.split("\n").map((s) => s.trim()).filter((s) => s.length >= 8 && s.length <= 120)[0];
  return line ?? "市场动态";
}

function json(res, content) {
  const body = JSON.stringify({
    id: "sim-" + Date.now(),
    model: "sim-1",
    choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.url?.includes("/embeddings")) {
      const body = JSON.parse(raw || "{}");
      const inputs = Array.isArray(body.input) ? body.input : [body.input ?? ""];
      const data = inputs.map((t, i) => {
        let h = 0; const s = String(t);
        for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) >>> 0;
        return { index: i, embedding: Array.from({ length: 8 }, (_, j) => ((h >> (j * 3)) % 97) / 97) };
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data, model: "sim-emb", usage: { prompt_tokens: 10, total_tokens: 10 } }));
    }
    if (!req.url?.includes("/chat/completions")) { res.writeHead(404); return res.end("{}"); }
    let body;
    try { body = JSON.parse(raw); } catch { res.writeHead(400); return res.end("{}"); }
    const msgs = body.messages ?? [];
    const system = msgs[0]?.role === "system" ? String(msgs[0].content) : "";
    const last = msgs[msgs.length - 1];
    const user = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
    const title = extractTitle(user);
    const rule = pickRule(user);

    if (!system) {
      // summarize step: plain-text lines
      return json(res, `title_zh: ${title}\nsummary_zh: ${title}。据公开披露，相关事项已对外公布，具体影响以后续官方信息为准。`);
    }
    if (system.includes("attentionScore")) return json(res, { attentionScore: rule.score });
    if (system.includes("PASS|BLOCK|UNKNOWN") || system.includes("预筛")) return json(res, { label: "PASS", reason: "与市场或AI安全相关" });
    if (system.includes("editorialJudgment") || system.includes("itemType")) {
      return json(res, {
        itemType: rule.type,
        authorRole: "principal",
        tags: [rule.cat],
        editorialJudgment: `模拟评判：属${rule.cat}类事项，信息具体、可核查。`,
        titleZh: title,
        summaryZh: `${title}。据公开披露，相关事项已对外公布，具体影响以后续官方信息为准。`,
      });
    }
    if (system.includes("scope") && system.includes("fact")) {
      return json(res, {
        category: rule.catKey,
        tags: [rule.cat],
        subjects: [],
        scope: "single",
        fact: { title: title.slice(0, 30), subject: "相关机构", action: "披露", object: title.slice(0, 20), occurredAt: null, evidence: null, conditions: [] },
      });
    }
    if (system.includes("SAME_OCCURRENCE") && system.includes("\"a\"")) {
      return json(res, { a: title, b: "", relation: "UNRELATED", difference: "两次发生的主体或动作不同", confidence: 0.7 });
    }
    if (system.includes("decisions") && system.includes("selection")) {
      const ids = [...new Set([...user.matchAll(/\bC\d+\b/g)].map((m) => m[0]))];
      return json(res, {
        query: title,
        decisions: ids.map((id) => ({ id, relation: "UNRELATED", confidence: 0.7, note: "与候选报道不是同一次发生" })),
        selection: { addsValue: true, reason: "提供新的具体信息" },
      });
    }
    if (system.includes("digest") && system.includes("\"title\"")) {
      return json(res, { title: title.slice(0, 30), digest: `${title}。相关进展已对外披露，后续以官方信息为准。` });
    }
    if (system.includes("overview")) {
      let keys = [];
      const m = system.match(/"sections"\s*:\s*\{([^}]*)\}/);
      if (m) keys = [...m[1].matchAll(/"([^"]+)"\s*:/g)].map((x) => x[1]);
      const sections = {};
      for (const k of keys) sections[k] = `本栏目汇总本时段${k}方面的主要动态，详见条目。`;
      return json(res, { overview: `本时段要闻以${rule.cat}为主线：${title}。其余动态已按栏目整理，详见各条。`, sections });
    }
    if (system.includes("titleZh") && system.includes("reasonZh")) {
      return json(res, { titleZh: title, summaryZh: `${title}。据公开披露，相关事项已对外公布。`, reasonZh: "信息具体、可核查" });
    }
    if (system.includes("\"t\"")) {
      return json(res, { t: [user.slice(0, 500)] });
    }
    // fallback: generic structured answer
    return json(res, { titleZh: title, summaryZh: `${title}。据公开披露，相关事项已对外公布。` });
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`sim-llm on ${PORT}`));
