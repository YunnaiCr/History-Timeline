/** 刻度尺：根据 pxPerDay 自动选粒度，并生成刻度（供 Canvas 绘制）。 */
import { toJdn, fromJdn, type JDN } from "./time";

export type TickUnit = "day" | "month" | "year" | "decade" | "century" | "millennium";

export interface Tick {
  jdn: JDN;
  x: number;
  label: string;
  major: boolean;
}

/** 每个单位大致多少天，用于估算像素间距 */
const DAYS_PER: Record<TickUnit, number> = {
  day: 1,
  month: 30.44,
  year: 365.2425,
  decade: 3652.425,
  century: 36524.25,
  millennium: 365242.5,
};

export function pickUnit(pxPerDay: number, minPx = 70): TickUnit {
  const order: TickUnit[] = ["day", "month", "year", "decade", "century", "millennium"];
  for (const u of order) {
    if (DAYS_PER[u] * pxPerDay >= minPx) return u;
  }
  return "millennium";
}

const yearLabel = (year: number) => (year <= 0 ? `前${-year + 1}` : `${year}`);

/** 生成 [fromJd, toJd] 区间内的刻度 */
export function buildTicks(fromJd: JDN, toJd: JDN, pxPerDay: number, xOf: (j: JDN) => number): Tick[] {
  const unit = pickUnit(pxPerDay);
  const ticks: Tick[] = [];

  if (unit === "day") {
    for (let j = Math.floor(fromJd); j <= toJd; j += 1) {
      const d = fromJdn(j);
      ticks.push({
        jdn: j,
        x: xOf(j),
        label: d.day === 1 ? `${d.month}月` : `${d.month}/${d.day}`,
        major: d.day === 1,
      });
    }
    return ticks;
  }

  if (unit === "month") {
    const start = fromJdn(Math.floor(fromJd));
    let y = start.year;
    let m = start.month;
    for (let guard = 0; guard < 600; guard++) {
      const jdn = toJdn(y, m, 1);
      if (jdn > toJd) break;
      ticks.push({
        jdn,
        x: xOf(jdn),
        label: m === 1 ? yearLabel(y) : `${m}月`,
        major: m === 1,
      });
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return ticks;
  }

  // 年 / 十年 / 世纪 / 千年：按公历年份对齐
  const step = unit === "year" ? 1 : unit === "decade" ? 10 : unit === "century" ? 100 : 1000;
  const fromYear = fromJdn(Math.floor(fromJd)).year;
  const toYear = fromJdn(Math.ceil(toJd)).year;
  const first = Math.floor((fromYear - 1) / step) * step + 1; // 对齐到 "…1 年" 这类世纪起点
  for (let yr = first; yr <= toYear + step; yr += step) {
    if (yr < -8000 || yr > 5000) break;
    const jdn = toJdn(yr, 1, 1);
    let label: string;
    if (unit === "year") label = yearLabel(yr);
    else if (unit === "decade") label = `${yr}s`;
    else {
      const n = step === 100 ? Math.floor((Math.abs(yr) + 99) / 100) : Math.floor((Math.abs(yr) + 999) / 1000);
      label = yr <= 0 ? (step === 100 ? `前${n}世纪` : `前${n}千纪`) : step === 100 ? `${n}世纪` : `${n}千纪`;
    }
    ticks.push({ jdn, x: xOf(jdn), label, major: true });
  }
  return ticks;
}
