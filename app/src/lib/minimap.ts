/**
 * 迷你地图的几何计算（纯函数，便于自检）。
 *
 * 迷你地图把"全部数据的完整时间范围"压成一条横条，
 * 上面叠一个矩形表示当前视口。点哪里就跳到哪里。
 */
import type { TimelineEvent } from "../data/schema";
import type { Viewport } from "./viewport";

/** 时间点在全域里的位置，0..1 */
export function ratioOf(jdn: number, minJdn: number, maxJdn: number): number {
  const span = maxJdn - minJdn;
  if (span <= 0) return 0.5;
  return Math.min(1, Math.max(0, (jdn - minJdn) / span));
}

/** 全域里某个比例位置对应的时间点 */
export function jdnAtRatio(ratio: number, minJdn: number, maxJdn: number): number {
  const r = Math.min(1, Math.max(0, ratio));
  return minJdn + (maxJdn - minJdn) * r;
}

export interface DensityBin {
  /** 落在这格的事件数 */
  count: number;
  /** 这格里最高的重要度（1 最高）；没有事件为 0 */
  topImportance: number;
}

/**
 * 把事件按时间分箱，得到一条密度条。
 *
 * 事件多的时候不逐个画点，而是画 N 个柱子——200 个柱子足够看出分布，
 * 又不会因为几千个 DOM 节点拖慢界面。
 */
export function buildBins(
  events: TimelineEvent[],
  minJdn: number,
  maxJdn: number,
  bins: number
): DensityBin[] {
  const n = Math.max(1, Math.floor(bins));
  const out: DensityBin[] = Array.from({ length: n }, () => ({ count: 0, topImportance: 0 }));
  if (events.length === 0 || maxJdn <= minJdn) return out;

  for (const e of events) {
    // 用开始时间定位；区间事件不铺满，否则长事件会淹没整条
    const r = ratioOf(e.startJdn, minJdn, maxJdn);
    let idx = Math.floor(r * n);
    if (idx >= n) idx = n - 1;
    if (idx < 0) idx = 0;
    const bin = out[idx];
    bin.count += 1;
    // 1 最高，所以取最小值作为"最重要"
    bin.topImportance = bin.topImportance === 0 ? e.importance : Math.min(bin.topImportance, e.importance);
  }
  return out;
}

/** 当前视口在迷你地图上的矩形（都是 0..1 的比例） */
export interface ViewportRect {
  left: number;
  width: number;
}

export function viewportRect(vp: Viewport, minJdn: number, maxJdn: number): ViewportRect {
  const span = maxJdn - minJdn;
  if (span <= 0) return { left: 0, width: 1 };
  const viewDays = vp.pxPerDay > 0 ? vp.width / vp.pxPerDay : span;
  const left = (vp.startJdn - minJdn) / span;
  const width = viewDays / span;
  // 视口可能超出数据范围，夹到 0..1 再保证至少有一条细缝可见
  const clampedLeft = Math.min(1, Math.max(0, left));
  const clampedRight = Math.max(0, Math.min(1, left + width));
  return {
    left: clampedLeft,
    width: Math.max(0.004, clampedRight - clampedLeft),
  };
}

/** 数据的时间范围；没有事件时返回 null */
export function dataRange(events: TimelineEvent[]): { minJdn: number; maxJdn: number } | null {
  if (events.length === 0) return null;
  let minJdn = Infinity;
  let maxJdn = -Infinity;
  for (const e of events) {
    if (e.startJdn < minJdn) minJdn = e.startJdn;
    const end = e.endJdn ?? e.startJdn;
    if (end > maxJdn) maxJdn = end;
  }
  if (minJdn === maxJdn) {
    // 只有一个时间点：给一天余量，免得除零
    return { minJdn: minJdn - 1, maxJdn: maxJdn + 1 };
  }
  return { minJdn, maxJdn };
}
