# 历史事件线

一个用于梳理历史事件时间轴的桌面应用。不是甘特图，也不是思维导图——它的核心是**在一条时间轴上把「同一时期发生的一堆事」收得住、放得开**。

![技术栈](https://img.shields.io/badge/Tauri-2-24C8DB) ![React](https://img.shields.io/badge/React-19-61DAFB) ![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6)

## 它解决什么

普通时间轴工具遇到历史数据会立刻崩掉：

- **跨度极端**：公元前 221 年和 1919 年要放在同一条轴上，差 2000 倍
- **密集扎堆**：1911–1921 十年里有十几件事，缩小时全叠在一起
- **尺度不一**：甲午战争持续 2 年，黄海海战只有 1 天

所以这里做了三件事：

| 能力 | 做法 |
|---|---|
| **自动收纳** | 屏幕上距离 < 30px 的节点自动合成 `N ↓` 徽标，放大自动散开；点徽标直接放大到那一段 |
| **父子事件** | 父事件画成区间带，子事件收缩到轴线上方的一条迷你带里，按真实时间排布 |
| **双轴筛选** | 类别（单值、必填）与标签（多值、可选）互相独立，可叠加过滤 |

## 功能

- **时间轴**：锚定光标缩放、拖拽平移、首屏自动铺满全部数据
- **收纳**：自动聚簇 + 点簇放大 + 重要度分级（低缩放先收次要事件）
- **层级**：父子事件展开、区间事件色带
- **筛选**：类别多选、标签多选
- **编辑**：事件增删改、指定父事件、类别/标签管理
- **表格视图**：排序、搜索、父子缩进、双击回到时间轴定位
- **数据**：JSON 导出/导入（支持**合并**或覆盖）、本地自动保存

## 快速开始

```bash
cd app
npm install
npm run tauri dev     # 开发
npm run tauri build   # 打包
```

环境要求：Rust（msvc 工具链）+ 带「使用 C++ 的桌面开发」工作负载的 Visual Studio。

## 项目结构

```
app/
├── src/
│   ├── lib/
│   │   ├── time.ts       儒略日换算、公元前/公元互转
│   │   ├── viewport.ts   时间 ↔ 像素映射、锚定缩放、首屏适配
│   │   ├── cluster.ts    聚簇与子事件布局（纯函数）
│   │   ├── ticks.ts      刻度粒度
│   │   ├── store.ts      localStorage 持久化
│   │   └── io.ts         JSON 导入导出、合并
│   ├── components/       Ruler / CanvasArea / EventDialog / ManageDialog / DataTable
│   └── data/             示例数据
├── src-tauri/            Tauri 2 壳
└── selfcheck/            8 组自检，共 105 项
```

## 自检

```bash
cd app
node build-m0.mjs
node selfcheck/timecheck.mjs       # 时间换算
node selfcheck/bcecheck.mjs        # 公元前/公元
node selfcheck/clustercheck.mjs    # 聚簇与层级
node selfcheck/childbandcheck.mjs  # 子事件布局
node selfcheck/fitcheck.mjs        # 首屏适配
node selfcheck/storecheck.mjs      # 存储容错
node selfcheck/iocheck.mjs         # 导入导出与合并
node selfcheck/uicheck.mjs         # UI 回归
```

## 文档

- [技术选型与数据模型](docs/技术选型与数据模型.md)
- [收纳与事件层级设计](docs/M2-收纳与事件层级.md)

## 设计笔记

几个踩过坑、值得记下来的点：

- **时间用儒略日整数存**，不用 Date。公元前后的加减不会断，也没有时区问题。
- **界面用历史纪年，内部用天文纪年**（year 0 = 公元前 1 年）。表单里是「公元前 / 公元」下拉，用户只填正整数。
- **收纳阈值必须是像素，不是时间**。这样缩小时自动收、放大时自动散，不需要额外的"节点缩放"概念。
- **子事件带贴轴固定高度、最多 3 层**。早期按"一人一行"往上堆，超过 3 个就越过轴线掉进卡片区。
- **卡片浮起效果必须挂在 CSS `:hover` 上**。挂在 JS 状态上时，指针移到卡片外的操作按钮会导致卡片掉层、按钮被邻居盖住。
