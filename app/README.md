# 历史事件线 · v0.2（M0 + M2）

Tauri 2 + React 19 + TypeScript + Vite 的桌面版历史事件时间轴。

**已完成**：时间映射、刻度尺、事件卡片、拖拽/缩放、类别与标签筛选、**自动聚簇收纳 + 点开展开**、
**区间事件（span）**、**父子事件展开**。

## 目录

```
app/
├── src/                       前端源码（React + TS）
│   ├── App.tsx                顶栏筛选、视口状态、滚轮缩放、pointer 拖拽、展开状态
│   ├── components/
│   │   ├── Ruler.tsx          Canvas 刻度尺（高 DPI，按 pxPerDay 自动切 千年→世纪→年→月→日）
│   │   └── CanvasArea.tsx     时间轴主体：簇徽标 / 事件卡片 / 区间带 / 子事件层 / 悬浮摘要
│   ├── lib/
│   │   ├── time.ts            儒略日换算、公元前处理、格式化
│   │   ├── viewport.ts        time ↔ pixel 映射、锚点缩放、平移
│   │   ├── ticks.ts           刻度粒度选择与生成
│   │   └── cluster.ts         聚簇核心（纯函数，可单测）
│   └── data/sampleData.ts     示例数据（含甲午战争 / 辛亥革命 / 北伐 / 抗战 的嵌套子事件）
├── src-tauri/                 Tauri 2 壳（Rust）
├── selfcheck/
│   ├── timecheck.mjs          时间核心自检（7 项）
│   └── clustercheck.mjs       聚簇与层级自检（13 项）
├── m0.html / serve-m0.mjs     无打包器预览入口（沙箱里用）
└── vite.config.mjs            Vite 配置（端口 1420）
```

## 运行

```powershell
cd app
npm install              # 首次
npm run tauri dev        # 开发窗口（改代码即热更新）
npm run tauri build      # 出 release exe + NSIS 安装包
```

只调试前端（不起 Rust）：

```powershell
npm run dev              # 浏览器 http://127.0.0.1:1420
```

环境要求：**Rust（rustup, msvc 工具链）+ 任意 VS 2022/2026 带「使用 C++ 的桌面开发」工作负载**。
本机已验证：VS 2026 Enterprise 18.11 + MSVC 14.52 + Windows SDK 10.0.26100 + Rust 1.99.1。

## 交互一览

| 操作 | 效果 |
|---|---|
| 左键拖动 | 平移时间轴 |
| 滚轮 | 以鼠标为锚点缩放 |
| `←` `→` / `+` `-` | 键盘平移与缩放 |
| 点 **`N ↓` 徽标** | 放大到该时间段，收纳的事件自动散开 |
| 点父事件卡片（带 `▸N`） | 展开/收起子事件（显示在轴线上方） |
| 顶栏类别 chip | 多选，控制可见类别 |
| 顶栏标签 chip | 多选，任一匹配即显示（OR） |
| 悬停卡片/子事件 | 显示摘要（停 0.9 秒才弹，不挡点击） |
| 点卡片 | 打开右侧详情面板（含 编辑 / ＋子事件 / 删除，Esc 关闭） |
| 悬停卡片右下角 | 出现 `＋` `✎` `🗑` 三个快捷按钮 |
| **顶栏「＋ 新增事件」** | 打开编辑弹窗（可指定父事件 → 直接建成子事件） |
| **顶栏「管理类别/标签」** | 增删改类别、增删标签 |
| 底栏「重置数据」 | 清空本地数据，恢复示例 |

## 时间输入：公元前 / 公元

内部统一存**天文纪年**（year 0 = 公元前 1 年），保证公元前后的加减连续无断点；
界面用**历史纪年**，表单里有「公元前 / 公元」下拉，用户只填正整数年份，不用敲负号。

| 历史纪年 | 天文纪年 |
|---|---|
| 公元前 221 年 | -220 |
| 公元前 1 年 | 0 |
| 公元 1 年 | 1 |
| 公元 1912 年 | 1912 |

换算函数在 `src/lib/time.ts`：`fromHistoricalYear` / `toHistoricalYear` / `bcToJdn`。
表单底部有「将记录为：公元前221年」的实时预览。

## 聚簇规则（`src/lib/cluster.ts`）

- 两个节点在屏幕上距离 < **30px** 就合并成一个簇，放大后自动散开。
- 缩放时的 `importance` 门槛：`< 0.02 px/天` 只显示重要事件，`< 0.1` 显示到中级，其余全显示。
- 区间事件宽度 < 14px 时退化成点，参与聚簇。
- 簇 id 取自组内最早事件，保证重渲染时 DOM 不抖。
- 首屏用 `fitRange` 自动铺满全量数据范围（打开就能看到全貌）。

## 数据存储（`src/lib/store.ts`）

- localStorage，键名 `history-timeline.v1`，结构 `{ version, events, categories, tags }`。
- 任何改动自动保存；数据损坏或版本不符时**回退到示例数据**，不会白屏。
- 换 SQLite 时只改 `loadData` / `saveData` / `resetData` 三个函数，组件不用动。

## 自检

```powershell
cd app
node build-m0.mjs                # 先用 tsc 生成 dist-src/（自检脚本 import 它）
node selfcheck/timecheck.mjs      # 7 passed  时间映射/缩放锚点
node selfcheck/clustercheck.mjs   # 13 passed 聚簇与层级
node selfcheck/childbandcheck.mjs # 8 passed  子事件带布局
node selfcheck/fitcheck.mjs       # 9 passed  首屏自适应
node selfcheck/storecheck.mjs     # 11 passed 存储读写与容错
node selfcheck/bcecheck.mjs       # 15 passed 公元前/公元换算
node selfcheck/uicheck.mjs        # 4 passed  UI 回归（label 内不得有 button 等）
```

## 已知限制（后续里程碑）

| 项 | 计划 |
|---|---|
| 子事件只渲染一层（不支持孙事件） | M3 |
| 手动分组（框选收进自定义组） | M3 |
| 类别/标签的增删改管理界面 | M4b |
| JSON 导入导出、SQLite | M4c / M5 |
| 迷你地图 / 跳转到指定年份 | M5 |
| 移动端触屏手势（双指缩放） | 之后 |

详细设计见 [`../docs/事件层级与收纳设计.md`](../docs/事件层级与收纳设计.md) 与
[`../docs/技术选型与数据模型.md`](../docs/技术选型与数据模型.md)。
