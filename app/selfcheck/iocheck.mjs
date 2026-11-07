/**
 * 导入 / 导出 / 合并 / 清空 的自检（纯逻辑，不碰 DOM 下载）。
 * 运行：node build-m0.mjs && node selfcheck/iocheck.mjs
 */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const { seedData, loadData, clearData, saveData } = await import("../dist-src/lib/store.js");
const { serialize, parseImport, exportFileName, mergeData } = await import("../dist-src/lib/io.js");

let ok = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (cond) ok++;
};

// ================= 清空 =================
clearData();
const afterClear = loadData();
check("清空后事件为 0", afterClear.events.length === 0, `${afterClear.events.length} 条`);
check("清空后标签为 0", afterClear.tags.length === 0);
check("清空后保留类别", afterClear.categories.length > 0, `${afterClear.categories.length} 个`);
check("清空已落盘", localStorage.getItem("history-timeline.v1") !== null);

// ================= 序列化往返 =================
mem.clear();
const seed = seedData();
const json = serialize(seed);

let parsedOk = true;
try {
  JSON.parse(json);
} catch {
  parsedOk = false;
}
check("导出的是合法 JSON", parsedOk);

const round = parseImport(json, seed);
check("往返解析成功", round.ok === true, round.error ?? "");
check(
  "往返事件数一致",
  round.data.events.length === seed.events.length,
  `${round.data.events.length}/${seed.events.length}`
);
check("往返类别数一致", round.data.categories.length === seed.categories.length);
check("往返标签数一致", round.data.tags.length === seed.tags.length);

const ww1 = round.data.events.find((e) => e.id === "d-ww1");
const kids = round.data.events.filter((e) => e.parentId === "d-ww1");
check("区间事件的 endJdn 保住", !!ww1 && typeof ww1.endJdn === "number");
check("父子关系保住", kids.length === 6, `${kids.length} 个子事件`);

const e7 = round.data.events.find((e) => e.id === "e7");
check("标签数组保住", !!e7 && e7.tagIds.length > 0);

// ================= 坏数据要拒绝 =================
const bad1 = parseImport("{ 不是 json", seed);
check("拒绝非 JSON", bad1.ok === false, bad1.error);

const bad2 = parseImport(JSON.stringify({ events: [{ id: "x" }] }), seed);
check("拒绝缺字段的事件", bad2.ok === false, bad2.error);

const bad3 = parseImport(JSON.stringify({ categories: [] }), seed);
check("拒绝没有 events 的文件", bad3.ok === false, bad3.error);

const partial = parseImport(JSON.stringify({ events: [] }), seed);
check("缺字段时用当前库补齐", partial.ok && partial.data.categories.length > 0);

// ================= 文件名 =================
const name = exportFileName(new Date(2026, 10, 6));
check("导出文件名带日期", name.includes("2026-11-06") && name.endsWith(".json"), name);

// ================= 落盘再读回 =================
saveData(round.data);
const reread = loadData();
check("导入后可落盘再读回", reread.events.length === seed.events.length);

// ================= 合并（不覆盖） =================
const mkEvent = (id, title, extra = {}) => ({
  id,
  title,
  startJdn: 2419403,
  dateText: "1912年",
  categoryId: "politics",
  tagIds: [],
  summary: "",
  importance: 2,
  ...extra,
});

const current = {
  version: 1,
  events: [mkEvent("a1", "已有事件A"), mkEvent("a2", "已有事件B")],
  categories: [{ id: "politics", name: "政治", color: "#e05c5c" }],
  tags: [{ id: "t1", name: "民国" }],
};

const incoming = {
  version: 1,
  events: [
    mkEvent("n1", "新事件1"),
    mkEvent("n2", "新事件2", { tagIds: ["t1"] }),
    mkEvent("a1", "与新库 id 冲突的事件"),
  ],
  categories: [
    { id: "politics", name: "政治", color: "#e05c5c" },
    { id: "geo", name: "地理", color: "#4f9d69" },
  ],
  tags: [
    { id: "t1", name: "民国" },
    { id: "t2", name: "晚清" },
  ],
};

const m = mergeData(current, incoming);
check("合并后事件数 = 2 + 3", m.data.events.length === 5, `${m.data.events.length}`);
check("合并保留原有事件", m.data.events.some((e) => e.id === "a1" && e.title === "已有事件A"));
check("合并追加了新事件", m.data.events.some((e) => e.title === "新事件1"));
check("id 冲突被重新分配", m.renamed === 1, `renamed=${m.renamed}`);
check("冲突事件没有被覆盖", m.data.events.filter((e) => e.id === "a1").length === 1);
check("同名类别复用不重复", m.data.categories.filter((c) => c.name === "政治").length === 1);
check("新类别被追加", m.data.categories.some((c) => c.name === "地理") && m.newCategories === 1);
check("同名标签复用", m.data.tags.filter((t) => t.name === "民国").length === 1);
check("新标签被追加", m.data.tags.some((t) => t.name === "晚清") && m.newTags === 1);
check("标签引用被重映射", m.data.events.find((e) => e.title === "新事件2").tagIds.length === 1);

const m2 = mergeData(m.data, incoming);
check("重复合并仍在增长但不报错", m2.data.events.length === 8, `${m2.data.events.length}`);

// ================= 子事件 parentId 重映射 =================
const withKids = {
  version: 1,
  events: [
    mkEvent("p", "父事件", { endJdn: 2419500 }),
    mkEvent("k", "子事件", { parentId: "p" }),
  ],
  categories: [{ id: "politics", name: "政治", color: "#e05c5c" }],
  tags: [],
};
const base2 = {
  version: 1,
  events: [mkEvent("p", "我自己的父事件")],
  categories: [{ id: "politics", name: "政治", color: "#e05c5c" }],
  tags: [],
};
const m3 = mergeData(base2, withKids);
const mergedKid = m3.data.events.find((e) => e.title === "子事件");
const mergedParent = m3.data.events.find((e) => e.title === "父事件");
check(
  "子事件 parentId 跟着重映射",
  !!mergedKid && mergedKid.parentId !== "p" && mergedKid.parentId === mergedParent.id,
  `${mergedKid?.parentId}`
);

console.log(`\n${ok} passed.`);
process.exit(ok === 30 ? 0 : 1);
