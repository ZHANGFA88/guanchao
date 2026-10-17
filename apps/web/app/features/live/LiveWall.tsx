// 电视直播墙：与首页 05 共用一份代码（compact 变体）。
// 行为定版（样板 §9 过门 + 性能实测定版）：多窗同页静音预播为默认（wall），?mode=poster 为降级形态；
// 点选任意一窗全屏带声（进入 unMute+音量 80、退出回静音，播放器不重载）；「陪看」选中频道供陪看区跟随。
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { CHANNELS, type LiveChannel } from "./channels";

interface YTPlayer {
  unMute(): void;
  mute(): void;
  setVolume(v: number): void;
  playVideo(): void;
}

let ytPromise: Promise<void> | null = null;
function loadYT(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const w = window as unknown as { YT?: { Player: unknown }; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve();
  if (!ytPromise) {
    ytPromise = new Promise((resolve) => {
      const prev = w.onYouTubeIframeAPIReady;
      w.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve();
      };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    });
  }
  return ytPromise;
}

export function LiveWall({
  compact = false,
  watching,
  onWatch,
  poster = false,
}: {
  compact?: boolean;
  watching?: LiveChannel | null;
  onWatch?: (ch: LiveChannel) => void;
  poster?: boolean;
}) {
  const [innerWatch, setInnerWatch] = useState<LiveChannel | null>(null);
  const selected = watching !== undefined ? watching : innerWatch;
  const [status, setStatus] = useState<Record<string, string>>({});
  const [activated, setActivated] = useState<ReadonlySet<string>>(new Set());
  const cellRefs = useRef(new Map<string, HTMLElement>());
  const players = useRef(new Map<string, YTPlayer>());

  const select = (ch: LiveChannel) => {
    setInnerWatch(ch);
    onWatch?.(ch);
  };

  // 退出全屏统一回静音，播放不中断。
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        players.current.forEach((p) => {
          try {
            p.mute();
          } catch {
            /* 播放器已卸载 */
          }
        });
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const ensurePlayer = (ch: LiveChannel) => {
    void loadYT().then(() => {
      const w = window as unknown as {
        YT?: { Player: new (id: string, opts: { events: { onStateChange: (e: { data: number }) => void } }) => YTPlayer };
      };
      if (!w.YT?.Player || players.current.has(ch.no)) return;
      try {
        players.current.set(
          ch.no,
          new w.YT.Player(`lv-yt-${ch.no}`, {
            events: {
              onStateChange: (e) => {
                setStatus((s) => ({
                  ...s,
                  [ch.no]: e.data === 1 ? "直播中" : e.data === 3 ? "缓冲中" : "直播待命",
                }));
              },
            },
          }),
        );
      } catch {
        /* iframe 尚未就绪时忽略，下次点选再注册 */
      }
    });
  };

  const goFull = (ch: LiveChannel) => {
    select(ch);
    if (poster && !activated.has(ch.no)) {
      setActivated((prev) => new Set(prev).add(ch.no));
    }
    ensurePlayer(ch);
    cellRefs.current.get(ch.no)?.requestFullscreen?.().catch(() => {});
    setTimeout(() => {
      const p = players.current.get(ch.no);
      if (p) {
        try {
          p.unMute();
          p.setVolume(80);
          p.playVideo();
        } catch {
          /* 同上 */
        }
      }
    }, 350);
  };

  const seats = compact ? CHANNELS.filter((c) => c.live) : CHANNELS;
  return (
    <div className={`lv-board${compact ? " lv-compact" : ""}`}>
      {seats.map((ch) =>
        ch.live ? (
          <section
            key={ch.no}
            ref={(el) => {
              if (el) cellRefs.current.set(ch.no, el);
              else cellRefs.current.delete(ch.no);
            }}
            className={`lv-cell${selected?.no === ch.no ? " selected" : ""}`}
          >
            <div className="lv-frame">
              {(!poster || activated.has(ch.no)) && (
                <iframe
                  id={`lv-yt-${ch.no}`}
                  title={ch.name}
                  src={`https://www.youtube-nocookie.com/embed/live_stream?channel=${ch.cid}&enablejsapi=1&autoplay=1&mute=1&playsinline=1&rel=0`}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                />
              )}
              <div className="lv-veil" onClick={() => goFull(ch)}>
                <span>点击全屏播放</span>
              </div>
              <div className="lv-hint">横屏观看更佳</div>
            </div>
            <div className="lv-cap">
              <span className="lv-no">{ch.no}</span>
              <span className="lv-name">{ch.name}</span>
              <span className="lv-status">
                <span className="lv-dot" />
                {status[ch.no] ?? "直播中"}
              </span>
              <span className="lv-btns">
                {compact ? (
                  <Link className="lv-btn lv-watch" to="/live">
                    陪看
                  </Link>
                ) : (
                  <button
                    type="button"
                    className={`lv-btn lv-watch${selected?.no === ch.no ? " on" : ""}`}
                    onClick={(ev) => {
                      select(ch);
                      ev.currentTarget.blur();
                    }}
                  >
                    {selected?.no === ch.no ? "观看中" : "陪看"}
                  </button>
                )}
                <button type="button" className="lv-btn" onClick={() => goFull(ch)}>
                  全屏观看 ⛶
                </button>
              </span>
            </div>
            {!compact && <p className="lv-fig">{ch.fig}</p>}
          </section>
        ) : (
          <section key={ch.no} className="lv-cell">
            <div className="lv-frame">
              <div className="lv-pending">
                <div className="lv-stamp">待验</div>
                <div className="lv-pnote">复测窗口：亚洲日间 10:00–16:00</div>
              </div>
            </div>
            <div className="lv-cap">
              <span className="lv-no">{ch.no}</span>
              <span className="lv-name">{ch.name}</span>
              <span className="lv-status grey">
                <span className="lv-dot" />
                待验 · 暂不播出
              </span>
            </div>
            {!compact && <p className="lv-fig">{ch.fig}</p>}
          </section>
        ),
      )}
    </div>
  );
}
