import { useEffect, useRef } from "react";
import type { MonitorFeedItem } from "@aihot/contracts/site";

/**
 * Persistent canvas crawler over the observatory deck (mirrors the reference
 * observatory's scan engine, per its built JS bundle):
 * - state machine idle → crawl → tap → thread, never disappears; idles with a
 *   sine float when there is no target; body rotates toward travel direction
 *   with a capped turn rate.
 * - body: red dot r≈5.5 + breathing halo (r 9±2) + two short front antennae;
 *   26-point ribbon trail (3 parallel lines, lateral offsets -7/0/+7 tapering,
 *   ~55% alpha).
 * - 6 legs (3 per side, longitudinal offsets -8/0/8): two-segment IK legs,
 *   28px per segment, knee dot r=2.4 (white fill, dark stroke), foot dot r=1.8.
 *   Legs re-anchor continuously: when an anchor is stale or out of reach the
 *   foot extends to the new anchor within 120ms; unanchored feet splay ~38px
 *   outward. Anchors hold element references and geometry is recomputed every
 *   frame via getBoundingClientRect (scroll-following, no snapshots).
 * - tap reading: on a card, taps each [data-field] in turn — moves to the
 *   field center, anchors one leg, highlights the field ~75ms, finishes
 *   ~190ms, next field; at the tap instant 3 red bezier "suction beams" shoot
 *   from the field's left edge toward the body (hot color, 55% alpha).
 * - threads: after a card is read, a "comet thread" fires from each topic tag
 *   to the matching topic node in the star map — quadratic bezier (control
 *   point raised 90–150px), 800ms flight, 10-segment trail (alpha 0.9→0,
 *   0.012 segment spacing), head red dot r=2.6; on landing an expanding pulse
 *   ring (r→22) plus a floating "+1". Tags are staggered 0.12s.
 * - timing is event-driven: card finished → result row appended → crawl to the
 *   next card. The card highlight lasts the whole tap sequence.
 */

interface SpiderProps {
  deck: React.RefObject<HTMLElement | null>;
  getCards: () => Map<string, HTMLDivElement>;
  materials: MonitorFeedItem[];
  /** false while paused / focused / reading: the creature idles and releases its card. */
  active: boolean;
  onCardStart: (id: string) => void;
  onCardDone: (item: MonitorFeedItem) => void;
}

interface Vec { x: number; y: number }

const SEG = 28; // leg segment length
const TURN_MAX = 6.5; // rad/s
const CRAWL_SPEED = 250; // px/s
const HOT = "#e0521f";
const DARK = "#2b2620";

interface Leg {
  side: 1 | -1;
  along: number;
  anchor: { el: Element; ox: number; oy: number } | null;
  foot: Vec;
  footFrom: Vec;
  footT: number; // 0..1 re-anchor progress (120ms)
  bend: 1 | -1;
}

interface Beam { fx: number; fy: number; age: number }
interface Thread { from: Vec; toEl: Element; delay: number; t: number; landed: boolean }
interface Pulse { x: number; y: number; age: number }

function sub(a: Vec, b: Vec): Vec { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a: Vec, b: Vec): Vec { return { x: a.x + b.x, y: a.y + b.y }; }
function mul(a: Vec, s: number): Vec { return { x: a.x * s, y: a.y * s }; }
function len(a: Vec): number { return Math.hypot(a.x, a.y); }
function norm(a: Vec): Vec { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; }
function rot(a: Vec, ang: number): Vec {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

/** Two-bone IK: base → knee → target, segment lengths SEG/SEG, knee bows to `bend` side. */
function solveKnee(base: Vec, target: Vec, bend: 1 | -1): Vec {
  const d = sub(target, base);
  const dist = Math.min(Math.max(len(d), 1), SEG * 2 - 0.5);
  const dir = norm(d);
  const a1 = Math.acos(Math.min(1, Math.max(-1, (SEG * SEG + dist * dist - SEG * SEG) / (2 * SEG * dist))));
  const kneeAng = Math.atan2(dir.y, dir.x) + bend * a1;
  return add(base, { x: Math.cos(kneeAng) * SEG, y: Math.sin(kneeAng) * SEG });
}

export function Spider({ deck, getCards, materials, active, onCardStart, onCardDone }: SpiderProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const live = useRef({ active, onCardStart, onCardDone });
  live.current = { active, onCardStart, onCardDone };
  const matsRef = useRef(materials);
  matsRef.current = materials;

  useEffect(() => {
    const canvas = canvasRef.current;
    const section = deck.current;
    if (!canvas || !section) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ---- engine state -------------------------------------------------------
    const legs: Leg[] = [];
    for (const side of [1, -1] as const) {
      for (const along of [-8, 0, 8]) {
        legs.push({ side, along, anchor: null, foot: { x: 0, y: 0 }, footFrom: { x: 0, y: 0 }, footT: 1, bend: side });
      }
    }
    const S = {
      pos: { x: 120, y: 220 },
      angle: 0,
      trail: [] as Vec[],
      mode: "idle" as "idle" | "crawl" | "tap" | "thread",
      cardId: null as string | null,
      cardEl: null as HTMLElement | null,
      item: null as MonitorFeedItem | null,
      fields: [] as Element[],
      fieldIdx: 0,
      fieldT: 0, // ms inside current field
      fieldState: "move" as "move" | "hold",
      beams: [] as Beam[],
      threads: [] as Thread[],
      pulses: [] as Pulse[],
      qi: 0,
      t: 0,
    };
    let queue: string[] = [];
    let lastTs = 0;
    let raf = 0;
    let dead = false;

    const deckRect = (): DOMRect => section.getBoundingClientRect();
    const toLocal = (clientX: number, clientY: number, r: DOMRect): Vec => ({ x: clientX - r.left, y: clientY - r.top });
    const elCenter = (el: Element, r: DOMRect): Vec => {
      const b = el.getBoundingClientRect();
      return { x: b.left - r.left + b.width / 2, y: b.top - r.top + b.height / 2 };
    };

    const releaseCard = () => {
      for (const f of S.fields) (f as HTMLElement).style.outline = "";
      S.fields = [];
      for (const l of legs) l.anchor = null;
      if (S.cardId) live.current.onCardStart("");
      S.cardId = null; S.cardEl = null; S.item = null;
      S.mode = "idle";
    };

    const pickNext = () => {
      const cards = getCards();
      const mats = matsRef.current;
      if (mats.length === 0) { queue = []; return; }
      const ids = mats.map((m) => m.id);
      if (queue.join() !== ids.join()) { queue = ids; S.qi = 0; }
      for (let n = 0; n < queue.length; n++) {
        const id = queue[(S.qi + n) % queue.length]!;
        const el = cards.get(id);
        if (el) {
          S.qi = (S.qi + n + 1) % queue.length;
          return id;
        }
      }
      return null;
    };

    const startCard = (id: string) => {
      const el = getCards().get(id);
      const item = matsRef.current.find((m) => m.id === id);
      if (!el || !item) return;
      S.cardId = id; S.cardEl = el; S.item = item;
      S.fields = [...el.querySelectorAll("[data-field]")];
      S.fieldIdx = 0; S.fieldT = 0; S.fieldState = "move";
      S.mode = "crawl";
      live.current.onCardStart(id);
    };

    const fireThreads = () => {
      if (!S.cardEl) return;
      const r = deckRect();
      const tags = [...S.cardEl.querySelectorAll("[data-tag]")];
      S.threads = tags
        .map((tag, i) => {
          const slug = tag.getAttribute("data-tag");
          const node = slug ? section.querySelector(`[data-node="${slug}"]`) : null;
          if (!node) return null;
          const from = elCenter(tag, r);
          return { from, toEl: node, delay: i * 120, t: 0, landed: false } as Thread;
        })
        .filter((x): x is Thread => x !== null);
      S.mode = "thread";
    };

    const step = (ts: number) => {
      if (dead) return;
      raf = requestAnimationFrame(step);
      const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
      lastTs = ts;
      S.t += dt * 1000;
      const L = live.current;
      const r = deckRect();
      const legBase = (l: Leg): Vec => add(S.pos, rot({ x: l.along, y: l.side * 7 }, S.angle));
      const W = section.clientWidth, H = section.clientHeight;
      if (canvas.width !== W * devicePixelRatio || canvas.height !== H * devicePixelRatio) {
        canvas.width = W * devicePixelRatio;
        canvas.height = H * devicePixelRatio;
      }
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // ---- scheduler ---------------------------------------------------------
      // homing helper: turn toward the target (capped rate); when closer than the
      // turning radius, translate straight at it so arrival is guaranteed.
      const homeToward = (target: Vec, speed: number, arrive: number): boolean => {
        const d = sub(target, S.pos);
        const dist = len(d);
        if (dist <= arrive) return true;
        const want = Math.atan2(d.y, d.x);
        let da = want - S.angle;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        S.angle += Math.max(-TURN_MAX * dt, Math.min(TURN_MAX * dt, da));
        while (S.angle > Math.PI) S.angle -= Math.PI * 2;
        while (S.angle < -Math.PI) S.angle += Math.PI * 2;
        const dir = dist < 48 ? norm(d) : { x: Math.cos(S.angle), y: Math.sin(S.angle) };
        S.pos = add(S.pos, mul(dir, Math.min(speed * dt, dist)));
        return false;
      };
      if (!L.active) {
        if (S.mode !== "idle") releaseCard();
      } else if (S.mode === "idle") {
        const id = pickNext();
        if (id) startCard(id);
      }

      // ---- mode logic ---------------------------------------------------------
      if (S.mode === "crawl" && S.cardEl) {
        const target = elCenter(S.cardEl, r);
        target.x -= 40; // approach the card's left half
        if (homeToward(target, CRAWL_SPEED, 8)) { S.mode = "tap"; S.fieldT = 0; S.fieldState = "move"; }
      } else if (S.mode === "tap" && S.cardEl) {
        const field = S.fields[S.fieldIdx];
        if (!field) { fireThreads(); }
        else {
          const c = elCenter(field, r);
          if (S.fieldState === "move") {
            if (homeToward(c, 320, 6)) {
              S.fieldState = "hold"; S.fieldT = 0;
              // anchor the nearest free leg to this field
              let best: Leg | null = null; let bd = Infinity;
              for (const l of legs) {
                if (l.anchor) continue;
                const bp = legBase(l);
                const dd = len(sub(c, bp));
                if (dd < bd) { bd = dd; best = l; }
              }
              if (best) {
                const b = field.getBoundingClientRect();
                best.anchor = { el: field, ox: b.width / 2, oy: b.height / 2 };
                best.footFrom = { ...best.foot };
                best.footT = 0;
              }
              // suction beams from the field's left edge toward the body
              const b = field.getBoundingClientRect();
              for (let k = -1; k <= 1; k++) {
                S.beams.push({ fx: b.left - r.left, fy: b.top - r.top + b.height / 2 + k * 6, age: 0 });
              }
            }
          } else {
            S.fieldT += dt * 1000;
            if (S.fieldT >= 75 && !(field as HTMLElement).style.outline) {
              (field as HTMLElement).style.outline = `2px solid ${HOT}`;
              (field as HTMLElement).style.outlineOffset = "1px";
            }
            if (S.fieldT >= 190) {
              (field as HTMLElement).style.outline = "";
              for (const l of legs) if (l.anchor?.el === field) l.anchor = null;
              S.fieldIdx += 1; S.fieldState = "move"; S.fieldT = 0;
            }
          }
        }
      } else if (S.mode === "thread") {
        let pending = false;
        for (const th of S.threads) {
          if (th.delay > 0) { th.delay -= dt * 1000; pending = true; continue; }
          if (th.t < 800) { th.t += dt * 1000; pending = true; }
          else if (!th.landed) {
            th.landed = true;
            const c = elCenter(th.toEl, r);
            S.pulses.push({ x: c.x, y: c.y, age: 0 });
          }
        }
        if (!pending) {
          if (S.item) L.onCardDone(S.item);
          releaseCard();
        }
      } else if (S.mode === "idle") {
        // sine float in place
        S.pos.x += Math.sin(S.t / 1400) * 6 * dt;
        S.pos.y += Math.cos(S.t / 1100) * 5 * dt;
      }

      // ---- trail ---------------------------------------------------------------
      S.trail.push({ ...S.pos });
      if (S.trail.length > 26) S.trail.shift();

      // ---- draw ------------------------------------------------------------------
      const heading = { x: Math.cos(S.angle), y: Math.sin(S.angle) };
      const perp = { x: -heading.y, y: heading.x };

      // ribbon trail: 3 parallel lines, offsets -7/0/+7, tapering, ~55% alpha
      for (const off of [-7, 0, 7]) {
        ctx.beginPath();
        S.trail.forEach((p, i) => {
          const x = p.x + perp.x * off * (i / S.trail.length);
          const y = p.y + perp.y * off * (i / S.trail.length);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = "rgba(224,82,31,0.5)";
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      // suction beams: 3 red beziers, hot color 55% alpha, 350ms life
      S.beams = S.beams.filter((b) => b.age < 350);
      for (const b of S.beams) {
        b.age += dt * 1000;
        const a = 0.55 * (1 - b.age / 350);
        const from = { x: b.fx, y: b.fy };
        const mid = mul(add(from, S.pos), 0.5);
        const off = mul(perp, 26);
        for (const s of [-1, 0, 1]) {
          ctx.beginPath();
          ctx.moveTo(from.x, from.y + s * 3);
          ctx.quadraticCurveTo(mid.x + off.x * s, mid.y + off.y * s, S.pos.x, S.pos.y);
          ctx.strokeStyle = `rgba(224,82,31,${a.toFixed(3)})`;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      }

      // comet threads
      for (const th of S.threads) {
        if (th.delay > 0 || th.landed) continue;
        const t = Math.min(1, th.t / 800);
        const to = elCenter(th.toEl, r);
        const lift = 90 + ((th.from.x * 13 + th.from.y * 7) % 60 + 60) % 60; // 90–150px raise
        const ctrl = { x: (th.from.x + to.x) / 2, y: Math.min(th.from.y, to.y) - lift };
        const q = (tt: number): Vec => {
          const u = 1 - tt;
          return {
            x: u * u * th.from.x + 2 * u * tt * ctrl.x + tt * tt * to.x,
            y: u * u * th.from.y + 2 * u * tt * ctrl.y + tt * tt * to.y,
          };
        };
        for (let k = 9; k >= 0; k--) {
          const tt = t - k * 0.012;
          if (tt <= 0) continue;
          const p = q(tt);
          const a = 0.9 * (1 - k / 10);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.6 * (1 - k / 14), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(224,82,31,${a.toFixed(3)})`;
          ctx.fill();
        }
        const head = q(t);
        ctx.beginPath();
        ctx.arc(head.x, head.y, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = HOT;
        ctx.fill();
      }

      // landing pulses + "+1"
      S.pulses = S.pulses.filter((p) => p.age < 700);
      for (const p of S.pulses) {
        p.age += dt * 1000;
        const k = p.age / 700;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4 + 18 * k, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(224,82,31,${(0.8 * (1 - k)).toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = "bold 13px sans-serif";
        ctx.fillStyle = `rgba(224,82,31,${(1 - k).toFixed(3)})`;
        ctx.textAlign = "center";
        ctx.fillText("+1", p.x, p.y - 10 - 16 * k);
      }

      // legs (behind body)
      for (const l of legs) {
        const base = legBase(l);
        let target: Vec;
        if (l.anchor) {
          const a = l.anchor.el.getBoundingClientRect();
          target = { x: a.left - r.left + l.anchor.ox, y: a.top - r.top + l.anchor.oy };
          if (!l.anchor.el.isConnected || len(sub(target, l.foot)) > 70) {
            // stale or out of reach: re-extend within 120ms
            l.footFrom = { ...l.foot };
            l.footT = 0;
            const b = l.anchor.el.isConnected ? l.anchor.el.getBoundingClientRect() : null;
            if (b) l.anchor = { el: l.anchor.el, ox: b.width / 2, oy: b.height / 2 };
            else l.anchor = null;
          }
        } else {
          const out = rot({ x: -10, y: l.side * 36 }, S.angle);
          const flutter = Math.sin(S.t / 300 + l.along) * 3;
          target = add(base, add(out, { x: Math.cos(S.angle) * flutter, y: Math.sin(S.angle) * flutter }));
        }
        if (l.anchor && l.footT < 1) {
          l.footT = Math.min(1, l.footT + dt / 0.12);
          const e = 1 - Math.pow(1 - l.footT, 3);
          l.foot = add(l.footFrom, mul(sub(target, l.footFrom), e));
        } else {
          // ease the foot toward its target for a natural gait
          l.foot = add(l.foot, mul(sub(target, l.foot), Math.min(1, dt * 14)));
        }
        const knee = solveKnee(base, l.foot, l.bend);
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.lineTo(knee.x, knee.y);
        ctx.lineTo(l.foot.x, l.foot.y);
        ctx.strokeStyle = DARK;
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(knee.x, knee.y, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = DARK;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(l.foot.x, l.foot.y, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = DARK;
        ctx.fill();
      }

      // halo (breathing)
      const haloR = 9 + 2 * Math.sin(S.t / 380);
      ctx.beginPath();
      ctx.arc(S.pos.x, S.pos.y, haloR, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(224,82,31,0.45)";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // antennae (two short lines toward the front)
      for (const s of [-1, 1]) {
        const a = S.angle + s * 0.45;
        ctx.beginPath();
        ctx.moveTo(S.pos.x + Math.cos(a) * 4, S.pos.y + Math.sin(a) * 4);
        ctx.lineTo(S.pos.x + Math.cos(a) * 12, S.pos.y + Math.sin(a) * 12);
        ctx.strokeStyle = DARK;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      // body: red dot r≈5.5
      ctx.beginPath();
      ctx.arc(S.pos.x, S.pos.y, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = "#c2410c";
      ctx.fill();
    };

    raf = requestAnimationFrame(step);
    return () => { dead = true; cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-10 h-full w-full" aria-hidden />;
}
