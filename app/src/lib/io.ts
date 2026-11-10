/**
 * 数据导入 / 导出。
 *
 * localStorage 里存的是 WebView2 的 LevelDB，用户没法直接看到或备份。
 * 这里提供两件事：
 *   - 导出：把整个库写成一份**人能读、能手写**的 JSON 文件
 *   - 导入：读回 JSON，支持「覆盖」或「合并」两种模式
 *
 * 格式设计原则：**用日期字符串、类别名、标签名，而不是内部 id 和儒略日数字。**
 * 否则导出的文件只能当副本，想手写新增一条得自己算儒略日。
 *
 * 兼容性：导入同时接受
 *   - 可读格式（本文档描述的 start / end / category / tags）
 *   - 旧的内部格式（startJdn / categoryId / tagIds / parentId），历史文件不会失效
 *
 * 合并语义：
 *   - 类别 / 标签按「名称」对齐：同名的复用现有 id，不同名的追加
 *   - 事件 id 冲突时**分配新 id**，绝不让导入的文件覆盖你已录入的内容
 *   - 子事件的 parent 会跟着重映射，父子关系不会断
 */
import { makeId, type DataFile } from "./store";
import type { Category, Tag, TimelineEvent } from "../data/schema";
import type { Library, TimelineDoc } from "./library";
import { newTimeline, normalizeName } from "./library";
import { fromJdn, toJdn, fromHistoricalYear, toHistoricalYear } from "./time";

export const EXPORT_VERSION = 1;

/** 文件名：history-timeline-export-2026-11-06.json（全英文，避免中文路径问题） */
export function exportFileName(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `history-timeline-export-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * 儒略日 -> 可读日期字符串。
 *   公元 1911 年 10 月 10 日  ->  "1911-10-10"
 *   公元前 221 年 1 月 1 日   ->  "-221-01-01"（负数 = 公元前 N 年）
 */
export function formatDateOut(jdn: number): string {
  const { year, month, day } = fromJdn(jdn);
  const hist = toHistoricalYear(year);
  const y = hist.era === "bc" ? `-${hist.value}` : `${hist.value}`;
  return `${y}-${pad2(month)}-${pad2(day)}`;
}

/**
 * 可读日期字符串 -> 儒略日。支持这些写法：
 *   "1911"              仅年份
 *   "1911-10"           年月
 *   "1911-10-10"        年月日
 *   "公元前221" / "公元前221年" / "-221" / "-221-01-01"
 *   "1911年10月10日"
 * 无法解析时返回 null。
 */
export function parseDateIn(input: string): number | null {
  const t = input.trim();
  if (!t) return null;

  // 公元前 221 年 / 公元前221
  let m = t.match(/^公元前\s*(\d+)\s*年?(?:\s*(\d{1,2})\s*月)?(?:\s*(\d{1,2})\s*日)?/);
  if (m) {
    return toJdn(fromHistoricalYear("bc", Number(m[1])), Number(m[2] ?? 1), Number(m[3] ?? 1));
  }

  // 1911年10月10日
  m = t.match(/^(\d+)\s*年(?:\s*(\d{1,2})\s*月)?(?:\s*(\d{1,2})\s*日)?/);
  if (m) {
    return toJdn(Number(m[1]), Number(m[2] ?? 1), Number(m[3] ?? 1));
  }

  // -221 / -221-01-01 / 1911 / 1911-10 / 1911-10-10
  m = t.match(/^(-?\d+)(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (m) {
    const raw = Number(m[1]);
    const year = raw < 0 ? fromHistoricalYear("bc", -raw) : raw;
    return toJdn(year, Number(m[2] ?? 1), Number(m[3] ?? 1));
  }

  return null;
}

/** 导出用的可读事件结构 */
export interface PortableEvent {
  id?: string;
  title: string;
  start: string;
  end?: string;
  /** 原始日期文本（"约公元前1046年" 这类模糊表述靠它保留） */
  dateText?: string;
  category?: string;
  tags?: string[];
  summary?: string;
  importance?: number;
  /** 父事件的 id 或标题 */
  parent?: string;
}

function toPortable(data: DataFile) {
  const catName = new Map(data.categories.map((c) => [c.id, c.name]));
  const tagName = new Map(data.tags.map((t) => [t.id, t.name]));

  const events: PortableEvent[] = data.events.map((e) => ({
    id: e.id,
    title: e.title,
    start: formatDateOut(e.startJdn),
    ...(e.endJdn !== undefined ? { end: formatDateOut(e.endJdn) } : {}),
    ...(e.dateText ? { dateText: e.dateText } : {}),
    category: catName.get(e.categoryId) ?? e.categoryId,
    ...(e.tagIds.length ? { tags: e.tagIds.map((t) => tagName.get(t) ?? t) } : {}),
    ...(e.summary ? { summary: e.summary } : {}),
    importance: e.importance,
    ...(e.parentId ? { parent: e.parentId } : {}),
    ...(e.dateTextCustom ? { dateTextCustom: true } : {}),
    ...(e.hideDate ? { hideDate: true } : {}),
    ...(e.dateDisplay && e.dateDisplay !== "full" ? { dateDisplay: e.dateDisplay } : {}),
    ...(e.fuzz ? { fuzz: e.fuzz } : {}),
  }));

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    categories: data.categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    tags: data.tags.map((t) => ({ id: t.id, name: t.name })),
    events,
  };
}

/** 序列化成可读 JSON（缩进 2 格，字段顺序固定，方便 diff） */
export function serialize(data: DataFile): string {
  return JSON.stringify(toPortable(data), null, 2);
}

/** 单条时间线导出：在 v1 结构上多带一个 name，便于导入时还原名字 */
export function serializeTimeline(doc: { name: string } & DataFile): string {
  return JSON.stringify({ ...toPortable(doc), name: doc.name }, null, 2);
}

/** 整个库导出：所有时间线装在一个文件里 */
export function serializeLibrary(lib: Library): string {
  return JSON.stringify(
    {
      version: 2,
      exportedAt: new Date().toISOString(),
      lastOpenedId: lib.lastOpenedId,
      timelines: lib.timelines.map((t) => ({
        id: t.id,
        name: t.name,
        ...(t.viewport ? { viewport: t.viewport } : {}),
        ...toPortable(t),
      })),
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

const DEFAULT_COLORS = ["#e05c5c", "#4f9d69", "#4a7fd4", "#b06ab3", "#8a6d3b", "#3fa9a0", "#d8a657"];

/**
 * 解析导入文件。
 *
 * 同时接受可读格式和旧的内部格式；缺类别/标签时用当前库补。
 * 任何一条事件缺必要信息都会整体报错，不会写入半条脏数据。
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
  const rawEvents = obj.events;
  if (!Array.isArray(rawEvents)) return { ok: false, error: "缺少 events 数组" };

  // ---- 文件里声明的类别 / 标签（用来还原颜色和 id→名称） ----
  const declaredCats = Array.isArray(obj.categories) ? obj.categories : [];
  const declaredTags = Array.isArray(obj.tags) ? obj.tags : [];
  const catIdToName = new Map<string, string>();
  const catNameToColor = new Map<string, string>();
  for (const c of declaredCats as Record<string, unknown>[]) {
    if (!c || typeof c.name !== "string") continue;
    if (typeof c.id === "string") catIdToName.set(c.id, c.name);
    if (typeof c.color === "string") catNameToColor.set(c.name, c.color);
  }
  const tagIdToName = new Map<string, string>();
  for (const t of declaredTags as Record<string, unknown>[]) {
    if (!t || typeof t.name !== "string") continue;
    if (typeof t.id === "string") tagIdToName.set(t.id, t.name);
  }

  // ---- 工作副本：从当前库出发，缺什么补什么 ----
  const categories: Category[] = fallback.categories.length
    ? fallback.categories.map((c) => ({ ...c }))
    : [{ id: "politics", name: "政治", color: DEFAULT_COLORS[0] }];
  const tags: Tag[] = fallback.tags.map((t) => ({ ...t }));

  const ensureCategory = (name: string): string => {
    const hit = categories.find((c) => c.name === name);
    if (hit) return hit.id;
    const color =
      catNameToColor.get(name) ?? DEFAULT_COLORS[categories.length % DEFAULT_COLORS.length];
    const cat: Category = { id: makeId("cat"), name, color };
    categories.push(cat);
    return cat.id;
  };
  const ensureTag = (name: string): string => {
    const hit = tags.find((t) => t.name === name);
    if (hit) return hit.id;
    const tag: Tag = { id: makeId("t"), name };
    tags.push(tag);
    return tag.id;
  };

  // ---- 第一遍：解析每条事件，建立 原id -> 新id 映射 ----
  interface Pending {
    id: string;
    originalId?: string;
    ev: TimelineEvent;
    parentRef?: { byId?: string; byTitle?: string };
  }
  const pending: Pending[] = [];

  for (let i = 0; i < rawEvents.length; i++) {
    const e = rawEvents[i] as Record<string, unknown>;
    const at = `第 ${i + 1} 条事件`;

    if (!e || typeof e !== "object") return { ok: false, error: `${at}不是一个对象` };
    if (typeof e.title !== "string" || !e.title.trim()) {
      return { ok: false, error: `${at}缺少 title` };
    }

    // 开始时间：可读字符串优先，其次旧的 startJdn
    let startJdn: number | null = null;
    if (typeof e.start === "string") {
      startJdn = parseDateIn(e.start);
      if (startJdn === null) {
        return { ok: false, error: `${at}的 start 无法解析：「${e.start}」` };
      }
    } else if (typeof e.startJdn === "number") {
      startJdn = e.startJdn;
    } else {
      return { ok: false, error: `${at}缺少 start（如 "1911-10-10" 或 "-221"）` };
    }

    // 结束时间（可选）
    let endJdn: number | undefined;
    if (typeof e.end === "string" && e.end.trim()) {
      const v = parseDateIn(e.end);
      if (v === null) return { ok: false, error: `${at}的 end 无法解析：「${e.end}」` };
      endJdn = v;
    } else if (typeof e.endJdn === "number") {
      endJdn = e.endJdn;
    }
    if (endJdn !== undefined && endJdn < startJdn) {
      return { ok: false, error: `${at}的结束时间早于开始时间` };
    }

    // 类别：名称优先，其次旧的 categoryId
    let catName: string | undefined =
      typeof e.category === "string" ? e.category : undefined;
    if (!catName && typeof e.categoryId === "string") {
      catName = catIdToName.get(e.categoryId) ?? undefined;
    }
    if (!catName && typeof e.categoryId === "string" && categories.some((c) => c.id === e.categoryId)) {
      catName = categories.find((c) => c.id === e.categoryId)!.name;
    }
    const categoryId = catName ? ensureCategory(catName) : categories[0].id;

    // 标签：名称数组优先，其次旧的 tagIds
    const tagNames: string[] = [];
    if (Array.isArray(e.tags)) {
      for (const t of e.tags) if (typeof t === "string") tagNames.push(t);
    } else if (Array.isArray(e.tagIds)) {
      for (const t of e.tagIds) {
        if (typeof t !== "string") continue;
        const n = tagIdToName.get(t) ?? tags.find((x) => x.id === t)?.name;
        if (n) tagNames.push(n);
      }
    }
    const tagIds = [...new Set(tagNames.map(ensureTag))];

    // 重要性
    const imp = Number(e.importance);
    const importance: 1 | 2 | 3 = imp === 1 || imp === 3 ? imp : 2;

    const dateText =
      typeof e.dateText === "string" && e.dateText.trim()
        ? e.dateText
        : formatDateOut(startJdn);

    // 手写文本标记 / 显示粒度 / 不确定范围，都是可选字段
    const dateTextCustom = e.dateTextCustom === true;
    const hideDate = e.hideDate === true;
    // 新字段优先；老文件的 hideDate 等价于 "none"
    const dateDisplay: "full" | "year" | "none" =
      e.dateDisplay === "year" || e.dateDisplay === "none"
        ? e.dateDisplay
        : hideDate
          ? "none"
          : "full";
    let fuzz: { before: number; after: number } | undefined;
    if (e.fuzz && typeof e.fuzz === "object") {
      const f = e.fuzz as Record<string, unknown>;
      const before = Number(f.before);
      const after = Number(f.after);
      if (Number.isFinite(before) && Number.isFinite(after) && before >= 0 && after >= 0) {
        fuzz = { before, after };
      }
    }

    const originalId = typeof e.id === "string" && e.id.trim() ? e.id : undefined;
    const id = originalId ?? makeId();

    const parentRef = typeof e.parent === "string"
      ? { byId: e.parent, byTitle: undefined }
      : typeof e.parentId === "string"
        ? { byId: e.parentId, byTitle: undefined }
        : undefined;

    pending.push({
      id,
      originalId,
      ev: {
        id,
        title: e.title.trim(),
        startJdn,
        ...(endJdn !== undefined ? { endJdn } : {}),
        dateText,
        categoryId,
        tagIds,
        summary: typeof e.summary === "string" ? e.summary : "",
        importance,
        ...(dateTextCustom ? { dateTextCustom: true } : {}),
        ...(dateDisplay !== "full" ? { dateDisplay } : {}),
        ...(fuzz ? { fuzz } : {}),
      },
      parentRef,
    });
  }

  // ---- 第二遍：把 parent（id 或标题）解析成最终 id ----
  const byOriginalId = new Map<string, string>();
  const byTitle = new Map<string, string>();
  for (const p of pending) {
    if (p.originalId) byOriginalId.set(p.originalId, p.id);
    byTitle.set(p.ev.title, p.id);
  }

  for (const p of pending) {
    const ref = p.parentRef;
    if (!ref?.byId) continue;
    // 同文件内优先按 id 找，找不到再当标题找
    const resolved = byOriginalId.get(ref.byId) ?? byTitle.get(ref.byId);
    if (resolved && resolved !== p.id) {
      p.ev.parentId = resolved;
    }
  }

  // ---- 第三遍：拒绝多层嵌套 ----
  // 渲染只支持「父 → 子」一层。父事件自己还是子事件时，这条孙事件既不是顶层、
  // 也不会被任何顶层事件取到，导入后会静默消失——宁可拒绝，也不要放进来看不见。
  const byId = new Map(pending.map((p) => [p.id, p]));
  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    if (!p.ev.parentId) continue;
    const parent = byId.get(p.ev.parentId);
    if (parent?.ev.parentId) {
      return {
        ok: false,
        error:
          `第 ${i + 1} 条事件「${p.ev.title}」的父事件「${parent.ev.title}」本身也是子事件。\n` +
          `当前只支持一层父子关系（父事件必须属于顶层），请调整后再导入。`,
      };
    }
  }

  return {
    ok: true,
    data: {
      version: 1,
      events: pending.map((p) => p.ev),
      categories,
      tags,
    },
  };
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
}/**
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

  for (const inc of incoming.categories) {
    const same = categories.find((c) => c.name === inc.name);
    if (same) {
      catIdMap.set(inc.id, same.id);
    } else {
      const id = categories.some((c) => c.id === inc.id) ? makeId("cat") : inc.id;
      categories.push({ id, name: inc.name, color: inc.color });
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

// ============================================================
// 多时间线：整库解析
// ============================================================

export type ParsedFile =
  | { kind: "timeline"; doc: TimelineDoc }
  | { kind: "library"; library: Library };

export interface ParseAnyResult {
  ok: boolean;
  value?: ParsedFile;
  error?: string;
}

function parseViewport(v: unknown): { startJdn: number; pxPerDay: number } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.startJdn !== "number" || typeof o.pxPerDay !== "number") return undefined;
  if (!Number.isFinite(o.startJdn) || !Number.isFinite(o.pxPerDay) || o.pxPerDay <= 0) {
    return undefined;
  }
  return { startJdn: o.startJdn, pxPerDay: o.pxPerDay };
}

/**
 * 解析任意导入文件：单条时间线（v1）或整个库（v2）。
 *
 * 每条时间线内部都走 parseImport，所以层级、日期、类别等校验完全复用，
 * 不会出现"整库导入时校验宽松"的漏洞。
 */
export function parseAny(text: string, fallback: DataFile): ParseAnyResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "不是合法的 JSON 文件" };
  }
  if (!raw || typeof raw !== "object") return { ok: false, error: "文件内容不是一个对象" };

  const obj = raw as Record<string, unknown>;

  // ---- v2：整库 ----
  if (Array.isArray(obj.timelines)) {
    const rawList = obj.timelines as Record<string, unknown>[];
    if (rawList.length === 0) return { ok: false, error: "文件里的 timelines 是空的" };

    const out: TimelineDoc[] = [];
    for (let i = 0; i < rawList.length; i++) {
      const t = rawList[i];
      if (!t || typeof t !== "object") {
        return { ok: false, error: `第 ${i + 1} 条时间线不是一个对象` };
      }
      const name =
        typeof t.name === "string" && t.name.trim()
          ? normalizeName(t.name)
          : `时间线 ${i + 1}`;
      // 复用单库解析：把这条线包成 v1 文件再走一遍
      const inner = parseImport(
        JSON.stringify({ version: 1, events: t.events, categories: t.categories, tags: t.tags }),
        fallback
      );
      if (!inner.ok || !inner.data) {
        return { ok: false, error: `时间线「${name}」内容有误：${inner.error}` };
      }
      out.push({
        ...inner.data,
        id: typeof t.id === "string" && t.id.trim() ? t.id : makeId("tl"),
        name,
        createdAt: typeof t.createdAt === "string" ? t.createdAt : new Date().toISOString(),
        viewport: parseViewport(t.viewport),
      });
    }

    // id 去重：手写文件很容易复制粘贴出重复 id
    const seen = new Set<string>();
    for (const doc of out) {
      while (seen.has(doc.id)) doc.id = makeId("tl");
      seen.add(doc.id);
    }

    const lastOpenedId =
      typeof obj.lastOpenedId === "string" && seen.has(obj.lastOpenedId)
        ? obj.lastOpenedId
        : out[0].id;

    return { ok: true, value: { kind: "library", library: { version: 2, lastOpenedId, timelines: out } } };
  }

  // ---- v1：单条时间线 ----
  const parsed = parseImport(text, fallback);
  if (!parsed.ok || !parsed.data) return { ok: false, error: parsed.error };

  const name =
    typeof obj.name === "string" && obj.name.trim() ? normalizeName(obj.name) : "导入的时间线";

  const doc: TimelineDoc = {
    ...parsed.data,
    ...newTimeline(name),
    // newTimeline 自带空事件与默认类别，这里用解析结果覆盖
    events: parsed.data.events,
    categories: parsed.data.categories,
    tags: parsed.data.tags,
  };
  return { ok: true, value: { kind: "timeline", doc } };
}
