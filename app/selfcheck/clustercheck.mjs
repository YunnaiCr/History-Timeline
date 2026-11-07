/**
 * M2 自检：聚簇与层级（纯函数）。
 * 运行前先 `node build-m0.mjs` 生成 dist-src/lib/cluster.js。
 * 运行：node selfcheck/clustercheck.mjs
 */
import { buildNodes, importanceThresholdFor, groupChildren, isCluster, layoutClusterRow, assignLanes, CLUSTER_PX, LANE_GAP } from "../dist-src/lib/cluster.js";
import { toJdn } from "../dist-src/lib/time.js";

let ok = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (cond) ok++;
};

const mk = (id, startJdn, extra = {}) => ({
  id,
  title: `事件${id}`,
  startJdn,
  dateText: `${startJdn}`,
  categoryId: "politics",
  tagIds: [],
  summary: "",
  importance: 1,
  ...extra,
});

const base = toJdn(1900, 1, 1);
const vp = (pxPerDay) => ({ startJdn: base, pxPerDay, width: 1200 });
const D = 1; // 1 天

// 1. 挤在一起的两个点事件 → 合成一个簇
const evs1 = [mk("a", base + 1 * D), mk("b", base + 2 * D)];
check("相邻点事件合并为簇", isCluster(buildNodes(vp(1), evs1)[0]), `n=${buildNodes(vp(1), evs1).length}`);

// 2. 拉开距离后 → 两个独立事件
const far = [mk("a", base), mk("b", base + 50 * D)];
const farNodes = buildNodes(vp(1), far);
check("相距 50px 不合并", farNodes.length === 2 && farNodes.every((n) => !isCluster(n)));

// 3. 阈值边界：CLUSTER_PX 内合并、外不合并
const e3 = [mk("a", base), mk("b", base + (CLUSTER_PX - 5) * D)];
check("阈值内合并", isCluster(buildNodes(vp(1), e3)[0]));
const e4 = [mk("a", base), mk("b", base + (CLUSTER_PX + 5) * D)];
check("阈值外不合并", buildNodes(vp(1), e4).length === 2);

// 4. importance 门槛随缩放变化
check("pxPerDay=0.01 → 只显示重要事件(1)", importanceThresholdFor(0.01) === 1);
check("pxPerDay=0.05 → 门槛 2", importanceThresholdFor(0.05) === 2);
check("pxPerDay=1    → 全部显示(3)", importanceThresholdFor(1) === 3);

// 5. importance 过滤生效
const mixed = [mk("hi", base, { importance: 1 }), mk("lo", base + 100 * D, { importance: 3 })];
const shown = buildNodes(vp(0.01), mixed, 1);
check("低缩放下 importance=3 被收纳", shown.length === 1 && shown[0].kind === "event" && shown[0].event.id === "hi");

// 6. 区间事件够宽时独立成节点，不参与聚簇
const span = [mk("s", base, { endJdn: base + 30 * D }), mk("p", base + 5 * D)];
const spanNodes = buildNodes(vp(1), span);
const spanNode = spanNodes.find((n) => n.kind === "event" && n.event.id === "s");
check("宽 span 独立成节点", !!spanNode, `nodes=${spanNodes.length}`);

// 7. 窄 span 退化成点并可参与聚簇
const narrow = [mk("s", base, { endJdn: base + 2 * D }), mk("p", base + 1 * D)];
const narrowNodes = buildNodes(vp(1), narrow);
check("窄 span 参与聚簇", narrowNodes.length === 1 && isCluster(narrowNodes[0]), `nodes=${narrowNodes.length}`);

// 8. 父子分组
const kids = [
  mk("p1", base, { endJdn: base + 100 * D }),
  mk("k1", base + 10 * D, { parentId: "p1" }),
  mk("k2", base + 5 * D, { parentId: "p1" }),
  mk("k3", base + 20 * D, { parentId: "p2" }),
];
const g = groupChildren(kids);
check("父子分组正确", g.get("p1").length === 2 && g.get("p2").length === 1);
check("子事件按时间排序", g.get("p1")[0].id === "k2" && g.get("p1")[1].id === "k1");

// 9. 簇 id 稳定（由组内最早事件决定）
const stable = buildNodes(vp(1), [mk("z", base + 3 * D), mk("y", base + 1 * D)]);
check("簇 id 取自最早事件", stable[0].id === "c:y", stable[0].id);

// 10. 簇徽标单行排布：不横向重叠、不越右边界、顺序保持
const W = 1200;
const CW = 44;
const xs = layoutClusterRow([100, 105, 108, 400, 405], W);
let noOverlap = true;
for (let i = 1; i < xs.length; i++) {
  if (xs[i] < xs[i - 1] + CW) noOverlap = false;
}
check("簇徽标互不重叠", noOverlap, xs.map((v) => v.toFixed(0)).join(","));
check("簇徽标不越右边界", xs.every((v) => v + CW <= W));
check("簇徽标顺序不乱", xs.every((v, i) => i === 0 || v >= xs[i - 1]));

// 11. 只有一个簇时位置不被挪动
const single = layoutClusterRow([123], W);
check("单个簇位置保持", Math.abs(single[0] - (123 + 16)) < 1e-6, single[0].toFixed(0));

// 12. 全部挤在右边缘时仍收在画布内
const edge = layoutClusterRow([1180, 1190, 1199], W);
check("右边缘簇不溢出", edge.every((v) => v + CW <= W), edge.map((v) => v.toFixed(0)).join(","));

// ============ 卡片轨道分配：核心不变量是"同轨不重叠" ============

/** 检查结果里同一轨的任意两张卡是否横向相交 */
function hasOverlap(items, slots) {
  const byLane = new Map();
  slots.forEach((s, i) => {
    const arr = byLane.get(s.lane) ?? [];
    arr.push({ x: s.x, w: items[i].width });
    byLane.set(s.lane, arr);
  });
  for (const arr of byLane.values()) {
    arr.sort((a, b) => a.x - b.x);
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].x < arr[i - 1].x + arr[i - 1].w - 0.001) return true;
    }
  }
  return false;
}

// 13. 正常情况：轨道够用，位置不被挪动
const spread = [
  { x: 0, width: 100 },
  { x: 150, width: 100 },
  { x: 300, width: 100 },
];
const s1 = assignLanes(spread, 3);
check("轨道够用时位置不变", s1.every((s, i) => s.x === spread[i].x));
check("轨道够用时不重叠", !hasOverlap(spread, s1));

// 14. 极端拥挤：20 张卡全在同一位置，只有 2 条轨道
const crowded = Array.from({ length: 20 }, () => ({ x: 500, width: 120 }));
const s2 = assignLanes(crowded, 2);
check("拥挤时用满全部轨道", new Set(s2.map((s) => s.lane)).size === 2);
check("拥挤时不重叠（关键修复）", !hasOverlap(crowded, s2), "旧实现这里会判失败");

// 15. 顺延保持顺序：后面的卡不会跑到前面的左边
check("顺延时顺序不乱", s2.every((s, i) => i === 0 || s.x >= s2[i - 1].x - 0.001));

// 16. 顺延确实发生了（说明不是简单丢弃）
check("拥挤时发生横向顺延", s2.some((s, i) => s.x > crowded[i].x));

// 17. 单轨也能排
const oneLane = Array.from({ length: 5 }, () => ({ x: 0, width: 80 }));
const s3 = assignLanes(oneLane, 1);
check("单轨多卡不重叠", !hasOverlap(oneLane, s3));
check("单轨最小间距生效", s3[1].x - (s3[0].x + 80) >= LANE_GAP - 0.001, `间隔 ${(s3[1].x - s3[0].x - 80).toFixed(1)}px`);

// 18. 空输入安全
check("空输入返回空数组", assignLanes([], 3).length === 0);

console.log(`\n${ok} passed.`);
process.exit(ok === 27 ? 0 : 1);