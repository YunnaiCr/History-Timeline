/**
 * 备份策略自检：时间戳解析、是否该新建备份、间隔描述。
 * 运行：node build-m0.mjs && node selfcheck/backupcheck.mjs
 */
const { formatStamp, parseStamp, shouldCreateBackup, describeInterval } = await import(
  "../dist-src/lib/backup.js"
);

let ok = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (cond) ok++;
};

// ---------- 时间戳格式 ----------
const t = new Date(2026, 10, 8, 14, 2, 33).getTime();
check("formatStamp 格式正确", formatStamp(t) === "20261108-140233", formatStamp(t));
check("parseStamp 能读回", parseStamp(`x.backup-${formatStamp(t)}.json`) === t);
check("parseStamp 处理个位数补零", formatStamp(new Date(2026, 0, 5, 9, 8, 7).getTime()) === "20260105-090807");

// ---------- 非法输入 ----------
check("没有时间戳返回 null", parseStamp("history-timeline.json") === null);
check("月份非法返回 null", parseStamp("x.backup-20261308-140233.json") === null);
check("小时非法返回 null", parseStamp("x.backup-20261108-250233.json") === null);
check("日期非法返回 null", parseStamp("x.backup-20261132-140233.json") === null);

// ---------- 是否该备份 ----------
const NOW = new Date(2026, 10, 8, 15, 0, 0).getTime();
const MIN = 60_000;

check("没有备份时立刻建一份", shouldCreateBackup(null, NOW, 10) === true);
check("刚备份过不重复建", shouldCreateBackup(NOW - 3 * MIN, NOW, 10) === false);
check("超过间隔要建", shouldCreateBackup(NOW - 11 * MIN, NOW, 10) === true);
check("正好到间隔就建", shouldCreateBackup(NOW - 10 * MIN, NOW, 10) === true);
check("间隔 0 表示不备份", shouldCreateBackup(null, NOW, 0) === false);
check("负数间隔也不备份", shouldCreateBackup(null, NOW, -5) === false);

// 时钟回拨（同步盘把文件时间改早了）也要能继续备份，不能卡死
check("时钟回拨时仍会备份", shouldCreateBackup(NOW + 5 * MIN, NOW, 10) === true);

// 极端：间隔 1 天
check("一天的间隔内不重复建", shouldCreateBackup(NOW - 23 * 60 * MIN, NOW, 1440) === false);

// ---------- 描述文字 ----------
check("描述：不备份", describeInterval(0) === "不备份", describeInterval(0));
check("描述：分钟", describeInterval(10) === "约每 10 分钟一份", describeInterval(10));
check("描述：整小时", describeInterval(120) === "约每 2 小时一份", describeInterval(120));
check("描述：非整小时仍用分钟", describeInterval(90) === "约每 90 分钟一份", describeInterval(90));

console.log(`\n${ok} passed.`);
process.exit(ok === 19 ? 0 : 1);
