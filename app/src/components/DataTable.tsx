import { useMemo, useState } from "react";
import type { Category, Tag, TimelineEvent } from "../data/schema";
import { eventDateLabelOrDash } from "../lib/display";

interface Props {
  events: TimelineEvent[];
  categories: Category[];
  tags: Tag[];
  onEdit: (ev: TimelineEvent) => void;
  onDelete: (id: string) => void;
  onSelect: (ev: TimelineEvent) => void;
}

type SortKey = "time" | "title" | "category" | "importance";

const IMPORTANCE_LABEL: Record<number, string> = { 1: "高", 2: "中", 3: "低" };

/**
 * 表格视图：把整库当成一张表看，补上时间轴看不到的"全局感"。
 * 支持搜索、排序、按父子缩进、就地编辑/删除。
 */
export default function DataTable({
  events,
  categories,
  tags,
  onEdit,
  onDelete,
  onSelect,
}: Props) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [asc, setAsc] = useState(true);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const tagMap = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  // 先按时间排好，父子关系才有意义
  const byTime = useMemo(
    () => [...events].sort((a, b) => a.startJdn - b.startJdn),
    [events]
  );

  /** 把事件整理成"父在前、子紧随"的扁平顺序，并标注层级 */
  const rowsWithDepth = useMemo(() => {
    const children = new Map<string, TimelineEvent[]>();
    for (const e of byTime) {
      if (!e.parentId) continue;
      const arr = children.get(e.parentId) ?? [];
      arr.push(e);
      children.set(e.parentId, arr);
    }
    const out: { ev: TimelineEvent; depth: number }[] = [];
    const walk = (list: TimelineEvent[], depth: number) => {
      for (const e of list) {
        out.push({ ev: e, depth });
        const kids = children.get(e.id);
        if (kids) walk(kids, depth + 1);
      }
    };
    walk(byTime.filter((e) => !e.parentId), 0);
    return out;
  }, [byTime]);

  /** 搜索过滤（保留父子顺序：父被过滤掉时子仍然显示，但标记出来） */
  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return rowsWithDepth;
    return rowsWithDepth.filter(({ ev }) => {
      const hay = [
        ev.title,
        ev.summary,
        ev.dateText,
        catMap.get(ev.categoryId)?.name ?? "",
        ...ev.tagIds.map((t) => tagMap.get(t)?.name ?? ""),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(kw);
    });
  }, [rowsWithDepth, q, catMap, tagMap]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let d = 0;
      if (sortKey === "time") d = a.ev.startJdn - b.ev.startJdn;
      else if (sortKey === "title") d = a.ev.title.localeCompare(b.ev.title, "zh");
      else if (sortKey === "category")
        d = (catMap.get(a.ev.categoryId)?.name ?? "").localeCompare(
          catMap.get(b.ev.categoryId)?.name ?? "",
          "zh"
        );
      else d = a.ev.importance - b.ev.importance;
      return asc ? d : -d;
    });
    return arr;
  }, [filtered, sortKey, asc, catMap]);

  const head = (key: SortKey, label: string, cls = "") => (
    <th
      className={cls + (sortKey === key ? " sorted" : "")}
      onClick={() => {
        if (sortKey === key) setAsc((v) => !v);
        else {
          setSortKey(key);
          setAsc(true);
        }
      }}
      title="点击排序"
    >
      {label}
      {sortKey === key && <i>{asc ? "▲" : "▼"}</i>}
    </th>
  );

  return (
    <div className="table-wrap">
      <div className="table-toolbar">
        <input
          className="table-search"
          value={q}
          placeholder="搜索标题 / 摘要 / 类别 / 标签…"
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="table-count">
          {sorted.length === events.length
            ? `共 ${events.length} 条`
            : `筛出 ${sorted.length} / ${events.length} 条`}
        </span>
        {q && (
          <button className="table-clear" onClick={() => setQ("")}>
            清除搜索
          </button>
        )}
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {head("time", "时间", "col-time")}
              {head("title", "标题", "col-title")}
              {head("category", "类别", "col-cat")}
              <th className="col-tags">标签</th>
              {head("importance", "重要度", "col-imp")}
              <th className="col-act">操作</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ ev, depth }) => {
              const cat = catMap.get(ev.categoryId);
              return (
                <tr key={ev.id} onDoubleClick={() => onSelect(ev)} title="双击在时间轴中定位">
                  <td className="col-time">{eventDateLabelOrDash(ev)}</td>
                  <td className="col-title">
                    <span className="title-indent" style={{ paddingLeft: depth * 16 }} />
                    {depth > 0 && <span className="tree-mark">└</span>}
                    <button type="button" className="title-btn" onClick={() => onEdit(ev)}>
                      {ev.title}
                    </button>
                    {ev.endJdn && <span className="span-flag">区间</span>}
                  </td>
                  <td className="col-cat">
                    <span className="cat-chip" style={{ background: cat?.color ?? "#999" }}>
                      {cat?.name ?? ev.categoryId}
                    </span>
                  </td>
                  <td className="col-tags">
                    {ev.tagIds.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      ev.tagIds.map((id) => (
                        <span key={id} className="tag-chip">
                          #{tagMap.get(id)?.name ?? id}
                        </span>
                      ))
                    )}
                  </td>
                  <td className={"col-imp imp-" + ev.importance}>{IMPORTANCE_LABEL[ev.importance]}</td>
                  <td className="col-act">
                    <button type="button" className="row-act" onClick={() => onEdit(ev)} title="编辑">
                      ✎
                    </button>
                    <button
                      type="button"
                      className="row-act danger"
                      title="删除"
                      onClick={() => {
                        if (window.confirm(`删除「${ev.title}」？`)) onDelete(ev.id);
                      }}
                    >
                      🗑
                    </button>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="table-empty">
                  {events.length === 0 ? "还没有任何事件，点右上角「＋ 新增事件」开始" : "没有匹配的事件"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
