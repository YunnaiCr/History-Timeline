/**
 * 多时间线（库）自检：新建、重命名、删除、复制、迁移、整库解析。
 * 运行：node build-m0.mjs && node selfcheck/librarycheck.mjs
 */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const L = await import("../dist-src/lib/library.js");
const { parseAny, serializeLibrary, serializeTimeline } = await import("../dist-src/lib/io.js");
const { emptyData } = await import("../dist-src/lib/store.js");
const { sampleData } = await import("./_sample.mjs");

let ok = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (cond) ok++;
};

// ---------- 新建 ----------
const a = L.newTimeline("中国");
check("新时间线有 id", typeof a.id === "string" && a.id.length > 0);
check("新时间线名字正确", a.name === "中国");
check("新时间线是空的", a.events.length === 0);
check("新时间线带默认类别", a.categories.length === 5);
check("新时间线没有标签", a.tags.length === 0);

const b = L.newTimeline("   ");
check("空名字有兜底", b.name === "未命名时间线", b.name);
check("名字长度受限", L.newTimeline("x".repeat(80)).name.length === L.MAX_NAME);

// 复制词汇
const src = { ...a, tags: [{ id: "t1", name: "我的" }] };
const c = L.newTimeline("欧洲", { vocabFrom: src });
check("可以只复制类别和标签", c.categories.length === 5 && c.tags.length === 1);
check("复制词汇不带事件", c.events.length === 0);
check("复制的是副本不是引用", c.categories[0] !== src.categories[0]);

// ---------- 增删改 ----------
let lib = L.emptyLibrary();
check("空库默认有一条线", lib.timelines.length === 1);
check("空库 lastOpenedId 指向它", lib.lastOpenedId === lib.timelines[0].id);

const added = L.addTimeline(lib, a);
check("添加后两条线", added.timelines.length === 2);
check("添加后自动打开新的", added.lastOpenedId === a.id);

const renamed = L.renameTimeline(added, a.id, "中国史");
check("重命名生效", L.findTimeline(renamed, a.id).name === "中国史");
check("重命名为空被忽略", L.renameTimeline(added, a.id, "  ").timelines[1].name === "中国");

check("重名检测能命中", L.nameTaken(added, "中国") === true);
check("重名检测可排除自己", L.nameTaken(added, "中国", a.id) === false);

// 删除只影响自己
const withEvents = L.replaceTimeline(added, a.id, sampleData());
const removed = L.removeTimeline(withEvents, a.id);
check("删除后只剩一条", removed.timelines.length === 1);
check("其他线的数据没被动", removed.timelines[0].events.length === 0);
check("删除当前线后 lastOpenedId 转移", removed.lastOpenedId === removed.timelines[0].id);

// 复制一条线
const dup = L.duplicateTimeline(withEvents, a.id);
const copy = dup.timelines.find((t) => t.name.includes("副本"));
check("复制产生新 id", !!copy && copy.id !== a.id);
check("复制带上全部事件", !!copy && copy.events.length === sampleData().events.length);
check("改副本不影响原线", (() => {
  const edited = L.replaceTimeline(dup, copy.id, { ...copy, events: [] });
  return L.findTimeline(edited, a.id).events.length === sampleData().events.length;
})());

// replaceTimeline 不动 id / name
const replaced = L.replaceTimeline(withEvents, a.id, emptyData());
const rdoc = L.findTimeline(replaced, a.id);
check("替换内容保留 id", rdoc.id === a.id);
check("替换内容保留名字", rdoc.name === a.name);
check("替换内容确实变了", rdoc.events.length === 0);

// 视口
const withVp = L.setViewport(lib, lib.timelines[0].id, { startJdn: 123, pxPerDay: 0.5 });
check("视口能存", withVp.timelines[0].viewport.startJdn === 123);

// ---------- 统计 ----------
const stats = L.statsOf(sampleData());
check("统计事件数", stats.count === sampleData().events.length);
check("统计范围", stats.minJdn <= stats.maxJdn);
check("空库统计返回 null", L.statsOf(L.newTimeline("空")) === null);

// ---------- 旧文件迁移 ----------
const v1 = sampleData();
const migrated = L.migrateV1(v1);
check("迁移成一条线", migrated.timelines.length === 1);
check("迁移保留全部事件", migrated.timelines[0].events.length === v1.events.length);
check("迁移保留类别", migrated.timelines[0].categories.length === v1.categories.length);
check("迁移库版本是 2", migrated.version === 2);

// ---------- 整库序列化 + 解析 ----------
const lib2 = L.addTimeline(migrated, L.newTimeline("欧洲"));
const text = serializeLibrary(lib2);
const parsed = parseAny(text, emptyData());
check("整库能被解析", parsed.ok === true, parsed.error ?? "");
check("解析出两条线", parsed.ok && parsed.value.library.timelines.length === 2);
check(
  "解析后事件数一致",
  parsed.ok && parsed.value.library.timelines[0].events.length === v1.events.length
);
check("解析后名字保留", parsed.ok && parsed.value.library.timelines[1].name === "欧洲");

// 单条线导出（v1）能被当成单条线解析回来
const one = serializeTimeline({ ...lib2.timelines[0] });
const oneParsed = parseAny(one, emptyData());
check("单线导出是 timeline 类型", oneParsed.ok && oneParsed.value.kind === "timeline");
check("单线导出保住名字", oneParsed.ok && oneParsed.value.doc.name === lib2.timelines[0].name);
check(
  "单线导出保住事件数",
  oneParsed.ok && oneParsed.value.doc.events.length === v1.events.length
);

// 坏数据的整库要报错，不能半途写入
const bad = JSON.stringify({ version: 2, timelines: [{ name: "坏的", events: [{ title: "x" }] }] });
const badParsed = parseAny(bad, emptyData());
check("整库里的坏线被拒", badParsed.ok === false, badParsed.error);
check("报错指出是哪条线", badParsed.ok === false && badParsed.error.includes("坏的"), badParsed.error);

const emptyTimelines = parseAny(JSON.stringify({ version: 2, timelines: [] }), emptyData());
check("空 timelines 被拒", emptyTimelines.ok === false);

console.log(`\n${ok} passed.`);
process.exit(ok === 45 ? 0 : 1);
