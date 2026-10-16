import { useState } from "react";
import { Link } from "react-router";
import type { HotStripEntry } from "@aihot/contracts/site";

const RANK_CLASS = ["text-rank-1", "text-rank-2", "text-rank-3"];
const BAR_MAX_H = 64;
const TZ = "Asia/Shanghai";

function hrefOf(e: HotStripEntry): string {
  return e.storyPublicId ? `/story/${e.storyPublicId}` : e.itemId ? `/items/${e.itemId}` : "/hot";
}

function fmtHour(iso: string | null, backHours: number): string {
  if (!iso) return "";
  const t = new Date(new Date(iso).getTime() - backHours * 3600000);
  const p = (n: number) => String(n).padStart(2, "0");
  const parts = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).formatToParts(t);
  const g = (k: string) => parts.find((x) => x.type === k)?.value ?? "";
  return `${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
}

/** Hourly heat as vertical bars: gray bars, the tallest one orange. Real data only. */
function HeatBars({ entry }: { entry: HotStripEntry }) {
  const vals = entry.spark;
  const valid = vals ? vals.filter((v): v is number => v != null && v > 0) : [];
  // SPEC §5: insufficient heat data is labelled, never silently dropped.
  if (!vals || valid.length < 2) return <p className="text-[12.5px] text-ink-4">暂无足够热度数据</p>;
  const max = Math.max(...valid);
  const peakIdx = vals.indexOf(max);
  const n = vals.length;
  return (
    <div>
      <div className="flex h-16 items-end gap-[3px]" aria-label="热度时间轴">
        {vals.map((v, i) => (
          <div
            key={i}
            title={v != null ? `热度 ${v}` : "暂无数据"}
            className={`w-full rounded-t-[2px] ${i === peakIdx ? "bg-hot" : "bg-ink-4/45"}`}
            style={{ height: v != null && v > 0 ? `${Math.max(3, (v / max) * BAR_MAX_H)}px` : "3px", opacity: v == null ? 0.25 : 1 }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-ink-4">
        <span>{fmtHour(entry.sparkAnchor, n - 1)}</span>
        <span className="text-ink-3">{entry.participantCount} 个发声来源</span>
        <span>{fmtHour(entry.sparkAnchor, 0)}</span>
      </div>
    </div>
  );
}

/** Right column (SPEC §5, 2026-10-16 ruling): a plain "发声者列" — the sources speaking
 * about the story, name + icon + kind + count only. No post stream, no scrolling;
 * the backend stores no social posts, so nothing is fabricated. */
function Voices({ entry }: { entry: HotStripEntry }) {
  const voices = entry.participants.slice(0, 12);
  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[13px] font-bold">发声来源 <span className="font-normal text-ink-4">· 共 {entry.participantCount} 个</span></h4>
      </div>
      {voices.length === 0 ? (
        <p className="rounded-card border border-line-soft bg-surface-2 px-4 py-8 text-center text-[12.5px] text-ink-4">暂无发声数据</p>
      ) : (
        <div className="space-y-2">
          {voices.map((p, i) => (
            <div key={`${p.name}-${i}`} className="flex items-center gap-2.5 rounded-card border border-line-soft bg-surface-2 px-3 py-2">
              {p.iconUrl ? (
                <img src={p.iconUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" loading="lazy" />
              ) : (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-4/20 text-[12px] font-bold text-ink-3">
                  {p.name.slice(0, 1)}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{p.name}</p>
                <p className="text-[11px] text-ink-4">{p.kind === "editorial" ? "机构发声" : "信号来源"}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 04 热点观察：页签 + 详情 + 发声列 + 底部横条。
 * The discussion column shows the story's real speaking sources; the backend stores no
 * social posts, so no tweet cards are fabricated.
 */
export function HotWatch({ entries, stats }: { entries: HotStripEntry[]; stats?: { items: number; sources: number } | null }) {
  const [sel, setSel] = useState(0);
  if (entries.length === 0) return null;
  const top = entries.slice(0, 5);
  const cur = top[Math.min(sel, top.length - 1)];
  const counts = [cur.participantCount > 0 && `${cur.participantCount} 个发声来源`, cur.sourceCount > 0 && `${cur.sourceCount} 相关报道`].filter(Boolean);
  return (
    <div className="rounded-sheet border border-line bg-surface shadow-card">
      {/* header (§5): section title + tabs inline + stats + all-hot link, one row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-soft px-5 py-3">
        <span className="flex items-baseline gap-2">
          <span className="text-[13px] font-bold tracking-[0.12em] text-amber-ink">04 /</span>
          <span className="text-[17px] font-bold">热点观察</span>
          <span className="text-[12.5px] text-ink-3">一个热点，多种声音</span>
        </span>
        <div className="flex gap-1.5" role="tablist" aria-label="热点页签">
          {top.map((e, i) => (
            <button
              key={e.rank}
              role="tab"
              aria-selected={i === sel}
              onClick={() => setSel(i)}
              className={`rounded-full px-3 py-1 text-[12.5px] font-bold transition-colors ${
                i === sel ? "bg-hot text-white" : "bg-surface-2 text-ink-3 hover:text-accent-ink"
              }`}
            >
              {String(e.rank).padStart(2, "0")}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 text-[12px] text-ink-4">
          {stats && <span>公开材料 {stats.items} · 信源 {stats.sources}</span>}
          <Link to="/hot" className="font-semibold text-accent-ink hover:underline">全部热点 ↗</Link>
        </div>
      </div>

      {/* detail + voices */}
      <div className="grid gap-6 px-5 py-5 md:grid-cols-[1.6fr_1fr]">
        <div>
          <p className="text-[12px] font-bold tracking-wide text-hot">当前热点 {String(cur.rank).padStart(2, "0")}</p>
          <h3 className="mt-1.5 text-[24px] font-black leading-snug">{cur.title}</h3>
          {cur.summary && <p className="mt-2 text-[14px] leading-relaxed text-ink-3">{cur.summary}</p>}
          <div className="mt-4">
            <HeatBars entry={cur} />
          </div>
          {counts.length > 0 && <p className="mt-3 text-[13px] text-ink-3">{counts.join(" · ")}</p>}
          <Link to={hrefOf(cur)} className="mt-2 inline-block text-[13px] font-semibold text-accent-ink hover:underline">
            阅读完整事件与讨论 ↗
          </Link>
        </div>
        <Voices entry={cur} />
      </div>

      {/* bottom strip */}
      <div className="flex items-center gap-4 overflow-x-auto border-t border-line-soft px-5 py-3">
        <span className="shrink-0 rounded bg-hot px-2 py-0.5 text-[11.5px] font-black text-white">热点</span>
        {top.map((e, i) => (
          <button
            key={e.rank}
            onClick={() => setSel(i)}
            className={`flex min-w-0 shrink-0 items-center gap-1.5 text-[12.5px] transition-colors ${i === sel ? "font-bold text-accent-ink" : "text-ink-3 hover:text-accent-ink"}`}
          >
            <b className={RANK_CLASS[e.rank - 1] ?? "text-ink-4"}>{String(e.rank).padStart(2, "0")}</b>
            <span className="max-w-[220px] truncate">{e.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
