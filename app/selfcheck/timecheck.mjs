/**
 * Self-check for the time core: JDN conversion, zoom anchoring, panning, coordinate roundtrip.
 * Note: imports the compiled JS in dist-src/ (run `npm run build:m0` first).
 * Run: node selfcheck/timecheck.mjs
 */
import { toJdn, fromJdn, yearOnlyText } from "../dist-src/lib/time.js";
import { zoomAt, panBy, xToJdn, jdnToX } from "../dist-src/lib/viewport.js";

const cases = [
  [2000, 1, 1, 2451545],
  [1912, 1, 1, 2419403],
  [-221, 2, 1, 1640373],
  [1970, 1, 1, 2440588],
];

let ok = 0;
for (const [y, m, d, expect] of cases) {
  const got = toJdn(y, m, d);
  const back = fromJdn(got);
  const pass = got === expect && back.year === y && back.month === m && back.day === d;
  console.log(
    `${pass ? "PASS" : "FAIL"} toJdn(${y},${m},${d}) = ${got} (expect ${expect}), back = ${back.year}-${back.month}-${back.day}`
  );
  if (pass) ok++;
}

let vp = { startJdn: 2400000, pxPerDay: 0.5, width: 1200 };
const before = xToJdn(vp, 400);
vp = zoomAt(vp, 400, 3.7);
const after = xToJdn(vp, 400);
const anchorOk = Math.abs(before - after) < 1e-6;
console.log(`${anchorOk ? "PASS" : "FAIL"} zoom anchor stable: ${before} -> ${after}`);
if (anchorOk) ok++;

const orig = { startJdn: 2400000, pxPerDay: 0.5, width: 1200 };
const moved = panBy(panBy(orig, 123), -123);
const panOk = Math.abs(moved.startJdn - orig.startJdn) < 1e-9;
console.log(`${panOk ? "PASS" : "FAIL"} pan roundtrip`);
if (panOk) ok++;

const x0 = 777;
const rtOk = Math.abs(jdnToX(orig, xToJdn(orig, x0)) - x0) < 1e-9;
console.log(`${rtOk ? "PASS" : "FAIL"} pixel<->jdn roundtrip`);
if (rtOk) ok++;

// 「只显示年份」模式：卡片上写什么
const yearCases = [
  ["点事件（公元前）", yearOnlyText(toJdn(-87, 3, 1)), "公元前88年"],
  ["点事件（公元）", yearOnlyText(toJdn(1911, 10, 10)), "1911年"],
  ["区间同年只写一次", yearOnlyText(toJdn(-87, 3, 1), toJdn(-87, 9, 1)), "公元前88年"],
  ["区间跨年写两段", yearOnlyText(toJdn(-87, 3, 1), toJdn(-80, 1, 1)), "公元前88年–前81年"],
  // 天文纪年 -1 年 = 公元前 2 年；跨公元时两端要分别带上前缀
  ["跨公元零点的区间", yearOnlyText(toJdn(-1, 1, 1), toJdn(1, 1, 1)), "公元前2年–1年"],
];
for (const [name, got, expect] of yearCases) {
  const pass = got === expect;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}: ${got}`);
  if (pass) ok++;
}

console.log(`\n${ok} passed.`);
process.exit(ok === cases.length + 3 + yearCases.length ? 0 : 1);
