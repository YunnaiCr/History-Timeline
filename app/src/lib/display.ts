/**
 * 事件在界面上显示的时间文本。
 *
 * 之前每个地方各自算：卡片用 dateText，表格用 formatJdn(startJdn)，
 * 于是手写的「约公元前1600年」和「只显示年份」在表格里全被无视。
 * 现在统一从这里取。
 */
import type { TimelineEvent } from "../data/schema";
import { yearOnlyText } from "./time";

/** 返回 null 表示"这个事件不显示时间" */
export function eventDateLabel(ev: TimelineEvent): string | null {
  const mode = ev.dateDisplay ?? (ev.hideDate ? "none" : "full");
  if (mode === "none") return null;
  if (mode === "year") return yearOnlyText(ev.startJdn, ev.endJdn);
  // dateText 理论上不会为空；真为空时退回年份，总比显示空白好
  return ev.dateText || yearOnlyText(ev.startJdn, ev.endJdn);
}

/** 表格等地方需要一个占位符时用它 */
export function eventDateLabelOrDash(ev: TimelineEvent): string {
  return eventDateLabel(ev) ?? "—";
}

/** 鼠标悬停/详情里用的完整说法：优先 dateText，其次按日期生成 */
export function eventDateFullText(ev: TimelineEvent): string {
  return ev.dateText || yearOnlyText(ev.startJdn, ev.endJdn);
}
