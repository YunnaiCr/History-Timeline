import { useCallback, useMemo, useRef } from "react";
import type { Category, TimelineEvent } from "../data/schema";
import { buildBins, jdnAtRatio } from "../lib/minimap";
import { fromJdn, toHistoricalYear } from "../lib/time";

interface Props {
  events: TimelineEvent[];
  categories: Category[];
  /** 全域时间范围 */
  minJdn: number;
  maxJdn: number;
  /** 当前视口范围（用来画矩形） */
  viewStart: number;
  viewEnd: number;
  /** 跳转到某个时间点（居中显示） */
  onSeek: (jdn: number) => void;
}

const BINS = 220;

/** 把 jdn 标成"1911"或"前221"这类短标签 */
function shortYear(jdn: number): string {
  const { year } = fromJdn(jdn);
  const h = toHistoricalYear(year);
  return h.era === "bc" ? `前${h.value}` : `${h.value}`;
}

/**
 * 迷你地图：底部一条全局缩略轴。
 *
 * 作用只有一个——缩到很近的距离时（屏幕只显示几年），还能知道自己在整条时间轴的哪里，
 * 并且一拖就回去。
 */
export default function Minimap({
  events,
  categories,
  minJdn,
  maxJdn,
  viewStart,
  viewEnd,
  onSeek,
}: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const bins = useMemo(
    () => buildBins(events, minJdn, maxJdn, BINS),
    [events, minJdn, maxJdn]
  );
  const maxCount = useMemo(() => Math.max(1, ...bins.map((b) => b.count)), [bins]);

  const colorOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.id, c.color);
    return map;
  }, [categories]);

  // 每格代表哪种颜色：取该格里第一个事件的类别色（够用，不必精确）
  const binColors = useMemo(() => {
    const out = new Array<string>(BINS).fill("");
    const span = maxJdn - minJdn;
    if (span <= 0) return out;
    for (const e of events) {
      let idx = Math.floor(((e.startJdn - minJdn) / span) * BINS);
      if (idx >= BINS) idx = BINS - 1;
      if (idx < 0) idx = 0;
      if (!out[idx]) out[idx] = colorOf.get(e.categoryId) ?? "#8892a4";
    }
    return out;
  }, [events, minJdn, maxJdn, colorOf]);

  // 视口矩形：用当前 pxPerDay 换算成比例（不依赖外部再传一次 vp）
  const rect = useMemo(() => {
    const span = maxJdn - minJdn || 1;
    const left = (viewStart - minJdn) / span;
    const width = (viewEnd - viewStart) / span;
    const clampedLeft = Math.min(1, Math.max(0, left));
    const clampedRight = Math.max(0, Math.min(1, left + width));
    return { left: clampedLeft, width: Math.max(0.004, clampedRight - clampedLeft) };
  }, [minJdn, maxJdn, viewStart, viewEnd]);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      if (box.width <= 0) return;
      const ratio = (clientX - box.left) / box.width;
      onSeek(jdnAtRatio(ratio, minJdn, maxJdn));
    },
    [minJdn, maxJdn, onSeek]
  );

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    draggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    seekFromClientX(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    e.stopPropagation();
    seekFromClientX(e.clientX);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* 已经释放 */
    }
  };

  return (
    <div className="minimap" role="group" aria-label="全局缩略图">
      <div
        className="minimap-track"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        title="点击或拖动跳转到该位置"
      >
        {bins.map((bin, i) => {
          if (bin.count === 0) return null;
          // 高度按出现密度，最高的一格占满
          const h = 22 + 62 * Math.min(1, bin.count / maxCount);
          return (
            <span
              key={i}
              className="minimap-bar"
              style={{
                left: `${(i / BINS) * 100}%`,
                width: `${100 / BINS}%`,
                height: `${h}%`,
                background: binColors[i] || "#8892a4",
                opacity: bin.topImportance === 1 ? 0.95 : 0.6,
              }}
            />
          );
        })}

        <span
          className="minimap-view"
          style={{ left: `${rect.left * 100}%`, width: `${rect.width * 100}%` }}
        />
      </div>

      <div className="minimap-scale">
        <span>{shortYear(minJdn)}</span>
        <span>{shortYear(maxJdn)}</span>
      </div>
    </div>
  );
}
