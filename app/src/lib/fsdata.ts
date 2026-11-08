/**
 * 文件系统访问层。
 *
 * 真正的读写由 Rust 侧的 7 个命令完成（见 src-tauri/src/lib.rs），
 * 这里只做类型包装 + 「是否在 Tauri 里运行」的判断。
 *
 * 在浏览器里跑（`npm run dev`）时没有 Tauri，这些函数会抛错，
 * 调用方应当降级到 localStorage。
 */
import { invoke } from "@tauri-apps/api/core";

export { joinPath, dirOf, baseNameOf, stripJsonExt } from "./paths";

/** 是否运行在 Tauri 桌面壳里（浏览器模式下为 false） */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 默认数据目录：文档\历史事件线 */
export function defaultDataDir(): Promise<string> {
  return invoke<string>("default_data_dir");
}

export function ensureDir(path: string): Promise<void> {
  return invoke<void>("ensure_dir", { path });
}

export function pathExists(path: string): Promise<boolean> {
  return invoke<boolean>("path_exists", { path });
}

export function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

export function writeTextFile(path: string, content: string): Promise<void> {
  return invoke<void>("write_text_file", { path, content });
}

export function listDir(path: string): Promise<string[]> {
  return invoke<string[]>("list_dir", { path });
}

export function removeFile(path: string): Promise<void> {
  return invoke<void>("remove_file", { path });
}
