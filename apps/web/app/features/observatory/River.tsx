import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MonitorResponse } from "@aihot/contracts/site";
import { displaySummary, displayTitle } from "../../lib/display-text";
import { SourceAvatar } from "../../components/ui/SourceAvatar";

const GROUP_COLOR: Record<string, string> = { company: "#4a6fa5", field: "#c25e3a", genre: "#b03a6b" };
const CURVE_GRAY = "#c9c2b4";

function fmtMD(iso: string): string {
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  return `${parts.find((p) => p.type === "month")?.value}/${parts.find((p) => p.type === "day")?.value}`;
}

interface Curve { d: string; color: string; key: string }

/** The 03 news river: a grid of source logos, topics + entities, the newest materials flowing in on the right. */
export function River() {
  const [data, setData] = useState<MonitorResponse | null>(null);
  const [curves, setCurves] = useState<Curve[]>([]);
  const [page, setPage] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const logoRefs = useRef(new Map<string, HTMLSpanElement>());
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

  const topicBySlug = useMemo(() => {
    const m = new Map<string, { name: string; group: string }>();
    for (const t of data?.topics ?? []) m.set(t.slug, { name: t.name, group: t.group });
    return m;
  }, [data]);

  const iconBySourceName = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const s of data?.river.sources ?? []) m.set(s.name, s.iconUrl);
    return m;
  }, [data]);

  const logoSources = useMemo(() => data?.river.sources ?? [], [data]);

  const topicTopics = useMemo(() => {
    if (!data) return [];
    return data.topics.filter((t) => t.group !== "company" && t.total > 0).sort((a, b) => b.total - a.total).slice(0, 12);
  }, [data]);

  const entityTopics = useMemo(() => {
    if (!data) return [];
    return data.topics.filter((t) => t.group === "company").sort((a, b) => b.total - a.total);
  }, [data]);

  const visibleSlugs = useMemo(() => new Set([...topicTopics, ...entityTopics].map((t) => t.slug)), [topicTopics, entityTopics]);

  const flows = useMemo(() => {
    if (!data) return [];
    const visibleSources = new Set(logoSources.map((s) => s.id));
    const agg = new Map<string, { source: string; topic: string; n: number }>();
    for (const f of data.river.flows) {
      if (!visibleSlugs.has(f.topic) || !visibleSources.has(f.source)) continue;
      const key = `${f.source}|${f.topic}`;
      const cur = agg.get(key) ?? { source: f.source, topic: f.topic, n: 0 };
      cur.n += f.n;
      agg.set(key, cur);
    }
    return [...agg.values()].sort((a, b) => b.n - a.n).slice(0, 60);
  }, [data, logoSources, visibleSlugs]);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !data) return;
    const compute = () => {
      const wr = wrap.getBoundingClientRect();
      const next: Curve[] = [];
      const strongest = flows[0]?.n ?? 0;
      for (const f of flows) {
        const sEl = logoRefs.current.get(f.source);
        const tEl = topicRefs.current.get(f.topic);
        if (!sEl || !tEl) continue;
        const sr = sEl.getBoundingClientRect();
        const tr = tEl.getBoundingClientRect();
        const x1 = sr.right - wr.left, y1 = sr.top - wr.top + sr.height / 2;
        const x2 = tr.left - wr.left, y2 = tr.top - wr.top + tr.height / 2;
        const bend = Math.max(24, (x2 - x1) / 2);
        const colored = f.n === strongest && strongest > 0;
        next.push({
          key: `${f.source}|${f.topic}`,
          d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
          color: colored ? (GROUP_COLOR[topicBySlug.get(f.topic)?.group ?? "field"]!) : CURVE_GRAY,
        });
      }
      setCurves(next);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(wrap);
    return () => { ro.disconnect(); };
  }, [data, flows, topicBySlug]);

  const feed = data?.feed.items ?? [];
  const pageCount = Math.max(1, Math.ceil(feed.length / 2));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = feed.slice(safePage * 2, safePage * 2 + 2);

  const windowRange = useMemo(() => {
    if (!feed.length) return null;
    const times = feed.map((f) => new Date(f.at).getTime()).sort((a, b) => a - b);
    return `窗口回放 · ${fmtMD(new Date(times[0]!).toISOString())} — ${fmtMD(new Date(times[times.length - 1]!).toISOString())}`;
  }, [feed]);

  const topicTag = (slugs: string[]) => {
    const names = slugs.map((s) => topicBySlug.get(s)?.name).filter(Boolean) as string[];
    if (!names.length) return null;
    return names.length > 1 ? `${names[0]} · ${names[1]}` : names[0];
  };

  return (
    <div ref={wrapRef} className="relative rounded-sheet border border-line bg-surface px-5 py-4 shadow-card">
      {windowRange && <p className="mb-1.5 text-left text-[11px] text-ink-4">{windowRange}</p>}
      <div className="mb-1 grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)_300px]">
        <h5 className="text-[11px] font-semibold tracking-[0.18em] text-ink-4">来源</h5>
        <div className="hidden gap-8 lg:flex">
          <h5 className="text-[11px] font-semibold tracking-[0.18em] text-ink-4">话题</h5>
          <h5 className="text-[11px] font-semibold tracking-[0.18em] text-ink-4">机构</h5>
        </div>
        <h5 className="hidden text-[11px] font-semibold tracking-[0.18em] text-ink-4 lg:block">正在汇入</h5>
      </div>
      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)_300px]">
        <div>
          <div className="grid grid-cols-5 gap-x-2.5 gap-y-3 py-1.5">
            {logoSources.map((s) => (
              <span key={s.id} ref={(el) => { if (el) logoRefs.current.set(s.id, el); }} title={s.name} className="inline-flex">
                <SourceAvatar name={s.name} iconUrl={s.iconUrl} size={28} />
              </span>
            ))}
          </div>
          {logoSources.length === 0 && <p className="py-4 text-[12.5px] text-ink-3">来源还在汇集…</p>}
        </div>
        <div className="hidden gap-8 lg:flex">
          <div className="min-w-0 flex-1">
            {topicTopics.map((t) => (
              <div key={t.slug} ref={(el) => { if (el) topicRefs.current.set(t.slug, el); }} className="flex items-center gap-2 py-[5px]">
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: GROUP_COLOR[t.group] }} />
                <span className="min-w-0 truncate text-[13px]">{t.name}</span>
              </div>
            ))}
            {topicTopics.length === 0 && <p className="py-4 text-[12.5px] text-ink-3">话题随收录生长。</p>}
          </div>
          <div className="min-w-0 flex-1">
            {entityTopics.map((t) => (
              <div key={t.slug} ref={(el) => { if (el) topicRefs.current.set(t.slug, el); }} className="flex items-center gap-2 py-[5px]">
                <span className="shrink-0 text-[11px] text-ink-4">—</span>
                <span className="min-w-0 truncate text-[13px]">{t.name}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="hidden lg:block">
          {pageItems.map((item) => (
            <div key={item.id} className="mb-2 rounded-tile border border-line-soft bg-surface-2 px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <SourceAvatar name={item.source} iconUrl={iconBySourceName.get(item.source) ?? null} size={16} />
                <span className="min-w-0 truncate text-[12px] font-medium text-ink-2">{item.source}</span>
                <time className="ml-auto shrink-0 text-[11px] tabular-nums text-ink-4">{fmtMD(item.at)}</time>
              </div>
              <p className="mt-1 line-clamp-2 text-[15px] font-bold leading-snug">{displayTitle(item)}</p>
              {displaySummary(item) && <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-ink-3">{displaySummary(item)}</p>}
              <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
                <span className="min-w-0 truncate text-ink-4">{topicTag(item.topics)}</span>
                {item.url && (
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-accent hover:underline">原文 ↗</a>
                )}
              </div>
            </div>
          ))}
          {feed.length === 0 && <p className="py-4 text-[12.5px] text-ink-3">材料还在汇入…</p>}
          <div className="mt-1 flex items-center justify-center gap-3 text-[12px] text-ink-4">
            <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0} className="disabled:opacity-30">← 上一组</button>
            <span className="tabular-nums">{safePage + 1} / {pageCount}</span>
            <button type="button" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={safePage >= pageCount - 1} className="disabled:opacity-30">下一组 →</button>
          </div>
        </div>
      </div>
      <svg className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block" aria-hidden>
        {curves.map((c) => (
          <path
            key={c.key}
            d={c.d}
            fill="none"
            stroke={c.color}
            strokeWidth={1}
            opacity={0.25}
          />
        ))}
      </svg>
    </div>
  );
}
