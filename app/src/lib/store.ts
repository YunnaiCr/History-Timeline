/**
 * 存储层：localStorage 起步。
 *
 * 设计原则：UI 只依赖 loadData / saveData 两个函数，
 * 以后换成 SQLite（tauri-plugin-sql）或 JSON 文件时，只改这个文件，组件一行不用动。
 */
import type { Category, Tag, TimelineEvent } from "../data/sampleData";
import {
  categories as seedCategories,
  events as seedEvents,
  tags as seedTags,
} from "../data/sampleData";

export const STORAGE_KEY = "history-timeline.v1";

export interface DataFile {
  version: 1;
  events: TimelineEvent[];
  categories: Category[];
  tags: Tag[];
}

/** 首次运行时的初始数据（示例数据） */
export function seedData(): DataFile {
  return {
    version: 1,
    events: structuredClone(seedEvents),
    categories: structuredClone(seedCategories),
    tags: structuredClone(seedTags),
  };
}

/** 读取；文件损坏/版本不符时回退到初始数据，绝不让应用起不来 */
export function loadData(): DataFile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedData();
    const parsed = JSON.parse(raw) as Partial<DataFile>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.events)) return seedData();
    return {
      version: 1,
      events: parsed.events as TimelineEvent[],
      // 类别：空数组会导致"新建事件无处归类"，所以空就补默认类别
      categories:
        Array.isArray(parsed.categories) && parsed.categories.length
          ? (parsed.categories as Category[])
          : structuredClone(seedCategories),
      // 标签：空数组是合法状态（用户主动清空过），不能拿示例标签覆盖回去
      tags: Array.isArray(parsed.tags) ? (parsed.tags as Tag[]) : structuredClone(seedTags),
    };
  } catch (err) {
    console.warn("[store] 读取失败，回到初始数据：", err);
    return seedData();
  }
}

/** 写入；配额满等异常只告警，不打断交互 */
export function saveData(data: DataFile): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn("[store] 保存失败：", err);
    return false;
  }
}

/** 清空并回到初始数据 */
export function resetData(): DataFile {
  const fresh = seedData();
  saveData(fresh);
  return fresh;
}

/** 生成稳定且不重复的 id */
export function makeId(prefix = "e"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 清空所有事件与标签，保留类别。
 * 类别是"结构"（每个事件必须有且只有一个），清掉会导致新建事件无处归类，
 * 所以保留一份默认类别；用户可以在「管理类别/标签」里改成自己的。
 */
export function clearData(): DataFile {
  const base = seedData();
  const fresh: DataFile = {
    version: 1,
    events: [],
    categories: base.categories,
    tags: [],
  };
  saveData(fresh);
  return fresh;
}
