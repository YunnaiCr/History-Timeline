/**
 * 数据导入 / 导出。
 *
 * localStorage 里存的是 WebView2 的 LevelDB，用户没法直接看到或备份。
 * 这里提供两件事：
 *   - 导出：把整个库写成一份可读的 JSON 文件（默认落到「下载」目录）
 *   - 导入：读回 JSON，支持「覆盖」或「合并」两种模式
 * 这样数据就有了可迁移、可进 Git、可放网盘的载体。
 *
 * 合并语义（重要）：
 *   - 类别 / 标签按「名称」对齐：同名的复用现有 id，不同名的追加
 *   - 事件 id 冲突时**分配新 id**，绝不让导入的文件覆盖你已录入的内容
 *   - 子事件的 parentId 会跟着重映射，父子关系不会断
 */
import { makeId, type DataFile } from "./store";
import type { Category, Tag, TimelineEvent } from "../data/sampleData";

export const EXPORT_VERSION = 1;

/** 文件名：历史时间线-2026-11-06.json */
export function exportFileName(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `历史时间线-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

export function serialize(data: DataFile): string {
  return JSON.stringify(
    {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      events: data.events,
      categories: data.categories,
      tags: data.tags,
    },
    null,
    2
  );
}

/** 触发浏览器下载。WebView2 会走自己的下载流程。 */
export function downloadJson(data: DataFile, fileName = exportFileName()): void {
  const blob = new Blob([serialize(data)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 给 WebView2 一点时间开始下载再回收
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export interface ParseResult {
  ok: boolean;
  data?: DataFile;
  error?: string;
}

export interface MergeResult {
  data: DataFile;
  /** 实际新增的事件数 */
  added: number;
  /** 因为 id 冲突而重新分配 id 的事件数 */
  renamed: number;
  /** 新增的类别 / 标签数 */
  newCategories: number;
  newTags: number;
}

/**
 * 把 incoming 合并进 current（不覆盖任何已有事件）。
 *
 * - 类别按名称对齐；找不到同名就追加（颜色沿用文件里的）
 * - 标签同理
 * - 事件 id 若已存在，换一个新 id；parentId 同步重映射
 */
export function mergeData(current: DataFile, incoming: DataFile): MergeResult {
  // ---- 类别：按名称对齐 ----
  const categories: Category[] = [...current.categories];
  const catIdMap = new Map<string, string>(); // incoming id -> current id
  let newCategories = 0;

  const usedCatColors = new Set(categories.map((c) => c.color));

  for (const inc of incoming.categories) {
    const same = categories.find((c) => c.name === inc.name);
    if (same) {
      catIdMap.set(inc.id, same.id);
    } else {
      // 颜色尽量不重复，冲突就沿用文件里的（可接受）
      const id = categories.some((c) => c.id === inc.id) ? makeId("cat") : inc.id;
      const color = usedCatColors.has(inc.color) && categories.length > 0 ? inc.color : inc.color;
      categories.push({ id, name: inc.name, color });
      usedCatColors.add(color);
      catIdMap.set(inc.id, id);
      newCategories++;
    }
  }
  const fallbackCat = categories[0]?.id ?? "politics";

  // ---- 标签：按名称对齐 ----
  const tags: Tag[] = [...current.tags];
  const tagIdMap = new Map<string, string>();
  let newTags = 0;

  for (const inc of incoming.tags) {
    const same = tags.find((t) => t.name === inc.name);
    if (same) {
      tagIdMap.set(inc.id, same.id);
    } else {
      const id = tags.some((t) => t.id === inc.id) ? makeId("t") : inc.id;
      tags.push({ id, name: inc.name });
      tagIdMap.set(inc.id, id);
      newTags++;
    }
  }

  // ---- 事件 ----
  const existingIds = new Set(current.events.map((e) => e.id));
  const eventIdMap = new Map<string, string>(); // incoming id -> final id
  let renamed = 0;

  // 先给所有 incoming 事件分配最终 id，parentId 才能正确重映射
  for (const inc of incoming.events) {
    if (existingIds.has(inc.id)) {
      const fresh = makeId();
      eventIdMap.set(inc.id, fresh);
      existingIds.add(fresh);
      renamed++;
    } else {
      eventIdMap.set(inc.id, inc.id);
      existingIds.add(inc.id);
    }
  }

  const incomingIds = new Set(incoming.events.map((e) => e.id));
  const merged: TimelineEvent[] = incoming.events.map((inc) => {
    const finalId = eventIdMap.get(inc.id)!;
    // 父事件在文件内部就重映射；父事件不在文件里（指向当前库）则原样保留
    const parentId = inc.parentId
      ? incomingIds.has(inc.parentId)
        ? eventIdMap.get(inc.parentId)
        : inc.parentId
      : undefined;

    return {
      ...inc,
      id: finalId,
      categoryId: catIdMap.get(inc.categoryId) ?? fallbackCat,
      tagIds: inc.tagIds.map((t) => tagIdMap.get(t)).filter((t): t is string => !!t),
      parentId,
    };
  });

  return {
    data: {
      version: 1,
      events: [...current.events, ...merged],
      categories,
      tags,
    },
    added: merged.length,
    renamed,
    newCategories,
    newTags,
  };
}

/**
 * 解析导入文件。宽容但不糊弄：
 *  - 接受 {version, events, categories, tags}
 *  - categories / tags 缺失时用当前库补
 *  - 事件的必需字段缺失就报错，不会写入半条脏数据
 */
export function parseImport(text: string, fallback: DataFile): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "不是合法的 JSON 文件" };
  }
  if (!raw || typeof raw !== "object") return { ok: false, error: "文件内容不是一个对象" };

  const obj = raw as Record<string, unknown>;
  const events = obj.events;
  if (!Array.isArray(events)) return { ok: false, error: "缺少 events 数组" };

  for (let i = 0; i < events.length; i++) {
    const e = events[i] as Record<string, unknown>;
    if (
      !e ||
      typeof e.id !== "string" ||
      typeof e.title !== "string" ||
      typeof e.startJdn !== "number" ||
      typeof e.categoryId !== "string"
    ) {
      return { ok: false, error: `第 ${i + 1} 条事件缺少必要字段（id / title / startJdn / categoryId）` };
    }
  }

  const categories = Array.isArray(obj.categories) && obj.categories.length
    ? (obj.categories as DataFile["categories"])
    : fallback.categories;
  const tags = Array.isArray(obj.tags) ? (obj.tags as DataFile["tags"]) : fallback.tags;

  return {
    ok: true,
    data: {
      version: 1,
      events: events as DataFile["events"],
      categories,
      tags,
    },
  };
}
