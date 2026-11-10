import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Ruler from "./components/Ruler";
import CanvasArea from "./components/CanvasArea";
import EventDialog from "./components/EventDialog";
import ManageDialog from "./components/ManageDialog";
import DataTable from "./components/DataTable";
import Minimap from "./components/Minimap";
import SettingsDialog from "./components/SettingsDialog";
import { save } from "@tauri-apps/plugin-dialog";
import type { Category, Tag, TimelineEvent } from "./data/schema";
import { emptyData, loadData, saveData, type DataFile } from "./lib/store";
import { emptyHistory, pushHistory, redo, undo, type History } from "./lib/history";
import { downloadJson, parseDateIn, exportFileName, mergeData, serializeTimeline, serializeLibrary, parseAny } from "./lib/io";
import { dataRange } from "./lib/minimap";
import { panBy, fitRange, zoomAt, type Viewport } from "./lib/viewport";
import { toJdn } from "./lib/time";
import { loadSettings, saveSettings, type Settings } from "./lib/settings";
import {
  appDir,
  defaultDataDir,
  ensureDir,
  isDesktop,
  joinPath,
  legacyDataDir,
  pathExists,
  readTextFile,
  writeTextFile,
} from "./lib/fsdata";
import { resolveDataPath, saveDataFile, loadLibraryFile } from "./lib/repository";
import type { Library, TimelineDoc } from "./lib/library";
import {
  addTimeline,
  duplicateTimeline,
  emptyLibrary,
  findTimeline,
  nameTaken,
  newTimeline,
  pickTimelineForImport,
  removeTimeline,
  renameTimeline,
  replaceTimeline,
  setViewport,
} from "./lib/library";
import HomeScreen from "./components/HomeScreen";

const MIN_PX_PER_DAY = 1e-4; // 一屏约 2000 年
const MAX_PX_PER_DAY = 400; // 一屏几小时
const GUTTER = 16; // 与 CanvasArea 左留白对齐

/** 没有打开任何时间线时的占位文档（保持引用稳定，避免无谓重渲染） */
const EMPTY_DOC: DataFile = emptyData();

/** 导出副本放在数据目录下的这个子文件夹里 */
const EXPORT_SUBDIR = "exports";

const fitAll = (data: DataFile, width: number): Viewport => {
  if (data.events.length === 0) {
    // 空时间线：给一个像样的默认视野（公元 1800–2100）。
    // 之前这里写的是 19000101，被当成儒略日用了，等于把视口放到公元 5 万年附近，
    // 于是新建时间线后加的第一个事件永远在屏幕外，看起来像"没保存上"。
    return fitRange(
      toJdn(1800, 1, 1),
      toJdn(2100, 1, 1),
      width,
      0.04,
      MIN_PX_PER_DAY,
      MAX_PX_PER_DAY
    );
  }
  const minJ = Math.min(...data.events.map((e) => e.startJdn));
  const maxJ = Math.max(...data.events.map((e) => e.endJdn ?? e.startJdn));
  return fitRange(minJ, maxJ, width, 0.04, MIN_PX_PER_DAY, MAX_PX_PER_DAY);
};

export default function App() {
  const desktop = isDesktop();

  // 设置（数据目录、文件名、备份份数）
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  // ---------- 多时间线 ----------
  const [library, setLibrary] = useState<Library>(() => emptyLibrary());
  const [currentId, setCurrentId] = useState<string | null>(null);
  /** 首页 / 时间线内部 */
  const [screen, setScreen] = useState<"home" | "timeline">("home");

  const currentDoc = useMemo(
    () => library.timelines.find((t) => t.id === currentId) ?? null,
    [library, currentId]
  );

  const data: DataFile = currentDoc ?? EMPTY_DOC;

  /**
   * 兼容原有的 setData 调用点：写入的是**当前时间线**的内容。
   *
   * 注意必须用 ref 读当前时间线 id，不能把 currentId 放进依赖数组：
   * `mutate` 是空依赖的 useCallback，它捕获的是**第一次渲染时**的 setData，
   * 那时 currentId 还是 null，于是所有编辑都会静默变成空操作。
   * 用 ref 后 setData 变成稳定函数，任何时机调用都能拿到最新的 id。
   */
  const currentIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentIdRef.current = currentId;
  }, [currentId]);

  const setData = useCallback(
    (action: DataFile | ((prev: DataFile) => DataFile)) => {
      const id = currentIdRef.current;
      if (!id) return;
      setLibrary((lib) => {
        const idx = lib.timelines.findIndex((t) => t.id === id);
        if (idx < 0) {
          console.warn("[data] 当前时间线已不在库里，编辑被丢弃：", id);
          return lib;
        }
        const prev = lib.timelines[idx];
        const next = typeof action === "function" ? action(prev) : action;
        if (next === prev) return lib;
        return replaceTimeline(lib, id, next);
      });
    },
    []
  );

  const [vp, setVp] = useState<Viewport>(() => fitAll(EMPTY_DOC, 1200));
  const [activeCats, setActiveCats] = useState<Set<string>>(new Set());
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);

  // 数据文件相关
  const [dataDir, setDataDir] = useState<string>("");
  const [exeDir, setExeDir] = useState<string>("");
  const [dataPath, setDataPath] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string>("");

  // 编辑弹窗状态
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TimelineEvent | null>(null);
  const [dialogParentId, setDialogParentId] = useState<string | undefined>(undefined);
  const [manageOpen, setManageOpen] = useState(false);

  // 视图：时间轴 / 表格
  const [view, setView] = useState<"timeline" | "table">("timeline");

  // 待确认的导入（选好文件后先问"合并还是覆盖"）
  const [pendingImport, setPendingImport] = useState<{
    fileName: string;
    data: DataFile;
    /** 如果来源是整库文件，记下用的是哪条线 */
    fromTimeline?: string;
  } | null>(null);

  /** 首页导入整库时，待确认"追加还是替换" */
  const [pendingLibrary, setPendingLibrary] = useState<{
    fileName: string;
    library: Library;
  } | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x0: number; y0: number; startJdn: number; moved: boolean } | null>(null);
  const [canvasH, setCanvasH] = useState(600);

  // 保存失败提示（写盘失败必须让用户知道，否则会静默丢数据）
  const [saveError, setSaveError] = useState<string | null>(null);
  /** 中性提示（比如"已自动升级为新格式"），不是错误 */
  const [notice, setNotice] = useState<string | null>(null);
  /** 上一次成功写盘的文本，内容没变就不重复写 */
  const lastTextRef = useRef<string | null>(null);

  // ---------- 撤销 / 重做 ----------
  const [history, setHistory] = useState<History>(emptyHistory);
  /** 与 data 同步的最新快照，供 mutate 在同一轮事件里连续调用时读到正确的前值 */
  const dataRef = useRef<DataFile>(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  /**
   * 所有**用户操作导致**的数据变更都走这里，自动记录一步撤销。
   *
   * 载入/切换文件不走这里——那不是用户编辑，不该占用撤销栈。
   */
  const mutate = useCallback((updater: (d: DataFile) => DataFile) => {
    const prev = dataRef.current;
    const next = updater(prev);
    if (next === prev) return;
    setHistory((h) => pushHistory(h, prev));
    dataRef.current = next;
    setData(next);
  }, []);

  const doUndo = useCallback(() => {
    const step = undo(history, dataRef.current);
    if (!step) return;
    setHistory(step.history);
    dataRef.current = step.restore;
    setData(step.restore);
    setActiveCats(new Set(step.restore.categories.map((c) => c.id)));
    setActiveTags((prev) => new Set([...prev].filter((id) => step.restore.tags.some((t) => t.id === id))));
  }, [history]);

  const doRedo = useCallback(() => {
    const step = redo(history, dataRef.current);
    if (!step) return;
    setHistory(step.history);
    dataRef.current = step.restore;
    setData(step.restore);
    setActiveCats(new Set(step.restore.categories.map((c) => c.id)));
    setActiveTags((prev) => new Set([...prev].filter((id) => step.restore.tags.some((t) => t.id === id))));
  }, [history]);

  /**
   * 把一份数据装进界面：重置筛选、视口跟着数据走。
   * 用于载入/切换文件，**不进入撤销栈**——那不是用户编辑。
   */
  const adoptData = useCallback((next: DataFile) => {
    dataRef.current = next;
    setData(next);
    setActiveCats(new Set(next.categories.map((c) => c.id)));
    setActiveTags(new Set());
    setExpanded(new Set());
    setVp((v) => fitAll(next, v.width || 1200));
  }, []);

  // ---------- 启动：定位数据文件并读取 ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = loadSettings();

      if (!desktop) {
        // 浏览器模式：没有文件系统，退回 localStorage
        const local = loadData();
        if (cancelled) return;
        if (local.categories.length) adoptData(local);
        setLoading(false);
        return;
      }

      try {
        // 程序所在目录（仅作导出兜底）
        try {
          const exe = await appDir();
          if (!cancelled) setExeDir(exe);
        } catch {
          /* 拿不到就算了 */
        }

        const dir = s.dataDir ?? (await defaultDataDir());
        if (cancelled) return;
        setDataDir(dir);
        const path = joinPath(dir, s.fileName);
        setDataPath(path);

        // 目录名从「历史事件线」改成「HistoryTimeline」，把旧数据搬过来
        if (!s.dataDir && !(await pathExists(path))) {
          try {
            const legacyPath = joinPath(await legacyDataDir(), s.fileName);
            if (await pathExists(legacyPath)) {
              await ensureDir(dir);
              await writeTextFile(path, await readTextFile(legacyPath));
            }
          } catch {
            /* 搬迁失败就按新库开始，不阻塞启动 */
          }
        }

        const res = await loadLibraryFile(path);
        if (cancelled) return;
        setLibrary(res.library);
        const openId = res.library.lastOpenedId ?? res.library.timelines[0]?.id ?? null;
        setCurrentId(openId); currentIdRef.current = openId;
        const doc = res.library.timelines.find((t) => t.id === openId);
        if (doc) {
          dataRef.current = doc;
          setActiveCats(new Set(doc.categories.map((c) => c.id)));
          setActiveTags(new Set());
          setVp((v) => {
            const width = v.width || 1200;
            if (doc.viewport) {
              return { ...doc.viewport, width };
            }
            return fitAll(doc, width);
          });
        }
        // 有内容就直接进时间线；空库停在首页，方便新建或导入
        setScreen(doc && doc.events.length > 0 ? "timeline" : "home");
        if (res.migrated) {
          setNotice(
            "检测到旧版单库文件，已自动升级为多时间线格式（一条名为「我的时间线」），原内容全部保留。"
          );
        }
        if (res.error) {
          setSaveError(
            `${res.error}\n\n为避免覆盖，应用已按空库启动。原文件未做任何修改；` +
              `请先用记事本检查，或在「设置」里换一个文件名。`
          );
        }
      } catch (e) {
        if (!cancelled) setSaveError(`初始化数据目录失败：${String(e)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [desktop, adoptData]);

  // 保存：整个库变化 600ms 后写盘
  useEffect(() => {
    if (loading) return;
    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      if (!desktop) {
        // 浏览器模式：只缓存当前时间线内容
        const ok = saveData(data);
        setSaveState(ok ? "saved" : "error");
        if (!ok) setSaveError("浏览器本地存储写入失败，可能已满。请用「导出 JSON」备份。");
        else setSaveError(null);
        return;
      }
      const res = await saveDataFile(dataPath, library, {
        backupCount: settings.backupCount,
        backupIntervalMinutes: settings.backupIntervalMinutes,
        lastText: lastTextRef.current,
      });
      if (res.ok) {
        if (!res.skipped) lastTextRef.current = serializeLibrary(library);
        setSaveState("saved");
        setSaveError(null);
        setLastSavedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
      } else {
        setSaveState("error");
        setSaveError(`保存到文件失败：${res.error}\n\n请用「导出 JSON」备份当前数据。`);
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [library, dataPath, settings.backupCount, settings.backupIntervalMinutes, loading, desktop, data]);

  // 首次拿到真实宽度后，按全量数据自适应（用 layoutEffect 避免闪一下旧画面）
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let fitted = false;
    const apply = (w: number, h: number) => {
      setCanvasH(Math.max(320, h - 46));
      if (!fitted && w > 0) {
        fitted = true;
        // 首次只设置宽度；数据的适配由 adoptData 负责，避免和异步加载打架
        setVp((v) => ({ ...v, width: w }));
      } else {
        setVp((v) => ({ ...v, width: w }));
      }
    };
    apply(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver(() => apply(el.clientWidth, el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
    // 只在挂载时做一次自适应
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () =>
      data.events.filter(
        (e) =>
          activeCats.has(e.categoryId) &&
          (activeTags.size === 0 || e.tagIds.some((t) => activeTags.has(t)))
      ),
    [data.events, activeCats, activeTags]
  );

  // 滚轮缩放（以鼠标为锚点）
  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const factor = Math.pow(0.995, e.deltaY);
    setVp((v) => zoomAt(v, x, factor, MIN_PX_PER_DAY, MAX_PX_PER_DAY));
  }, []);

  // 拖拽平移（pointer 事件）
  // 关键：不要在 pointerdown 时就 setPointerCapture。
  // 一旦捕获，pointerup 的目标会变成画布，浏览器据此算出的 click 目标
  // 是"按下目标与抬起目标的共同祖先"= 画布，卡片的 onClick 就永远不触发。
  // 所以只在真正拖动（超过 4px）时才捕获。
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { x0: e.clientX, y0: e.clientY, startJdn: vp.startJdn, moved: false };
    stageRef.current?.focus();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    if (!d.moved) {
      if (Math.abs(dx) < 4) return; // 4px 以内算点击，不算拖拽
      d.moved = true;
      setDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    setVp((v) => ({ ...v, startJdn: d.startJdn - dx / v.pxPerDay }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current?.moved) {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
  };

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 所有有子事件的父事件（用于"展开全部/收起全部"）
  const parentIds = useMemo(
    () => [...new Set(data.events.filter((e) => e.parentId).map((e) => e.parentId!))],
    [data.events]
  );
  const allExpanded = parentIds.length > 0 && parentIds.every((id) => expanded.has(id));

  const toggleAllExpanded = useCallback(() => {
    setExpanded((prev) => {
      const every = parentIds.every((id) => prev.has(id));
      return every ? new Set<string>() : new Set(parentIds);
    });
  }, [parentIds]);

  // 全局快捷键：Ctrl+Z 撤销 / Ctrl+Y 或 Ctrl+Shift+Z 重做
  // 挂在 window 上，输入框里也能用（但输入框自己的撤销优先，见下面的判断）
  useEffect(() => {
    const onWindowKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      const key = e.key.toLowerCase();
      const isUndo = key === "z" && !e.shiftKey;
      const isRedo = key === "y" || (key === "z" && e.shiftKey);
      if (!isUndo && !isRedo) return;

      // 在输入框/文本域里让浏览器自己处理，否则会打断打字
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const typing =
        tag === "INPUT" || tag === "TEXTAREA" || (el?.isContentEditable ?? false);
      if (typing) return;

      // 弹窗打开时不处理，避免和弹窗内的撤销冲突
      if (dialogOpen || manageOpen || settingsOpen) return;

      e.preventDefault();
      if (isUndo) doUndo();
      else doRedo();
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [doUndo, doRedo, dialogOpen, manageOpen, settingsOpen]);

  // 键盘：←/→ 平移，+/- 缩放
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") setVp((v) => panBy(v, v.width * 0.15));
    else if (e.key === "ArrowRight") setVp((v) => panBy(v, -v.width * 0.15));
    else if (e.key === "+" || e.key === "=") setVp((v) => zoomAt(v, v.width / 2, 1.4, MIN_PX_PER_DAY, MAX_PX_PER_DAY));
    else if (e.key === "-") setVp((v) => zoomAt(v, v.width / 2, 1 / 1.4, MIN_PX_PER_DAY, MAX_PX_PER_DAY));
  };

  const resetView = () => setVp(fitAll(data, vp.width));

  /** 点自动收纳簇：放大到那一小段时间，簇会自动散开成独立卡片 */
  const focusRange = useCallback((from: number, to: number) => {
    setVp((v) => fitRange(from, to, v.width, 0.14, MIN_PX_PER_DAY, MAX_PX_PER_DAY));
  }, []);

  // ---------- M4：编辑 ----------
  const openAdd = () => {
    setEditing(null);
    setDialogParentId(undefined);
    setDialogOpen(true);
  };

  const openAddChild = useCallback((parentId: string) => {
    setEditing(null);
    setDialogParentId(parentId);
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((ev: TimelineEvent) => {
    setEditing(ev);
    setDialogParentId(undefined);
    setDialogOpen(true);
  }, []);

  const deleteEvent = useCallback(
    (id: string) => {
      mutate((d) => {
        // 删父事件时，子事件降级为顶层事件，不连坐删除
        const events = d.events
          .filter((e) => e.id !== id)
          .map((e) => (e.parentId === id ? { ...e, parentId: undefined } : e));
        return { ...d, events };
      });
    },
    [mutate]
  );

  const saveEvent = useCallback(
    (ev: TimelineEvent, newTag?: Tag) => {
      mutate((d) => {
        const exists = d.events.some((e) => e.id === ev.id);
        const events = exists ? d.events.map((e) => (e.id === ev.id ? ev : e)) : [...d.events, ev];
        const tags = newTag && !d.tags.some((t) => t.id === newTag.id) ? [...d.tags, newTag] : d.tags;
        return { ...d, events, tags };
      });
      // 保存的事件可能落在视野外（新建的空时间线、或者刚才平移到了别处）。
      // 看不见就等于"没保存上"，所以这里主动把视野挪过去。
      setVp((v) => {
        const span = v.pxPerDay > 0 ? v.width / v.pxPerDay : 365;
        const end = ev.endJdn ?? ev.startJdn;
        const visible = ev.startJdn >= v.startJdn && end <= v.startJdn + span;
        if (visible) return v;
        const mid = (ev.startJdn + end) / 2;
        const days = Math.max(365, (end - ev.startJdn) * 3);
        return fitRange(
          mid - days / 2,
          mid + days / 2,
          v.width,
          0.02,
          MIN_PX_PER_DAY,
          MAX_PX_PER_DAY
        );
      });
      setDialogOpen(false);
      setEditing(null);
      setDialogParentId(undefined);
    },
    [mutate]
  );

  /**
   * 把某个时间点放到视野正中，保持当前缩放。
   * 迷你地图点击、跳转输入框都用它。
   */
  const centerOn = useCallback((jdn: number) => {
    setVp((v) => {
      const span = v.pxPerDay > 0 ? v.width / v.pxPerDay : 365;
      return { ...v, startJdn: jdn - span / 2 };
    });
  }, []);

  /** 跳转到指定年份 */
  const [yearInput, setYearInput] = useState("");
  const [yearInvalid, setYearInvalid] = useState(false);

  /** 迷你地图用的全域范围（跟着筛选结果走） */
  const miniRange = useMemo(() => dataRange(filtered), [filtered]);

  const jumpToYear = useCallback(() => {
    const raw = yearInput.trim();
    if (!raw) return;
    const jdn = parseDateIn(raw);
    if (jdn === null) {
      setYearInvalid(true);
      return;
    }
    setYearInvalid(false);
    setYearInput("");
    setView("timeline");
    centerOn(jdn);
  }, [yearInput, centerOn]);

  /**
   * 把某个事件框到视野中间。
   *
   * 之前用固定 ±400 天，跨度差别很大的事件（一天的事 vs 四年的战争）框出来的
   * 视野都很别扭。现在按"事件占屏幕约 1/3、且至少显示一年"来算：
   * 点事件看到前后半年，长事件看到它本身加两侧余量。
   */
  const focusEvent = useCallback((ev: TimelineEvent) => {
    setView("timeline");
    setVp((v) => {
      const start = ev.startJdn;
      const end = ev.endJdn ?? start;
      const span = Math.max(1, end - start);
      const mid = (start + end) / 2;
      const visibleDays = Math.max(365, span * 3); // 至少一年，事件占中间约 1/3
      return fitRange(
        mid - visibleDays / 2,
        mid + visibleDays / 2,
        v.width,
        0.02,
        MIN_PX_PER_DAY,
        MAX_PX_PER_DAY
      );
    });
  }, []);

  /** 清空所有事件与标签（保留类别），便于从零开始录入。可撤销 */
  const handleClear = () => {
    if (
      !window.confirm(
        `清空全部 ${data.events.length} 条事件和 ${data.tags.length} 个标签？\n\n类别会保留。清空后可以用 Ctrl+Z 撤销。`
      )
    ) {
      return;
    }
    const cleared = emptyData();
    mutate(() => cleared);
    setActiveCats(new Set(cleared.categories.map((c) => c.id)));
    setActiveTags(new Set());
    setVp(fitAll(cleared, vp.width));
  };

  // ---------- 设置 ----------
  /** 应用新设置：目录或文件名变了就把数据迁过去 */
  const applySettings = useCallback(
    async (next: Settings) => {
      const prev = settings;
      setSettings(next);
      saveSettings(next);
      setSettingsOpen(false);
      if (!desktop) return;

      // 路径没变，什么也不用做
      if (next.dataDir === prev.dataDir && next.fileName === prev.fileName) return;

      try {
        const newPath = await resolveDataPath(next);
        const exists = await pathExists(newPath);
        if (exists) {
          // 目标已有数据：切过去（不覆盖）
          const res = await loadLibraryFile(newPath);
          if (res.error) {
            setSaveError(`切换失败：${res.error}`);
            return;
          }
          setDataPath(newPath);
          setDataDir(next.dataDir ?? (await defaultDataDir()));
          setLibrary(res.library);
          const openId = res.library.lastOpenedId ?? res.library.timelines[0]?.id ?? null;
          setCurrentId(openId); currentIdRef.current = openId;
          const doc = res.library.timelines.find((t) => t.id === openId);
          if (doc) {
            dataRef.current = doc;
            setActiveCats(new Set(doc.categories.map((c) => c.id)));
            setActiveTags(new Set());
            setVp((v) => (doc.viewport ? { ...doc.viewport, width: v.width || 1200 } : fitAll(doc, v.width || 1200)));
          }
          setScreen(doc && doc.events.length > 0 ? "timeline" : "home");
          window.alert(
            `已切换到已有数据文件：\n${newPath}\n\n` +
              `${res.library.timelines.length} 条时间线，共 ` +
              `${res.library.timelines.reduce((n, t) => n + t.events.length, 0)} 个事件。`
          );
        } else {
          // 目标不存在：把当前整库存过去
          const dir = next.dataDir ?? (await defaultDataDir());
          setDataDir(dir);
          setDataPath(newPath);
          const res = await saveDataFile(newPath, library, {
            backupCount: next.backupCount,
            backupIntervalMinutes: next.backupIntervalMinutes,
          });
          if (!res.ok) setSaveError(`写入新位置失败：${res.error}`);
          else window.alert(`数据已保存到新位置：\n${newPath}`);
        }
      } catch (e) {
        setSaveError(`切换数据位置失败：${String(e)}`);
      }
    },
    [settings, desktop, library]
  );

  // ---------- 多时间线操作 ----------
  /** 打开某条时间线：恢复它自己的视口 */
  const openTimeline = useCallback(
    (id: string) => {
      const doc = findTimeline(library, id);
      if (!doc) return;
      setCurrentId(id); currentIdRef.current = id;
      setLibrary((lib) => ({ ...lib, lastOpenedId: id }));
      dataRef.current = doc;
      setActiveCats(new Set(doc.categories.map((c) => c.id)));
      setActiveTags(new Set());
      setExpanded(new Set());
      setVp((v) => {
        const width = v.width || 1200;
        return doc.viewport ? { ...doc.viewport, width } : fitAll(doc, width);
      });
      setScreen("timeline");
    },
    [library]
  );

  /** 返回首页（顺手把当前视口记下来） */
  const backToHome = useCallback(() => {
    if (currentId) {
      setLibrary((lib) =>
        setViewport(lib, currentId, { startJdn: vp.startJdn, pxPerDay: vp.pxPerDay })
      );
    }
    setScreen("home");
  }, [currentId, vp.startJdn, vp.pxPerDay]);

  const createTimeline = useCallback(
    (name: string, vocabFromId?: string | null) => {
      if (nameTaken(library, name)) {
        window.alert(`已经有一条叫「${name}」的时间线了，换个名字。`);
        return;
      }
      const source = vocabFromId ? findTimeline(library, vocabFromId) ?? undefined : undefined;
      const doc = newTimeline(name, source ? { vocabFrom: source } : undefined);
      setLibrary((lib) => addTimeline(lib, doc));
      setCurrentId(doc.id); currentIdRef.current = doc.id;
      dataRef.current = doc;
      setActiveCats(new Set(doc.categories.map((c) => c.id)));
      setActiveTags(new Set());
      setVp((v) => fitAll(doc, v.width || 1200));
      setScreen("timeline");
    },
    [library]
  );

  const doRenameTimeline = useCallback(
    (id: string, name: string) => {
      if (nameTaken(library, name, id)) {
        window.alert(`已经有一条叫「${name}」的时间线了。`);
        return;
      }
      setLibrary((lib) => renameTimeline(lib, id, name));
    },
    [library]
  );

  const doDeleteTimeline = useCallback(
    (id: string) => {
      if (library.timelines.length <= 1) return;
      const doc = findTimeline(library, id);
      if (!doc) return;
      const answer = window.prompt(
        `删除时间线「${doc.name}」？\n\n` +
          `它自己的 ${doc.events.length} 个事件、${doc.tags.length} 个标签会一起删除，其他时间线不受影响。\n\n` +
          `如果确认，请输入这条时间线的名字：`,
        ""
      );
      if (answer === null) return;
      if (answer.trim() !== doc.name) {
        window.alert("名字不一致，已取消删除。");
        return;
      }
      setLibrary((lib) => removeTimeline(lib, id));
      if (currentId === id) { setCurrentId(null); currentIdRef.current = null; }
    },
    [library, currentId]
  );

  // 时间线内容变化时，顺手把视口记进库（节流 1.5 秒）
  useEffect(() => {
    if (!currentId || loading || screen !== "timeline") return;
    const timer = window.setTimeout(() => {
      setLibrary((lib) => setViewport(lib, currentId, { startJdn: vp.startJdn, pxPerDay: vp.pxPerDay }));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [currentId, vp.startJdn, vp.pxPerDay, loading, screen]);

  // ---------- 导入 / 导出 ----------
  const fileRef = useRef<HTMLInputElement | null>(null);
  /** 这次选文件是"导入到当前线"还是"从首页导入成新时间线" */
  const importTargetRef = useRef<"timeline" | "library">("timeline");

  const today = () => new Date().toISOString().slice(0, 10);

  /** 弹「另存为」，返回用户选的路径；取消返回 null */
  const pickExportPath = async (fileName: string, title: string): Promise<string | null> => {
    const exportDir = dataDir ? joinPath(dataDir, EXPORT_SUBDIR) : exeDir;
    if (exportDir) await ensureDir(exportDir);
    return save({
      title,
      defaultPath: exportDir ? joinPath(exportDir, fileName) : fileName,
      filters: [{ name: "JSON 文件", extensions: ["json"] }],
    });
  };

  /** 把一段文本写到用户选的路径 */
  const writeOut = async (target: string, text: string) => {
    try {
      await writeTextFile(target, text);
      window.alert(`已导出到：\n${target}`);
    } catch (e) {
      setSaveError(`导出失败：${String(e)}`);
    }
  };

  /**
   * 导出**当前时间线**（v1 格式，单个文件）。
   * 默认存到数据目录下的 exports\ 子文件夹，也可以改到任意位置。
   */
  const handleExport = async () => {
    if (!currentDoc) return;
    const text = serializeTimeline(currentDoc);
    if (!desktop) {
      downloadJson(data, exportFileName());
      return;
    }
    try {
      const target = await pickExportPath(exportFileName(), "导出当前时间线");
      if (!target) return;
      await writeOut(target, text);
    } catch (e) {
      setSaveError(`导出失败：${String(e)}`);
    }
  };

  /** 从首页导出整个库 */
  const handleExportAll = async () => {
    const text = serializeLibrary(library);
    if (!desktop) {
      window.alert("浏览器模式暂不支持导出整库，请在桌面版里操作。");
      return;
    }
    try {
      const target = await pickExportPath(`history-timeline-all-${today()}.json`, "导出全部时间线");
      if (!target) return;
      await writeOut(target, text);
    } catch (e) {
      setSaveError(`导出失败：${String(e)}`);
    }
  };

  /** 从首页导出勾选的时间线（装在一个文件里） */
  const handleExportSelected = async (ids: string[]) => {
    if (ids.length === 0) return;
    const picked = library.timelines.filter((t) => ids.includes(t.id));
    const sub: Library = {
      version: 2,
      lastOpenedId: picked[0]?.id ?? null,
      timelines: picked,
    };
    if (!desktop) {
      window.alert("浏览器模式暂不支持导出，请在桌面版里操作。");
      return;
    }
    try {
      const target = await pickExportPath(
        `history-timeline-${picked.length}-lines-${today()}.json`,
        `导出所选的 ${picked.length} 条时间线`
      );
      if (!target) return;
      await writeOut(target, serializeLibrary(sub));
    } catch (e) {
      setSaveError(`导出失败：${String(e)}`);
    }
  };

  const handleImportFile = async (file: File) => {
    const text = await file.text();

    // 首页导入：整库文件先问"追加还是替换"；单条文件直接作为一条新线
    if (importTargetRef.current === "library") {
      const any = parseAny(text, emptyData());
      if (!any.ok || !any.value) {
        window.alert(`导入失败：${any.error ?? "未知错误"}`);
        return;
      }
      if (any.value.kind === "timeline") {
        appendTimelines([any.value.doc]);
        return;
      }
      setPendingLibrary({ fileName: file.name, library: any.value.library });
      return;
    }

    // 时间线内部导入：整库文件也能用，挑其中一条
    const any = parseAny(text, data);
    if (!any.ok || !any.value) {
      window.alert(`导入失败：${any.error ?? "未知错误"}`);
      return;
    }
    if (any.value.kind === "library") {
      const picked = pickTimelineForImport(any.value.library, currentDoc?.name ?? "");
      if (!picked) {
        const names = any.value.library.timelines.map((t) => `「${t.name}」`).join("、");
        window.alert(
          `这是一个包含 ${any.value.library.timelines.length} 条时间线的整库文件：${names}\n\n` +
            `其中没有和当前时间线同名的条目。\n` +
            `请到首页用「导入」导入，或把文件里那条线改成与当前线同名再试。`
        );
        return;
      }
      setPendingImport({
        fileName: `${file.name} → 「${picked.name}」`,
        data: picked,
        fromTimeline: picked.name,
      });
      return;
    }

    setPendingImport({ fileName: file.name, data: any.value.doc });
  };

  /** 把若干条时间线追加进库（重名自动加后缀） */
  const appendTimelines = (incoming: TimelineDoc[]) => {
    if (incoming.length === 0) return;
    setLibrary((lib) => {
      let next = lib;
      let i = 0;
      for (const doc of incoming) {
        let name = doc.name;
        let n = 2;
        while (nameTaken(next, name)) name = `${doc.name} (${n++})`;
        next = addTimeline(next, {
          ...doc,
          id: `${doc.id}-${Date.now().toString(36)}-${i++}`,
          name,
        });
      }
      return next;
    });
    window.alert(`已导入 ${incoming.length} 条时间线，可在首页看到。`);
  };

  /** 用文件里的整库**替换**当前库 */
  const replaceLibrary = () => {
    if (!pendingLibrary) return;
    const lib = pendingLibrary.library;
    setLibrary(lib);
    const openId = lib.lastOpenedId ?? lib.timelines[0]?.id ?? null;
    setCurrentId(openId); currentIdRef.current = openId;
    const doc = lib.timelines.find((t) => t.id === openId);
    if (doc) {
      dataRef.current = doc;
      setActiveCats(new Set(doc.categories.map((c) => c.id)));
      setActiveTags(new Set());
    }
    setScreen("home");
    setPendingLibrary(null);
    window.alert(`已替换为文件里的 ${lib.timelines.length} 条时间线。`);
  };

  /** 合并：追加事件，冲突的 id 换新，不覆盖任何已有内容（可撤销） */
  const applyMerge = () => {
    if (!pendingImport) return;
    const res = mergeData(data, pendingImport.data);
    mutate(() => res.data);
    setActiveCats(new Set(res.data.categories.map((c) => c.id)));
    setVp(fitAll(res.data, vp.width));
    setPendingImport(null);
    window.alert(
      `已合并 ${res.added} 条事件` +
        (res.renamed ? `（其中 ${res.renamed} 条 id 冲突已重新分配）` : "") +
        (res.newCategories ? `，新增 ${res.newCategories} 个类别` : "") +
        (res.newTags ? `，新增 ${res.newTags} 个标签` : "")
    );
  };

  /** 覆盖：整库替换成文件内容（可撤销） */
  const applyReplace = () => {
    if (!pendingImport) return;
    const next = pendingImport.data;
    mutate(() => next);
    setActiveCats(new Set(next.categories.map((c) => c.id)));
    setActiveTags(new Set());
    setVp(fitAll(next, vp.width));
    setPendingImport(null);
  };

  // ---------- 类别 / 标签管理 ----------
  /** 保存类别；被删掉的类别下的事件自动归到第一个剩下的类别，不丢事件 */
  const saveCategories = useCallback(
    (next: Category[]) => {
      mutate((d) => {
        const ids = new Set(next.map((c) => c.id));
        const fallback = next[0]?.id ?? "politics";
        const events = d.events.map((e) =>
          ids.has(e.categoryId) ? e : { ...e, categoryId: fallback }
        );
        return { ...d, categories: next, events };
      });
      setActiveCats((prev) => {
        const ids = new Set(next.map((c) => c.id));
        const kept = [...prev].filter((id) => ids.has(id));
        return new Set(kept.length ? kept : next.map((c) => c.id));
      });
    },
    [mutate]
  );

  /** 保存标签；被删标签从事件上摘掉 */
  const saveTags = useCallback(
    (next: Tag[], removedIds: string[]) => {
      const gone = new Set(removedIds);
      mutate((d) => ({
        ...d,
        tags: next,
        events: gone.size
          ? d.events.map((e) =>
              e.tagIds.some((t) => gone.has(t))
                ? { ...e, tagIds: e.tagIds.filter((t) => !gone.has(t)) }
                : e
            )
          : d.events,
      }));
      setActiveTags((prev) => new Set([...prev].filter((id) => !gone.has(id))));
    },
    [mutate]
  );

  const pxPerDayLabel =
    vp.pxPerDay > 1 ? `${vp.pxPerDay.toFixed(1)} px/天` : `1 天 = ${(1 / vp.pxPerDay).toFixed(0)} px⁻¹`;

  const topLevelCount = useMemo(() => data.events.filter((e) => !e.parentId).length, [data.events]);
  const visibleTopLevel = useMemo(() => filtered.filter((e) => !e.parentId).length, [filtered]);

  return (
    <div className="app">
      {screen === "home" ? (
        <HomeScreen
          library={library}
          dataPath={dataPath}
          onOpen={openTimeline}
          onCreate={createTimeline}
          onRename={doRenameTimeline}
          onDuplicate={(id) => setLibrary((lib) => duplicateTimeline(lib, id))}
          onDelete={doDeleteTimeline}
          onExportAll={() => void handleExportAll()}
          onExportSelected={(ids) => void handleExportSelected(ids)}
          onImport={() => {
            importTargetRef.current = "library";
            fileRef.current?.click();
          }}
        />
      ) : (
        <>
      <header className="topbar">
        <button className="chip back-home" onClick={backToHome} title="返回所有时间线">
          ← 所有时间线
        </button>
        <div className="brand tl-title" title={currentDoc?.name ?? ""}>
          {currentDoc?.name ?? "历史事件线"}
        </div>

        <div className="view-switch">
          <button
            className={"vs-btn" + (view === "timeline" ? " on" : "")}
            onClick={() => setView("timeline")}
          >
            时间轴
          </button>
          <button
            className={"vs-btn" + (view === "table" ? " on" : "")}
            onClick={() => setView("table")}
          >
            表格
          </button>
        </div>

        <div className="filter-group">
          <span className="filter-label">类别</span>
          {data.categories.map((c) => (
            <button
              key={c.id}
              className={"chip" + (activeCats.has(c.id) ? " on" : "")}
              style={{ "--chip-color": c.color } as React.CSSProperties}
              onClick={() => setActiveCats((s) => toggle(s, c.id))}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="filter-group">
          <span className="filter-label">标签</span>
          {data.tags.map((t) => (
            <button
              key={t.id}
              className={"chip tag" + (activeTags.has(t.id) ? " on" : "")}
              onClick={() => setActiveTags((s) => toggle(s, t.id))}
            >
              #{t.name}
            </button>
          ))}
        </div>

        <button
          className={"chip expand-all" + (allExpanded ? " on" : "")}
          onClick={toggleAllExpanded}
          title="一次展开/收起所有带子事件的事件"
          disabled={parentIds.length === 0}
        >
          {allExpanded ? "收起全部子事件" : `展开全部子事件 (${parentIds.length})`}
        </button>

        <div className="jump-group">
          <input
            className={"jump-input" + (yearInvalid ? " invalid" : "")}
            value={yearInput}
            placeholder="跳到年份"
            title={yearInvalid ? "无法识别，试试 1911 或 -221" : "输入年份后回车跳转，支持公元前用负数"}
            onChange={(e) => {
              setYearInput(e.target.value);
              setYearInvalid(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                jumpToYear();
              }
            }}
          />
        </div>

        <button className="chip add-event" onClick={openAdd} title="新增事件">
          ＋ 新增事件
        </button>
        <button className="chip manage" onClick={() => setManageOpen(true)} title="管理类别与标签">
          管理类别/标签
        </button>
      </header>

      <main
        className="stage"
        ref={stageRef}
        tabIndex={0}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        style={dragging ? { cursor: "grabbing" } : undefined}
      >
        {view === "timeline" ? (
          <>
            <div className="ruler-row">
              <Ruler vp={vp} offsetX={GUTTER} />
            </div>
            <CanvasArea
              vp={vp}
              events={filtered}
              totalEvents={data.events.length}
              categories={data.categories}
              tags={data.tags}
              height={canvasH}
              expanded={expanded}
              onToggleExpand={toggleExpanded}
              onFocusRange={focusRange}
              onEditEvent={openEdit}
              onDeleteEvent={deleteEvent}
              onAddChild={openAddChild}
            />
            <div className="hud">
              <span>
                节点 {visibleTopLevel} / {topLevelCount}
              </span>
              <span>缩放 {pxPerDayLabel}</span>
            </div>

            {miniRange && (
              <Minimap
                events={filtered}
                categories={data.categories}
                minJdn={miniRange.minJdn}
                maxJdn={miniRange.maxJdn}
                viewStart={vp.startJdn}
                viewEnd={vp.startJdn + (vp.pxPerDay > 0 ? vp.width / vp.pxPerDay : 365)}
                onSeek={centerOn}
              />
            )}
          </>
        ) : (
          <DataTable
            events={filtered}
            categories={data.categories}
            tags={data.tags}
            onEdit={openEdit}
            onDelete={deleteEvent}
            onSelect={(ev) => {
              // 双击行：切回时间轴，把该事件框到视野中间
              focusEvent(ev);
            }}
          />
        )}
      </main>

      {notice && (
        <div className="notice-bar">
          <span>{notice}</span>
          <button className="save-error-close" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}

      {saveError && (
        <div className="save-error" role="alert">
          <span className="save-error-icon">!</span>
          <span>{saveError}</span>
          <button className="save-error-close" onClick={() => setSaveError(null)}>
            ×
          </button>
        </div>
      )}

      <footer className="bottombar">
        <div className="save-state">
          {loading ? (
            <span className="ss-idle">正在载入…</span>
          ) : saveState === "saving" ? (
            <span className="ss-saving">保存中…</span>
          ) : saveState === "error" ? (
            <span className="ss-error">保存失败</span>
          ) : saveState === "saved" ? (
            <span className="ss-saved" title={dataPath || "浏览器本地存储"}>
              已保存{lastSavedAt ? ` ${lastSavedAt}` : ""}
            </span>
          ) : (
            <span className="ss-idle">—</span>
          )}
        </div>
        <div className="hint">
          拖动平移 · 滚轮缩放 · 点「N ↓」放大到那一段 · 点卡片看详情
        </div>
        <div className="zoom-buttons">
          <button
            onClick={doUndo}
            disabled={history.past.length === 0}
            title={`撤销 (Ctrl+Z)${history.past.length ? ` · 还有 ${history.past.length} 步` : ""}`}
          >
            ↶
          </button>
          <button
            onClick={doRedo}
            disabled={history.future.length === 0}
            title={`重做 (Ctrl+Y)${history.future.length ? ` · 还有 ${history.future.length} 步` : ""}`}
          >
            ↷
          </button>
          <button onClick={() => setVp((v) => zoomAt(v, v.width / 2, 1 / 1.4, MIN_PX_PER_DAY, MAX_PX_PER_DAY))}>−</button>
          <button onClick={() => setVp((v) => zoomAt(v, v.width / 2, 1.4, MIN_PX_PER_DAY, MAX_PX_PER_DAY))}>+</button>
          <button onClick={resetView}>复位</button>
        </div>

        <div className="data-buttons">
          <button onClick={handleExport} title="另存为一份 JSON 文件（备份 / 交给别人）">
            导出 JSON
          </button>
          <button onClick={() => fileRef.current?.click()} title="从 JSON 文件导入">
            导入 JSON
          </button>
          <button className="danger" onClick={handleClear} title="清空全部事件与标签，保留类别">
            清空全部
          </button>
          <button onClick={() => setSettingsOpen(true)} title="数据目录、备份份数">
            设置
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleImportFile(f);
            e.target.value = ""; // 允许连续导入同一个文件
          }}
        />
      </footer>

      <EventDialog
        open={dialogOpen}
        initial={editing}
        categories={data.categories}
        tags={data.tags}
        allEvents={data.events}
        parentId={dialogParentId}
        onSave={saveEvent}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
          setDialogParentId(undefined);
        }}
      />

      <ManageDialog
        open={manageOpen}
        categories={data.categories}
        tags={data.tags}
        events={data.events}
        onSaveCategories={saveCategories}
        onSaveTags={saveTags}
        onClose={() => setManageOpen(false)}
      />

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        resolvedDir={dataDir || "（未初始化）"}
        isDesktop={desktop}
        onSave={(next) => {
          void applySettings(next);
        }}
        onClose={() => setSettingsOpen(false)}
      />

      {/* 首页导入整库：追加 or 替换 */}
      {pendingLibrary && (
        <div className="dialog-mask" onMouseDown={() => setPendingLibrary(null)}>
          <div className="dialog narrow" onMouseDown={(e) => e.stopPropagation()}>
            <div className="dlg-head">
              <span>导入时间线库</span>
              <button className="dlg-x" onClick={() => setPendingLibrary(null)}>
                ×
              </button>
            </div>
            <div className="dlg-body">
              <div className="imp-file">{pendingLibrary.fileName}</div>
              <div className="imp-stat">
                文件里有 <b>{pendingLibrary.library.timelines.length}</b> 条时间线，共{" "}
                <b>
                  {pendingLibrary.library.timelines.reduce((n, t) => n + t.events.length, 0)}
                </b>{" "}
                个事件
                <br />
                当前库有 <b>{library.timelines.length}</b> 条时间线
              </div>

              <div className="imp-options">
                <button
                  className="imp-opt primary"
                  onClick={() => {
                    const incoming = pendingLibrary.library.timelines;
                    setPendingLibrary(null);
                    appendTimelines(incoming);
                  }}
                >
                  <span className="imp-opt-title">追加为新的时间线</span>
                  <span className="imp-opt-desc">
                    现有的 {library.timelines.length} 条线保持不变，文件里的每条线各变成一条新线
                  </span>
                </button>
                <button className="imp-opt danger" onClick={replaceLibrary}>
                  <span className="imp-opt-title">替换整个库（清空后写入）</span>
                  <span className="imp-opt-desc">
                    当前的 {library.timelines.length} 条时间线会全部消失，只保留文件里的内容
                  </span>
                </button>
              </div>
            </div>
            <div className="dlg-foot">
              <button className="dlg-btn ghost" onClick={() => setPendingLibrary(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 导入方式选择：合并 or 覆盖 */}
      {pendingImport && (
        <div className="dialog-mask" onMouseDown={() => setPendingImport(null)}>
          <div className="dialog narrow" onMouseDown={(e) => e.stopPropagation()}>
            <div className="dlg-head">
              <span>导入数据</span>
              <button className="dlg-x" onClick={() => setPendingImport(null)}>
                ×
              </button>
            </div>
            <div className="dlg-body">
              <div className="imp-file">{pendingImport.fileName}</div>
              <div className="imp-stat">
                {pendingImport.fromTimeline && (
                  <>
                    来自整库文件里的「{pendingImport.fromTimeline}」
                    <br />
                  </>
                )}
                文件里有 <b>{pendingImport.data.events.length}</b> 条事件、
                <b>{pendingImport.data.categories.length}</b> 个类别、
                <b>{pendingImport.data.tags.length}</b> 个标签
                <br />
                当前库有 <b>{data.events.length}</b> 条事件
              </div>

              <div className="imp-options">
                <button className="imp-opt primary" onClick={applyMerge}>
                  <span className="imp-opt-title">合并到现有数据</span>
                  <span className="imp-opt-desc">
                    追加文件里的事件，已有内容一律不动；id 冲突的会重新分配
                  </span>
                </button>
                <button className="imp-opt danger" onClick={applyReplace}>
                  <span className="imp-opt-title">覆盖全部（清空后写入）</span>
                  <span className="imp-opt-desc">
                    当前 {data.events.length} 条事件会被清空，只保留文件里的内容
                  </span>
                </button>
              </div>
            </div>
            <div className="dlg-foot">
              <button className="dlg-btn ghost" onClick={() => setPendingImport(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
