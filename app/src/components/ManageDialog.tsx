import { useEffect, useState } from "react";
import type { Category, Tag, TimelineEvent } from "../data/schema";

interface Props {
  open: boolean;
  categories: Category[];
  tags: Tag[];
  events: TimelineEvent[];
  onSaveCategories: (next: Category[]) => void;
  onSaveTags: (next: Tag[], removedIds: string[]) => void;
  onClose: () => void;
}

/** 类别/标签的调色板：一眼能区分，且在深色底上够亮 */
export const PALETTE = [
  "#e05c5c",
  "#e88c4a",
  "#d8a657",
  "#4f9d69",
  "#3fa9a0",
  "#4a7fd4",
  "#6a6ad4",
  "#b06ab3",
  "#c7638f",
  "#8a6d3b",
  "#7a8291",
  "#5b8c5a",
];

const makeId = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export default function ManageDialog({
  open,
  categories,
  tags,
  events,
  onSaveCategories,
  onSaveTags,
  onClose,
}: Props) {
  const [cats, setCats] = useState<Category[]>(categories);
  const [tgs, setTgs] = useState<Tag[]>(tags);
  const [newCat, setNewCat] = useState("");
  const [newCatColor, setNewCatColor] = useState(PALETTE[0]);
  const [newTag, setNewTag] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCats(categories);
    setTgs(tags);
    setNewCat("");
    setNewTag("");
    setErr(null);
  }, [open, categories, tags]);

  if (!open) return null;

  const countIn = (catId: string) => events.filter((e) => e.categoryId === catId).length;
  const tagCountIn = (tagId: string) => events.filter((e) => e.tagIds.includes(tagId)).length;

  const addCategory = () => {
    const name = newCat.trim();
    if (!name) return;
    if (cats.some((c) => c.name === name)) {
      setErr(`类别「${name}」已存在`);
      return;
    }
    setErr(null);
    setCats([...cats, { id: makeId("cat"), name, color: newCatColor }]);
    setNewCat("");
    // 自动切换到下一个颜色，省得每次都点
    const idx = (PALETTE.indexOf(newCatColor) + 1) % PALETTE.length;
    setNewCatColor(PALETTE[idx]);
  };

  const removeCategory = (c: Category) => {
    if (cats.length <= 1) {
      setErr("至少保留一个类别");
      return;
    }
    const n = countIn(c.id);
    if (n > 0) {
      const target = cats.find((x) => x.id !== c.id)!;
      if (!window.confirm(`「${c.name}」下有 ${n} 个事件，删除后它们会归到「${target.name}」。继续？`)) {
        return;
      }
    }
    setErr(null);
    setCats(cats.filter((x) => x.id !== c.id));
  };

  const addTag = () => {
    const name = newTag.trim();
    if (!name) return;
    if (tgs.some((t) => t.name === name)) {
      setErr(`标签「${name}」已存在`);
      return;
    }
    setErr(null);
    setTgs([...tgs, { id: makeId("t"), name }]);
    setNewTag("");
  };

  const removeTag = (t: Tag) => {
    const n = tagCountIn(t.id);
    if (n > 0 && !window.confirm(`标签「#${t.name}」被 ${n} 个事件使用，删除后这些标记会消失。继续？`)) {
      return;
    }
    setErr(null);
    setTgs(tgs.filter((x) => x.id !== t.id));
  };

  const apply = () => {
    if (cats.length === 0) {
      setErr("至少保留一个类别");
      return;
    }
    const removedTagIds = tags.filter((t) => !tgs.some((x) => x.id === t.id)).map((t) => t.id);
    onSaveCategories(cats);
    onSaveTags(tgs, removedTagIds);
    onClose();
  };

  return (
    <div className="dialog-mask" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dlg-head">
          <span>管理类别与标签</span>
          <button className="dlg-x" onClick={onClose} title="取消 (Esc)">
            ×
          </button>
        </div>

        <div className="dlg-body">
          <div className="dlg-field">
            <span className="dlg-label">类别（每个事件只能属于一个）</span>
            <div className="mg-list">
              {cats.map((c) => (
                <div className="mg-row" key={c.id}>
                  <span className="mg-dot" style={{ background: c.color }} />
                  <input
                    className="mg-name"
                    value={c.name}
                    onChange={(e) =>
                      setCats(cats.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)))
                    }
                  />
                  <span className="mg-count">{countIn(c.id)} 条</span>
                  <div className="mg-swatches">
                    {PALETTE.slice(0, 6).map((col) => (
                      <button
                        key={col}
                        type="button"
                        className={"mg-sw" + (c.color === col ? " on" : "")}
                        style={{ background: col }}
                        onClick={() =>
                          setCats(cats.map((x) => (x.id === c.id ? { ...x, color: col } : x)))
                        }
                      />
                    ))}
                  </div>
                  <button className="mg-del" onClick={() => removeCategory(c)} title="删除类别">
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="mg-add">
              <input
                className="dlg-input"
                value={newCat}
                placeholder="新类别名称，如「地理」"
                onChange={(e) => setNewCat(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addCategory();
                }}
              />
              <div className="mg-swatches">
                {PALETTE.slice(0, 6).map((col) => (
                  <button
                    key={col}
                    type="button"
                    className={"mg-sw" + (newCatColor === col ? " on" : "")}
                    style={{ background: col }}
                    onClick={() => setNewCatColor(col)}
                  />
                ))}
              </div>
              <button className="dlg-btn" onClick={addCategory}>
                添加
              </button>
            </div>
          </div>

          <div className="dlg-field">
            <span className="dlg-label">标签（一个事件可以有多个）</span>
            <div className="mg-tags">
              {tgs.map((t) => (
                <span className="mg-tag" key={t.id}>
                  #{t.name}
                  <button className="mg-tag-x" onClick={() => removeTag(t)} title="删除标签">
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="mg-add">
              <input
                className="dlg-input"
                value={newTag}
                placeholder="新标签名称，如「晚清」"
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addTag();
                }}
              />
              <button className="dlg-btn" onClick={addTag}>
                添加
              </button>
            </div>
          </div>

          {err && <div className="dlg-err">{err}</div>}
        </div>

        <div className="dlg-foot">
          <button className="dlg-btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="dlg-btn primary" onClick={apply}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
