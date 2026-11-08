/**
 * 路径工具：纯字符串处理，不依赖 Tauri，也不依赖 Node 的 path 模块
 * （前端打包后没有 path 可用）。
 *
 * Windows 用反斜杠、其他平台用正斜杠，所以两种都要能处理。
 */

/** 把目录与文件名拼起来 */
export function joinPath(dir: string, fileName: string): string {
  if (!dir) return fileName;
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${fileName}` : `${dir}${sep}${fileName}`;
}

/** 取路径的目录部分；没有分隔符时返回空串 */
export function dirOf(path: string): string {
  const idx = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return idx > 0 ? path.slice(0, idx) : "";
}

/** 取路径的文件名部分 */
export function baseNameOf(path: string): string {
  const idx = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/** 去掉 .json 后缀（大小写不敏感） */
export function stripJsonExt(name: string): string {
  return name.toLowerCase().endsWith(".json") ? name.slice(0, -".json".length) : name;
}
