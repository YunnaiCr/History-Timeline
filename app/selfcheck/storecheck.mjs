/**
 * 容器与浏览器兜底存储的自检（桌面版数据在文件里，见 repository）。
 * 运行：node build-m0.mjs && node selfcheck/storecheck.mjs
 */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const { emptyData, loadData, saveData, makeId, STORAGE_KEY } = await import(
  "../dist-src/lib/store.js"
);

let ok = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (cond) ok++;
};

// ---------- 空库 ----------
const empty = emptyData();
check("空库没有事件", empty.events.length === 0);
check("空库没有标签", empty.tags.length === 0);
check("空库保留默认类别", empty.categories.length === 5, `${empty.categories.length} 个`);
check(
  "空库类别都是不同名字",
  new Set(empty.categories.map((c) => c.name)).size === empty.categories.length
);
check("空库版本号为 1", empty.version === 1);

// 两个空库互不影响（不能共享同一个数组）
const a = emptyData();
const b = emptyData();
a.categories[0].name = "改过的名字";
check("两次构造互不共享引用", b.categories[0].name !== "改过的名字", b.categories[0].name);

// ---------- 浏览器兜底：localStorage ----------
mem.clear();
const fresh = loadData();
check("空存储返回空库", fresh.events.length === 0 && fresh.categories.length === 5);

const modified = {
  version: 1,
  events: [
    {
      id: "t1",
      title: "测试事件",
      startJdn: 2419403,
      dateText: "1912年",
      categoryId: "politics",
      tagIds: [],
      summary: "",
      importance: 2,
    },
  ],
  categories: fresh.categories,
  tags: [{ id: "tag1", name: "我的标签" }],
};
check("保存成功返回 true", saveData(modified) === true);
const back = loadData();
check("保存后能读回", back.events.length === 1 && back.events[0].title === "测试事件");
check("标签也能读回", back.tags.length === 1 && back.tags[0].name === "我的标签");

// 空的标签数组是合法状态，不能被默认值覆盖
mem.set(STORAGE_KEY, JSON.stringify({ version: 1, events: [], categories: [], tags: [] }));
const emptyTags = loadData();
check("空标签保持为空", emptyTags.tags.length === 0);
check("空类别回退到默认", emptyTags.categories.length === 5);

// 损坏数据回退空库
mem.set(STORAGE_KEY, "{ 这不是合法 JSON");
let survived = true;
let fallback;
try {
  fallback = loadData();
} catch {
  survived = false;
}
check("损坏数据不抛异常", survived);
check("损坏数据回退空库", fallback && fallback.events.length === 0);

// 版本不符也回退
mem.set(STORAGE_KEY, JSON.stringify({ version: 99, events: [{}] }));
check("版本不符回退空库", loadData().events.length === 0);

// ---------- id 生成 ----------
const ids = new Set();
for (let i = 0; i < 2000; i++) ids.add(makeId());
check("2000 次生成 id 不重复", ids.size === 2000, `唯一 ${ids.size} 个`);

console.log(`\n${ok} passed.`);
process.exit(ok === 16 ? 0 : 1);
