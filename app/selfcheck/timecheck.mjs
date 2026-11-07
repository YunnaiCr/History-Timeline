/**
 * Self-check for the time core: JDN conversion, zoom anchoring, panning, coordinate roundtrip.
 * Note: imports the compiled JS in dist-src/ (run `npm run build:m0` first).
 * Run: node selfcheck/timecheck.mjs
 */
import { toJdn, fromJdn } from "../dist-src/lib/time.js";
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

console.log(`\n${ok} passed.`);
process.exit(ok === cases.length + 3 ? 0 : 1);
