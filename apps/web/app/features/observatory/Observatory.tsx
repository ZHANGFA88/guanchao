import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { MonitorFeedItem, MonitorResponse } from "@aihot/contracts/site";
import { StarMap } from "./StarMap";
import { setMoving, useMoving } from "./motion-store";

const SCAN_MS = 11_000;
const SCAN_SHOW_MS = 1_900;
const MATERIAL_COUNT = 12;

const KIND_LABEL: Record<string, string> = { rss: "新闻", external: "推送", x: "推文", paper: "论文", web: "网页" };

function fmtDayTime(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function fmtClock(d: Date): string {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);
}

interface ScanResult { item: MonitorFeedItem; slug: string | null; at: Date; key: number }

interface SpiderLeg { body: { x: number; y: number }; legs: Array<Array<{ x: number; y: number }>> }

export function Observatory() {
  const moving = useMoving();
  const [data, setData] = useState<MonitorResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [scanIdx, setScanIdx] = useState(0);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [focused, setFocused] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [spider, setSpider] = useState<SpiderLeg | null>(null);
  const deckRef = useRef<HTMLElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const stateRef = useRef({ moving, focused, reading });
  stateRef.current = { moving, focused, reading };
  const scanIdxRef = useRef(0);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch("/api/site/monitor");
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as MonitorResponse;
        if (!stop) setData(json);
      } catch { if (!stop) setFailed(true); }
    };
    void load();
    const id = window.setInterval(load, 120_000);
    return () => { stop = true; window.clearInterval(id); };
  }, []);

  const materials = useMemo(() => data?.feed.items.slice(0, MATERIAL_COUNT) ?? [], [data]);
  const topicName = useCallback((slug: string) => data?.topics.find((t) => t.slug === slug)?.name ?? slug, [data]);

  const runScan = useCallback(() => {
    const { moving: mv, focused: fz, reading: rd } = stateRef.current;
    if (!mv || fz || rd || !data || materials.length === 0) return;
    const idx = scanIdxRef.current % materials.length;
    const item = materials[idx]!;
    scanIdxRef.current += 1;
    setScanIdx(scanIdxRef.current);
    setActiveIdx(idx);
    // Draw the spider: body on the card, short legs to its topic chips, one long leg into the map.
    requestAnimationFrame(() => {
      const deck = deckRef.current;
      const card = cardRefs.current.get(item.id);
      if (!deck || !card) return;
      const dr = deck.getBoundingClientRect();
      const cr = card.getBoundingClientRect();
      const body = { x: cr.left - dr.left + cr.width * 0.52, y: cr.top - dr.top + cr.height * 0.55 };
      const legs: SpiderLeg["legs"] = [];
      const chips = card.querySelectorAll("[data-chip]");
      chips.forEach((chip, i) => {
        if (i > 1) return;
        const r = chip.getBoundingClientRect();
        legs.push([body, { x: (r.left + r.right) / 2 - dr.left, y: r.top - dr.top + r.height / 2 }]);
      });
      legs.push([body, { x: cr.left - dr.left + 14, y: cr.top - dr.top + 12 }]);
      legs.push([body, { x: cr.right - dr.left - 12, y: cr.bottom - dr.top - 10 }]);
      const slug = item.topics[0];
      if (slug) {
        const node = deck.querySelector(`[data-node="${slug}"]`);
        if (node) {
          const nr = node.getBoundingClientRect();
          const target = { x: (nr.left + nr.right) / 2 - dr.left, y: (nr.top + nr.bottom) / 2 - dr.top };
          const j1 = { x: body.x + (target.x - body.x) * 0.42 + 6, y: body.y + (target.y - body.y) * 0.42 - 7 };
          const j2 = { x: body.x + (target.x - body.x) * 0.76 - 4, y: body.y + (target.y - body.y) * 0.76 + 4 };
          legs.push([body, j1, j2, target]);
        }
      }
      setSpider({ body, legs });
    });
    window.setTimeout(() => {
      if (!stateRef.current.moving) { setActiveIdx(null); setSpider(null); return; }
      setResults((prev) => [{ item, slug: item.topics[0] ?? null, at: new Date(), key: Date.now() }, ...prev].slice(0, 6));
      setActiveIdx(null);
      setSpider(null);
    }, SCAN_SHOW_MS);
  }, [data, materials]);

  useEffect(() => {
    if (!data) return;
    const kick = window.setTimeout(runScan, 700);
    const id = window.setInterval(runScan, SCAN_MS);
    return () => { window.clearTimeout(kick); window.clearInterval(id); };
  }, [data, runScan]);

  const status = focused ? "话题聚焦" : !moving ? "已暂停" : reading ? "阅读暂停" : "收录回放";
  const focusItems = useMemo(() => {
    if (!focused || !data) return [];
    const inTopic = data.feed.items.filter((it) => it.topics.includes(focused));
    return inTopic.length ? inTopic : data.feed.items;
  }, [focused, data]);
  const [focusPos, setFocusPos] = useState(0);
  useEffect(() => { setFocusPos(0); }, [focused]);

  return (
    <section ref={deckRef} className="relative mt-5 overflow-hidden rounded-sheet border border-line bg-surface shadow-card">
      <div className="flex min-h-[44px] flex-wrap items-center gap-x-6 gap-y-1 border-b border-line px-5 py-2.5">
        <strong className="text-[15px]">市场观测台</strong>
        <span className="flex items-center gap-2 text-[12.5px] text-ink-3">
          <span><b className="mr-1 text-amber-ink">01</b>材料扫描</span>
          <i className="not-italic text-line-strong">→</i>
          <span className="font-semibold text-ink"><b className="mr-1 text-amber-ink">02</b>话题星图</span>
          <i className="not-italic text-line-strong">→</i>
          <span><b className="mr-1 text-amber-ink">03</b>新闻流</span>
          <i className="not-italic text-line-strong">→</i>
          <span><b className="mr-1 text-amber-ink">04</b>热点观察</span>
        </span>
        <button
          type="button"
          className="ml-auto flex items-center gap-2 whitespace-nowrap text-[13px] text-ink-3"
          onClick={() => { if (focused) setFocused(null); else setMoving(!moving); }}
        >
          <span className={`inline-block size-2 rounded-full bg-hot ${moving && !focused ? "obs-beacon" : ""}`} />
          {status}
          {(focused || !moving) && <b className="text-accent-ink">▶ 继续</b>}
        </button>
      </div>

      <div className="grid lg:grid-cols-[248px_minmax(0,1fr)_308px]">
        {/* Materials */}
        <div className="border-b border-line-soft px-3 py-3 lg:border-b-0 lg:border-r">
          <h5 className="mb-2.5 px-1 text-[11px] font-semibold tracking-[0.18em] text-ink-4">01 / 材料扫描</h5>
          <div className="scrollbar-thin max-h-[540px] space-y-2 overflow-y-auto pr-1">
            {materials.map((item, i) => {
              const done = i < scanIdx % Math.max(materials.length, 1) && activeIdx === null || (scanIdx > 0 && i < (scanIdx - 1) % Math.max(materials.length, 1));
              const isActive = activeIdx === i;
              return (
                <div
                  key={item.id}
                  ref={(el) => { if (el) cardRefs.current.set(item.id, el); }}
                  className={`rounded-tile border bg-surface-2 px-2.5 py-2 transition-all duration-300 ${isActive ? "border-hot shadow-[0_0_0_2px_var(--hot-soft)]" : "border-line-soft"} ${done && !isActive ? "opacity-45" : ""}`}
                >
                  <div className="flex items-center gap-1.5 text-[11px] text-ink-4">
                    <span className="rounded-mark border border-line px-1 py-px text-ink-3">{KIND_LABEL[item.kind] ?? "新闻"}</span>
                    <span className="font-medium text-ink-2">{item.source}</span>
                    <time className="ml-auto">{fmtDayTime(item.at)}</time>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] font-medium leading-snug">{item.title}</p>
                  {item.summary && <p className="mt-0.5 line-clamp-1 text-[12px] text-ink-3">{item.summary}</p>}
                  {item.topics.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {item.topics.slice(0, 3).map((slug) => (
                        <span key={slug} data-chip={slug} className="rounded-full bg-accent-soft px-1.5 py-px text-[11px] text-accent-ink">{topicName(slug)}</span>
                      ))}
                      <span className="ml-1 text-[11px] text-ink-4">话题：{item.topics.slice(0, 3).map(topicName).join(" · ")}</span>
                    </div>
                  )}
                </div>
              );
            })}
            {materials.length === 0 && <p className="px-1 py-6 text-[13px] text-ink-3">{failed ? "观测台数据暂时不可用" : "正在等待第一批材料…"}</p>}
          </div>
        </div>

        {/* Star map */}
        <div className="relative px-2 py-3">
          <div className="mb-1 flex items-baseline justify-between px-3">
            <h5 className="text-[11px] font-semibold tracking-[0.18em] text-ink-4">02 / 话题星图</h5>
            {data && <span className="text-[11.5px] text-ink-4">{data.topics.filter((t) => t.group !== "company").length} 话题 · {data.topics.filter((t) => t.group === "company").length} 机构</span>}
          </div>
          {data ? (
            <StarMap data={data} moving={moving} focused={focused} onFocus={setFocused} />
          ) : (
            <div className="flex h-[420px] items-center justify-center text-[13px] text-ink-3">{failed ? "星图加载失败" : "星图加载中…"}</div>
          )}
          {data && (
            <p className="border-t border-line-soft px-3 pt-2 text-[11.5px] text-ink-4">
              ▶ 浏览 {data.topics.length} 个话题 · 读取于 {fmtDayTime(data.generatedAt).slice(6)}
            </p>
          )}
        </div>

        {/* Reading column */}
        <div
          className="border-t border-line-soft px-3 py-3 lg:border-l lg:border-t-0"
          onMouseEnter={() => setReading(true)}
          onMouseLeave={() => setReading(false)}
        >
          <h5 className="mb-2.5 px-1 text-[11px] font-semibold tracking-[0.18em] text-ink-4">
            {focused ? `话题聚焦 · ${topicName(focused)}` : "扫描阅读"}
          </h5>
          {focused ? (
            <div>
              {focusItems.length > 0 && (
                <div className="obs-receive rounded-tile border border-line-soft bg-surface-2 px-3 py-2.5" key={focusItems[focusPos % focusItems.length]!.id}>
                  <p className="text-[13.5px] font-medium leading-snug">{focusItems[focusPos % focusItems.length]!.title}</p>
                  <p className="mt-1 text-[11.5px] text-ink-4">{fmtDayTime(focusItems[focusPos % focusItems.length]!.at)} · {focusItems[focusPos % focusItems.length]!.source}</p>
                </div>
              )}
              <div className="mt-2 flex items-center gap-2 text-[12.5px] text-ink-3">
                <button type="button" className="rounded-control border border-line px-2 py-0.5" onClick={() => setFocusPos((p) => (p - 1 + focusItems.length) % Math.max(focusItems.length, 1))}>← 上一条</button>
                <span>{focusItems.length ? (focusPos % focusItems.length) + 1 : 0} / {focusItems.length}</span>
                <button type="button" className="rounded-control border border-line px-2 py-0.5" onClick={() => setFocusPos((p) => p + 1)}>下一条 →</button>
              </div>
              <Link to={`/topics/${focused}`} className="mt-2 inline-block text-[12.5px] text-accent-ink hover:underline">查看话题全部内容 ↗</Link>
            </div>
          ) : (
            <div className="scrollbar-thin max-h-[540px] space-y-2 overflow-y-auto pr-1">
              {results.length === 0 && <p className="px-1 py-4 text-[12.5px] leading-relaxed text-ink-3">扫描结果会出现在这里：每条材料被读完后，落到它的话题上。</p>}
              {results.map((r) => (
                <div key={r.key}>
                  <div className="obs-receive rounded-tile border border-line-soft bg-surface-2 px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] text-ink-4">
                      <span className="flex size-4.5 items-center justify-center rounded-full bg-accent-soft text-[10px] font-bold text-accent-ink">{r.item.source.slice(0, 1)}</span>
                      <span className="font-medium text-ink-2">{r.item.source}</span>
                      <span className="ml-auto">收录于 {fmtDayTime(r.item.at)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[13.5px] font-medium leading-snug">{r.item.title}</p>
                    {r.slug && <p className="mt-1 text-[11.5px] text-ink-3">扫描结果 → 话题「{topicName(r.slug)}」</p>}
                  </div>
                  <p className="obs-log-in mt-1 rounded-mark px-2 py-1 text-[11.5px] text-ink-3">
                    <b className="mr-1.5 text-amber-ink">{fmtClock(r.at)}</b>命中话题 {r.slug ? topicName(r.slug) : "—"} · 已汇入新闻流
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {spider && (
        <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full" aria-hidden>
          {spider.legs.map((leg, i) => (
            <g key={i}>
              <polyline points={leg.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--ink)" strokeWidth="1.7" />
              {leg.slice(1, -1).map((p, j) => (
                <circle key={j} cx={p.x} cy={p.y} r="3.2" fill="var(--surface)" stroke="var(--ink)" strokeWidth="1.5" />
              ))}
              <circle cx={leg[leg.length - 1]!.x} cy={leg[leg.length - 1]!.y} r="3.2" fill="var(--surface)" stroke="var(--ink)" strokeWidth="1.5" />
            </g>
          ))}
          <circle cx={spider.body.x} cy={spider.body.y} r="5.5" fill="#c2410c" stroke="var(--surface)" strokeWidth="1.5" />
        </svg>
      )}
      {focused && (
        <button
          type="button"
          onClick={() => setFocused(null)}
          className="absolute left-[268px] top-14 z-20 hidden rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-medium text-bg shadow-pop lg:block"
        >
          话题聚焦 · {topicName(focused)} ▶ 继续
        </button>
      )}
    </section>
  );
}

/** The header counter: reconciles with /api/site/pool/today every two minutes and ticks up one by one. */
export function TodayCounter({ initial }: { initial: number }) {
  const moving = useMoving();
  const [shown, setShown] = useState(initial);
  const target = useRef(initial);
  const shownRef = useRef(initial);
  shownRef.current = shown;

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch("/api/site/pool/today");
        if (!res.ok) return;
        const json = (await res.json()) as { collectedToday: number };
        if (!stop && Number.isSafeInteger(json.collectedToday)) target.current = json.collectedToday;
      } catch { /* keep the last figure */ }
    };
    const poll = window.setInterval(load, 120_000);
    const tick = window.setInterval(() => {
      if (!moving || document.hidden) return;
      if (shownRef.current < target.current) setShown((v) => v + 1);
    }, 900);
    return () => { stop = true; window.clearInterval(poll); window.clearInterval(tick); };
  }, [moving]);

  return (
    <b key={shown} className="obs-rise mx-1 text-[19px] text-hot">
      {shown.toLocaleString("zh-CN")}
    </b>
  );
}
