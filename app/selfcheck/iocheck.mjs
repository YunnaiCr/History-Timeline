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

const { emptyData } = await import("../dist-src/lib/store.js");
const { serialize, parseImport, exportFileName, mergeData } = await import("../dist-src/lib/io.js");
import { sampleText, sampleData } from "./_sample.mjs";

let ok = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (cond) ok++;
};

// ================= 空库 =================
const empty = emptyData();
check("空库事件为 0", empty.events.length === 0, `${empty.events.length} 条`);
check("空库标签为 0", empty.tags.length === 0);
check("空库保留默认类别", empty.categories.length > 0, `${empty.categories.length} 个`);

// ================= 序列化往返 =================
const seed = sampleData();
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

const ww1 = round.data.events.find((e) => e.id === "e24");
const kids = round.data.events.filter((e) => e.parentId === "e24");
check("区间事件的 endJdn 保住", !!ww1 && typeof ww1.endJdn === "number");
check("父子关系保住", kids.length === 5, `${kids.length} 个子事件`);

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

// ================= 二次序列化内容稳定（导出→解析→再导出，数据不变） =================
// 注意不能直接比文本：serialize 会写入 exportedAt 时间戳。
const againData = parseImport(serialize(round.data), seed).data;
check(
  "二次解析后事件完全一致",
  JSON.stringify(againData.events) === JSON.stringify(round.data.events),
  `${againData.events.length} 条`
);
check(
  "二次解析后类别标签一致",
  JSON.stringify(againData.categories) === JSON.stringify(round.data.categories) &&
    JSON.stringify(againData.tags) === JSON.stringify(round.data.tags)
);

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

// ============ 可读格式（人手写） ============
const { parseDateIn, formatDateOut } = await import("../dist-src/lib/io.js");
const { toJdn, fromJdn, toHistoricalYear } = await import("../dist-src/lib/time.js");

// 19. 日期解析：各种写法都要认
check("解析 1911-10-10", parseDateIn("1911-10-10") === toJdn(1911, 10, 10));
check("解析 仅年份", parseDateIn("1911") === toJdn(1911, 1, 1));
check("解析 年月", parseDateIn("1911-10") === toJdn(1911, 10, 1));
check("解析 公元前221", parseDateIn("-221") === toJdn(-220, 1, 1));
check("解析 公元前221-01-01", parseDateIn("-221-01-01") === toJdn(-220, 1, 1));
check("解析 中文公元前", parseDateIn("公元前221年") === toJdn(-220, 1, 1));
check("解析 中文年月日", parseDateIn("1911年10月10日") === toJdn(1911, 10, 10));
check("解析非法输入返回 null", parseDateIn("随便写的") === null);

// 20. 导出格式：日期必须是人能读的，不能是儒略日数字
const probe = formatDateOut(toJdn(1911, 10, 10));
check("导出公元日期可读", probe === "1911-10-10", probe);
const probeBc = formatDateOut(toJdn(-220, 1, 1));
check("导出公元前日期可读", probeBc === "-221-01-01", probeBc);

// 21. 导出 → 导入 往返，公元 / 公元前都要保真
let dateRoundTrip = true;
for (const jdn of [toJdn(-220, 1, 1), toJdn(1, 1, 1), toJdn(1911, 10, 10), toJdn(2001, 12, 11)]) {
  if (parseDateIn(formatDateOut(jdn)) !== jdn) dateRoundTrip = false;
}
check("日期导出导入往返无损", dateRoundTrip);

// 22. 人手写的最小文件：没有 id、没有 categories/tags 数组
const handwritten = JSON.stringify({
  events: [
    { title: "我加的事件", start: "1911-10-10", category: "政治", tags: ["我的标签"] },
    { title: "公元前的事", start: "-221", category: "政治" },
  ],
});
const hw = parseImport(handwritten, seed);
check("手写最小文件可导入", hw.ok === true, hw.error ?? "");
check("手写事件自动生成 id", hw.ok && hw.data.events.every((e) => typeof e.id === "string" && e.id.length > 0));
// 类别名与已有类别同名时应当复用，而不是新建一个重复的
const hwCat = hw.ok && hw.data.categories.find((c) => c.id === hw.data.events[0].categoryId);
check("手写类别名复用同名类别", !!hwCat && hwCat.name === "政治", hwCat?.name);
check(
  "没有产生重复类别",
  hw.ok && new Set(hw.data.categories.map((c) => c.name)).size === hw.data.categories.length,
  hw.data ? `${hw.data.categories.length} 个` : ""
);
check("手写标签名自动创建", hw.ok && hw.data.events[0].tagIds.length === 1);
check("手写公元前日期算对了", hw.ok && fromJdn(hw.data.events[1].startJdn).year === -220);

// 23. dateText 要保留（"约公元前1046年" 这类模糊表述不能被覆盖）
const fuzzy = JSON.stringify({
  events: [{ title: "牧野之战", start: "-1046", dateText: "约公元前1046年" }],
});
const fz = parseImport(fuzzy, seed);
check("自定义 dateText 被保留", fz.ok && fz.data.events[0].dateText === "约公元前1046年", fz.data?.events[0].dateText);

// 24. parent 可以用标题引用
const withParent = JSON.stringify({
  events: [
    { title: "甲午战争", start: "1894-07-25", end: "1895-04-17", category: "战争" },
    { title: "黄海海战", start: "1894-09-17", category: "战争", parent: "甲午战争" },
  ],
});
const wp = parseImport(withParent, seed);
const parentEv = wp.ok && wp.data.events.find((e) => e.title === "甲午战争");
const kidEv = wp.ok && wp.data.events.find((e) => e.title === "黄海海战");
check("parent 用标题能解析", !!kidEv && !!parentEv && kidEv.parentId === parentEv.id);

// 25. 错误信息要说清是第几条、错在哪
const badDate = parseImport(JSON.stringify({ events: [{ title: "x", start: "不是日期" }] }), seed);
check("坏日期报错含条号", badDate.ok === false && badDate.error.includes("第 1 条"), badDate.error);
const noStart = parseImport(JSON.stringify({ events: [{ title: "x" }] }), seed);
check("缺 start 报错", noStart.ok === false, noStart.error);
const badEnd = parseImport(
  JSON.stringify({ events: [{ title: "x", start: "1911", end: "1910" }] }),
  seed
);
check("结束早于开始被拒", badEnd.ok === false, badEnd.error);

// 26. 导出再导入：事件数 / 类别 / 标签 / 区间 / 父子 全部一致
const rt = parseImport(serialize(seed), seed);
check("导出→导入事件数一致", rt.ok && rt.data.events.length === seed.events.length);
const rtWw1 = rt.data.events.find((e) => e.title === "第一次世界大战");
const rtKids = rt.data.events.filter((e) => e.parentId === rtWw1.id);
check("导出→导入区间保住", !!rtWw1 && !!rtWw1.endJdn);
check("导出→导入父子保住", rtKids.length === 5, `${rtKids.length}`);

// 27. 拒绝多层嵌套（渲染只支持一层，孙事件导入后会看不见）
const grandchild = JSON.stringify({
  events: [
    { title: "甲午战争", start: "1894-07-25", end: "1895-04-17" },
    { title: "黄海海战", start: "1894-09-17", parent: "甲午战争" },
    { title: "定远舰沉没", start: "1895-02-05", parent: "黄海海战" },
  ],
});
const gc = parseImport(grandchild, seed);
check("拒绝孙事件嵌套", gc.ok === false, gc.error ?? "竟然通过了");
check(
  "嵌套报错说清是哪一条",
  gc.ok === false && gc.error.includes("第 3 条") && gc.error.includes("定远舰沉没"),
  gc.error
);
check(
  "嵌套报错指出父事件也是子事件",
  gc.ok === false && gc.error.includes("黄海海战"),
  gc.error
);

// 两层（父 + 子）必须仍然通过
const twoLevels = parseImport(
  JSON.stringify({
    events: [
      { title: "甲午战争", start: "1894-07-25", end: "1895-04-17" },
      { title: "黄海海战", start: "1894-09-17", parent: "甲午战争" },
    ],
  }),
  seed
);
check("一层父子仍然允许", twoLevels.ok === true, twoLevels.error ?? "");

// 三条互不相关的顶层事件当然也可以
const flat = parseImport(
  JSON.stringify({
    events: [
      { title: "A", start: "1900" },
      { title: "B", start: "1901" },
      { title: "C", start: "1902" },
    ],
  }),
  seed
);
check("全顶层不受影响", flat.ok === true);

console.log(`\n${ok} passed.`);
process.exit(ok === 60 ? 0 : 1);
