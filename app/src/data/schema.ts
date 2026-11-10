/**
 * 数据类型与默认分类。
 *
 * 这里**不含任何事件数据**：示例事件已移到仓库根的 `samples/sample.json`，
 * 通过「导入 JSON」载入。应用首次启动是一个空库。
 */

export interface Category {
  id: string;
  name: string;
  color: string;
}

export interface Tag {
  id: string;
  name: string;
}

export interface TimelineEvent {
  id: string;
  title: string;
  /** 起止（点事件时 endJdn 省略） */
  startJdn: number;
  endJdn?: number;
  /** 原始模糊文本，如 "约公元前1046年" */
  dateText: string;
  categoryId: string;
  tagIds: string[];
  summary: string;
  importance: 1 | 2 | 3; // 1 高 / 2 中 / 3 低，低缩放时只显示高重要度

  /** 父事件 id。父事件必须是区间事件，子事件时间应落在父区间内。 */
  parentId?: string;
  /** 展开策略；目前渲染只用得到 span */
  expandMode?: "span" | "point" | "collapsed";
  /** 手动指定颜色，缺省用类别色 */
  color?: string;

  /**
   * 显示文本是用户手写的，日期变化时不再自动覆盖。
   * "约公元前1600年"、"商朝建立初期" 这类都靠它保留。
   */
  dateTextCustom?: boolean;

  /** 卡片上不显示时间（锚点照常参与布局和排序） */
  hideDate?: boolean;

  /**
   * 卡片上的时间显示粒度：
   *  - "full"（默认）显示 dateText
   *  - "year"  只显示年份（"公元前88年"），适合只知道年的古代事件
   *  - "none"  完全不显示
   * 旧字段 hideDate 仍然能读，等价于 "none"。
   */
  dateDisplay?: "full" | "year" | "none";

  /**
   * 可选的模糊范围（天），**仅用于在轴上画一条不确定带**。
   * 不填就没有；不参与排序、聚簇和任何计算。
   * 给不出具体年数时（比如"商朝建立"）就不要填。
   */
  fuzz?: { before: number; after: number };
}

/** 新库自带的类别：每个事件必须属于一个类别，所以不能为空 */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: "politics", name: "政治", color: "#e05c5c" },
  { id: "economy", name: "经济", color: "#4f9d69" },
  { id: "science", name: "科技", color: "#4a7fd4" },
  { id: "culture", name: "文化", color: "#b06ab3" },
  { id: "war", name: "战争", color: "#8a6d3b" },
];

/** 新库不自带标签：标签是用户自由标注的东西 */
export const DEFAULT_TAGS: Tag[] = [];
