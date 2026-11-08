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

## 直接运行

编译好的程序是**单个 exe 文件**，双击即可打开：

```
history-timeline.exe
```

不需要安装 Node.js、Rust 或 Visual Studio，也不需要安装过程，删掉文件就等于卸载。

首次启动会在文档目录建立一个**空的数据文件**（见[数据存储](#数据存储)）。之后每次改动都会自动保存。

想先看看效果，可以导入仓库里的示例数据：

```
samples/sample.json     50 条事件，含 4 组父子层级
```

打开应用 → 底栏「导入 JSON」→ 选这个文件 → 选「合并」。也可以只用它试试导入功能，再「清空全部」开始记自己的。

> 仓库目前不附带预编译的 exe，需要自己生成一次 —— 见[从源码构建](#从源码构建)，完成后产物在 `app/src-tauri/target/release/history-timeline.exe`。

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

## 使用说明

| 操作 | 效果 |
|---|---|
| 拖动 / 滚轮 | 平移、缩放时间轴 |
| `←` `→` / `+` `-` | 键盘平移与缩放 |
| 点击数量标记 | 放大到该时段，收纳的事件自动展开 |
| 点击事件卡片 | 打开详情面板，可编辑、删除、添加子事件 |
| 悬停事件卡片 | 显示摘要（停一下才出现，不挡点击） |
| 顶栏类别 / 标签 | 多选筛选 |
| 顶栏「表格」 | 切换到表格视图 |

## 数据存储

数据是一个**普通 JSON 文件**，默认位于：

```
文档\历史事件线\history-timeline.json
```

可以在底栏「设置」里改成任意目录和文件名。`history-timeline.json` 就是你的全部数据，可以直接备份、放进网盘、拷到别的电脑。

保存时会在同目录留一份备份：

```
history-timeline.backup-20261108-140233.json
```

默认保留最近 5 份，数量可在设置里调整（也可以关掉）。

文件格式是**可手写**的：日期写成 `1911-10-10` 或 `-221`，类别和标签用名称，只用记事本写几条事件也能导入。详见 [JSON 数据格式](docs/JSON格式.md)。

底栏「导出 JSON」会弹「另存为」，默认位置是数据目录的**上一层**（默认即 `文档`），文件名形如 `历史时间线-2026-11-08.json`。导出的是副本，不影响应用正在用的数据文件。

## 从源码构建

只有需要自己生成 exe 或修改代码时才需要这一节。

### 环境要求

| 依赖 | 说明 |
|---|---|
| Node.js | 18 以上 |
| Rust | stable，MSVC 工具链 |
| Visual Studio | 2022 或 2026，安装时必须勾选「使用 C++ 的桌面开发」 |
| WebView2 | Windows 10/11 通常已自带 |

### 为什么要 `npm install`

界面的依赖（React、Vite、TypeScript 等）**不放进仓库**：安装后约 82 MB、几千个文件，且与操作系统和架构绑定，放进版本库既臃肿又没法跨平台。仓库里只记录两份清单：

- `package.json` —— 声明需要哪些依赖
- `package-lock.json` —— 锁定每个依赖的确切版本

`npm install` 做的就是照着这两份清单把依赖下载到 `app/node_modules`。

> 类比：npm 相当于 Python 的 pip、C++ 的 vcpkg；`package.json` 相当于 `requirements.txt`。
> 这一步只需要做一次，之后除非依赖有变动，否则不用重复执行。

### 开发模式

```bash
cd app
npm install        # 只需第一次
npm run tauri dev  # 启动窗口，改代码即时生效
```

### 「构建」是什么意思

构建 = 把源码**编译并打包**成一个可以直接运行的 exe。分两步：

1. **前端**：TypeScript + React 源码 → 浏览器能执行的 JS/CSS（由 Vite 完成）
2. **桌面外壳**：把上一步的产物嵌进 Rust 程序，链接成单个 exe（由 Tauri 完成）

```bash
cd app
npm run tauri build
```

产物：`app/src-tauri/target/release/history-timeline.exe`，可直接拷到别的电脑上双击运行。

### 开发模式与构建产物的区别

| | `npm run tauri dev` | `npm run tauri build` |
|---|---|---|
| 产出 | 不产出文件，只是打开一个窗口 | 生成 exe |
| 依赖 | 每次运行都要 Node.js 和 Rust | 生成的 exe 不需要任何运行时 |
| 改代码 | 保存后自动刷新 | 需要重新构建 |
| 启动速度 | 慢（第一次要编译 Rust，可能 5–15 分钟） | 快 |
| 用途 | 开发调试 | 日常使用、分发给别人 |

### 其他构建选项

```bash
npm run tauri build -- --no-bundle   # 只出 exe，不生成安装包
npm run tauri build                  # 同时生成 NSIS 安装包
```

安装包位于 `app/src-tauri/target/release/bundle/`。

### 只调试界面

界面代码不依赖任何 Tauri 接口，可以只在浏览器里跑：

```bash
cd app
npm run dev     # 浏览器打开 http://127.0.0.1:1420
```

注意：浏览器模式和桌面版的数据**互不相通**（各自独立的存储位置）。

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面外壳 | Tauri 2 |
| 界面 | React 19 + TypeScript |
| 构建 | Vite |
| 时间模型 | 整数儒略日 |
| 存储 | 单个 JSON 文件 + 自动备份 |

## 项目结构

```
app/
├── src/
│   ├── lib/
│   │   ├── time.ts        时间换算与格式化
│   │   ├── viewport.ts    时间与像素的映射、缩放、平移
│   │   ├── cluster.ts     收纳与层级布局
│   │   ├── ticks.ts       刻度生成
│   │   ├── store.ts       数据容器（浏览器模式兜底存储）
│   │   ├── path.ts        路径拼接
│   │   ├── fsdata.ts      文件读写（调 Rust 命令）
│   │   ├── repository.ts  数据文件：读取、保存、备份轮转
│   │   ├── settings.ts    设置项
│   │   └── io.ts          JSON 导入导出
│   ├── components/        时间轴、刻度尺、编辑弹窗、表格、设置等
│   └── data/schema.ts     数据类型与默认类别
├── src-tauri/             Tauri 应用外壳（含文件读写命令）
└── selfcheck/             自动化校验脚本

samples/sample.json        示例数据，用于试用导入功能
```

## 开发自检

项目包含一组不依赖浏览器的校验脚本，覆盖时间换算、收纳布局、数据完整性、导入导出等逻辑：

```bash
cd app
node build-m0.mjs                    # 先把 TypeScript 编译到 dist-src/，自检脚本读取它
node selfcheck/timecheck.mjs         # 时间换算与缩放锚点
node selfcheck/bcecheck.mjs          # 公元前 / 公元换算
node selfcheck/clustercheck.mjs      # 收纳与卡片轨道
node selfcheck/childbandcheck.mjs    # 子事件布局
node selfcheck/fitcheck.mjs          # 首屏自适应
node selfcheck/datacheck.mjs         # 示例数据完整性
node selfcheck/storecheck.mjs        # 存储容错
node selfcheck/iocheck.mjs           # JSON 导入导出与合并
node selfcheck/uicheck.mjs           # 界面回归检查
```

## 文档

- [JSON 数据格式](docs/JSON格式.md)
- [技术选型与数据模型](docs/技术选型与数据模型.md)
- [收纳与事件层级设计](docs/事件层级与收纳设计.md)

## 许可

暂未指定。
