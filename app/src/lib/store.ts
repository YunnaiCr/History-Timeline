/**
 * 数据容器与浏览器兜底存储。
 *
 * 桌面版的数据由 repository.ts 落到 JSON 文件；这个文件只负责：
 *   - 定义 DataFile 结构
 *   - 构造空库
 *   - 浏览器模式（npm run dev，没有文件系统）下用 localStorage 兜底
 */
import type { Category, Tag, TimelineEvent } from "../data/schema";
import { DEFAULT_CATEGORIES, DEFAULT_TAGS } from "../data/schema";

/** 浏览器兜底用的键；桌面版不再使用 */
export const STORAGE_KEY = "history-timeline.v1";

export interface DataFile {
  version: 1;
  events: TimelineEvent[];
  categories: Category[];
  tags: Tag[];
}

/**
 * 空库：没有事件、没有标签，但保留默认类别。
 * 类别不能为空——每个事件必须有且只有一个类别。
 */
export function emptyData(): DataFile {
  return {
    version: 1,
    events: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    tags: DEFAULT_TAGS.map((t) => ({ ...t })),
  };
}

/** 浏览器模式：读 localStorage，没有就返回空库 */
export function loadData(): DataFile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    const parsed = JSON.parse(raw) as Partial<DataFile>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.events)) return emptyData();
    return {
      version: 1,
      events: parsed.events as TimelineEvent[],
      categories:
        Array.isArray(parsed.categories) && parsed.categories.length
          ? (parsed.categories as Category[])
          : DEFAULT_CATEGORIES.map((c) => ({ ...c })),
      // 标签为空是合法状态，不能拿默认值覆盖回去
      tags: Array.isArray(parsed.tags) ? (parsed.tags as Tag[]) : [],
    };
  } catch (err) {
    console.warn("[store] 读取失败，回到空库：", err);
    return emptyData();
  }
}

/** 浏览器模式：写 localStorage。配额满时返回 false，由调用方提示用户 */
export function saveData(data: DataFile): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn("[store] 保存失败：", err);
    return false;
  }
}

/**
 * 生成 id。
 *
 * 光靠 `Math.random()` 不够：`toString(36)` 有时只有一两位小数，
 * 随机部分会变短，大批量生成时有概率撞车（实测 2000 次撞过 1 次）。
 * 这里加一个进程内自增序号，保证同一会话内必然唯一。
 */
let idSeq = 0;

export function makeId(prefix = "e"): string {
  idSeq = (idSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}-${idSeq.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}
