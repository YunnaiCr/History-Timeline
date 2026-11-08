/**
 * 撤销 / 重做栈自检（纯逻辑）。
 * 运行：node build-m0.mjs && node selfcheck/historycheck.mjs
 */
const { emptyHistory, pushHistory, undo, redo, HISTORY_LIMIT } = await import(
  "../dist-src/lib/history.js"
);

let ok = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (cond) ok++;
};

/** 造一个可辨识的数据版本 */
const v = (n) => ({ version: 1, events: [], categories: [], tags: [{ id: `t${n}`, name: `v${n}` }] });
const label = (d) => d.tags[0].id;

// ---------- 初始状态 ----------
check("初始没有可撤销", emptyHistory.past.length === 0);
check("初始没有可重做", emptyHistory.future.length === 0);
check("空栈撤销返回 null", undo(emptyHistory, v(0)) === null);
check("空栈重做返回 null", redo(emptyHistory, v(0)) === null);

// ---------- 一次撤销 ----------
let h = pushHistory(emptyHistory, v(1));
check("压栈后产生一步撤销", h.past.length === 1);
check("压栈会清空重做", h.future.length === 0);

let step = undo(h, v(2));
check("撤销拿回变更前快照", label(step.restore) === "t1", label(step.restore));
check("撤销后 past 少一步", step.history.past.length === 0);
check("撤销后 future 有一步", step.history.future.length === 1);
check("future 里存的是当前状态", label(step.history.future[0]) === "t2");

// ---------- 再重做 ----------
let re = redo(step.history, step.restore);
check("重做拿回撤销前的状态", label(re.restore) === "t2", label(re.restore));
check("重做后 future 清空", re.history.future.length === 0);
check("重做后 past 回到一步", re.history.past.length === 1);

// ---------- 多步往返 ----------
let multi = emptyHistory;
for (let i = 1; i <= 5; i++) multi = pushHistory(multi, v(i));
check("连续压 5 步", multi.past.length === 5);

let cur = v(6);
const restored = [];
for (let i = 0; i < 5; i++) {
  const s = undo(multi, cur);
  multi = s.history;
  cur = s.restore;
  restored.push(label(cur));
}
check("连续撤销顺序正确（后进先出）", restored.join(",") === "t5,t4,t3,t2,t1", restored.join(","));
check("撤销到底后不能再撤销", undo(multi, cur) === null);

// ---------- 新操作会清掉重做分支 ----------
let branch = undo(pushHistory(pushHistory(emptyHistory, v(1)), v(2)), v(3));
check("分支前 future 有内容", branch.history.future.length === 1);
const branched = pushHistory(branch.history, branch.restore);
check("新操作后 future 被清空", branched.future.length === 0);

// ---------- 上限 ----------
let deep = emptyHistory;
for (let i = 0; i < HISTORY_LIMIT + 20; i++) deep = pushHistory(deep, v(i));
check("past 不超过上限", deep.past.length === HISTORY_LIMIT, String(deep.past.length));
check(
  "超限时丢的是最旧的",
  label(deep.past[0]) === `t${20}`,
  label(deep.past[0])
);
check("最新的仍在栈顶", label(deep.past[deep.past.length - 1]) === `t${HISTORY_LIMIT + 19}`);

// ---------- 不可变性 ----------
const base = pushHistory(emptyHistory, v(1));
const before = JSON.stringify(base);
undo(base, v(2));
check("undo 不修改原 history 对象", JSON.stringify(base) === before);
pushHistory(base, v(9));
check("pushHistory 不修改入参", JSON.stringify(base) === before);

console.log(`\n${ok} passed.`);
process.exit(ok === 23 ? 0 : 1);
