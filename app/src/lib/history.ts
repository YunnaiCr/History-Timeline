/**
 * 撤销 / 重做栈。
 *
 * 存的是整份 DataFile 快照（数据量小，快照比操作日志简单可靠得多）。
 * 栈有上限，超出就丢最旧的。
 *
 * 纯函数，不依赖 React，便于自检。
 */
import type { DataFile } from "./store";

export interface History {
  past: DataFile[];
  future: DataFile[];
}

export const HISTORY_LIMIT = 60;

export const emptyHistory: History = { past: [], future: [] };

/**
 * 记录一次变更：把「变更前」的快照压入 past，并清空 future。
 *
 * 清空 future 是标准行为：撤销几步后做了新操作，原来的重做分支就作废了。
 */
export function pushHistory(history: History, before: DataFile): History {
  const past = [...history.past, before];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, future: [] };
}

/** 撤销：返回「要恢复的快照」和新的栈；没有可撤销时返回 null */
export function undo(
  history: History,
  current: DataFile
): { restore: DataFile; history: History } | null {
  if (history.past.length === 0) return null;
  const past = [...history.past];
  const restore = past.pop()!;
  return {
    restore,
    history: { past, future: [current, ...history.future].slice(0, HISTORY_LIMIT) },
  };
}

/** 重做：返回「要恢复的快照」和新的栈；没有可重做时返回 null */
export function redo(
  history: History,
  current: DataFile
): { restore: DataFile; history: History } | null {
  if (history.future.length === 0) return null;
  const future = [...history.future];
  const restore = future.shift()!;
  return {
    restore,
    history: { past: [...history.past, current].slice(-HISTORY_LIMIT), future },
  };
}
