// 市况台外部推送器：把 fusion-office 的财经快讯与 AISafetyHot 日报灌进 AIHOT 的 external 信源。
// 用法：node scripts/push-finsight.mjs [--serve http://127.0.0.1:8772] [--api http://127.0.0.1:3001]
// 依赖 .env 里的 INGEST_TOKEN。快讯按 url 去重由服务端处理，可重复运行。
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const SERVE = opt('--serve', 'http://127.0.0.1:8772');
const API = opt('--api', 'http://127.0.0.1:3001');

const envText = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
const token = (envText.match(/^INGEST_TOKEN=(.+)$/m) || [])[1]?.trim();
if (!token) { console.error('INGEST_TOKEN missing in .env'); process.exit(1); }

async function push(sourceId, sourceName, items) {
  if (!items.length) { console.log(sourceId, 'no items'); return; }
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50);
    const r = await fetch(`${API}/api/ingest/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sourceId, sourceName, items: batch }),
    });
    const body = await r.text();
    console.log(sourceId, r.status, body.slice(0, 120));
    if (!r.ok) break;
  }
}

// 1) 财经快讯：来自 fusion-office serve.py 的 /api/finance/news（东财快讯 + 新浪滚动，多源互备）
try {
  const r = await fetch(`${SERVE}/api/finance/news?limit=40`);
  const d = await r.json();
  const items = (d.items || []).filter(n => n.title && n.url).map(n => ({
    title: String(n.title).slice(0, 200),
    url: n.url,
    publishedAt: n.time ? new Date(String(n.time).replace(' ', 'T') + '+08:00').toISOString() : new Date().toISOString(),
  }));
  await push('push-finflash', '财经快讯（本地推送）', items);
} catch (e) { console.error('finflash failed:', e.message); }

// 2) AI 安全日报：来自 ZHANGFA88/AISafetyHot-Hub 的 daily/<年>/<日期>.md（取最近 3 天存在的）
try {
  const items = [];
  for (let back = 0; back < 3; back++) {
    const dt = new Date(Date.now() - back * 86400000);
    const y = dt.getFullYear(), ds = dt.toISOString().slice(0, 10);
    const raw = `https://raw.githubusercontent.com/ZHANGFA88/AISafetyHot-Hub/main/daily/${y}/${ds}.md`;
    const r = await fetch(raw);
    if (!r.ok) continue;
    const md = await r.text();
    const firstLine = md.split('\n').map(x => x.replace(/^#+\s*/, '').trim()).find(x => x.length > 6) || `AI 安全日报 ${ds}`;
    items.push({
      title: `AI 安全日报 · ${ds}：${firstLine}`.slice(0, 200),
      url: `https://github.com/ZHANGFA88/AISafetyHot-Hub/blob/main/daily/${y}/${ds}.md`,
      publishedAt: new Date(`${ds}T08:00:00+08:00`).toISOString(),
      summary: md.replace(/[#>*`\-]/g, '').replace(/\s+/g, ' ').slice(0, 500),
    });
  }
  await push('push-aisafety', 'AI 安全日报（AISafetyHot 推送）', items);
} catch (e) { console.error('aisafety failed:', e.message); }
