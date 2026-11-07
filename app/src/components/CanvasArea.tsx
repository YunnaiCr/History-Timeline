import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Viewport } from "../lib/viewport";
import { jdnToX } from "../lib/viewport";
import type { Category, Tag, TimelineEvent } from "../data/sampleData";
import {
  buildNodes,
  groupChildren,
  importanceThresholdFor,
  isCluster,
  isEvent,
  layoutClusterRow,
  type ClusterNode,
} from "../lib/cluster";

interface Props {
  vp: Viewport;
  events: TimelineEvent[];
  /** 数据总量（未经过筛选），用来区分"库是空的"和"被筛选滤空了" */
  totalEvents: number;
  categories: Category[];
  tags: Tag[];
  height?: number;
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  /** 点自动收纳簇时，把视口放大到这一段时间 */
  onFocusRange: (fromJdn: number, toJdn: number) => void;
  /** M4：编辑 / 删除 / 新增子事件 */
  onEditEvent?: (ev: TimelineEvent) => void;
  onDeleteEvent?: (id: string) => void;
  onAddChild?: (parentId: string) => void;
}

const GUTTER = 16;
const LINE_Y = 190; // 主轴线：上方留给子事件带，下方留给卡片轨道
const CARD_TOP = LINE_Y + 14;
const LANE_H = 62;

/** 子事件带：轴线正上方，最多 3 层，永远不会越过轴线 */
const CHILD_ROWS = 3;
const CHILD_ROW_H = 20;
const CHILD_GAP_Y = 14;

/** 粗略估算卡片宽度（标题 14px/字 + padding），用于轨道排布避让 */
function estimateWidth(title: string): number {
  return Math.min(230, title.length * 14 + 34);
}

/** 贪心轨道分配：横向区间不重叠就复用同一轨 */
function assignLanes(items: { x: number; width: number }[], laneCount: number): number[] {
  const tails: number[] = new Array(Math.max(1, laneCount)).fill(-Infinity);
  return items.map((it) => {
    let lane = tails.findIndex((t) => t < it.x - 4);
    if (lane === -1) lane = tails.indexOf(Math.min(...tails));
    tails[lane] = it.x + it.width;
    return lane;
  });
}

interface SelectedState {
  ev: TimelineEvent;
  /** 被点元素的左上角（画布坐标） */
  x: number;
  y: number;
  /** 被点元素的实际宽度 / 高度，用来把面板放到它旁边而不是压在它身上 */
  w: number;
  h: number;
}

interface ChildChip {
  kid: TimelineEvent;
  parentId: string;
  left: number;
  width: number;
  top: number;
}

/** 悬停提示锚定在元素本身，而不是光标 —— 否则一定压在自己那张卡片上 */
type HoverRect = { left: number; top: number; right: number; bottom: number } | undefined;

/** 悬浮内容：单个事件，或一个簇里的多条事件；rect 是被悬停元素的屏幕矩形 */
type HoverState =
  | { kind: "event"; ev: TimelineEvent; rect?: HoverRect }
  | { kind: "cluster"; items: TimelineEvent[]; rect?: HoverRect };

export default function CanvasArea({
  vp,
  events,
  totalEvents,
  categories,
  tags,
  height = 520,
  expanded,
  onToggleExpand,
  onFocusRange,
  onEditEvent,
  onDeleteEvent,
  onAddChild,
}: Props) {
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const tagMap = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const eventMap = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);

  const [hover, setHover] = useState<HoverState | null>(null);
  const [selected, setSelected] = useState<SelectedState | null>(null);

  const hoverTimer = useRef<number | null>(null);
  const hoverSeenRef = useRef(false);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const areaRef = useRef<HTMLDivElement | null>(null);
  const [areaRect, setAreaRect] = useState({ left: 0, top: 0 });

  const childMap = useMemo(() => groupChildren(events), [events]);
  const topLevel = useMemo(() => events.filter((e) => !e.parentId), [events]);
  const threshold = importanceThresholdFor(vp.pxPerDay);

  // 视口裁剪：左右各留 1 屏，拖拽时不会突然出现/消失
  const visible = useMemo(() => {
    const pad = vp.width / vp.pxPerDay;
    const left = vp.startJdn - pad;
    const right = vp.startJdn + vp.width / vp.pxPerDay + pad;
    return topLevel.filter((e) => {
      const end = e.endJdn ?? e.startJdn;
      return end >= left && e.startJdn <= right;
    });
  }, [topLevel, vp.startJdn, vp.pxPerDay, vp.width]);

  const nodes = useMemo(() => buildNodes(vp, visible, threshold), [vp, visible, threshold]);

  const laneCount = Math.max(1, Math.floor((height - CARD_TOP - 16) / LANE_H));

  /**
   * 两套独立的布点：
   *  - 卡片（普通事件）排到轴线下方的轨道里，逐轨避让
   *  - 簇徽标是"轴上的标记"，全部固定贴在轴线上，只做横向防重叠
   *
   * 之前两者共用一套轨道，簇会被塞到第 2、3、4 轨，
   * 于是同一屏里有的在线上、有的在中间、有的在最下面，看着很乱。
   */
  const CLUSTER_Y = LINE_Y - 23; // 让徽标底边正好压在轴线上

  const layout = useMemo(() => {
    // ---- 卡片 ----
    const cardItems = nodes
      .filter(isEvent)
      .map((n) => ({
        node: n,
        x: GUTTER + n.x,
        width: Math.max(
          estimateWidth(n.event.title),
          n.event.endJdn ? (n.event.endJdn - n.event.startJdn) * vp.pxPerDay : 0
        ),
      }));
    const lanes = assignLanes(cardItems, laneCount);
    const placedCards = cardItems.map((it, i) => ({ ...it, lane: lanes[i] }));

    // ---- 簇：单行贴在轴线上，只做横向顺延 ----
    const clusterNodes = nodes.filter(isCluster).sort((a, b) => a.x - b.x);
    const clusterXs = layoutClusterRow(clusterNodes.map((n) => n.x), vp.width);
    const placedClusters = clusterNodes.map((n, i) => ({ node: n, x: clusterXs[i] }));

    return { placedCards, placedClusters };
  }, [nodes, vp.pxPerDay, vp.width, laneCount]);

  const { placedCards, placedClusters } = layout;

  // 展开只由用户点击决定（缩放到多大都不会自动展开，避免"点了收起又弹开"）
  const isOpen = (id: string) => expanded.has(id);

  const toggle = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setHover(null);
    onToggleExpand(id);
  };

  /**
   * 悬停提示：真的停住才弹。
   *  首次停 900ms，之后切卡片 200ms。
   *  弹窗画在光标右下 16px，且 pointer-events:none，物理上挡不住任何点击。
   */
  const cancelHover = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  const scheduleHover = (ev: TimelineEvent, el?: HTMLElement | null) => {
    cancelHover();
    const delay = hoverSeenRef.current ? 200 : 900;
    const rect = el?.getBoundingClientRect();
    hoverTimer.current = window.setTimeout(() => {
      hoverSeenRef.current = true;
      setHover({ kind: "event", ev, rect });
    }, delay);
  };

  /** 簇徽标：列出簇内的所有事件（取代原生 title，避免两个框叠在一起） */
  const scheduleClusterHover = (items: TimelineEvent[], el?: HTMLElement | null) => {
    cancelHover();
    const delay = hoverSeenRef.current ? 200 : 900;
    const rect = el?.getBoundingClientRect();
    hoverTimer.current = window.setTimeout(() => {
      hoverSeenRef.current = true;
      setHover({ kind: "cluster", items, rect });
    }, delay);
  };

  const hideHover = () => {
    cancelHover();
    setHover(null);
  };

  const select = (ev: TimelineEvent, x: number, y: number, w = 0, h = 0) => {
    hideHover();
    setSelected({ ev, x, y, w, h });
  };

  // Esc 关闭详情面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelHover();
    };
  }, []);

  const PANEL_W = 300;
  const PANEL_GAP = 14;
  /**
   * 详情面板：视口坐标（fixed）+ 挂到 body。
   *
   * 两个要点：
   *  1) 挂到 body，和画布内部的卡片/徽标不在同一个层叠体系，任何卡片的
   *     transform / z-index 都影响不到它。
   *  2) 位置要**避开被点的那个卡片本身**：之前用 x + 18，而卡片宽 100~240px，
   *     面板整个压在自己卡片上，看起来就像"沉在卡片下面"。现在按卡片的实际宽度算。
   */
  const panelPos = (() => {
    const s = selected;
    if (!s) return { left: 0, top: 0 };

    const rightStart = s.x + s.w + PANEL_GAP;
    const leftStart = s.x - PANEL_W - PANEL_GAP;
    const fitsRight = rightStart + PANEL_W <= vp.width - 4;
    const fitsLeft = leftStart >= 4;

    let left: number;
    if (fitsRight) left = rightStart;
    else if (fitsLeft) left = leftStart;
    else left = Math.max(4, Math.min(s.x, vp.width - PANEL_W - 4)); // 两侧都放不下才覆盖

    // 垂直：尽量和卡片顶部对齐，超出画布就往上夹
    const top = Math.min(Math.max(4, s.y), Math.max(4, height - 220));

    return { left: areaRect.left + left, top: areaRect.top + top };
  })();

  const selectedKids = selected ? childMap.get(selected.ev.id) ?? [] : [];
  const selectedParent = selected?.ev.parentId
    ? eventMap.get(selected.ev.parentId)
    : undefined;

  // 展开的父事件
  const openParents = placedCards.filter(({ node }) => {
    if (!isEvent(node)) return false;
    const kids = childMap.get(node.event.id);
    return !!kids && kids.length > 0 && isOpen(node.event.id);
  });

  /**
   * 子事件排布：
   *  - 位置由真实时间决定（与主刻度同一套坐标）
   *  - 能并排就并排；同一层放不下才换下一层；三层都满则顺延（不丢事件）
   *  - 垂直范围固定在轴线之上，永远不会压到卡片区
   */
  const childChips = useMemo<ChildChip[]>(() => {
    const all: { kid: TimelineEvent; parentId: string }[] = [];
    for (const { node } of openParents) {
      if (!isEvent(node)) continue;
      for (const kid of childMap.get(node.event.id) ?? []) {
        const desired = jdnToX(vp, kid.startJdn) + GUTTER;
        if (desired < -200 || desired > vp.width + 4) continue;
        all.push({ kid, parentId: node.event.id });
      }
    }
    all.sort((a, b) => a.kid.startJdn - b.kid.startJdn);

    const tails: number[] = new Array(CHILD_ROWS).fill(-Infinity);
    const out: ChildChip[] = [];

    for (const { kid, parentId } of all) {
      const width = Math.min(168, kid.title.length * 12 + 24);
      const desired = jdnToX(vp, kid.startJdn) + GUTTER;

      let row = tails.findIndex((t) => t < desired - 2);
      let left = desired;
      if (row === -1) {
        row = tails.indexOf(Math.min(...tails));
        left = Math.max(desired, tails[row] + 2);
      }
      left = Math.min(Math.max(0, left), Math.max(0, vp.width - width - 4));
      tails[row] = left + width;

      out.push({
        kid,
        parentId,
        left,
        width,
        top: LINE_Y - CHILD_GAP_Y - (row + 1) * CHILD_ROW_H,
      });
    }
    return out;
  }, [openParents, childMap, vp]);

  // 悬浮窗定位：相对画布算一次，用 fixed 渲染到 body
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAreaRect({ left: r.left, top: r.top });
  }, [vp, height, hover]);

  /**
   * 悬浮提示定位：锚定在被悬停的元素上，而不是光标。
   *
   * 用光标定位时（光标 +16/+18），因为光标就在卡片上，提示框必然压在卡片范围内，
   * 一旦层叠有任何偏差就会被自己那张卡片挡住。改成锚定元素：
   * 优先放右侧，其次左侧，再其次下方/上方，总之尽量不与元素自身重叠。
   */
  const tipStyle = (() => {
    if (!hover) return null;

    const W = hover.kind === "cluster" ? 300 : 268;
    const H = hover.kind === "cluster" ? Math.min(280, 60 + hover.items.length * 20) : 108;
    const GAP = 12;

    const r = hover.rect;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    // 没有 rect（理论上不会发生）就退回光标位置
    if (!r) {
      const p = pointerRef.current;
      if (!p) return null;
      const left = p.x + 16 + W > viewportW ? Math.max(8, p.x - 16 - W) : p.x + 16;
      const top = p.y + 18 + H > viewportH ? Math.max(8, p.y - 18 - H) : p.y + 18;
      return { left, top };
    }

    // 右侧优先
    if (r.right + GAP + W <= viewportW - 6) {
      return { left: r.right + GAP, top: clampTop(r.top, H, viewportH) };
    }
    // 左侧
    if (r.left - GAP - W >= 6) {
      return { left: r.left - GAP - W, top: clampTop(r.top, H, viewportH) };
    }
    // 下方
    if (r.bottom + GAP + H <= viewportH - 6) {
      return { left: clampLeft(r.left, W, viewportW), top: r.bottom + GAP };
    }
    // 上方
    if (r.top - GAP - H >= 6) {
      return { left: clampLeft(r.left, W, viewportW), top: r.top - GAP - H };
    }
    // 实在无处可放，压在元素上但保证在视口内
    return {
      left: clampLeft(r.left + 12, W, viewportW),
      top: clampTop(r.top + 12, H, viewportH),
    };
  })();

  function clampLeft(x: number, w: number, vw: number) {
    return Math.max(6, Math.min(x, vw - w - 6));
  }
  function clampTop(y: number, h: number, vh: number) {
    return Math.max(6, Math.min(y, vh - h - 6));
  }

  const isInteractive = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    target.closest(".event-card, .child-chip, .cluster-badge, .detail-panel") !== null;

  /**
   * 卡片的快捷按钮（＋ ✎ 🗑）在悬停时才出现。
   * 悬浮窗的位置是在"弹出的那一刻"算定的，之后鼠标移动不会跟着走，
   * 所以鼠标一移到底部按钮上，那个框就正好压住按钮。
   * 这里约定：鼠标落在 .card-actions 上时一律不显示悬浮窗。
   */
  const overCardActions = (target: EventTarget | null) =>
    target instanceof HTMLElement && target.closest(".card-actions") !== null;

  return (
    <div
      className="canvas-area"
      ref={areaRef}
      style={{ height, position: "relative" }}
      onMouseLeave={hideHover}
      onMouseDown={(e) => {
        if (!isInteractive(e.target)) hideHover();
      }}
      onPointerMove={(e) => {
        pointerRef.current = { x: e.clientX, y: e.clientY };
        if (overCardActions(e.target)) {
          if (hover) hideHover();
          cancelHover();
          return;
        }
        if (hover && !isInteractive(e.target)) hideHover();
      }}
    >
      <div className="timeline-axis" style={{ top: LINE_Y }} />

      <div className="legend-hint">
        {threshold < 3 ? (
          <span className="legend-chip">低缩放：仅显示重要事件（次要已收纳）</span>
        ) : (
          <span className="legend-chip dim">全部事件可见</span>
        )}
      </div>

      {/*
        空状态只看「筛选后的列表是否为空」，跟视口无关。
        早先误用了 placed.length（视口裁剪后的节点数），
        结果缩放到某段没有事件的年代也会弹出提示，误导用户以为是筛选问题。
      */}
      {events.length === 0 && (
        <div className="empty-state" style={{ top: LINE_Y + 46 }}>
          <div className="empty-title">
            {totalEvents === 0 ? "还没有任何事件" : "当前筛选下没有事件"}
          </div>
          <div className="empty-sub">
            {totalEvents === 0
              ? "点右上角「＋ 新增事件」开始记录"
              : "试试打开上方的类别 / 标签"}
          </div>
        </div>
      )}

      {/* ---------- 子事件带：轴线正上方 ---------- */}
      {childChips.map(({ kid, parentId, left, width, top }) => {
        const parentCat = catMap.get(eventMap.get(parentId)?.categoryId ?? "");
        return (
          <div
            key={`${parentId}-${kid.id}`}
            className="child-chip"
            style={{ left, top, width, borderLeftColor: parentCat?.color ?? "#888" }}
            onMouseEnter={(e) => scheduleHover(kid, e.currentTarget as HTMLElement)}
            onMouseLeave={hideHover}
            onClick={(e) => {
              e.stopPropagation();
              const el = e.currentTarget as HTMLElement;
              select(kid, left, top, el.offsetWidth, el.offsetHeight);
            }}
          >
            <i style={{ background: parentCat?.color ?? "#888" }} />
            <span>{kid.title}</span>
          </div>
        );
      })}

      {/* ---------- 簇徽标：全部贴在轴线上，作为"这里还有一堆"的标记 ---------- */}
      {placedClusters.map(({ node, x }) => (
        <button
          key={node.id}
          className="cluster-badge"
          style={{ left: x, top: CLUSTER_Y }}
          onClick={(e) => {
            e.stopPropagation();
            hideHover();
            const evs = (node as ClusterNode).events;
            onFocusRange(
              Math.min(...evs.map((it) => it.startJdn)),
              Math.max(...evs.map((it) => it.endJdn ?? it.startJdn))
            );
          }}
          onMouseEnter={(e) =>
            scheduleClusterHover((node as ClusterNode).events, e.currentTarget as HTMLElement)
          }
          onMouseLeave={hideHover}
        >
          <span className="cluster-count">{(node as ClusterNode).events.length}</span>
          <span className="cluster-icon">↓</span>
        </button>
      ))}

      {/* ---------- 卡片区：轴线下方 ---------- */}
      {placedCards.map(({ node, lane, x }) => {
        const cardTop = CARD_TOP + lane * LANE_H;
        const ev = node.event;
        const cat = catMap.get(ev.categoryId);
        const kids = childMap.get(ev.id) ?? [];
        const open = kids.length > 0 && isOpen(ev.id);
        const spanW = ev.endJdn ? Math.max(3, (ev.endJdn - ev.startJdn) * vp.pxPerDay) : 0;

        return (
          <div key={node.id}>
            {ev.endJdn && spanW >= 4 && (
              <div
                className="span-bar"
                style={{ left: x, width: spanW, top: LINE_Y - 3, background: cat?.color ?? "#999" }}
              />
            )}

              <div
                className={"event-card" + (kids.length ? " has-kids" : "")}
                style={{ left: x, top: cardTop, borderLeftColor: cat?.color ?? "#999" }}
                onMouseEnter={(e) => scheduleHover(ev, e.currentTarget as HTMLElement)}
                onMouseLeave={hideHover}
                onClick={(e) => {
                  e.stopPropagation();
                  // 用真实 DOM 尺寸，面板才能精确地摆在卡片旁边
                  const el = e.currentTarget as HTMLElement;
                  select(ev, x, cardTop, el.offsetWidth, el.offsetHeight);
                }}
              >
                <div className="event-dot" style={{ background: cat?.color ?? "#999" }} />
                <div className="event-title">{ev.title}</div>
                <div className="event-date">{ev.dateText}</div>
                <div className="event-tags">
                  <span className="cat-chip" style={{ background: cat?.color }}>
                    {cat?.name}
                  </span>
                  {ev.tagIds.slice(0, 2).map((id) => (
                    <span key={id} className="tag-chip">
                      #{tagMap.get(id)?.name ?? id}
                    </span>
                  ))}
                </div>
                {kids.length > 0 && (
                  <button
                    className="expand-btn"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => toggle(e, ev.id)}
                    title={open ? "收起子事件" : `展开 ${kids.length} 个子事件`}
                  >
                    {open ? "▾" : `▸${kids.length}`}
                  </button>
                )}

                {/* 卡片上的快捷操作：悬停才出现，避免平时太吵 */}
                {(onEditEvent || onAddChild || onDeleteEvent) && (
                  <div
                    className="card-actions"
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseEnter={hideHover}
                  >
                    {onAddChild && (
                      <button
                        type="button"
                        className="card-act"
                        title="在这个事件下新增子事件"
                        onClick={(e) => {
                          e.stopPropagation();
                          hideHover();
                          onAddChild(ev.id);
                        }}
                      >
                        ＋
                      </button>
                    )}
                    {onEditEvent && (
                      <button
                        type="button"
                        className="card-act"
                        title="编辑"
                        onClick={(e) => {
                          e.stopPropagation();
                          hideHover();
                          onEditEvent(ev!);
                        }}
                      >
                        ✎
                      </button>
                    )}
                    {onDeleteEvent && (
                      <button
                        type="button"
                        className="card-act danger"
                        title="删除"
                        onClick={(e) => {
                          e.stopPropagation();
                          hideHover();
                          if (window.confirm(`删除「${ev.title}」？`)) onDeleteEvent(ev.id);
                        }}
                      >
                        🗑
                      </button>
                    )}
                  </div>
                )}
              </div>
          </div>
        );
      })}

      {/* ---------- 悬停提示（portal 到 body，不挡任何操作） ---------- */}
      {hover &&
        !selected &&
        tipStyle &&
        createPortal(
          <div
            className="tooltip"
            style={{ position: "fixed", left: tipStyle.left, top: tipStyle.top }}
          >
            {hover.kind === "event" ? (
              <>
                <div className="tt-title">{hover.ev.title}</div>
                <div className="tt-date">{hover.ev.dateText}</div>
                <div className="tt-summary">{hover.ev.summary}</div>
              </>
            ) : (
              <>
                <div className="tt-title">此处收纳 {hover.items.length} 个事件</div>
                <div className="tt-list">
                  {hover.items.slice(0, 8).map((it) => (
                    <div key={it.id} className="tt-list-row">
                      <i style={{ background: catMap.get(it.categoryId)?.color ?? "#999" }} />
                      <span className="tt-list-title">{it.title}</span>
                      <span className="tt-list-date">{it.dateText}</span>
                    </div>
                  ))}
                  {hover.items.length > 8 && (
                    <div className="tt-list-more">还有 {hover.items.length - 8} 条…</div>
                  )}
                </div>
                <div className="tt-hint">点击徽标放大到这一段</div>
              </>
            )}
          </div>,
          document.body
        )}

      {/* ---------- 详情面板（点击固定，挂到 body，不受画布层叠影响） ---------- */}
      {selected &&
        createPortal(
          <div
            className="detail-panel"
            style={{ position: "fixed", left: panelPos.left, top: panelPos.top }}
          >
            <button className="detail-close" onClick={() => setSelected(null)} title="关闭 (Esc)">
              ×
            </button>
          <div className="dp-cat">
            <span
              className="dp-cat-chip"
              style={{ background: catMap.get(selected.ev.categoryId)?.color ?? "#999" }}
            >
              {catMap.get(selected.ev.categoryId)?.name}
            </span>
            {selected.ev.tagIds.map((id) => (
              <span key={id} className="tag-chip">
                #{tagMap.get(id)?.name ?? id}
              </span>
            ))}
          </div>
          <div className="dp-title">{selected.ev.title}</div>
          <div className="dp-date">{selected.ev.dateText}</div>
          <div className="dp-summary">{selected.ev.summary || "（暂无详细描述）"}</div>

          {/* M4：编辑动作 */}
          {(onEditEvent || onDeleteEvent || onAddChild) && (
            <div className="dp-actions">
              {onEditEvent && (
                <button className="dp-btn" onClick={() => onEditEvent(selected.ev)}>
                  编辑
                </button>
              )}
              {onAddChild && (
                <button className="dp-btn" onClick={() => onAddChild(selected.ev.id)}>
                  ＋ 子事件
                </button>
              )}
              {onDeleteEvent && (
                <button
                  className="dp-btn danger"
                  onClick={() => {
                    if (window.confirm(`删除「${selected.ev.title}」？`)) {
                      onDeleteEvent(selected.ev.id);
                      setSelected(null);
                    }
                  }}
                >
                  删除
                </button>
              )}
            </div>
          )}

          {selectedKids.length > 0 && (
            <div className="dp-kids">
              <div className="dp-kids-head">包含 {selectedKids.length} 个子事件</div>
              {selectedKids.map((kid) => (
                <button
                  key={kid.id}
                  className="dp-kid"
                  onClick={() => setSelected({ ev: kid, x: selected.x, y: selected.y, w: selected.w, h: selected.h })}
                >
                  <i style={{ background: catMap.get(kid.categoryId)?.color ?? "#999" }} />
                  <span className="dp-kid-title">{kid.title}</span>
                  <span className="dp-kid-date">{kid.dateText}</span>
                </button>
              ))}
            </div>
          )}

          {selectedParent && (
            <div className="dp-parent">
              属于：
              <button
                className="dp-parent-link"
                onClick={() => setSelected({ ev: selectedParent, x: selected.x, y: selected.y, w: selected.w, h: selected.h })}
              >
                {selectedParent.title}
              </button>
            </div>
          )}
          </div>,
          document.body
        )}
    </div>
  );
}
