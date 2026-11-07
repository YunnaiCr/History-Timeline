/**
 * 首屏自适应自检：fitRange 必须让数据完整落在视口内并居中。
 * 运行：node build-m0.mjs && node selfcheck/fitcheck.mjs
 */
import { fitRange, xToJdn, jdnToX } from "../dist-src/lib/viewport.js";
import { toJdn } from "../dist-src/lib/time.js";
import { events } from "../dist-src/data/sampleData.js";

let ok = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (cond) ok++;
};

const W = 1200;
const minJ = Math.min(...events.map((e) => e.startJdn));
const maxJ = Math.max(...events.map((e) => e.endJdn ?? e.startJdn));

const vp = fitRange(minJ, maxJ, W, 0.04);

// 1. 最早和最晚的事件都在视口内
const xMin = jdnToX(vp, minJ);
const xMax = jdnToX(vp, maxJ);
check("最早事件在视口内", xMin >= 0, `x=${xMin.toFixed(1)}`);
check("最晚事件在视口内", xMax <= W, `x=${xMax.toFixed(1)}`);

// 2. 大致居中（左右留白接近）
const leftPad = xMin;
const rightPad = W - xMax;
check("左右留白接近", Math.abs(leftPad - rightPad) < W * 0.02, `左 ${leftPad.toFixed(0)} / 右 ${rightPad.toFixed(0)}`);

// 3. 数据占满大部分画布（不是缩成一小团）
const fill = (xMax - xMin) / W;
check("数据占画布 > 88%", fill > 0.88, `${(fill * 100).toFixed(1)}%`);

// 4. 缩放值在合法区间
check("pxPerDay 在 [1e-4, 400]", vp.pxPerDay >= 1e-4 && vp.pxPerDay <= 400, vp.pxPerDay.toExponential(3));

// 5. 退化为单点时不崩（min == max）
const single = fitRange(minJ, minJ, W, 0.04);
check("单个时间点不产生 Infinity/NaN", Number.isFinite(single.pxPerDay) && Number.isFinite(single.startJdn));

// 6. 极窄宽度也能算
const narrow = fitRange(minJ, maxJ, 60, 0.04);
check("窄视口可用", Number.isFinite(narrow.pxPerDay) && narrow.pxPerDay > 0);

// 7. 首屏不再是 1880 那种"只看 9 年"的视野
const visibleYears = W / vp.pxPerDay / 365.25;
const dataYears = (maxJ - minJ) / 365.25;
check("首屏可见年份 >= 数据跨度", visibleYears >= dataYears, `${visibleYears.toFixed(0)} 年 vs 数据 ${dataYears.toFixed(0)} 年`);

// 8. xToJdn 与 jdnToX 在 fit 后仍然自洽
const roundTrip = Math.abs(jdnToX(vp, xToJdn(vp, 600)) - 600);
check("坐标往返自洽", roundTrip < 1e-6);

console.log(`\n${ok} passed.`);
process.exit(ok === 9 ? 0 : 1);
