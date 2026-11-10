import { useMemo, useState } from "react";
import type { Library, TimelineDoc } from "../lib/library";
import { normalizeName } from "../lib/library";
import { buildBins } from "../lib/minimap";
import { statsOf } from "../lib/library";
import { fromJdn, toHistoricalYear } from "../lib/time";

interface Props {
  library: Library;
  onOpen: (id: string) => void;
  onCreate: (name: string, vocabFromId?: string | null) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  /** 导出整库 */
  onExportAll: () => void;
  /** 导出选中的若干条时间线（装在一个文件里） */
  onExportSelected: (ids: string[]) => void;
  onImport: () => void;
  /** 当前数据文件路径，显示用 */
  dataPath: string;
}

const SPARK_BINS = 60;

/** 一条小小的密度条，复用迷你地图的分箱逻辑 */
function Spark({ doc }: { doc: TimelineDoc }) {
  const stats = useMemo(() => statsOf(doc), [doc]);
  const bins = useMemo(() => {
    if (!stats) return [];
    return buildBins(doc.events, stats.minJdn, stats.maxJdn, SPARK_BINS);
  }, [doc, stats]);

  if (!stats) {
    return <div className="tl-spark tl-spark-empty">还没有事件</div>;
  }
  const maxCount = Math.max(1, ...bins.map((b) => b.count));
  return (
    <div className="tl-spark">
      {bins.map((bin, i) => {
        if (bin.count === 0) return null;
        const h = 20 + 80 * Math.min(1, bin.count / maxCount);
        return (
          <span
            key={i}
            className="tl-spark-bar"
            style={{ left: `${(i / SPARK_BINS) * 100}%`, width: `${100 / SPARK_BINS}%`, height: `${h}%` }}
          />
        );
      })}
    </div>
  );
}

function yearsLabel(doc: TimelineDoc): string {
  const stats = statsOf(doc);
  if (!stats) return "—";
  const a = toHistoricalYear(fromJdn(stats.minJdn).year);
  const b = toHistoricalYear(fromJdn(stats.maxJdn).year);
  const fmt = (h: { era: string; value: number }) => (h.era === "bc" ? `前${h.value}` : `${h.value}`);
  return `${fmt(a)} – ${fmt(b)}`;
}

export default function HomeScreen({
  library,
  onOpen,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
  onExportAll,
  onExportSelected,
  onImport,
  dataPath,
}: Props) {
  const [newName, setNewName] = useState("");
  const [copyVocab, setCopyVocab] = useState(false);
  const [vocabSource, setVocabSource] = useState<string>("");
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const togglePick = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const startRename = (doc: TimelineDoc) => {
    setEditingId(doc.id);
    setDraftName(doc.name);
  };

  const commitRename = () => {
    if (!editingId) return;
    const clean = normalizeName(draftName);
    if (clean) onRename(editingId, clean);
    setEditingId(null);
  };

  const create = () => {
    const clean = normalizeName(newName);
    if (!clean) return;
    onCreate(clean, copyVocab ? vocabSource || library.timelines[0]?.id : null);
    setNewName("");
  };

  return (
    <div className="home">
      <div className="home-head">
        <div>
          <h1 className="home-title">历史事件线</h1>
          <div className="home-sub">
            {library.timelines.length} 条时间线 · {dataPath ? dataPath : "浏览器模式"}
          </div>
        </div>
        <div className="home-actions">
          <button className="hm-btn" onClick={onImport} title="从 JSON 文件导入时间线">
            导入
          </button>
          <button className="hm-btn" onClick={onExportAll} title="把全部时间线导出成一个文件">
            导出全部
          </button>
          <button
            className={"hm-btn" + (selecting ? " on" : "")}
            onClick={() => {
              setSelecting(!selecting);
              setPicked(new Set());
            }}
            title="勾选若干条时间线后一起导出"
          >
            {selecting ? "取消选择" : "选择导出"}
          </button>
          {selecting && (
            <button
              className="hm-btn primary"
              disabled={picked.size === 0}
              onClick={() => onExportSelected([...picked])}
            >
              导出所选（{picked.size}）
            </button>
          )}
        </div>
      </div>

      <div className="home-grid">
        {library.timelines.map((doc) => (
          <div
            key={doc.id}
            className={"tl-card" + (picked.has(doc.id) ? " picked" : "")}
            onClick={() => {
              if (selecting) togglePick(doc.id);
              else if (editingId !== doc.id) onOpen(doc.id);
            }}
          >
            <div className="tl-card-top">
              {editingId === doc.id ? (
                <input
                  className="tl-rename"
                  value={draftName}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <span className="tl-name">{doc.name}</span>
              )}
              {selecting && <span className="tl-check">{picked.has(doc.id) ? "✓" : ""}</span>}
            </div>

            <Spark doc={doc} />

            <div className="tl-meta">
              <span>{doc.events.length} 个事件</span>
              <span>{yearsLabel(doc)}</span>
            </div>

            {!selecting && (
              <div className="tl-ops" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => startRename(doc)} title="重命名">
                  改名
                </button>
                <button onClick={() => onDuplicate(doc.id)} title="复制一份（含全部事件）">
                  复制
                </button>
                <button
                  className="danger"
                  onClick={() => onDelete(doc.id)}
                  disabled={library.timelines.length <= 1}
                  title={library.timelines.length <= 1 ? "至少要保留一条时间线" : "删除这条时间线"}
                >
                  删除
                </button>
              </div>
            )}
          </div>
        ))}

        <div className="tl-card tl-new" onClick={() => document.getElementById("new-tl-input")?.focus()}>
          <input
            id="new-tl-input"
            className="tl-new-input"
            placeholder="新时间线名称，如「欧洲」"
            value={newName}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
          />

          <label className="tl-new-opt" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={copyVocab}
              onChange={(e) => setCopyVocab(e.target.checked)}
            />
            复制类别和标签
          </label>

          {copyVocab && (
            <select
              className="tl-new-select"
              value={vocabSource || library.timelines[0]?.id || ""}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setVocabSource(e.target.value)}
            >
              {library.timelines.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}

          <button
            className="hm-btn primary"
            onClick={(e) => {
              e.stopPropagation();
              create();
            }}
            disabled={!normalizeName(newName)}
          >
            新建
          </button>
          <div className="tl-new-hint">
            {copyVocab ? "事件不会复制，只带类别和标签" : "新建的线是空的，类别用默认的五个"}
          </div>
        </div>
      </div>
    </div>
  );
}
