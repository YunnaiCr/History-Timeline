/**
 * 多时间线（时间线库）。
 *
 * 设计决定：**每条时间线是一份完整独立的库**——自己的事件、类别、标签、视口。
 * 时间线之间没有任何引用，所以：
 *   - 删事件不会影响别的线
 *   - 删整条线只删它自己的东西
 *   - 不需要"未分配"之类的收拾逻辑
 *
 * 单条时间线内部的结构仍然是老的 DataFile，所以 io / 渲染逻辑几乎不用改。
 */
import type { Category, Tag, TimelineEvent } from "../data/schema";
import { DEFAULT_CATEGORIES, DEFAULT_TAGS } from "../data/schema";
import { makeId, type DataFile } from "./store";

/** 每条时间线保存自己的视口，切回去还是上次的位置 */
export interface SavedViewport {
  startJdn: number;
  pxPerDay: number;
}

export interface TimelineDoc extends DataFile {
  id: string;
  name: string;
  createdAt: string;
  /** 上次退出时的视口；没有就自适应全部数据 */
  viewport?: SavedViewport;
}

export interface Library {
  version: 2;
  lastOpenedId: string | null;
  timelines: TimelineDoc[];
}

export const MAX_NAME = 40;

/** 新建一条空时间线；可选择性复制另一条线的类别与标签（不含事件） */
export function newTimeline(
  name: string,
  opts?: { vocabFrom?: TimelineDoc }
): TimelineDoc {
  const src = opts?.vocabFrom;
  return {
    version: 1,
    id: makeId("tl"),
    name: normalizeName(name) || "未命名时间线",
    createdAt: new Date().toISOString(),
    events: [],
    categories: src
      ? src.categories.map((c) => ({ ...c }))
      : DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    tags: src ? src.tags.map((t) => ({ ...t })) : DEFAULT_TAGS.map((t) => ({ ...t })),
  };
}

export function normalizeName(raw: string): string {
  return raw.trim().slice(0, MAX_NAME);
}

export function emptyLibrary(): Library {
  const first = newTimeline("我的时间线");
  return { version: 2, lastOpenedId: first.id, timelines: [first] };
}

/** 把老版本的单库文件包成一条时间线 */
export function migrateV1(data: DataFile, name = "我的时间线"): Library {
  const doc: TimelineDoc = {
    ...data,
    id: makeId("tl"),
    name: normalizeName(name) || "我的时间线",
    createdAt: new Date().toISOString(),
  };
  return { version: 2, lastOpenedId: doc.id, timelines: [doc] };
}

export function findTimeline(lib: Library, id: string | null): TimelineDoc | null {
  if (!id) return null;
  return lib.timelines.find((t) => t.id === id) ?? null;
}

/** 替换某条时间线的内容（保持 id / name / createdAt 不被内容覆盖） */
export function replaceTimeline(lib: Library, id: string, next: DataFile): Library {
  const idx = lib.timelines.findIndex((t) => t.id === id);
  if (idx < 0) return lib;
  const prev = lib.timelines[idx];
  const doc: TimelineDoc = {
    ...prev,
    events: next.events,
    categories: next.categories,
    tags: next.tags,
  };
  const timelines = [...lib.timelines];
  timelines[idx] = doc;
  return { ...lib, timelines };
}

export function addTimeline(lib: Library, doc: TimelineDoc): Library {
  return { ...lib, timelines: [...lib.timelines, doc], lastOpenedId: doc.id };
}

export function renameTimeline(lib: Library, id: string, name: string): Library {
  const clean = normalizeName(name);
  if (!clean) return lib;
  return {
    ...lib,
    timelines: lib.timelines.map((t) => (t.id === id ? { ...t, name: clean } : t)),
  };
}

/** 删除一条时间线。**只删它自己的内容**，不碰其他线 */
export function removeTimeline(lib: Library, id: string): Library {
  const timelines = lib.timelines.filter((t) => t.id !== id);
  const lastOpenedId =
    lib.lastOpenedId === id ? (timelines[0]?.id ?? null) : lib.lastOpenedId;
  return { ...lib, timelines, lastOpenedId };
}

export function duplicateTimeline(lib: Library, id: string): Library {
  const src = lib.timelines.find((t) => t.id === id);
  if (!src) return lib;
  const copy: TimelineDoc = {
    ...structuredClone(src),
    id: makeId("tl"),
    name: normalizeName(`${src.name} 副本`),
    createdAt: new Date().toISOString(),
  };
  return addTimeline(lib, copy);
}

export function setViewport(lib: Library, id: string, viewport: SavedViewport): Library {
  return {
    ...lib,
    timelines: lib.timelines.map((t) => (t.id === id ? { ...t, viewport } : t)),
  };
}

/** 时间线概况：事件数 + 年代范围，首页缩略图用 */
export interface TimelineStats {
  count: number;
  minJdn: number;
  maxJdn: number;
}

export function statsOf(doc: TimelineDoc): TimelineStats | null {
  if (doc.events.length === 0) return null;
  let minJdn = Infinity;
  let maxJdn = -Infinity;
  for (const e of doc.events) {
    if (e.startJdn < minJdn) minJdn = e.startJdn;
    const end = e.endJdn ?? e.startJdn;
    if (end > maxJdn) maxJdn = end;
  }
  return { count: doc.events.length, minJdn, maxJdn };
}

/** 名称是否已被别的线占用 */
export function nameTaken(lib: Library, name: string, exceptId?: string): boolean {
  const clean = normalizeName(name);
  return lib.timelines.some((t) => t.id !== exceptId && t.name === clean);
}

/**
 * 在时间线内部导入一个"整库文件"时，挑哪一条线用。
 *
 * 规则：先找同名的；只有一条就直接用；多条且无同名则返回 null（让用户去首页导入）。
 */
export function pickTimelineForImport(lib: Library, currentName: string): TimelineDoc | null {
  if (lib.timelines.length === 0) return null;
  if (lib.timelines.length === 1) return lib.timelines[0];
  const same = lib.timelines.find((t) => t.name === normalizeName(currentName));
  return same ?? null;
}

/** 只读快照，便于类型收窄 */
export function isTimelineDoc(v: unknown): v is TimelineDoc {
  const d = v as TimelineDoc;
  return !!d && typeof d.id === "string" && Array.isArray(d.events) && Array.isArray(d.categories);
}

export type { Category, Tag, TimelineEvent };
