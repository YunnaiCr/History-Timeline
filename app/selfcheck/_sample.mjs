/**
 * 自检共用：读取仓库根的 samples/sample.json 并解析成 DataFile。
 *
 * 示例数据已从源码剥离，只作为仓库里的一份可导入 JSON 存在。
 * 需要"真实规模数据"的自检（数据完整性、往返、首屏适配）都从这里取。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseImport } from "../dist-src/lib/io.js";
import { emptyData } from "../dist-src/lib/store.js";

const here = dirname(fileURLToPath(import.meta.url));
export const SAMPLE_PATH = join(here, "..", "..", "samples", "sample.json");

/** 原始 JSON 文本 */
export function sampleText() {
  return readFileSync(SAMPLE_PATH, "utf8");
}

/** 解析后的 DataFile；解析失败直接抛错，让自检立刻失败 */
export function sampleData() {
  const res = parseImport(sampleText(), emptyData());
  if (!res.ok || !res.data) {
    throw new Error(`samples/sample.json 无法解析：${res.error}`);
  }
  return res.data;
}
