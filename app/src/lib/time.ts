/**
 * 时间核心：所有时间统一用"儒略日 (Julian Day)"存成整数。
 * 好处：
 *  - 公元前直接被支持（负数/小正数都行），不用区分 BC/AD 分支；
 *  - 排序、比较、求差全是整数运算，没有时区/夏令时问题；
 *  - 后续换 SQLite 时直接存 INTEGER。
 *
 * 公历 -> 儒略日 用标准的 Fliegel–Van Flandern 算法（适用于公元 -4712 年以后）。
 */

export type JDN = number;

/** 公历日期 -> 儒略日（时间部分忽略，按当天 0 点算） */
export function toJdn(year: number, month = 1, day = 1): JDN {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

/** 儒略日 -> 公历（用于显示） */
export function fromJdn(jdn: JDN): { year: number; month: number; day: number } {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = 100 * b + d - 4800 + Math.floor(m / 10);
  return { year, month, day };
}

/**
 * 历史纪年 ↔ 天文纪年。
 *
 * 内部统一用天文纪年（year 0 = 公元前 1 年），因为这样公元前后的加减连续、无断点。
 * 界面上给用户看的是历史纪年（公元前 221 年 / 公元 1912 年）。
 *
 *   历史「公元前 221 年」 → 天文 -220 年
 *   历史「公元前 1 年」   → 天文 0 年
 *   历史「公元 1 年」     → 天文 1 年
 */
export const BC_OFFSET = 1;

/** 历史纪年 → 天文年（era: "bc" 表示公元前） */
export function fromHistoricalYear(era: "bc" | "ad", yearValue: number): number {
  return era === "bc" ? BC_OFFSET - yearValue : yearValue;
}

/** 天文年 → 历史纪年（拆成 公元前/公元 + 正数年份） */
export function toHistoricalYear(year: number): { era: "bc" | "ad"; value: number } {
  return year <= 0 ? { era: "bc", value: BC_OFFSET - year } : { era: "ad", value: year };
}

/** 公元前 N 年 → 儒略日（N 为正整数） */
export function bcToJdn(yearBC: number, month = 1, day = 1): JDN {
  return toJdn(fromHistoricalYear("bc", yearBC), month, day);
}

/** 历史纪年的显示文本："公元前221年" / "1912年" */
export function formatHistoricalYear(era: "bc" | "ad", yearValue: number): string {
  return era === "bc" ? `公元前${yearValue}年` : `${yearValue}年`;
}

/**
 * 只显示年份时的文本："公元前88年"，区间事件则 "公元前88–前80年"。
 * 用于卡片上的「只显示年份」模式。
 */
export function yearOnlyText(startJdn: JDN, endJdn?: JDN): string {
  const s = toHistoricalYear(fromJdn(startJdn).year);
  const start = formatHistoricalYear(s.era, s.value);
  if (endJdn === undefined) return start;
  const e = toHistoricalYear(fromJdn(endJdn).year);
  if (e.era === s.era && e.value === s.value) return start;
  const end = e.era === "bc" ? `前${e.value}年` : `${e.value}年`;
  return `${start}–${end}`;
}

/** 儒略日 -> 大致年份（小数），用于粗粒度定位 */
export function jdnToFractionalYear(jdn: JDN): number {
  // 以 1 年 = 365.2425 天近似，足够画刻度和缩放
  const { year, month, day } = fromJdn(jdn);
  const yearStart = toJdn(year, 1, 1);
  const nextStart = toJdn(year + 1, 1, 1);
  const frac = (toJdn(year, month, day) - yearStart) / (nextStart - yearStart);
  return year + frac;
}

/** 格式化成年份文本："公元前1046年" / "1912年" / "1912-01" */
export function formatJdn(jdn: JDN, granularity: "century" | "decade" | "year" | "month" | "day" = "year"): string {
  const { year, month, day } = fromJdn(jdn);
  const hist = toHistoricalYear(year);
  const isBc = hist.era === "bc";
  const yLabel = formatHistoricalYear(hist.era, hist.value);
  if (granularity === "century") {
    const century = Math.floor((hist.value - 1) / 100) + 1;
    return isBc ? `公元前${century}世纪` : `公元${century}世纪`;
  }
  if (granularity === "decade") {
    const decade = Math.floor(hist.value / 10) * 10;
    return isBc ? `公元前${decade}年代` : `${decade}年代`;
  }
  if (granularity === "month") return `${yLabel}${month}月`;
  if (granularity === "day") return `${yLabel}${month}月${day}日`;
  return yLabel;
}
