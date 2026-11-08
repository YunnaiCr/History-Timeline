/**
 * 仓库层：把 DataFile 落到磁盘上的一个 JSON 文件，并维护自动备份。
 *
 * 职责边界：
 *   - fsdata.ts  只管"能不能读写这个路径"
 *   - 本文件      管"数据文件放哪、怎么写、备份怎么轮转"
 *   - App.tsx     只管"什么时候该存"
 */
import type { DataFile } from "./store";
import { emptyData } from "./store";
import type { Settings } from "./settings";
import {
  baseNameOf,
  copyFile,
  defaultDataDir,
  dirOf,
  ensureDir,
  joinPath,
  listDir,
  pathExists,
  readTextFile,
  removeFile,
  stripJsonExt,
  writeTextFile,
} from "./fsdata";
import { parseImport, serialize } from "./io";
import { formatStamp, parseStamp, shouldCreateBackup } from "./backup";

/** 备份文件名前缀：history-timeline.backup-<时间戳>.json */
const BACKUP_MARK = ".backup-";

/** 解析出数据文件的完整路径 */
export async function resolveDataPath(settings: Settings): Promise<string> {
  const dir = settings.dataDir ?? (await defaultDataDir());
  return joinPath(dir, settings.fileName);
}

export interface LoadResult {
  data: DataFile;
  /** 文件不存在（首次运行） */
  created: boolean;
  /** 文件存在但读取/解析失败，已回退成空库 */
  error?: string;
}

/**
 * 读取数据文件。
 * 文件不存在 → 返回空库（首次运行）。
 * 文件损坏 → 返回空库并带上错误信息，**绝不静默覆盖用户文件**。
 */
export async function loadDataFile(path: string): Promise<LoadResult> {
  const exists = await pathExists(path);
  if (!exists) {
    return { data: emptyData(), created: true };
  }
  let text: string;
  try {
    text = await readTextFile(path);
  } catch (err) {
    return { data: emptyData(), created: false, error: `读取数据文件失败：${String(err)}` };
  }
  // 空文件当作首次运行
  if (!text.trim()) {
    return { data: emptyData(), created: true };
  }
  const parsed = parseImport(text, emptyData());
  if (!parsed.ok || !parsed.data) {
    return { data: emptyData(), created: false, error: `数据文件格式有误：${parsed.error}` };
  }
  return { data: parsed.data, created: false };
}

function backupPrefix(fileName: string): string {
  return `${stripJsonExt(fileName)}${BACKUP_MARK}`;
}

/** 只保留最近 count 份备份，按文件名（=时间戳）排序 */
async function pruneBackups(dir: string, fileName: string, count: number): Promise<void> {
  if (count <= 0) return;
  const prefix = backupPrefix(fileName);
  let names: string[];
  try {
    names = await listDir(dir);
  } catch {
    return;
  }
  const backups = names.filter((n) => n.startsWith(prefix)).sort();
  const excess = backups.length - count;
  for (let i = 0; i < excess; i++) {
    try {
      await removeFile(joinPath(dir, backups[i]));
    } catch {
      /* 清理失败不影响主流程 */
    }
  }
}

export interface SaveResult {
  ok: boolean;
  /** 实际写入的路径 */
  path: string;
  /** 内容与上次相同，跳过了写盘 */
  skipped?: boolean;
  /** 本次是否新建了备份 */
  backedUp?: boolean;
  error?: string;
}

export interface SaveOptions {
  /** 保留几份备份；0 表示不备份 */
  backupCount: number;
  /** 备份间隔（分钟） */
  backupIntervalMinutes: number;
  /**
   * 上一次成功写入的文本。内容完全相同就直接跳过——
   * 省掉一次无意义的整文件重写（以及随之而来的备份轮转）。
   */
  lastText?: string | null;
  /** 当前时间，便于测试注入 */
  now?: number;
}

/**
 * 写数据文件。
 *
 * 顺序：可能建备份 → 写主文件 → 清理多余备份。
 *
 * 三个优化：
 *  - 内容没变就不写
 *  - 备份按时间节流（默认 10 分钟一份），否则 600ms 一次保存会把备份冲光
 *  - 备份用系统级文件复制，不再"读成字符串再写一遍"
 */
export async function saveDataFile(
  path: string,
  data: DataFile,
  opts: SaveOptions
): Promise<SaveResult> {
  const dir = dirOf(path);
  const fileName = baseNameOf(path);
  const now = opts.now ?? Date.now();
  try {
    const text = serialize(data);

    if (opts.lastText != null && text === opts.lastText) {
      return { ok: true, path, skipped: true };
    }

    await ensureDir(dir);

    let backedUp = false;
    if (opts.backupCount > 0 && (await pathExists(path))) {
      try {
        const names = await listDir(dir);
        const prefix = backupPrefix(fileName);
        const stamps = names
          .filter((n) => n.startsWith(prefix))
          .map((n) => parseStamp(n))
          .filter((t): t is number => t !== null);
        const lastBackup = stamps.length ? Math.max(...stamps) : null;

        if (shouldCreateBackup(lastBackup, now, opts.backupIntervalMinutes)) {
          await copyFile(path, joinPath(dir, `${prefix}${formatStamp(now)}.json`));
          backedUp = true;
        }
      } catch {
        /* 备份失败不阻塞保存 */
      }
    }

    await writeTextFile(path, text);

    if (opts.backupCount > 0) {
      await pruneBackups(dir, fileName, opts.backupCount);
    }
    return { ok: true, path, backedUp };
  } catch (err) {
    return { ok: false, path, error: String(err) };
  }
}

/** 列出某个目录下的备份文件（设置对话框里展示用），新的在前 */
export async function listBackups(path: string): Promise<string[]> {
  const dir = dirOf(path);
  const prefix = backupPrefix(baseNameOf(path));
  try {
    const names = await listDir(dir);
    return names.filter((n) => n.startsWith(prefix)).sort().reverse();
  } catch {
    return [];
  }
}
