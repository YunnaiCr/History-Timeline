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

/** 时间戳：20261108-140233，用于备份文件名（按字典序即按时间序） */
function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
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
  error?: string;
}

/**
 * 写数据文件。
 *
 * 写之前先把**旧内容**复制一份成备份，再写新内容。
 * 这样即使新内容有问题，上一版还在。
 */
export async function saveDataFile(
  path: string,
  data: DataFile,
  backupCount: number
): Promise<SaveResult> {
  const dir = dirOf(path);
  const fileName = baseNameOf(path);
  try {
    await ensureDir(dir);

    if (backupCount > 0) {
      const exists = await pathExists(path);
      if (exists) {
        try {
          const old = await readTextFile(path);
          if (old.trim()) {
            await writeTextFile(joinPath(dir, `${backupPrefix(fileName)}${stamp()}.json`), old);
          }
        } catch {
          /* 备份失败不阻塞保存 */
        }
      }
    }

    await writeTextFile(path, serialize(data));

    if (backupCount > 0) {
      await pruneBackups(dir, fileName, backupCount);
    }
    return { ok: true, path };
  } catch (err) {
    return { ok: false, path, error: String(err) };
  }
}

/** 列出某个目录下的备份文件（设置对话框里展示用） */
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
