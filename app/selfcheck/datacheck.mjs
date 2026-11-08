/**
 * 示例数据完整性自检：标题不重复、id 不重复、父子关系合法。
 * 数据来自仓库根的 samples/sample.json（应用本身不再内置示例）。
 * 运行：node build-m0.mjs && node selfcheck/datacheck.mjs
 */
import { sampleData } from "./_sample.mjs";

const { events, categories, tags } = sampleData();

let ok = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (cond) ok++;
};

const ids = events.map((e) => e.id);
const idSet = new Set(ids);

// 1. id 唯一
const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
check("事件 id 唯一", dupIds.length === 0, dupIds.join(","));

// 2. 标题唯一（重复标题会让"按标题引用父事件"变得不可靠）
const titles = events.map((e) => e.title);
const dupTitles = [...new Set(titles.filter((t, i) => titles.indexOf(t) !== i))];
check("事件标题唯一", dupTitles.length === 0, dupTitles.join(" / "));

// 3. 每个 parentId 都指向存在的事件
const orphans = events.filter((e) => e.parentId && !idSet.has(e.parentId));
check(
  "没有指向不存在父事件的子事件",
  orphans.length === 0,
  orphans.map((o) => `${o.title}->${o.parentId}`).join(", ")
);

// 4. 父事件是区间事件
const badParents = events.filter((e) => {
  if (!e.parentId) return false;
  const p = events.find((x) => x.id === e.parentId);
  return p && p.endJdn === undefined;
});
check("父事件都是区间事件", badParents.length === 0, badParents.map((x) => x.title).join(","));

// 5. 子事件的时间落在父事件区间内
const outOfRange = [];
for (const e of events) {
  if (!e.parentId) continue;
  const p = events.find((x) => x.id === e.parentId);
  if (!p || p.endJdn === undefined) continue;
  const end = e.endJdn ?? e.startJdn;
  if (e.startJdn < p.startJdn || end > p.endJdn) outOfRange.push(e.title);
}
check("子事件时间在父区间内", outOfRange.length === 0, outOfRange.join(","));

// 6. 类别 / 标签引用都存在
const catIds = new Set(categories.map((c) => c.id));
const tagIds = new Set(tags.map((t) => t.id));
const badCat = events.filter((e) => !catIds.has(e.categoryId));
const badTag = events.filter((e) => e.tagIds.some((t) => !tagIds.has(t)));
check("类别引用都存在", badCat.length === 0, badCat.map((e) => e.title).join(","));
check("标签引用都存在", badTag.length === 0, badTag.map((e) => e.title).join(","));

// 7. 每条事件都有 dateText
const noDateText = events.filter((e) => !e.dateText || !e.dateText.trim());
check("每条事件都有 dateText", noDateText.length === 0, noDateText.map((e) => e.title).join(","));

// 8. importance 取值合法
const badImp = events.filter((e) => ![1, 2, 3].includes(e.importance));
check("importance 都是 1/2/3", badImp.length === 0, badImp.map((e) => e.title).join(","));

// 9. 规模合理（这份示例是用来演示的，不能太少）
check("示例事件数不少于 40", events.length >= 40, `${events.length} 条`);
check("示例包含父子层级", events.filter((e) => e.parentId).length >= 10, `${events.filter((e) => e.parentId).length} 个`);

console.log(`\n${ok} passed.`);
process.exit(ok === 11 ? 0 : 1);
