/**
 * 显示文本自检：卡片、表格、详情共用同一份逻辑。
 * 运行：node build-m0.mjs && node selfcheck/displaycheck.mjs
 */
const { eventDateLabel, eventDateLabelOrDash, eventDateFullText } = await import(
  "../dist-src/lib/display.js"
);
const { toJdn } = await import("../dist-src/lib/time.js");

let ok = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (cond) ok++;
};

const ev = (extra = {}) => ({
  id: "e1",
  title: "t",
  startJdn: toJdn(-87, 3, 17),
  dateText: "公元前88年初",
  categoryId: "c",
  tagIds: [],
  summary: "",
  importance: 2,
  ...extra,
});

// ---------- 默认：完整文本 ----------
check("默认显示手写文本", eventDateLabel(ev()) === "公元前88年初", eventDateLabel(ev()));
check("没有 dateText 时退回年份", eventDateLabel(ev({ dateText: "" })) === "公元前88年");

// ---------- 只显示年份 ----------
check(
  "year 模式只给年份",
  eventDateLabel(ev({ dateDisplay: "year" })) === "公元前88年",
  eventDateLabel(ev({ dateDisplay: "year" }))
);
check(
  "year 模式也压缩同年区间",
  eventDateLabel(ev({ dateDisplay: "year", endJdn: toJdn(-87, 9, 1) })) === "公元前88年"
);

// ---------- 不显示 ----------
check("none 模式返回 null", eventDateLabel(ev({ dateDisplay: "none" })) === null);
check("表格占位符是破折号", eventDateLabelOrDash(ev({ dateDisplay: "none" })) === "—");

// ---------- 老字段兼容 ----------
check("老的 hideDate 等价于 none", eventDateLabel(ev({ hideDate: true })) === null);
check(
  "新字段优先于老字段",
  eventDateLabel(ev({ hideDate: true, dateDisplay: "full" })) === "公元前88年初"
);

// ---------- 详情用的完整说法 ----------
check(
  "详情优先用手写文本",
  eventDateFullText(ev()) === "公元前88年初"
);
check(
  "详情在 none 模式下仍然给完整文本",
  eventDateFullText(ev({ dateDisplay: "none" })) === "公元前88年初"
);

console.log(`\n${ok} passed.`);
process.exit(ok === 10 ? 0 : 1);
