# ⚡️ GGCV Vite Plugins

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0-brightgreen.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/maintained%20with-pnpm-cc00ff.svg)](https://pnpm.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

> 一系列现代化、高性能的 Vite 插件集，旨在提升前端工程化开发体验与构建效率。

这个仓库是一个 [Monorepo](https://monorepo.tools/)，由 `pnpm` workspace 管理，包含了多个我们在实际业务中沉淀的高质量 Vite 插件。

## 📦 插件列表 (Packages)

目前我们维护了以下插件：

| 插件名称                                                     | 简介                                                                                                | 版本                                                                                                                          | 目录                 |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **[`@ggcv/vite-plugin-ssg`](./packages/vite-ssg/README.md)** | 强大灵活的 Vite 静态站点生成 (SSG) 插件。支持 Vue/React 预渲染、自定义渲染函数与内置 SSR 模拟环境。 | [![npm version](https://badge.fury.io/js/%40ggcv%2Fvite-plugin-ssg.svg)](https://www.npmjs.com/package/@ggcv/vite-plugin-ssg) | `/packages/vite-ssg` |
| **[`@ggcv/vite-plugin-mpa`](./packages/vite-mpa/README.md)** | _(🚧 开发中)_ 多页应用 (MPA) 路由与页面生成插件，轻松管理复杂多页 HTML 入口。                       | -                                                                                                                             | `/packages/vite-mpa` |

> 📌 **更多详细用法，请点击表格中的插件名称前往各自的子文档。**

## 💻 环境要求

使用本仓库中的插件，你需要确保所处的环境满足：

- **Node.js**: `>= 22.12.0`
- **Vite**: `>= 5.0.0`

## 🚀 本地开发与贡献 (Contributing)

如果你想要参与开发、提交 PR 或在本地调试这些插件，请按照以下步骤进行。本仓库使用 [pnpm](https://pnpm.io/) 和 [vite-plus](https://github.com/voidzero-dev/vite-plus) 进行项目管理和构建。

### 1. 克隆代码并安装依赖

```bash
git clone https://github.com/ggchivalrous/vite-plugins.git
cd vite-plugins

# 安装依赖 (请使用 pnpm)
pnpm install
```

### 2. 初始化与配置

```bash
# 自动生成或准备配置/TypeScript 环境
pnpm run prepare
```

### 3. 开发与测试指令

在项目根目录，你可以使用以下命令统一调用工作区中的脚本：

- `pnpm run ready`: 自动执行格式化 (`vp fmt`)、Lint (`vp lint`)、运行单元测试和构建产物，用于在 Commit 之前检查状态。
- `pnpm -F @ggcv/vite-plugin-ssg test`: 单独运行 SSG 插件的单元测试。
- `pnpm -F @ggcv/vite-plugin-ssg build`: 单独构建 SSG 插件。

> 本项目通过 `vite-plus` 统一处理 TypeScript 编译和 Vitest 单元测试，内置了极速的开发体验。

## 📝 提交规范

我们鼓励并欢迎各种形式的贡献。提交代码前，请确保：

1. 你的代码通过了所有的单元测试 (`pnpm run ready`)。
2. 尽可能为新增的功能补充对应测试用例。
3. 遵循现有的 ESLint / Prettier (Oxlint/Oxfmt) 代码格式规范。

## 📄 License

[MIT](./LICENSE) License © 2026-PRESENT [ggchivalrous](https://github.com/ggchivalrous).
