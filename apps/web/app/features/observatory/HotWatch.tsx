import { Link } from "react-router";
import type { HotStripEntry } from "@aihot/contracts/site";
import { IconTrendDown, IconTrendUp } from "../../components/icons";

const RANK_CLASS = ["text-rank-1", "text-rank-2", "text-rank-3"];

function hrefOf(e: HotStripEntry): string {
  return e.storyPublicId ? `/story/${e.storyPublicId}` : e.itemId ? `/items/${e.itemId}` : "/hot";
}

/** The 04 hot watch: the ranked stories with their heat and trend, and the top-five strip underneath. */
export function HotWatch({ entries }: { entries: HotStripEntry[] }) {
  if (entries.length === 0) return null;
  const top = entries.slice(0, 5);
  return (
    <div className="rounded-sheet border border-line bg-surface shadow-card">
      <ol>
        {top.map((e, i) => (
          <li key={e.rank} className={i > 0 ? "border-t border-line-soft" : ""}>
            <Link to={hrefOf(e)} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2">
              <span className={`w-6 text-center text-[17px] font-black ${RANK_CLASS[i] ?? "text-ink-4"}`}>{e.rank}</span>
              <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{e.title}</span>
              {e.participantCount > 0 && <span className="hidden whitespace-nowrap text-[12px] text-ink-4 md:block">{e.participantCount} 人发声</span>}
              <span className="whitespace-nowrap text-[12.5px] text-ink-3"><b className="text-[14px] text-hot">{e.heat}</b> 热度</span>
              {e.trend === "up" && <IconTrendUp size={14} strokeWidth={2.2} className="text-hot" aria-label="热度上升" />}
              {e.trend === "down" && <IconTrendDown size={14} strokeWidth={2.2} className="text-ink-4" aria-label="热度回落" />}
              {e.trend === "new" && <span className="rounded-full bg-accent-soft px-1.5 text-[10.5px] font-semibold leading-4 text-accent-ink">新</span>}
            </Link>
          </li>
        ))}
      </ol>
      <div className="flex gap-2 overflow-x-auto border-t border-line-soft px-5 py-3">
        {top.map((e) => (
          <Link key={e.rank} to={hrefOf(e)} className="flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[12px] text-ink-2 hover:text-accent-ink">
            <b className={RANK_CLASS[e.rank - 1] ?? "text-ink-4"}>{e.rank}</b>
            <span className="max-w-[220px] truncate">{e.title}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
