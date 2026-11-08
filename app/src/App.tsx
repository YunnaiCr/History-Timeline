import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Ruler from "./components/Ruler";
import CanvasArea from "./components/CanvasArea";
import EventDialog from "./components/EventDialog";
import ManageDialog from "./components/ManageDialog";
import DataTable from "./components/DataTable";
import SettingsDialog from "./components/SettingsDialog";
import { save } from "@tauri-apps/plugin-dialog";
import type { Category, Tag, TimelineEvent } from "./data/schema";
import { emptyData, loadData, saveData, type DataFile } from "./lib/store";
import { downloadJson, parseImport, exportFileName, mergeData } from "./lib/io";
import { panBy, fitRange, zoomAt, type Viewport } from "./lib/viewport";
import { loadSettings, saveSettings, type Settings } from "./lib/settings";
import { defaultDataDir, dirOf, isDesktop, joinPath, pathExists } from "./lib/fsdata";
import { loadDataFile, resolveDataPath, saveDataFile } from "./lib/repository";

const MIN_PX_PER_DAY = 1e-4; // 一屏约 2000 年
const MAX_PX_PER_DAY = 400; // 一屏几小时
const GUTTER = 16; // 与 CanvasArea 左留白对齐

const fitAll = (data: DataFile, width: number): Viewport => {
  if (data.events.length === 0) {
    return fitRange(19000101, 19000102, width, 0.04, MIN_PX_PER_DAY, MAX_PX_PER_DAY);
  }
  const minJ = Math.min(...data.events.map((e) => e.startJdn));
  const maxJ = Math.max(...data.events.map((e) => e.endJdn ?? e.startJdn));
  return fitRange(minJ, maxJ, width, 0.04, MIN_PX_PER_DAY, MAX_PX_PER_DAY);
};

export default function App() {
  const desktop = isDesktop();

  // 设置（数据目录、文件名、备份份数）
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  const [data, setData] = useState<DataFile>(() => emptyData());
  const [vp, setVp] = useState<Viewport>(() => fitAll(emptyData(), 1200));
  const [activeCats, setActiveCats] = useState<Set<string>>(new Set());
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);

  // 数据文件相关
  const [dataDir, setDataDir] = useState<string>("");
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
  } | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x0: number; y0: number; startJdn: number; moved: boolean } | null>(null);
  const [canvasH, setCanvasH] = useState(600);

  // 保存失败提示（写盘失败必须让用户知道，否则会静默丢数据）
  const [saveError, setSaveError] = useState<string | null>(null);

  /** 把一份数据装进界面：重置筛选、视口跟着数据走 */
  const adoptData = useCallback((next: DataFile) => {
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
        const dir = s.dataDir ?? (await defaultDataDir());
        if (cancelled) return;
        setDataDir(dir);
        const path = joinPath(dir, s.fileName);
        setDataPath(path);

        const res = await loadDataFile(path);
        if (cancelled) return;
        adoptData(res.data);
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

  // ---------- 保存：数据变化 600ms 后写盘 ----------
  useEffect(() => {
    if (loading) return;
    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      if (!desktop) {
        const ok = saveData(data);
        setSaveState(ok ? "saved" : "error");
        if (!ok) setSaveError("浏览器本地存储写入失败，可能已满。请用「导出 JSON」备份。");
        else setSaveError(null);
        return;
      }
      const res = await saveDataFile(dataPath, data, settings.backupCount);
      if (res.ok) {
        setSaveState("saved");
        setSaveError(null);
        setLastSavedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
      } else {
        setSaveState("error");
        setSaveError(`保存到文件失败：${res.error}\n\n请用「导出 JSON」备份当前数据。`);
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [data, dataPath, settings.backupCount, loading, desktop]);

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

  const deleteEvent = useCallback((id: string) => {
    setData((d) => {
      // 删父事件时，子事件降级为顶层事件，不连坐删除
      const events = d.events
        .filter((e) => e.id !== id)
        .map((e) => (e.parentId === id ? { ...e, parentId: undefined } : e));
      return { ...d, events };
    });
  }, []);

  const saveEvent = useCallback((ev: TimelineEvent, newTag?: Tag) => {
    setData((d) => {
      const exists = d.events.some((e) => e.id === ev.id);
      const events = exists ? d.events.map((e) => (e.id === ev.id ? ev : e)) : [...d.events, ev];
      const tags = newTag && !d.tags.some((t) => t.id === newTag.id) ? [...d.tags, newTag] : d.tags;
      return { ...d, events, tags };
    });
    setDialogOpen(false);
    setEditing(null);
    setDialogParentId(undefined);
  }, []);

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

  /** 清空所有事件与标签（保留类别），便于从零开始录入 */
  const handleClear = () => {
    if (
      !window.confirm(
        `清空全部 ${data.events.length} 条事件和 ${data.tags.length} 个标签？\n\n类别会保留。此操作不可撤销，建议先「导出 JSON」备份。`
      )
    ) {
      return;
    }
    adoptData(emptyData());
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
          const res = await loadDataFile(newPath);
          setDataPath(newPath);
          setDataDir(next.dataDir ?? (await defaultDataDir()));
          adoptData(res.data);
          setSaveError(res.error ?? null);
          window.alert(`已切换到已有数据文件：\n${newPath}\n\n共 ${res.data.events.length} 条事件。`);
        } else {
          // 目标不存在：把当前数据存过去
          const dir = next.dataDir ?? (await defaultDataDir());
          setDataDir(dir);
          setDataPath(newPath);
          const res = await saveDataFile(newPath, data, next.backupCount);
          if (!res.ok) setSaveError(`写入新位置失败：${res.error}`);
          else window.alert(`数据已保存到新位置：\n${newPath}`);
        }
      } catch (e) {
        setSaveError(`切换数据位置失败：${String(e)}`);
      }
    },
    [settings, desktop, data, adoptData]
  );

  // ---------- 导入 / 导出 ----------
  const fileRef = useRef<HTMLInputElement | null>(null);

  /**
   * 导出为 JSON。
   *
   * 桌面版弹「另存为」，默认目录是**数据文件的上一层**（默认即「文档」），
   * 这样别人找起来方便，也不会像浏览器下载那样堆出 `(1)` `(2)`。
   * 浏览器模式没有保存对话框，退回普通下载。
   */
  const handleExport = async () => {
    if (!desktop) {
      downloadJson(data, exportFileName());
      return;
    }
    try {
      const defaultPath = dataDir ? joinPath(dirOf(dataDir), exportFileName()) : exportFileName();
      const target = await save({
        title: "导出为 JSON",
        defaultPath,
        filters: [{ name: "JSON 文件", extensions: ["json"] }],
      });
      if (!target) return; // 用户取消
      // 导出是副本，不做备份轮转
      const res = await saveDataFile(target, data, 0);
      if (res.ok) {
        window.alert(`已导出到：\n${target}`);
      } else {
        setSaveError(`导出失败：${res.error}`);
      }
    } catch (e) {
      setSaveError(`导出失败：${String(e)}`);
    }
  };

  const handleImportFile = async (file: File) => {
    const text = await file.text();
    const res = parseImport(text, data);
    if (!res.ok || !res.data) {
      window.alert(`导入失败：${res.error ?? "未知错误"}`);
      return;
    }
    // 不直接写入，先让用户选"合并"还是"覆盖"
    setPendingImport({ fileName: file.name, data: res.data });
  };

  /** 合并：追加事件，冲突的 id 换新，不覆盖任何已有内容 */
  const applyMerge = () => {
    if (!pendingImport) return;
    const res = mergeData(data, pendingImport.data);
    setData(res.data);
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

  /** 覆盖：整库替换成文件内容 */
  const applyReplace = () => {
    if (!pendingImport) return;
    const next = pendingImport.data;
    setData(next);
    setActiveCats(new Set(next.categories.map((c) => c.id)));
    setActiveTags(new Set());
    setVp(fitAll(next, vp.width));
    setPendingImport(null);
  };

  // ---------- 类别 / 标签管理 ----------
  /** 保存类别；被删掉的类别下的事件自动归到第一个剩下的类别，不丢事件 */
  const saveCategories = useCallback((next: Category[]) => {
    setData((d) => {
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
  }, []);

  /** 保存标签；被删标签从事件上摘掉 */
  const saveTags = useCallback((next: Tag[], removedIds: string[]) => {
    const gone = new Set(removedIds);
    setData((d) => ({
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
  }, []);

  const pxPerDayLabel =
    vp.pxPerDay > 1 ? `${vp.pxPerDay.toFixed(1)} px/天` : `1 天 = ${(1 / vp.pxPerDay).toFixed(0)} px⁻¹`;

  const topLevelCount = useMemo(() => data.events.filter((e) => !e.parentId).length, [data.events]);
  const visibleTopLevel = useMemo(() => filtered.filter((e) => !e.parentId).length, [filtered]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">历史事件线</div>

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
    </div>
  );
}
