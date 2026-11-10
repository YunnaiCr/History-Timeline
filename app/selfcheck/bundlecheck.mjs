/**
 * 打包产物自检：确认 dist 里的 bundle 是最新源码编出来的。
 *
 * 为什么需要：踩过一次——源码已经修好，但 dist 里还是旧 bundle，
 * 于是用户重启 exe 后测到的仍是旧代码，白报一次"没修好"。
 *
 * 检查方式：从源码里取几个"应该出现/不该出现"的特征串，
 * 到最新的 bundle 里核对。只做粗粒度验证，不追求精确。
 *
 * 运行：node selfcheck/bundlecheck.mjs（需要先 npm run build 或 tauri build）
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const distDir = new URL("../dist/assets/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const srcPath = new URL("../src/components/CanvasArea.tsx", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1"
);

let ok = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (cond) ok++;
};

let bundles = [];
try {
  bundles = readdirSync(distDir)
    .filter((n) => n.endsWith(".js"))
    .map((n) => ({ name: n, mtime: statSync(join(distDir, n)).mtimeMs }));
} catch {
  console.log("SKIP 找不到 dist/assets，先跑一次 npm run build");
  process.exit(0);
}

check("dist 里有 bundle", bundles.length > 0);
const newest = bundles.sort((a, b) => b.mtime - a.mtime)[0];
const srcMtime = statSync(srcPath).mtimeMs;
check(
  "bundle 比 CanvasArea.tsx 新（没有用旧产物打包）",
  newest.mtime >= srcMtime,
  `bundle ${new Date(newest.mtime).toLocaleTimeString()} / src ${new Date(srcMtime).toLocaleTimeString()}`
);

const code = readFileSync(join(distDir, newest.name), "utf8");

// 详情面板关闭监听必须无条件注册：bundle 里不应出现 "if(!x)return" 紧跟 Escape 处理的形状
const guarded = /if\(!\w+\)return;const \w+=\w+=>\{\w+\.key==="Escape"/.test(code);
check("面板关闭监听已无条件注册", !guarded, guarded ? "bundle 里仍是旧写法" : "");

// 悬停改由指针位置驱动，这几个标记应该在
check("bundle 含 data-ev-id 标记", code.includes("data-ev-id"));
check("bundle 含 data-cluster-ids 标记", code.includes("data-cluster-ids"));

console.log(`\n${ok} passed.`);
process.exit(ok === 5 ? 0 : 1);
