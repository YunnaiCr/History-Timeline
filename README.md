# 历史事件线

基于 Tauri 2 + React + TypeScript 的桌面端历史时间轴应用，用于梳理、浏览和整理时间跨度很大的历史事件。

![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB)
![React](https://img.shields.io/badge/React-19-61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6)
![Platform](https://img.shields.io/badge/Platform-Windows-0078D6)

## 简介

历史数据在时间轴上并不好放：公元前 221 年和 1919 年要共处一条轴，跨度相差两千倍；1911–1921 这十年却挤着十几件事；甲午战争持续两年，而黄海海战只有一天。普通时间轴工具在这些地方会迅速变得不可读。

本项目围绕这些问题设计：

- **自动收纳** —— 屏幕上靠得太近的节点会自动合并成一个带数量的标记，缩放后自动散开
- **事件层级** —— 长周期事件可以包含具体到某天的事件，两者各有合适的时间尺度
- **双重分类** —— 类别与标签彼此独立，可以组合过滤

## 功能

### 时间轴

- 横向缩放与拖拽平移，支持鼠标与键盘操作
- 打开时自动适配全部数据的年代范围
- 自动收纳：密集处合并为标记，点击即放大到该时段
- 按缩放级别分级显示，低缩放时优先保留重要事件
- 区间事件以色带呈现

### 事件组织

- **类别**：单值、必填，用于划分事件性质（政治、经济、科技等），可自定义并调整颜色
- **标签**：多值、可选，用于自由标注，与类别相互独立
- **父子事件**：一个事件可以包含若干子事件，展开后在轴线上方按真实时间排列

### 编辑与浏览

- 新增、编辑、删除事件，支持公元前后的时间输入
- 表格视图：排序、搜索、按父子层级缩进，双击回到时间轴定位
- 类别与标签管理

### 数据

- 自动保存，关闭即持久化
- JSON 导出与导入，导入支持**合并**（追加到现有数据）或**覆盖**两种模式
- 导入时自动处理类别、标签的同名复用与 id 冲突

## 安装与运行

### 环境要求

| 依赖 | 版本 |
|---|---|
| Node.js | 18 以上 |
| Rust | stable（MSVC 工具链） |
| Visual Studio | 2022 或 2026，需勾选「使用 C++ 的桌面开发」 |
| WebView2 | Windows 10/11 通常已自带 |

### 开发

```bash
cd app
npm install
npm run tauri dev
```

### 构建

```bash
cd app
npm run tauri build
```

产物位于 `app/src-tauri/target/release/`。

## 使用说明

| 操作 | 效果 |
|---|---|
| 拖动 / 滚轮 | 平移、缩放时间轴 |
| `←` `→` / `+` `-` | 键盘平移与缩放 |
| 点击数量标记 | 放大到该时段，收纳的事件自动展开 |
| 点击事件卡片 | 打开详情面板，可编辑、删除、添加子事件 |
| 悬停事件卡片 | 显示摘要 |
| 顶栏类别 / 标签 | 多选筛选 |
| 顶栏「表格」 | 切换到表格视图 |

## 数据存储

数据保存在本地应用数据目录中：

```
%LOCALAPPDATA%\com.yunnai.historytimeline\EBWebView\Default\Local Storage
```

如需备份、迁移或在其他设备使用，请使用「导出 JSON」将数据保存为文件，再通过「导入 JSON」恢复。导入支持**合并**（追加到现有数据）和**覆盖**（整体替换）两种模式。

导出的 JSON 是**可手写**的：日期写成 `1911-10-10` 或 `-221`，类别和标签用名称。也可以只用记事本写几条事件再导入。格式说明见 [JSON 数据格式](docs/JSON格式.md)。

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面外壳 | Tauri 2 |
| 界面 | React 19 + TypeScript |
| 构建 | Vite |
| 时间模型 | 整数儒略日 |
| 存储 | localStorage（可选 JSON 导出） |

## 项目结构

```
app/
├── src/
│   ├── lib/
│   │   ├── time.ts       时间换算与格式化
│   │   ├── viewport.ts   时间与像素的映射、缩放、平移
│   │   ├── cluster.ts    收纳与层级布局
│   │   ├── ticks.ts      刻度生成
│   │   ├── store.ts      本地持久化
│   │   └── io.ts         JSON 导入导出
│   ├── components/       时间轴、刻度尺、编辑弹窗、表格等
│   └── data/             示例数据
├── src-tauri/            Tauri 应用外壳
└── selfcheck/            自动化校验脚本
```

## 开发自检

项目包含一组不依赖浏览器的校验脚本，覆盖时间换算、收纳布局、存储与导入导出等逻辑：

```bash
cd app
node build-m0.mjs
node selfcheck/timecheck.mjs
node selfcheck/bcecheck.mjs
node selfcheck/clustercheck.mjs
node selfcheck/childbandcheck.mjs
node selfcheck/fitcheck.mjs
node selfcheck/storecheck.mjs
node selfcheck/iocheck.mjs
node selfcheck/uicheck.mjs
```

## 文档

- [JSON 数据格式](docs/JSON格式.md)
- [技术选型与数据模型](docs/技术选型与数据模型.md)
- [收纳与事件层级设计](docs/事件层级与收纳设计.md)

## 许可

暂未指定。
