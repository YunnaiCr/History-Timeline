/**
 * 存储层自检：加载/保存/损坏回退/版本不符/id 唯一性。
 * 运行：node build-m0.mjs && node selfcheck/storecheck.mjs
 */
// node 里没有 localStorage，先造一个最小实现（store 只在调用时用它，import 阶段不碰）
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const { loadData, saveData, seedData, resetData, makeId, STORAGE_KEY } = await import(
  "../dist-src/lib/store.js"
);

let ok = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (cond) ok++;
};

// 1. 空存储 → 返回种子数据
mem.clear();
const fresh = loadData();
const seed = seedData();
check("空存储返回种子数据", fresh.events.length === seed.events.length, `${fresh.events.length} 条`);

// 2. 保存后能原样读回
const modified = {
  version: 1,
  events: [...fresh.events, {
    id: "test-1", title: "测试事件", startJdn: 2419403, dateText: "1912年",
    categoryId: "politics", tagIds: [], summary: "", importance: 2,
  }],
  categories: fresh.categories,
  tags: fresh.tags,
};
saveData(modified);
const back = loadData();
check("保存后能读回", back.events.length === modified.events.length, `${back.events.length} 条`);
check("读回内容一致", back.events.at(-1).title === "测试事件");

// 3. 损坏的 JSON → 回退到种子，不抛错
mem.set(STORAGE_KEY, "{ 这不是合法 JSON");
let survived = true;
let fallback;
try {
  fallback = loadData();
} catch {
  survived = false;
}
check("损坏数据不抛异常", survived);
check("损坏数据回退到种子", fallback && fallback.events.length === seed.events.length);

// 4. 版本不符 → 回退
mem.set(STORAGE_KEY, JSON.stringify({ version: 99, events: [] }));
const wrongVer = loadData();
check("版本不符回退到种子", wrongVer.version === 1 && wrongVer.events.length === seed.events.length);

// 5. 缺 categories/tags 时补齐
mem.set(STORAGE_KEY, JSON.stringify({ version: 1, events: [] }));
const partial = loadData();
check("缺失字段被补齐", partial.categories.length > 0 && partial.tags.length > 0);

// 6. id 不重复
const ids = new Set();
for (let i = 0; i < 2000; i++) ids.add(makeId());
check("2000 次生成 id 不重复", ids.size === 2000, `唯一 ${ids.size} 个`);

// 7. resetData 回到种子并落盘
mem.clear();
const afterReset = resetData();
check("resetData 返回种子", afterReset.events.length === seed.events.length);
check("resetData 已落盘", localStorage.getItem(STORAGE_KEY) !== null);

// 8. 种子数据可安全深拷贝（structuredClone 存在，说明没有函数/循环引用）
let cloneOk = true;
try {
  structuredClone(seed);
} catch {
  cloneOk = false;
}
check("种子数据可深拷贝", cloneOk);

console.log(`\n${ok} passed.`);
process.exit(ok === 11 ? 0 : 1);
