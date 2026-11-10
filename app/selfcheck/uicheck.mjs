/**
 * UI 回归自检：把踩过的坑固化成断言，防止以后改回去。
 *
 * 坑 1：<label> 里包 <button>。HTML 规定 <label> 会把点击转发给内部第一个
 *   "可标注元素"，而 <button> 恰恰算可标注元素 —— 点标题右侧或选项行空白处
 *   会误选中第一个 chip。
 *
 * 坑 2：时间轴元素挂原生 title=。浏览器会额外弹一个黑框，和我们自己的悬浮窗叠在一起。
 *
 * 坑 3：空状态用"视口内节点数为 0"当条件。那样缩放到没有事件的年代也会弹提示，
 *   误导用户以为是筛选问题。正确条件是"筛选后的列表为空"。
 *
 * 运行：node selfcheck/uicheck.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}

/** 去掉 JSX 注释 {/* *\/} 和 // 行注释，避免注释里的示例文字被当成真实标签 */
const stripComments = (src) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const files = walk(SRC);
let ok = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
  if (cond) ok++;
};

// ---------- 坑 1：<label> 内不得包含 <button> ----------
const labelViolations = [];
for (const f of files) {
  const text = stripComments(readFileSync(f, "utf8"));
  let idx = 0;
  while ((idx = text.indexOf("<label", idx)) !== -1) {
    const close = text.indexOf("</label>", idx);
    if (close === -1) break;
    const block = text.slice(idx, close);
    if (block.includes("<button")) {
      const line = text.slice(0, idx).split("\n").length;
      labelViolations.push(`${relative(SRC, f)}:${line}`);
    }
    idx = close + 8;
  }
}
check("<label> 内不含 <button>", labelViolations.length === 0, labelViolations.join(", "));

// ---------- 坑 2：child-chip / cluster-badge 不得有原生 title= ----------
const nativeTitleViolations = [];
for (const f of files) {
  const text = stripComments(readFileSync(f, "utf8"));
  for (const cls of ['className="child-chip"', 'className="cluster-badge"']) {
    let idx = 0;
    while ((idx = text.indexOf(cls, idx)) !== -1) {
      const tail = text.slice(idx, idx + 900);
      const docEnd = tail.search(/>\s*\n/);
      const elem = docEnd === -1 ? tail : tail.slice(0, docEnd);
      if (/\btitle=/.test(elem)) {
        const line = text.slice(0, idx).split("\n").length;
        nativeTitleViolations.push(`${relative(SRC, f)}:${line} (${cls})`);
      }
      idx += cls.length;
    }
  }
}
check("时间轴元素无原生 title=", nativeTitleViolations.length === 0, nativeTitleViolations.join(", "));

// ---------- 坑 3：空状态只能由"筛选后为空"触发 ----------
const canvasSrc = stripComments(readFileSync(join(SRC, "components/CanvasArea.tsx"), "utf8"));
const emptyMatch = canvasSrc.match(/\{([^{}]+?)&&\s*\(?\s*<div\s+className="empty-state"/);
check("存在空状态提示", !!emptyMatch);
const cond = emptyMatch ? emptyMatch[1].trim() : "";
check("空状态条件基于筛选结果", cond.includes("events.length === 0"), `条件: ${cond || "(未匹配)"}`);
check("空状态不引用视口变量", !/placed(Cards|Clusters)/.test(cond), `条件: ${cond}`);

// ---------- 坑 4：悬浮窗会盖住卡片底部的快捷按钮 ----------
// 悬浮窗位置在弹出时算定、之后不跟随鼠标，鼠标移到 .card-actions 上就会被压住，
// 所以指针落在按钮区时必须主动隐藏悬浮窗。
check(
  "指针在卡片按钮上时隐藏悬浮窗",
  /overCardActions/.test(canvasSrc) && /className="card-actions"[\s\S]{0,120}onMouseEnter=\{hideHover\}/.test(canvasSrc)
);

// ---------- 坑 5：簇徽标箭头方向 ----------
// 徽标贴在轴线上、点开后内容在轴线下方，所以用 ↓ 而不是 ↑。
check("簇徽标用 ↓", /className="cluster-icon">↓</.test(canvasSrc) && !/className="cluster-icon">↑</.test(canvasSrc));

// ---------- 坑 6：卡片浮起/z-index 必须由 CSS :hover 驱动 ----------
// 底部按钮伸出卡片之外，指针落在按钮上时我们会隐藏悬浮窗；
// 若浮起跟着 JS 状态走，卡片会瞬间掉层，按钮被邻居卡片盖住。
const cssSrc = readFileSync(join(SRC, "styles.css"), "utf8");
const hoverRule = cssSrc.match(/\.event-card:hover\s*\{([^}]*)\}/);
check("卡片浮起挂在 CSS :hover", !!hoverRule);
check(
  "CSS :hover 抬高了层叠",
  !!hoverRule && /z-index:\s*\d+/.test(hoverRule[1]),
  hoverRule ? hoverRule[1].replace(/\s+/g, " ").trim().slice(0, 80) : ""
);

// ---------- 坑 7：详情面板的层叠 ----------
// 面板在画布内部时，一旦卡片被加了 transform/hover 形成层叠上下文，
// 排序就不可预测（实测会被悬停卡片盖住）。所以面板必须 portal 到 body。
const panelIdx = canvasSrc.indexOf('className="detail-panel"');
const panelBodyIdx = panelIdx === -1 ? -1 : canvasSrc.indexOf("document.body", panelIdx);
const lastCreatePortal = canvasSrc.lastIndexOf("createPortal(", panelIdx);
check(
  "详情面板 portal 到 body",
  panelIdx !== -1 && panelBodyIdx !== -1 && lastCreatePortal !== -1 && panelBodyIdx - panelIdx < 4000
);
const panelRule = cssSrc.match(/\.detail-panel\s*\{([^}]*)\}/);
check("详情面板用 fixed 定位", !!panelRule && /position:\s*fixed/.test(panelRule[1]));
check(
  "详情面板 z-index 足够高",
  !!panelRule && Number((panelRule[1].match(/z-index:\s*(\d+)/) ?? [])[1] ?? 0) >= 900,
  panelRule ? (panelRule[1].match(/z-index:\s*\d+/) ?? [""])[0] : ""
);

// ---------- 附加：确认修复真的落地 ----------
const dialog = readFileSync(join(SRC, "components/EventDialog.tsx"), "utf8");
check("类别/标签/重要度用 div 容器", (dialog.match(/<div className="dlg-field">/g) ?? []).length >= 3);
check("chip 按钮都写了 type=button", dialog.includes('type="button"'));

// ---------- 坑 8：编辑必须真的落进当前时间线 ----------
// 多时间线上线时踩过：setData 用 useCallback([currentId]) 捕获了 id，
// 而 mutate 是空依赖的 useCallback，捕获的是**首次渲染**的 setData——
// 那时 currentId 还是 null，于是所有编辑静默变成空操作（事件看似保存了，实际没写进库）。
// 修复方式：setData 通过 ref 读当前 id，自身保持稳定。
const appSrc = readFileSync(join(SRC, "App.tsx"), "utf8");
check("App 有用 currentId 的 ref", /currentIdRef\s*=\s*useRef/.test(appSrc));
check(
  "写入当前时间线时读的是 ref 而不是状态变量",
  /setLibrary\(\(lib\)\s*=>\s*\{[\s\S]{0,400}?currentIdRef\.current/.test(appSrc) ||
    /const id = currentIdRef\.current;/.test(appSrc)
);
const setDataBlock = appSrc.match(/const setData = useCallback\([\s\S]*?\n\s{0,4}\[[^\]]*\]\n?\s*\);/);
check(
  "setData 的依赖数组里没有 currentId（否则会被空依赖的 mutate 捕获成旧值）",
  !!setDataBlock && !/\[\s*currentId\s*\]/.test(setDataBlock[0]),
  setDataBlock ? (setDataBlock[0].match(/\[[^\]]*\]\s*\);/g) ?? []).slice(-1)[0] : "未匹配到 setData"
);

// ---------- 坑 9：空时间线的默认视野必须是真实日期 ----------
// 曾把 19000101 直接当儒略日传给 fitRange，等于把视口放在公元 5 万年附近，
// 结果新建时间线后加的第一个事件永远在屏幕外，看起来像没保存。
check("空库视野用 toJdn 构造真实日期", /toJdn\(1800,\s*1,\s*1\)/.test(appSrc));
check("不再把 19000101 当儒略日用", !/fitRange\(\s*19000101/.test(appSrc));

// ---------- 坑 10：预览必须反映"手写文本" ----------
// 踩过：手写了「公元前88年初」，绿色预览仍显示自动生成的「公元前88年1月」，
// 两处说法不一致。预览要以 dateText 为准，并把轴线位置单独标出来。
check("预览用 shownText（手写优先）", /shownText/.test(dialog));
check("预览标出轴线位置", /轴线位置/.test(dialog));
check("只有用户改过才提示轴线位置", /usingCustomText/.test(dialog));

console.log(`\n${ok} passed.`);
process.exit(ok === 22 ? 0 : 1);
