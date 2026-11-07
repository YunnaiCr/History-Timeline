/**
 * 子事件带排布自检：确保子事件永远不会越过轴线掉进卡片区。
 * 运行：node build-m0.mjs && node selfcheck/childbandcheck.mjs
 */
import { toJdn } from "../dist-src/lib/time.js";

const LINE_Y = 190;
const CHILD_ROWS = 3;
const CHILD_ROW_H = 20;
const CHILD_GAP_Y = 14;
const GUTTER = 16;

/**
 * 与 CanvasArea 中相同的排布算法（保持同步）。
 * 返回每个 chip 的 top / left / width。
 */
function layoutChildren(kids, { pxPerDay, startJdn, width }) {
  const jdnToX = (j) => (j - startJdn) * pxPerDay;
  const all = kids
    .map((kid) => ({ kid, desired: jdnToX(kid.startJdn) + GUTTER }))
    .filter(({ desired }) => desired >= -200 && desired <= width + 4)
    .sort((a, b) => a.kid.startJdn - b.kid.startJdn);

  const tails = new Array(CHILD_ROWS).fill(-Infinity);
  const out = [];
  for (const { kid, desired } of all) {
    const w = Math.min(168, kid.title.length * 12 + 24);
    let row = tails.findIndex((t) => t < desired - 2);
    let left = desired;
    if (row === -1) {
      row = tails.indexOf(Math.min(...tails));
      left = Math.max(desired, tails[row] + 2);
    }
    left = Math.min(Math.max(0, left), Math.max(0, width - w - 4));
    tails[row] = left + w;
    out.push({ kid, left, width: w, top: LINE_Y - CHILD_GAP_Y - (row + 1) * CHILD_ROW_H });
  }
  return out;
}

let ok = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (cond) ok++;
};

const mk = (id, year, month = 1, title = `子事件${id}`) => ({
  id,
  title,
  startJdn: toJdn(year, month, 1),
});

// 甲午战争那组：6 个子事件，跨越 1894-07 ~ 1895-04
const ww = [
  mk("a", 1894, 7, "丰岛海战"),
  mk("b", 1894, 9, "黄海海战"),
  mk("c", 1895, 1, "威海卫之战"),
  mk("d", 1895, 4, "马关条约"),
  mk("e", 1894, 8, "平壤战役"),
  mk("f", 1894, 10, "旅顺大屠杀"),
];

const base = { pxPerDay: 0.35, startJdn: toJdn(1893, 1, 1), width: 1200 };
const chips = layoutChildren(ww, base);

// 1. 所有 chip 都在轴线之上（top + 高度 < LINE_Y）
const allAbove = chips.every((c) => c.top + 18 <= LINE_Y - 4);
check("全部子事件在轴线之上", allAbove, chips.map((c) => c.top).join(","));

// 2. 最多只用 3 层
const rows = new Set(chips.map((c) => c.top));
check("层数不超过 3", rows.size <= CHILD_ROWS, `用 ${rows.size} 层`);

// 3. 同一层内不横向重叠
let overlap = false;
for (const top of rows) {
  const same = chips.filter((c) => c.top === top).sort((a, b) => a.left - b.left);
  for (let i = 1; i < same.length; i++) {
    if (same[i].left < same[i - 1].left + same[i - 1].width - 0.5) overlap = true;
  }
}
check("同一层内无横向重叠", !overlap);

// 4. 子事件不丢（6 个都在）
check("子事件不丢失", chips.length === ww.length, `${chips.length}/${ww.length}`);

// 5. 横向位置贴近真实时间（未被迫右推时误差很小）
const jdnToX = (j) => (j - base.startJdn) * base.pxPerDay;
const drift = Math.max(...chips.map((c) => Math.abs(c.left - (jdnToX(c.kid.startJdn) + GUTTER))));
check("时间定位误差可接受", drift < 260, `最大偏移 ${drift.toFixed(0)}px`);

// 6. 极端挤压：视口内同一个月的 10 个子事件，仍然不越界、不丢失
const tight = Array.from({ length: 10 }, (_, i) => mk(`t${i}`, 1896, 6, `事件${i}`));
const tightChips = layoutChildren(tight, base);
check("极端挤压仍不越界", tightChips.every((c) => c.top + 18 <= LINE_Y - 4));
check("极端挤压不丢事件", tightChips.length === 10, `${tightChips.length}/10`);

// 7. 放大后能铺开（视口跟着移到事件附近，层数应当变少）
const zoomed = layoutChildren(ww, {
  pxPerDay: 3,
  startJdn: toJdn(1894, 6, 1),
  width: 1200,
});
const zoomRows = new Set(zoomed.map((c) => c.top)).size;
check("放大后用更少的层", zoomed.length > 0 && zoomRows <= 2, `${zoomed.length} 个 / ${zoomRows} 层`);

console.log(`\n${ok} passed.`);
process.exit(ok === 8 ? 0 : 1);
