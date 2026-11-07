/**
 * 公元前/公元 换算自检。
 * 内部用天文纪年（0 = 公元前 1 年），界面用历史纪年，两者必须严格互逆且连续无断点。
 * 运行：node build-m0.mjs && node selfcheck/bcecheck.mjs
 */
import {
  fromHistoricalYear,
  toHistoricalYear,
  bcToJdn,
  formatHistoricalYear,
  toJdn,
  fromJdn,
} from "../dist-src/lib/time.js";

let ok = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (cond) ok++;
};

// 1. 历史 → 天文
check("公元前 221 年 = 天文 -220", fromHistoricalYear("bc", 221) === -220);
check("公元前 1 年 = 天文 0", fromHistoricalYear("bc", 1) === 0);
check("公元 1 年 = 天文 1", fromHistoricalYear("ad", 1) === 1);

// 2. 天文 → 历史
const h220 = toHistoricalYear(-220);
check("天文 -220 = 公元前 221", h220.era === "bc" && h220.value === 221);
const h0 = toHistoricalYear(0);
check("天文 0 = 公元前 1", h0.era === "bc" && h0.value === 1, `${h0.era} ${h0.value}`);
const h1912 = toHistoricalYear(1912);
check("天文 1912 = 公元 1912", h1912.era === "ad" && h1912.value === 1912);

// 3. 显示文本
check("公元前221年 文本", formatHistoricalYear("bc", 221) === "公元前221年");
check("1912年 文本", formatHistoricalYear("ad", 1912) === "1912年");

// 4. 公元前 221 年的 JDN 与直接用天文年一致
check("bcToJdn(221) == toJdn(-220)", bcToJdn(221) === toJdn(-220, 1, 1));
check("bcToJdn 反解回 -220", fromJdn(bcToJdn(221)).year === -220);

// 5. 双向互逆：公元前 1..300 年、公元 1..300 年
let roundTripOk = true;
for (let y = 1; y <= 300; y++) {
  for (const era of ["bc", "ad"]) {
    const astro = fromHistoricalYear(era, y);
    const back = toHistoricalYear(astro);
    if (back.era !== era || back.value !== y) roundTripOk = false;
  }
}
check("1..300 年双向互逆", roundTripOk);

// 6. 连续性：公元前 1 年最后一天 + 1 天 = 公元 1 年第一天（中间不能有空洞）
const lastBc = bcToJdn(1, 12, 31);
const firstAd = toJdn(1, 1, 1);
check("公元前1年末与公元1年初相接", firstAd - lastBc === 1, `相差 ${firstAd - lastBc} 天`);

// 7. 时间单调：公元前年份越大越早
check("公元前 300 年早于公元前 221 年", bcToJdn(300) < bcToJdn(221));
check("公元前 221 年早于公元 1 年", bcToJdn(221) < toJdn(1, 1, 1));

// 8. 不出现 "0年" 这种非法显示
let zeroYearText = false;
for (let j = toJdn(-5, 1, 1); j < toJdn(5, 1, 1); j += 37) {
  const { year } = fromJdn(j);
  const h = toHistoricalYear(year);
  if (h.value < 1) zeroYearText = true;
}
check("不产生年份 < 1 的历史纪年", !zeroYearText);

console.log(`\n${ok} passed.`);
process.exit(ok === 15 ? 0 : 1);
