import { useEffect, useMemo, useRef, useState } from "react";
import type { MonitorResponse } from "@aihot/contracts/site";
import { useMoving } from "./motion-store";

type Topic = MonitorResponse["topics"][number];

const W = 680;
const H = 560;
const CX = 340;
const CY = 272;
const R_OUT = 256;

// 星盘刻度层（SPEC §3，与样板同参数）：环带半径与 layout 的 ringRadius 一致；刻度每 15°、每 45° 加长并标度数。
const BAND_RADII = [74, 148, 224];
const TICKS = Array.from({ length: 24 }, (_, i) => {
  const deg = i * 15;
  const a = ((deg - 90) * Math.PI) / 180;
  const long = deg % 45 === 0;
  const r1 = R_OUT - (long ? 10 : 5);
  return {
    deg, long,
    x1: CX + Math.cos(a) * r1, y1: CY + Math.sin(a) * r1,
    x2: CX + Math.cos(a) * R_OUT, y2: CY + Math.sin(a) * R_OUT,
    lx: CX + Math.cos(a) * (R_OUT - 22), ly: CY + Math.sin(a) * (R_OUT - 22),
  };
});

const PALETTES: Record<string, string[]> = {
  company: ["#4a6fa5", "#6387b8", "#86a8cc", "#3a5a8c"],
  field: ["#c25e3a", "#cf7a45", "#b3402a", "#cf9a4a", "#a86432"],
  genre: ["#b03a6b", "#7a6aa8", "#4f7d74", "#5c7d4f"],
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Placed {
  topic: Topic;
  x: number;
  y: number;
  cloud: number;
  particles: Array<{ dx: number; dy: number; r: number; fill: string; o: number }>;
  // 集群浮动参数（SPEC §3 浮动口径，样板同参数）：振幅 4–8px、周期 6–12s、双轴独立、逐节点错相，皆由 slug 种子决定。
  fAx: number;
  fAy: number;
  fTx: number;
  fTy: number;
  fPx: number;
  fPy: number;
}

function layout(topics: Topic[], pairs: MonitorResponse["pairs"]): Map<string, Placed> {
  const pairWeight = new Map<string, Map<string, number>>();
  for (const [a, b, w] of pairs) {
    if (!pairWeight.has(a)) pairWeight.set(a, new Map());
    if (!pairWeight.has(b)) pairWeight.set(b, new Map());
    pairWeight.get(a)!.set(b, w);
    pairWeight.get(b)!.set(a, w);
  }
  const placed = new Map<string, Placed>();
  const byTotal = [...topics].sort((a, b) => b.total - a.total);
  const ringRadius = (t: Topic) => (t.group === "company" ? 224 : t.group === "field" ? 148 : 74);
  const companies = byTotal.filter((t) => t.group === "company");
  companies.forEach((t, i) => {
    const ang = -Math.PI / 2 + (i / Math.max(companies.length, 1)) * Math.PI * 2;
    place(t, CX + Math.cos(ang) * 224, CY + Math.sin(ang) * 224);
  });
  for (const t of byTotal) {
    if (placed.has(t.slug)) continue;
    const r = ringRadius(t);
    // Angle: pulled toward the weighted average angle of already-placed neighbours; golden angle otherwise.
    let sx = 0, sy = 0, sw = 0;
    for (const [slug, w] of pairWeight.get(t.slug) ?? []) {
      const p = placed.get(slug);
      if (!p) continue;
      const ang = Math.atan2(p.y - CY, p.x - CX);
      sx += Math.cos(ang) * w; sy += Math.sin(ang) * w; sw += w;
    }
    const ang = sw > 0 ? Math.atan2(sy, sx) + (hash(t.slug) % 40 - 20) * 0.01 : hash(t.slug) % 628 / 100;
    place(t, CX + Math.cos(ang) * r, CY + Math.sin(ang) * r);
  }
  function place(t: Topic, x: number, y: number) {
    const rand = rng(hash(t.slug));
    const cloud = Math.min(52, Math.max(15, 13 + Math.sqrt(t.total) * 6));
    const n = Math.round(Math.min(150, Math.max(12, 10 + Math.sqrt(t.total) * 18)));
    const palette = PALETTES[t.group] ?? PALETTES.field!;
    const particles = Array.from({ length: n }, () => {
      const a = rand() * Math.PI * 2;
      const d = Math.abs(rand() + rand() - 1) * cloud;
      return { dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.92, r: 1.0 + rand() * 1.2, fill: palette[Math.floor(rand() * palette.length)]!, o: 0.45 + rand() * 0.5 };
    });
    placed.set(t.slug, {
      topic: t, x, y, cloud, particles,
      fAx: 4 + rand() * 4, fAy: 4 + rand() * 4,
      fTx: 6000 + rand() * 6000, fTy: 6000 + rand() * 6000,
      fPx: rand() * Math.PI * 2, fPy: rand() * Math.PI * 2,
    });
  }
  // Relaxation: keep clouds apart and inside the disc.
  const list = [...placed.values()];
  for (let it = 0; it < 70; it++) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!, b = list[j]!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.1;
        const need = a.cloud + b.cloud + 16;
        if (d < need) {
          const push = ((need - d) / 2) * 0.5;
          const ux = dx / d, uy = dy / d;
          a.x -= ux * push; a.y -= uy * push;
          b.x += ux * push; b.y += uy * push;
        }
      }
    }
    for (const p of list) {
      const dx = p.x - CX, dy = p.y - CY;
      const d = Math.hypot(dx, dy);
      const max = R_OUT - p.cloud * 0.4 - 4;
      if (d > max) { p.x = CX + (dx / d) * max; p.y = CY + (dy / d) * max; }
    }
  }
  return placed;
}

export function StarMap({ data, focused, onFocus, scanSlug, scanSeq }: {
  data: MonitorResponse;
  focused: string | null;
  onFocus: (slug: string | null) => void;
  /** 扫描命中的话题（引擎 onCardDone 透传）：样式与 hover 同等的自动高亮，优先级低于 focused/hover。 */
  scanSlug?: string | null;
  /** 扫描命中序号（每次 onCardDone 递增）：同话题连续命中时靠它重启涟漪动画。 */
  scanSeq?: number;
}) {
  const placed = useMemo(() => layout(data.topics, data.pairs), [data]);
  const [hovered, setHovered] = useState<string | null>(null);
  // 浮动总开关：站内动效开关关闭或系统 prefers-reduced-motion 时，集群静止于锚点（SPEC §3）。
  const moving = useMoving();
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const fn = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  const floatOnRef = useRef(true);
  floatOnRef.current = moving && !reducedMotion;
  // 命中特效（涟漪 + 「+1」）：只由扫描命中触发，hover/focus 不触发；1.6s 后随动画结束撤下。
  const [hitFx, setHitFx] = useState<{ slug: string; seq: number } | null>(null);
  useEffect(() => {
    if (!scanSlug || !scanSeq) return;
    setHitFx({ slug: scanSlug, seq: scanSeq });
    const id = window.setTimeout(() => {
      setHitFx((cur) => (cur && cur.seq === scanSeq ? null : cur));
    }, 1600);
    return () => window.clearTimeout(id);
  }, [scanSlug, scanSeq]);
  const groupRefs = useRef(new Map<string, SVGGElement>());
  const edgeRefs = useRef(new Map<string, SVGPathElement>());
  const dotRefs = useRef(new Map<string, SVGCircleElement>());
  const active = focused ?? hovered ?? scanSlug ?? null;

  const neighbours = useMemo(() => {
    if (!active) return null;
    const set = new Set<string>([active]);
    for (const [a, b] of data.pairs) { if (a === active) set.add(b); if (b === active) set.add(a); }
    return set;
  }, [active, data.pairs]);

  const topPartners = useMemo(() => {
    if (!active) return [];
    return data.pairs
      .filter(([a, b]) => a === active || b === active)
      .map(([a, b, w]) => ({ slug: a === active ? b : a, w, edge: `${a}|${b}` }))
      .sort((x, y) => y.w - x.w)
      .slice(0, 3);
  }, [active, data.pairs]);

  const hotEdges = useMemo(() => topPartners.map((p, i) => ({ ...p, idx: i })), [topPartners]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      const pos = new Map<string, { x: number; y: number }>();
      const floatOn = floatOnRef.current;
      for (const p of placed.values()) {
        // 集群浮动：绕锚点双轴正弦微漂（缓入缓出），关动效时回锚点静止。
        const x = floatOn ? p.x + Math.sin((ts / p.fTx) * Math.PI * 2 + p.fPx) * p.fAx : p.x;
        const y = floatOn ? p.y + Math.sin((ts / p.fTy) * Math.PI * 2 + p.fPy) * p.fAy : p.y;
        pos.set(p.topic.slug, { x, y });
        groupRefs.current.get(p.topic.slug)?.setAttribute("transform", `translate(${x},${y})`);
      }
      if (ts - last > 33) {
        last = ts;
        for (const [a, b] of data.pairs) {
          const el = edgeRefs.current.get(`${a}|${b}`);
          const A = pos.get(a), B = pos.get(b);
          if (el && A && B) el.setAttribute("d", edgePath(A, B));
        }
      }
      // red hotspots travelling along the top-3 co-occurrence edges of the active node
      for (const e of hotEdges) {
        const dot = dotRefs.current.get(e.edge);
        if (!dot) continue;
        const pair = data.pairs.find(([a, b]) => `${a}|${b}` === e.edge);
        if (!pair) continue;
        const A = pos.get(pair[0]), B = pos.get(pair[1]);
        if (!A || !B) continue;
        const tt = (ts / 850 + e.idx * 0.33) % 1;
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        const cx = mx + (CX - mx) * 0.14, cy = my + (CY - my) * 0.14;
        const u = 1 - tt;
        dot.setAttribute("cx", String(u * u * A.x + 2 * u * tt * cx + tt * tt * B.x));
        dot.setAttribute("cy", String(u * u * A.y + 2 * u * tt * cy + tt * tt * B.y));
        dot.setAttribute("opacity", "0.95");
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [placed, data.pairs, hotEdges]);

  const activePlaced = active ? placed.get(active) : null;

  /** Tiered label sizes by cumulative count (spec §3): 20 / 17 / 15 / 13px; companies stay 12px + count. */
  const labelSize = (t: Topic): number => {
    if (t.group === "company") return 12;
    if (t.total >= 1000) return 20;
    if (t.total >= 100) return 17;
    if (t.total >= 10) return 15;
    return 13;
  };

  return (
    <div className="relative">
      <style>{`
        .obs-edge-hot { animation: edge-grow 0.38s ease-out; }
        @keyframes edge-grow { from { stroke-width: 1.1; } to { stroke-width: 2.6; } }
      `}</style>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="话题星图">
        <circle cx={CX} cy={CY} r={R_OUT} fill="none" stroke="var(--line)" strokeWidth="1" />
        {BAND_RADII.map((r) => (
          <circle key={r} cx={CX} cy={CY} r={r} fill="none" stroke="var(--ink)" strokeOpacity={0.13} />
        ))}
        {TICKS.map((t) => (
          <line key={t.deg} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="var(--ink)" strokeOpacity={t.long ? 0.5 : 0.3} />
        ))}
        {TICKS.filter((t) => t.long).map((t) => (
          <text key={`deg-${t.deg}`} x={t.lx} y={t.ly} fontSize={9} fill="var(--ink)" fillOpacity={0.55} textAnchor="middle" dominantBaseline="middle">
            {t.deg}°
          </text>
        ))}
        {data.pairs.map(([a, b, w]) => {
          const A = placed.get(a), B = placed.get(b);
          if (!A || !B) return null;
          const hot = active !== null && (a === active || b === active);
          const dim = active !== null && !hot;
          return (
            <path
              key={`${a}|${b}`}
              ref={(el) => { if (el) edgeRefs.current.set(`${a}|${b}`, el); }}
              className={hot ? "obs-edge-hot" : undefined}
              d={edgePath(A, B)}
              fill="none"
              stroke={hot ? "#e0521f" : (PALETTES[A.topic.group] ?? PALETTES.field!)[0]}
              strokeWidth={hot ? 1.7 : 0.6 + Math.min(w, 24) * 0.045}
              opacity={dim ? 0.05 : hot ? 0.95 : 0.3}
            />
          );
        })}
        {hotEdges.map((e) => (
          <circle
            key={`hot-${e.edge}`}
            ref={(el) => { if (el) dotRefs.current.set(e.edge, el); else dotRefs.current.delete(e.edge); }}
            r="3"
            fill="#e0521f"
            opacity="0"
          />
        ))}
        {[...placed.values()].map((p) => {
          const dim = neighbours !== null && !neighbours.has(p.topic.slug);
          const hoveredNow = p.topic.slug === active;
          return (
            <g
              key={p.topic.slug}
              data-node={p.topic.slug}
              ref={(el) => { if (el) groupRefs.current.set(p.topic.slug, el); }}
              transform={`translate(${p.x},${p.y})`}
              opacity={dim ? 0.25 : 1}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHovered(p.topic.slug)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onFocus(focused === p.topic.slug ? null : p.topic.slug)}
            >
              <circle r={p.cloud + 6} fill="transparent" />
              {p.particles.map((pt, i) => (
                <circle key={i} cx={pt.dx} cy={pt.dy} r={pt.r} fill={pt.fill} opacity={pt.o} />
              ))}
              <text
                textAnchor="middle"
                dy="0.35em"
                fontSize={labelSize(p.topic)}
                fontWeight={hoveredNow ? 700 : 500}
                fill={hoveredNow ? "#e0521f" : "var(--ink-2)"}
                style={{ paintOrder: "stroke", stroke: "var(--surface)", strokeWidth: 3, strokeLinejoin: "round" }}
              >
                {p.topic.name}
              </text>
              {/* 所有节点名下常驻计数（SPEC §3 改裁 2026-10-17 21:12）：话题=组色、机构=灰字，命中/hover 与名称同变热点色。 */}
              <text
                textAnchor="middle"
                dy="1.5em"
                fontSize="9.5"
                fill={hoveredNow ? "#e0521f" : p.topic.group === "company" ? "var(--ink-4)" : (PALETTES[p.topic.group] ?? PALETTES.field!)[0]}
                opacity="0.9"
              >
                {p.topic.total.toLocaleString()}
              </text>
              {/* 扫描命中特效（SPEC §3，与样板同参数）：细墨涟漪 2 环（第二环迟 190ms）+「+1」上浮；
                  挂在节点组内，随集群浮动同行、落点不脱靶；仅扫描命中触发，hover/focus 不触发。 */}
              {hitFx && hitFx.slug === p.topic.slug && (
                <g key={hitFx.seq} pointerEvents="none">
                  {[0, 0.19].map((delay) => (
                    <circle key={delay} r={6} fill="none" stroke="var(--ink)" strokeWidth={1.2} strokeOpacity={0}>
                      <animate attributeName="r" values={`6;${p.cloud + 30}`} dur="1.06s" begin={`${delay}s`} fill="freeze" />
                      <animate attributeName="stroke-opacity" values="0.5;0" dur="1.06s" begin={`${delay}s`} fill="freeze" />
                    </circle>
                  ))}
                  <text textAnchor="middle" y={-14} fontSize={12} fontWeight={600} fill="#e0521f" opacity={0}>
                    +1
                    <animate attributeName="y" values="-14;-36" dur="1.4s" fill="freeze" />
                    <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.7;1" dur="1.4s" fill="freeze" />
                  </text>
                </g>
              )}
            </g>
          );
        })}
        {focused && placed.get(focused) && (
          <circle
            data-node-target={focused}
            cx={placed.get(focused)!.x}
            cy={placed.get(focused)!.y}
            r="4"
            fill="#c2410c"
            stroke="var(--surface)"
            strokeWidth="1.5"
          />
        )}
      </svg>
      {hovered && activePlaced && !focused && (
        <div
          className="pointer-events-none absolute z-10 max-w-[250px] rounded-tile bg-ink px-3 py-2 text-[12px] leading-relaxed text-bg shadow-pop"
          style={{ left: `${(activePlaced.x / W) * 100}%`, top: `${(activePlaced.y / H) * 100}%`, transform: "translate(14px, -50%)" }}
        >
          <b className="text-amber">{activePlaced.topic.name}</b>
          <span> · 累计 {activePlaced.topic.total.toLocaleString()} 条</span>
          {topPartners.length > 0 && (
            <div>常一起出现：{topPartners.map((p) => `${placed.get(p.slug)?.topic.name ?? p.slug} ${p.w}`).join(" · ")}</div>
          )}
        </div>
      )}
    </div>
  );
}

function edgePath(A: { x: number; y: number }, B: { x: number; y: number }): string {
  const mx = (A.x + B.x) / 2;
  const my = (A.y + B.y) / 2;
  const cpx = mx + (CX - mx) * 0.14;
  const cpy = my + (CY - my) * 0.14;
  return `M ${A.x} ${A.y} Q ${cpx} ${cpy} ${B.x} ${B.y}`;
}
