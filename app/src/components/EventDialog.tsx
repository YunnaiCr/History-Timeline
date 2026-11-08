import { useEffect, useMemo, useState } from "react";
import type { Category, Tag, TimelineEvent } from "../data/schema";
import {
  fromJdn,
  fromHistoricalYear,
  toHistoricalYear,
  toJdn,
  formatHistoricalYear,
} from "../lib/time";
import { makeId } from "../lib/store";

type Era = "bc" | "ad";

export interface EventDraft {
  id?: string;
  title: string;
  categoryId: string;
  tagIds: string[];
  summary: string;
  importance: 1 | 2 | 3;
  startEra: Era;
  startY: string;
  startM: string;
  startD: string;
  hasEnd: boolean;
  endEra: Era;
  endY: string;
  endM: string;
  endD: string;
  parentId?: string;
}

interface Props {
  open: boolean;
  initial: TimelineEvent | null;
  categories: Category[];
  tags: Tag[];
  /** 所有可作为父事件的事件（只取区间事件） */
  allEvents: TimelineEvent[];
  parentId?: string;
  onSave: (ev: TimelineEvent, newTag?: Tag) => void;
  onClose: () => void;
}

const emptyDraft = (categoryId: string, parentId?: string): EventDraft => ({
  title: "",
  categoryId,
  tagIds: [],
  summary: "",
  importance: 2,
  startEra: "ad",
  startY: "1911",
  startM: "1",
  startD: "1",
  hasEnd: false,
  endEra: "ad",
  endY: "",
  endM: "",
  endD: "",
  parentId,
});

/** 从已有事件反推表单值（JDN → 历史纪年 年/月/日） */
function toDraft(ev: TimelineEvent): EventDraft {
  const s = fromJdn(ev.startJdn);
  const sHist = toHistoricalYear(s.year);
  const e = ev.endJdn ? fromJdn(ev.endJdn) : null;
  const eHist = e ? toHistoricalYear(e.year) : null;
  return {
    id: ev.id,
    title: ev.title,
    categoryId: ev.categoryId,
    tagIds: [...ev.tagIds],
    summary: ev.summary,
    importance: ev.importance,
    startEra: sHist.era,
    startY: String(sHist.value),
    startM: String(s.month),
    startD: String(s.day),
    hasEnd: !!ev.endJdn,
    endEra: eHist?.era ?? "ad",
    endY: eHist ? String(eHist.value) : "",
    endM: e ? String(e.month) : "",
    endD: e ? String(e.day) : "",
    parentId: ev.parentId,
  };
}

const num = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const clampMonth = (m: number) => Math.min(12, Math.max(1, m));
const clampDay = (d: number) => Math.min(31, Math.max(1, d));

export default function EventDialog({
  open,
  initial,
  categories,
  tags,
  allEvents,
  parentId,
  onSave,
  onClose,
}: Props) {
  const [d, setD] = useState<EventDraft>(() =>
    initial ? toDraft(initial) : emptyDraft(categories[0]?.id ?? "politics", parentId)
  );
  const [newTagName, setNewTagName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setNewTagName("");
    setD(initial ? toDraft(initial) : emptyDraft(categories[0]?.id ?? "politics", parentId));
  }, [open, initial, parentId, categories]);

  const title = initial ? "编辑事件" : parentId ? "新增子事件" : "新增事件";
  const patch = (p: Partial<EventDraft>) => setD((prev) => ({ ...prev, ...p }));

  /** 可选的父事件：区间事件、且不能选自己或自己的子孙 */
  const parentOptions = useMemo(() => {
    const banned = new Set<string>();
    if (d.id) {
      banned.add(d.id);
      // 禁止把父事件设成自己的后代（避免环）
      let changed = true;
      while (changed) {
        changed = false;
        for (const e of allEvents) {
          if (e.parentId && banned.has(e.parentId) && !banned.has(e.id)) {
            banned.add(e.id);
            changed = true;
          }
        }
      }
    }
    return allEvents
      .filter((e) => e.endJdn && !banned.has(e.id))
      .sort((a, b) => a.startJdn - b.startJdn);
  }, [allEvents, d.id]);

  /** 输入框旁边的实时预览，避免用户对公元前后的换算没把握 */
  const preview = useMemo(() => {
    const sy = num(d.startY);
    if (sy === null || sy < 1) return "";
    const startTxt = formatHistoricalYear(d.startEra, sy);
    const sm = num(d.startM);
    const sd = num(d.startD);
    const withMD =
      sm || sd ? `${startTxt.replace("年", "")}年${sm ?? 1}月${sd && sd > 1 ? `${sd}日` : ""}` : startTxt;
    if (!d.hasEnd) return withMD;
    const ey = num(d.endY);
    if (ey === null)
      return `${withMD} → ？（结束年份还没填）`;
    return `${withMD} → ${formatHistoricalYear(d.endEra, ey)}`;
  }, [d]);

  const submit = () => {
    if (!d.title.trim()) {
      setErr("标题不能为空");
      return;
    }
    const sy = num(d.startY);
    if (sy === null || sy < 1) {
      setErr("开始年份必须是正整数（公元前请选「公元前」后再填年份，不要填负号）");
      return;
    }
    const startYear = fromHistoricalYear(d.startEra, sy);
    const startJdn = toJdn(startYear, clampMonth(num(d.startM) ?? 1), clampDay(num(d.startD) ?? 1));

    let endJdn: number | undefined;
    if (d.hasEnd) {
      const ey = num(d.endY);
      if (ey === null || ey < 1) {
        setErr("结束年份要么不勾选，要么填正整数");
        return;
      }
      const endYear = fromHistoricalYear(d.endEra, ey);
      endJdn = toJdn(endYear, clampMonth(num(d.endM) ?? 12), clampDay(num(d.endD) ?? 31));
      if (endJdn < startJdn) {
        setErr("结束时间不能早于开始时间");
        return;
      }
    }

    const dateText = endJdn !== undefined
      ? `${formatHistoricalYear(d.startEra, sy)} – ${formatHistoricalYear(d.endEra, num(d.endY)!)}`
      : (num(d.startM) ?? 1) === 1 && (num(d.startD) ?? 1) === 1
        ? formatHistoricalYear(d.startEra, sy)
        : `${formatHistoricalYear(d.startEra, sy)}${num(d.startM) ?? 1}月${
            (num(d.startD) ?? 1) > 1 ? `${num(d.startD)}日` : ""
          }`;

    // 顺手创建新标签
    let createdTag: Tag | undefined;
    const tagIds = [...d.tagIds];
    const nt = newTagName.trim();
    if (nt) {
      const exist = tags.find((t) => t.name === nt);
      if (exist) {
        if (!tagIds.includes(exist.id)) tagIds.push(exist.id);
      } else {
        createdTag = { id: `t-${Date.now().toString(36)}`, name: nt };
        tagIds.push(createdTag.id);
      }
    }

    const ev: TimelineEvent = {
      id: d.id ?? makeId(),
      title: d.title.trim(),
      startJdn,
      endJdn,
      dateText,
      categoryId: d.categoryId,
      tagIds,
      summary: d.summary.trim(),
      importance: d.importance,
      parentId: d.parentId,
    };
    onSave(ev, createdTag);
  };

  if (!open) return null;

  const eraSelect = (value: Era, onChange: (v: Era) => void) => (
    <select
      className="dlg-select"
      value={value}
      onChange={(e) => onChange(e.target.value as Era)}
    >
      <option value="ad">公元</option>
      <option value="bc">公元前</option>
    </select>
  );

  return (
    <div className="dialog-mask" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dlg-head">
          <span>{title}</span>
          <button className="dlg-x" onClick={onClose} title="取消 (Esc)">
            ×
          </button>
        </div>

        <div className="dlg-body">
          <label className="dlg-field">
            <span className="dlg-label">标题 *</span>
            <input
              className="dlg-input"
              value={d.title}
              autoFocus
              placeholder="例如：辛亥革命"
              onChange={(e) => patch({ title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </label>

          {/* 父事件：选了就变成子事件，展开父事件时会出现在轴线上方 */}
          <div className="dlg-field">
            <span className="dlg-label">父事件（可选，选了就是子事件）</span>
            <select
              className="dlg-select wide"
              value={d.parentId ?? ""}
              onChange={(e) => patch({ parentId: e.target.value || undefined })}
            >
              <option value="">— 无（顶层事件）—</option>
              {parentOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}（{p.dateText}）
                </option>
              ))}
            </select>
          </div>

          <div className="dlg-field">
            <span className="dlg-label">开始时间 *</span>
            <div className="dlg-date">
              {eraSelect(d.startEra, (v) => patch({ startEra: v }))}
              <input
                className="dlg-input"
                value={d.startY}
                placeholder="年份，如 1911 或 221"
                onChange={(e) => patch({ startY: e.target.value })}
              />
              <input
                className="dlg-input tiny"
                value={d.startM}
                placeholder="月"
                onChange={(e) => patch({ startM: e.target.value })}
              />
              <input
                className="dlg-input tiny"
                value={d.startD}
                placeholder="日"
                onChange={(e) => patch({ startD: e.target.value })}
              />
            </div>
          </div>

          <div className="dlg-field">
            <label className="dlg-check">
              <input
                type="checkbox"
                checked={d.hasEnd}
                onChange={(e) => patch({ hasEnd: e.target.checked })}
              />
              这是一个持续一段时间的事件（填结束时间）
            </label>
            {d.hasEnd && (
              <div className="dlg-date">
                {eraSelect(d.endEra, (v) => patch({ endEra: v }))}
                <input
                  className="dlg-input"
                  value={d.endY}
                  placeholder="结束年"
                  onChange={(e) => patch({ endY: e.target.value })}
                />
                <input
                  className="dlg-input tiny"
                  value={d.endM}
                  placeholder="月"
                  onChange={(e) => patch({ endM: e.target.value })}
                />
                <input
                  className="dlg-input tiny"
                  value={d.endD}
                  placeholder="日"
                  onChange={(e) => patch({ endD: e.target.value })}
                />
              </div>
            )}
          </div>

          {preview && <div className="dlg-preview">将记录为：{preview}</div>}

          {/* 用 div 而不是 label：<label> 会把点击转发给内部第一个可标注元素，button 也算 */}
          <div className="dlg-field">
            <span className="dlg-label">类别（单选）</span>
            <div className="dlg-chips">
              {categories.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  className={"chip" + (d.categoryId === c.id ? " on" : "")}
                  style={{ "--chip-color": c.color } as React.CSSProperties}
                  onClick={() => patch({ categoryId: c.id })}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="dlg-field">
            <span className="dlg-label">标签（可多选）</span>
            <div className="dlg-chips">
              {tags.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  className={"chip tag" + (d.tagIds.includes(t.id) ? " on" : "")}
                  onClick={() =>
                    patch({
                      tagIds: d.tagIds.includes(t.id)
                        ? d.tagIds.filter((x) => x !== t.id)
                        : [...d.tagIds, t.id],
                    })
                  }
                >
                  #{t.name}
                </button>
              ))}
            </div>
            <input
              className="dlg-input"
              value={newTagName}
              placeholder="新建标签（点保存时一并创建）"
              onChange={(e) => setNewTagName(e.target.value)}
            />
          </div>

          <div className="dlg-field">
            <span className="dlg-label">重要度（低缩放时先保留哪个）</span>
            <div className="dlg-chips">
              {([1, 2, 3] as const).map((lv) => (
                <button
                  type="button"
                  key={lv}
                  className={"chip" + (d.importance === lv ? " on" : "")}
                  onClick={() => patch({ importance: lv })}
                >
                  {lv === 1 ? "高" : lv === 2 ? "中" : "低"}
                </button>
              ))}
            </div>
          </div>

          <label className="dlg-field">
            <span className="dlg-label">摘要</span>
            <textarea
              className="dlg-textarea"
              rows={3}
              value={d.summary}
              placeholder="一句话说明这个事件"
              onChange={(e) => patch({ summary: e.target.value })}
            />
          </label>

          {err && <div className="dlg-err">{err}</div>}
        </div>

        <div className="dlg-foot">
          <button className="dlg-btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="dlg-btn primary" onClick={submit}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
