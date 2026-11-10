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
  /** 手写的显示文本；空表示按日期自动生成 */
  dateText: string;
  /** 用户改过显示文本，之后不再自动生成 */
  dateTextCustom: boolean;
  /** 卡片上不显示时间 */
  hideDate: boolean;
  /** 卡片时间显示粒度 */
  dateDisplay: "full" | "year" | "none";
  /** 标出不确定范围 */
  hasFuzz: boolean;
  /** 不确定范围 ±N 年 */
  fuzzYears: string;
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
  startM: "",
  startD: "",
  hasEnd: false,
  endEra: "ad",
  endY: "",
  endM: "",
  endD: "",
  dateText: "",
  dateTextCustom: false,
  hideDate: false,
  dateDisplay: "full",
  hasFuzz: false,
  fuzzYears: "10",
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
    // 1 月 1 日视为"没特别指定"，留空，避免卡片莫名显示"1月"
    startM: s.month > 1 ? String(s.month) : "",
    startD: s.day > 1 ? String(s.day) : "",
    hasEnd: !!ev.endJdn,
    endEra: eHist?.era ?? "ad",
    endY: eHist ? String(eHist.value) : "",
    endM: e && e.month > 1 ? String(e.month) : "",
    endD: e && e.day > 1 ? String(e.day) : "",
    parentId: ev.parentId,
    dateText: ev.dateText ?? "",
    dateTextCustom: ev.dateTextCustom ?? false,
    hideDate: ev.hideDate ?? false,
    dateDisplay: ev.dateDisplay ?? (ev.hideDate ? "none" : "full"),
    hasFuzz: !!ev.fuzz,
    fuzzYears: ev.fuzz ? String(Math.max(1, Math.round((ev.fuzz.before + ev.fuzz.after) / 2 / 365.25))) : "10",
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
    // 只有真的填了才显示月/日；留空就是"只到年"
    const withMD = `${startTxt}${sm ? `${sm}月` : ""}${sd ? `${sd}日` : ""}`;
    if (!d.hasEnd) return withMD;
    const ey = num(d.endY);
    if (ey === null)
      return `${withMD} → ？（结束年份还没填）`;
    return `${withMD} → ${formatHistoricalYear(d.endEra, ey)}`;
  }, [d]);

  /** 卡片上实际会显示的文本：手写过就用手写的，否则用自动生成的 */
  const shownText = d.dateText.trim() || preview;
  /**
   * 只有用户真的动手改过，才提示"轴线位置"那一行。
   * 老数据里的 dateText（如"约公元前1046年"）虽然不等于自动生成的结果，
   * 但没有 dateTextCustom 标记，不该被当成"手写"，否则每次打开都很吵。
   */
  const usingCustomText = d.dateTextCustom && !!d.dateText.trim();
  const fuzzYearsNum = num(d.fuzzYears);
  const fuzzNote =
    d.hasFuzz && fuzzYearsNum !== null && fuzzYearsNum > 0 ? `±${fuzzYearsNum} 年` : "";

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

    // 自动文本：只把用户真的填了的月/日写进去，留空就只到年
    const smFilled = num(d.startM);
    const sdFilled = num(d.startD);
    const startText =
      `${formatHistoricalYear(d.startEra, sy)}` +
      (smFilled ? `${smFilled}月` : "") +
      (sdFilled ? `${sdFilled}日` : "");
    const autoText =
      endJdn !== undefined
        ? `${startText} – ${formatHistoricalYear(d.endEra, num(d.endY)!)}`
        : startText;

    // 手写过就用手写的；留空则回到自动生成的文本
    const custom = d.dateText.trim();
    const dateText = custom ? custom : autoText;

    // 不确定范围：填了就画模糊带，不填就完全没有
    let fuzz: { before: number; after: number } | undefined;
    if (d.hasFuzz) {
      const yr = num(d.fuzzYears);
      if (yr !== null && yr > 0) {
        const days = Math.round(yr * 365.25);
        fuzz = { before: days, after: days };
      }
    }

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
      ...(d.dateTextCustom ? { dateTextCustom: true } : {}),
      ...(d.dateDisplay !== "full" ? { dateDisplay: d.dateDisplay } : {}),
      ...(fuzz ? { fuzz } : {}),
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
              <span className="dlg-unit">年</span>
              <input
                className="dlg-input tiny"
                value={d.startM}
                placeholder="—"
                onChange={(e) => patch({ startM: e.target.value })}
              />
              <span className="dlg-unit">月</span>
              <input
                className="dlg-input tiny"
                value={d.startD}
                placeholder="—"
                onChange={(e) => patch({ startD: e.target.value })}
              />
              <span className="dlg-unit">日</span>
            </div>
            <span className="set-hint">月、日可以留空，只填年份也行</span>
          </div>

          {/* 显示文本：位置定在哪是一回事，卡片上写什么是另一回事 */}
          <label className="dlg-field">
            <span className="dlg-label">卡片上显示的文本</span>
            <input
              className="dlg-input"
              value={d.dateText}
              placeholder={preview ? `留空则显示：${preview}` : "留空则按上面的日期自动生成"}
              onChange={(e) => patch({ dateText: e.target.value, dateTextCustom: true })}
            />
            <span className="set-hint">
              可以随便写，比如「约公元前1600年」「商朝建立初期」「年代不详」。留空就按日期自动生成。
            </span>
          </label>

          <div className="dlg-field">
            <span className="dlg-label">卡片上显示多少时间</span>
            <div className="dlg-chips">
              {(
                [
                  ["full", "完整文本"],
                  ["year", "只显示年份"],
                  ["none", "不显示"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={"chip" + (d.dateDisplay === mode ? " on" : "")}
                  onClick={() => patch({ dateDisplay: mode })}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="set-hint">
              {d.dateDisplay === "year"
                ? "卡片上只写年份，比如「公元前88年」，适合只知道年的古代事件。"
                : d.dateDisplay === "none"
                  ? "卡片上不写时间。锚点仍然在轴上占位，排序和聚簇照常。"
                  : "按「卡片上显示的文本」原样显示。"}
            </span>
          </div>

          <div className="dlg-field">
            <label className="dlg-check">
              <input
                type="checkbox"
                checked={d.hasFuzz}
                onChange={(e) => patch({ hasFuzz: e.target.checked })}
              />
              轴线上标出不确定范围
            </label>
            {d.hasFuzz && (
              <div className="dlg-date">
                <span className="set-hint">±</span>
                <input
                  className="dlg-input tiny"
                  value={d.fuzzYears}
                  placeholder="年"
                  onChange={(e) => patch({ fuzzYears: e.target.value })}
                />
                <span className="set-hint">年（不知道多少就不勾，不要硬填）</span>
              </div>
            )}
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

          {(shownText || d.hideDate) && (
            <div className="dlg-preview">
              {d.hideDate ? (
                <div className="pv-main">卡片上不显示时间</div>
              ) : (
                <div className="pv-main">将显示为：{shownText}</div>
              )}
              {usingCustomText && preview && (
                <div className="pv-sub">轴线位置：{preview}</div>
              )}
              {fuzzNote && <div className="pv-sub">不确定范围：{fuzzNote}</div>}
            </div>
          )}

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
