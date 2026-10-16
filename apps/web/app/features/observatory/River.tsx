import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MonitorResponse } from "@aihot/contracts/site";
import { useMoving } from "./motion-store";

const GROUP_COLOR: Record<string, string> = { company: "#4a6fa5", field: "#c25e3a", genre: "#b03a6b" };
const LOGO_COLORS = ["#b3402a", "#4a6fa5", "#5c7d4f", "#b8873a", "#7a6aa8", "#4f7d74", "#a86432", "#33506e"];
const KIND_LABEL: Record<string, string> = { rss: "新闻", external: "推送", x: "推文", paper: "论文", web: "网页" };

function logoColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return LOGO_COLORS[h % LOGO_COLORS.length]!;
}

function fmtTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  return `${parts.find((p) => p.type === "hour")?.value}:${parts.find((p) => p.type === "minute")?.value}`;
}

interface Curve { d: string; color: string; w: number; key: string }

/** The 03 news river: sources on the left, topics in the middle, the newest materials flowing in on the right. */
export function River() {
  const moving = useMoving();
  const [data, setData] = useState<MonitorResponse | null>(null);
  const [curves, setCurves] = useState<Curve[]>([]);
  const [drawn, setDrawn] = useState(false);
  const [cycle, setCycle] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sourceRefs = useRef(new Map<string, HTMLDivElement>());
  const topicRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch("/api/site/monitor");
        if (res.ok && !stop) setData((await res.json()) as MonitorResponse);
      } catch { /* keep the last river */ }
    };
    void load();
    const id = window.setInterval(load, 120_000);
    return () => { stop = true; window.clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!moving) return;
    const id = window.setInterval(() => setCycle((c) => c + 1), 4_500);
    return () => window.clearInterval(id);
  }, [moving]);

  const shownSources = useMemo(() => {
    if (!data) return { rows: [] as MonitorResponse["river"]["sources"], other: 0, otherTotal: 0 };
    const rows = data.river.sources.slice(0, 8);
    const rest = data.river.sources.slice(8);
    return { rows, other: rest.length, otherTotal: rest.reduce((a, s) => a + s.total, 0) };
  }, [data]);

  const shownTopics = useMemo(() => {
    if (!data) return [];
    const withTotal = data.topics.filter((t) => t.total > 0).sort((a, b) => b.total - a.total);
    return withTotal.slice(0, 12);
  }, [data]);

  const flows = useMemo(() => {
    if (!data) return [];
    const visibleSources = new Set(shownSources.rows.map((s) => s.id));
    const visibleTopics = new Set(shownTopics.map((t) => t.slug));
    const agg = new Map<string, { source: string; topic: string; n: number }>();
    for (const f of data.river.flows) {
      if (!visibleTopics.has(f.topic)) continue;
      const source = visibleSources.has(f.source) ? f.source : shownSources.other > 0 ? "__other" : f.source;
      if (source !== "__other" && !visibleSources.has(source)) continue;
      const key = `${source}|${f.topic}`;
      const cur = agg.get(key) ?? { source, topic: f.topic, n: 0 };
      cur.n += f.n;
      agg.set(key, cur);
    }
    return [...agg.values()].sort((a, b) => b.n - a.n).slice(0, 60);
  }, [data, shownSources, shownTopics]);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !data) return;
    const compute = () => {
      const wr = wrap.getBoundingClientRect();
      const next: Curve[] = [];
      for (const f of flows) {
        const sEl = sourceRefs.current.get(f.source);
        const tEl = topicRefs.current.get(f.topic);
        if (!sEl || !tEl) continue;
        const sr = sEl.getBoundingClientRect();
        const tr = tEl.getBoundingClientRect();
        const x1 = sr.right - wr.left, y1 = sr.top - wr.top + sr.height / 2;
        const x2 = tr.left - wr.left, y2 = tr.top - wr.top + tr.height / 2;
        const bend = Math.max(30, (x2 - x1) / 2);
        const topic = data.topics.find((t) => t.slug === f.topic);
        next.push({
          key: `${f.source}|${f.topic}`,
          d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
          color: GROUP_COLOR[topic?.group ?? "field"]!,
          w: 0.8 + Math.min(f.n, 10) * 0.28,
        });
      }
      setCurves(next);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(wrap);
    const t = window.setTimeout(() => setDrawn(true), 60);
    return () => { ro.disconnect(); window.clearTimeout(t); };
  }, [data, flows]);

  const feed = data?.feed.items ?? [];
  const ingest = feed.length ? [0, 1, 2].map((k) => feed[(cycle + k) % feed.length]!) : [];

  return (
    <div ref={wrapRef} className="relative rounded-sheet border border-line bg-surface px-5 py-4 shadow-card">
      <div className="mb-1 grid gap-6 lg:grid-cols-[210px_minmax(0,1fr)_300px]">
        <h5 className="text-[11px] font-semibold tracking-[0.18em] text-ink-4">来源</h5>
        <h5 className="hidden text-[11px] font-semibold tracking-[0.18em] text-ink-4 lg:block">话题</h5>
        <h5 className="hidden text-[11px] font-semibold tracking-[0.18em] text-ink-4 lg:block">正在汇入</h5>
      </div>
      <div className="grid gap-6 lg:grid-cols-[210px_minmax(0,1fr)_300px]">
        <div>
          {shownSources.rows.map((s) => (
            <div key={s.id} ref={(el) => { if (el) sourceRefs.current.set(s.id, el); }} className="flex items-center gap-2 py-[6px]">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-tile text-[12px] font-bold text-white" style={{ background: logoColor(s.id) }}>{s.name.slice(0, 1)}</span>
              <span className="min-w-0 truncate text-[13px] font-medium">{s.name}</span>
              <span className="ml-auto text-[12px] tabular-nums text-ink-4">{s.total}</span>
            </div>
          ))}
          {shownSources.other > 0 && (
            <div ref={(el) => { if (el) sourceRefs.current.set("__other", el); }} className="flex items-center gap-2 py-[6px]">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-tile bg-bg-muted text-[12px] font-bold text-ink-3">…</span>
              <span className="min-w-0 truncate text-[13px] font-medium text-ink-3">其他 {shownSources.other} 个来源</span>
              <span className="ml-auto text-[12px] tabular-nums text-ink-4">{shownSources.otherTotal}</span>
            </div>
          )}
          {shownSources.rows.length === 0 && <p className="py-4 text-[12.5px] text-ink-3">来源还在汇集…</p>}
        </div>
        <div className="hidden lg:block">
          {shownTopics.map((t) => (
            <div key={t.slug} ref={(el) => { if (el) topicRefs.current.set(t.slug, el); }} className="flex items-center gap-2 py-[6px]">
              <span className="size-2 shrink-0 rounded-full" style={{ background: GROUP_COLOR[t.group] }} />
              <span className="min-w-0 truncate text-[13px] font-medium">{t.name}</span>
              <span className="ml-auto text-[12px] tabular-nums text-ink-4">{t.total}</span>
            </div>
          ))}
          {shownTopics.length === 0 && <p className="py-4 text-[12.5px] text-ink-3">话题随收录生长。</p>}
        </div>
        <div className="hidden lg:block">
          <div className="mb-2 rounded-tile border border-line-soft bg-surface-2 px-3 py-2.5" aria-hidden>
            <div className="h-2.5 w-3/5 animate-pulse rounded bg-bg-muted" />
            <div className="mt-2 h-2.5 w-4/5 animate-pulse rounded bg-bg-muted" />
          </div>
          {ingest.map((item, i) => (
            <div key={`${item.id}-${cycle + i}`} className="obs-receive mb-2 rounded-tile border border-line-soft bg-surface-2 px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] text-ink-4">
                <span className="rounded-mark border border-line px-1 py-px text-ink-3">{KIND_LABEL[item.kind] ?? "新闻"}</span>
                <span className="font-medium text-ink-2">{item.source}</span>
                <time className="ml-auto">{fmtTime(item.at)}</time>
              </div>
              <p className="mt-1 line-clamp-2 text-[13px] font-medium leading-snug">{item.title}</p>
            </div>
          ))}
        </div>
      </div>
      <svg className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block" aria-hidden>
        {curves.map((c, i) => (
          <path
            key={c.key}
            d={c.d}
            fill="none"
            stroke={c.color}
            strokeWidth={c.w}
            opacity={0.4}
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={drawn ? 0 : 1}
            style={{ transition: `stroke-dashoffset 0.9s cubic-bezier(0.25,1,0.5,1) ${i * 40}ms` }}
          />
        ))}
      </svg>
    </div>
  );
}
