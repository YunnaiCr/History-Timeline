/**
 * 迷你地图几何自检（纯函数）。
 * 运行：node build-m0.mjs && node selfcheck/minimapcheck.mjs
 */
const { ratioOf, jdnAtRatio, buildBins, viewportRect, dataRange } = await import(
  "../dist-src/lib/minimap.js"
);

let ok = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (cond) ok++;
};

const MIN = 1000;
const MAX = 2000;

// ---------- 比例换算 ----------
check("左端是 0", ratioOf(MIN, MIN, MAX) === 0);
check("右端是 1", ratioOf(MAX, MIN, MAX) === 1);
check("中点 0.5", Math.abs(ratioOf(1500, MIN, MAX) - 0.5) < 1e-9);
check("超出左端夹到 0", ratioOf(0, MIN, MAX) === 0);
check("超出右端夹到 1", ratioOf(9999, MIN, MAX) === 1);
check("零跨度返回中点", ratioOf(5, 5, 5) === 0.5);

check("比例还原时间点", jdnAtRatio(0.25, MIN, MAX) === 1250);
check("比例越界被夹住", jdnAtRatio(2, MIN, MAX) === MAX);
check("比例还原往返一致", jdnAtRatio(ratioOf(1234, MIN, MAX), MIN, MAX) === 1234);

// ---------- 分箱 ----------
const ev = (start, imp = 2) => ({
  id: `e${start}`,
  title: "t",
  startJdn: start,
  dateText: "",
  categoryId: "c",
  tagIds: [],
  summary: "",
  importance: imp,
});

const bins = buildBins([ev(MIN), ev(MIN), ev(1500), ev(MAX)], MIN, MAX, 10);
check("分箱数量正确", bins.length === 10);
check("总数守恒", bins.reduce((s, b) => s + b.count, 0) === 4);
check("最左一格收到两个事件", bins[0].count === 2, String(bins[0].count));
check("最右一格收到一个事件", bins[9].count === 1, String(bins[9].count));
check("中间事件落在第 5 格", bins[5].count === 1, String(bins[5].count));
check("没有事件的格子计数为 0", bins[3].count === 0, String(bins[3].count));

const multi = buildBins([ev(1500, 3), ev(1500, 1)], MIN, MAX, 10);
check("同格取最高重要度", multi[5].topImportance === 1, String(multi[5].topImportance));

check("空事件集返回全零", buildBins([], MIN, MAX, 10).every((b) => b.count === 0));
check("零跨度不崩", buildBins([ev(1500)], 1500, 1500, 10).length === 10);

// 边界：正好落在右端的事件不能越界
const edge = buildBins([ev(MAX)], MIN, MAX, 10);
check("右端事件落在最后一格", edge[9].count === 1);

// ---------- 视口矩形 ----------
const vp = (startJdn, days) => ({ startJdn, pxPerDay: 1200 / days, width: 1200 });

const full = viewportRect(vp(MIN, 1000), MIN, MAX);
check("看全域时矩形铺满", Math.abs(full.left - 0) < 1e-9 && Math.abs(full.width - 1) < 1e-9);

const mid = viewportRect(vp(1400, 200), MIN, MAX);
check("视口矩形左边界正确", Math.abs(mid.left - 0.4) < 1e-9, String(mid.left));
check("视口矩形宽度正确", Math.abs(mid.width - 0.2) < 1e-9, String(mid.width));

const outside = viewportRect(vp(-500, 100), MIN, MAX);
check("视口在数据左侧时左边界夹到 0", outside.left === 0);

const wayOut = viewportRect(vp(5000, 100), MIN, MAX);
check("视口完全在右侧时仍有最小宽度", wayOut.width >= 0.004, String(wayOut.width));

// ---------- 数据范围 ----------
check("空数据返回 null", dataRange([]) === null);

const r1 = dataRange([ev(1500), ev(1200), ev(1800)]);
check("范围取最早开始", r1.minJdn === 1200);
check("范围取最晚结束", r1.maxJdn === 1800);

const ranged = dataRange([
  { ...ev(1500), endJdn: 1900 },
  ev(1300),
]);
check("区间事件按结束时间算范围", ranged.maxJdn === 1900, String(ranged.maxJdn));

const single = dataRange([ev(1500)]);
check("只有一个时间点时给一天余量", single.minJdn === 1499 && single.maxJdn === 1501);

console.log(`\n${ok} passed.`);
process.exit(ok === 29 ? 0 : 1);
