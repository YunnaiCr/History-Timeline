/** 视口：把"时间"映射到"屏幕像素"的纯函数集合。 */
import type { JDN } from "./time";

export interface Viewport {
  /** 视口左边缘对应的时间 */
  startJdn: JDN;
  /** 每秒像素数（px / 天）—— 缩放的核心参数 */
  pxPerDay: number;
  /** 画布宽度（css px） */
  width: number;
}

export function jdnToX(vp: Viewport, jdn: JDN): number {
  return (jdn - vp.startJdn) * vp.pxPerDay;
}

export function xToJdn(vp: Viewport, x: number): JDN {
  return vp.startJdn + x / vp.pxPerDay;
}

/** 缩放：以 anchorX（视口内像素）为锚点，改变 pxPerDay。 */
export function zoomAt(vp: Viewport, anchorX: number, factor: number, min = 1e-5, max = 200): Viewport {
  const next = clamp(vp.pxPerDay * factor, min, max);
  const anchorJdn = xToJdn(vp, anchorX);
  const startJdn = anchorJdn - anchorX / next;
  return { ...vp, pxPerDay: next, startJdn };
}

/** 平移：按像素偏移。 */
export function panBy(vp: Viewport, dxPx: number): Viewport {
  return { ...vp, startJdn: vp.startJdn - dxPx / vp.pxPerDay };
}

/**
 * 让 [minJdn, maxJdn] 刚好铺满整个宽度（左右各留 padRatio 的空白）。
 *
 * 用于"首屏自适应"和"复位"：不管数据跨度是 200 年还是 2400 年，
 * 打开就能看到全貌，而不是撞上一片空白。
 */
export function fitRange(
  minJdn: JDN,
  maxJdn: JDN,
  width: number,
  padRatio = 0.04,
  min = 1e-4,
  max = 400
): Viewport {
  const safeMax = Math.max(minJdn + 1, maxJdn);
  const span = safeMax - minJdn;
  // 目标可视跨度 = 数据跨度 + 两侧留白
  const target = span * (1 + padRatio * 2);
  const pxPerDay = clamp(width / target, min, max);
  // 居中：左边多留一段，使数据整体落在中间
  const startJdn = minJdn - (target - span) / 2;
  return { startJdn, pxPerDay, width };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
