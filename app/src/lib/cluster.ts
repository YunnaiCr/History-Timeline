/**
 * 聚簇（收纳/展开）核心：纯函数，不碰 React，方便用 node 自检。
 *
 * 设计要点（对应需求"时间节点能够收纳展开"）：
 *  - 阈值以"屏幕像素"为单位：两个事件在屏幕上挤到一起（< CLUSTER_PX）就收成簇。
 *    这样缩小时自动收、放大时自动散，不需要用户手动开合。
 *  - 区间事件（有 endJdn）不参与聚簇，它们画在轴上作为"带"；但在低缩放级别如果带太短，
 *    会被压缩成一个点参与聚簇。
 *  - importance 门槛：点位太密时先丢掉 importance=3 的次要事件，再聚簇。
 */
import type { TimelineEvent } from "../data/sampleData";
import type { Viewport } from "./viewport";
import { jdnToX } from "./viewport";

/** 两个节点中心距离小于这个像素值就合并 */
export const CLUSTER_PX = 30;
/** 区间带宽度小于这个像素值时，退化成点 */
export const SPAN_MIN_PX = 14;

export interface ClusterNode {
  kind: "cluster";
  /** 稳定 id：由组内最小事件 id 生成，避免重新渲染抖 key */
  id: string;
  events: TimelineEvent[];
  x: number;
  /** 代表时间（组内最早） */
  jdn: number;
  /** 组内事件跨度（若全部为点事件则为 0） */
  spanPx: number;
}

export interface EventNode {
  kind: "event";
  id: string;
  event: TimelineEvent;
  x: number;
  jdn: number;
}

export type Node = ClusterNode | EventNode;

export const isCluster = (n: Node): n is ClusterNode => n.kind === "cluster";
export const isEvent = (n: Node): n is EventNode => n.kind === "event";

/** 事件在给定缩放下的像素宽度（点事件为 0） */
export function spanPxOf(vp: Viewport, ev: TimelineEvent): number {
  if (!ev.endJdn) return 0;
  return (ev.endJdn - ev.startJdn) * vp.pxPerDay;
}

/**
 * 自动聚簇。
 *
 * @param candidates 已经过类别/标签过滤、且**不含子事件**的顶层事件
 * @param importanceThreshold 只保留 importance <= 阈值的事件（低缩放时抬高）
 */
export function buildNodes(
  vp: Viewport,
  candidates: TimelineEvent[],
  importanceThreshold: 1 | 2 | 3 = 3
): Node[] {
  const shown = candidates.filter((e) => e.importance <= importanceThreshold);

  // 区间带够宽 → 单独成节点（不参与聚簇，免得和点事件混在一起）
  const spans: Node[] = [];
  const points: TimelineEvent[] = [];
  for (const ev of shown) {
    if (spanPxOf(vp, ev) >= SPAN_MIN_PX) {
      spans.push({ kind: "event", id: ev.id, event: ev, x: jdnToX(vp, ev.startJdn), jdn: ev.startJdn });
    } else {
      points.push(ev);
    }
  }

  points.sort((a, b) => a.startJdn - b.startJdn);

  const clusters: ClusterNode[] = [];
  let current: TimelineEvent[] = [];
  let lastX = -Infinity;

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0];
    const last = current[current.length - 1];
    const x = jdnToX(vp, first.startJdn);
    clusters.push({
      kind: "cluster",
      id: `c:${first.id}`,
      events: current,
      x,
      jdn: first.startJdn,
      spanPx: (last.startJdn - first.startJdn) * vp.pxPerDay,
    });
    current = [];
  };

  for (const ev of points) {
    const x = jdnToX(vp, ev.startJdn);
    if (current.length > 0 && x - lastX > CLUSTER_PX) flush();
    current.push(ev);
    lastX = x;
  }
  flush();

  // 单个事件的簇降级为普通事件节点
  const out: Node[] = [];
  for (const c of clusters) {
    if (c.events.length === 1) {
      const ev = c.events[0];
      out.push({ kind: "event", id: ev.id, event: ev, x: c.x, jdn: c.jdn });
    } else {
      out.push(c);
    }
  }

  return [...spans, ...out].sort((a, b) => a.jdn - b.jdn);
}

/**
 * 根据缩放级别决定 importance 门槛：
 *  - 每像素覆盖的时间越多（缩得越小），越只显示重要事件
 *  - pxPerDay < 0.02（一屏 ≈ 2000 天以上）时只留 importance=1
 */
export function importanceThresholdFor(pxPerDay: number): 1 | 2 | 3 {
  if (pxPerDay < 0.02) return 1;
  if (pxPerDay < 0.1) return 2;
  return 3;
}

/** 簇的展开规则：放大到一定程度后强制拆开（用户点了展开也会拆开） */
export function shouldAutoCollapse(vp: Viewport, cluster: ClusterNode): boolean {
  if (cluster.events.length <= 1) return true;
  return cluster.spanPx > 26 || vp.pxPerDay > 2;
}

export interface ClusterChild {
  ev: TimelineEvent;
  /** 相对父事件起点的像素偏移 */
  offsetPx: number;
}

/** 把事件按 parentId 分组：父 → 子列表（只算直接子） */
export function groupChildren(events: TimelineEvent[]): Map<string, TimelineEvent[]> {
  const map = new Map<string, TimelineEvent[]>();
  for (const ev of events) {
    if (!ev.parentId) continue;
    const arr = map.get(ev.parentId) ?? [];
    arr.push(ev);
    map.set(ev.parentId, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.startJdn - b.startJdn);
  return map;
}

/**
 * 簇徽标排成"一行贴轴"的横向坐标。
 *
 * 簇是轴上的标记，不参与卡片轨道分配——之前两者共用轨道，簇会被排到第 2、3、4 轨，
 * 同一屏里忽上忽下很乱。现在全部固定在同一 y，只在横向做顺延避让。
 *
 * @param positions 已按时间升序排列的簇中心像素（相对画布左边缘）
 */
export function layoutClusterRow(
  positions: number[],
  width: number,
  { clusterW = 44, gap = 6, gutter = 16 }: { clusterW?: number; gap?: number; gutter?: number } = {}
): number[] {
  let prevRight = -Infinity;
  return positions.map((pos) => {
    const wanted = gutter + pos;
    const left = Math.min(
      Math.max(wanted, prevRight + gap),
      Math.max(0, width - clusterW - 4)
    );
    prevRight = left + clusterW;
    return left;
  });
}

/** 同轨两张卡片之间至少留的缝 */
export const LANE_GAP = 6;

export interface LaneSlot {
  lane: number;
  /** 最终 x 坐标；轨道不够时会大于输入的 x（向右顺延） */
  x: number;
}

/**
 * 卡片轨道分配：横向区间不重叠就复用同一轨。
 *
 * 关键不变量：**同一轨内任意两张卡片的横向区间不相交**。
 * 轨道全满时不再"复用最空的那条"（那样会叠在一起），
 * 而是把卡片沿该轨向右顺延——代价是时间位置略有偏移，但不会看不清。
 */
export function assignLanes(
  items: { x: number; width: number }[],
  laneCount: number,
  gap = LANE_GAP
): LaneSlot[] {
  const tails: number[] = new Array(Math.max(1, laneCount)).fill(-Infinity);

  return items.map((it) => {
    let lane = tails.findIndex((t) => t < it.x - gap);
    let x = it.x;

    if (lane === -1) {
      // 没有空轨：挑最早空出来的那条，横向顺延到不重叠的位置
      lane = tails.indexOf(Math.min(...tails));
      x = Math.max(it.x, tails[lane] + gap);
    }
    tails[lane] = x + it.width;
    return { lane, x };
  });
}
