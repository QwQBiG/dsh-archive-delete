# dsh-archive-delete

简体中文 · [English](README.md)

面向 DeepSeek Harness 已归档会话的轻量本地回收站。直接嵌入 DSH 桌面界面，支持移入回收站、恢复，以及确认后永久清除选中的回收站记录。

包名：`@qwqbig/dsh-archive-delete` · 许可证：[Apache-2.0](LICENSE)

## 功能

- 在原生已归档会话菜单加入 **移入回收站**。
- 从插件详情打开简洁的 **已归档／回收站** 弹窗。
- 支持单条与批量操作、影响预览及逐项结果。
- 闲置会话若仍被本次 DSH 进程持有写锁，显示 **待移入回收站**。下次插件启动重新检查；执行前可以取消。
- 恢复后回到原工作区的 **已归档** 状态。原工作区不存在时归入未分组，不重建项目目录。
- 跟随 DSH 的语言、明暗主题与原生交互习惯。

回收站不会自动过期。卸载插件也不会清空回收站。

## 数据边界

一次操作会把选中的母会话与明确属于它的子代理会话作为一组处理。独立 fork 分支保持原样。正在运行的工作、待交互状态、关系不明确、路径不安全或其他进程持有写锁时，操作会被阻止。

插件处理会话日志目录，以及这些会话在宿主中的必要登记。**不删除** 共享附件、spill 溢出文件、项目文件或其他插件的缓存。永久清除会移除选中的本地回收站内容及其恢复元数据，并不代表会话在本地或远端的所有副本都已擦除。

移入回收站可以恢复；**永久清除无法撤销**。两种操作都会在执行前说明实际目标和处理范围。

## 兼容性

首个支持目标是 **官方 DSH macOS Desktop `0.2.1-rc.3`** 与官方 JSONL 会话持久化后端。版本或能力不符合时会禁用数据变更，不猜测宿主内部结构。

本仓库实际执行的验证见 [验收记录](docs/acceptance.zh-CN.md)。声明支持目标不代表后续 DSH 版本或其他平台已经实测。

## 安装与使用

版本发布后，在 DSH 桌面端打开 **插件 → 添加插件**，输入：

```text
github:QwQBiG/dsh-archive-delete#v0.1.0
```

安装、启用，并按插件管理器提示重启 DSH。请安装到桌面端实际使用的 profile；安装到 `web` 不会改变 `desktop`。

1. 使用 DSH 原有操作归档会话。
2. 在原生会话菜单选择 **移入回收站**；或打开 **插件 → Archive Delete → 管理归档与回收站**。
3. 检查目标与关联子代理，确认执行。
4. 区分 **已移入、待重启、跳过、失败**。待处理记录仍在原存储位置，尚未释放磁盘空间。
5. 在 **回收站** 选择 **恢复** 或确认 **永久删除**；在 **已归档** 使用 **取消待处理** 撤销排队请求。

本地安装包与卸载方式见 [安装使用指南](docs/installation.zh-CN.md)。

## 开发

使用仓库声明的 Node 与 pnpm 版本。开发与集成测试仅使用临时 profile 和合成会话，不使用真实 DSH 历史。

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack
```

GitHub 安装包含生成的 `lib` 产物，用户无需运行依赖的 `prepare` 构建脚本。DSH 与 React 由宿主提供。

## 文档

所有用户和开发者文档都有英文与简体中文版本，两版在同一改动中同步更新。

- [研究与参考基线](docs/research.zh-CN.md)
- [架构与兼容边界](docs/architecture.zh-CN.md)
- [操作状态与崩溃恢复](docs/operations.zh-CN.md)
- [验收场景与验证证据](docs/acceptance.zh-CN.md)
- [参与贡献](CONTRIBUTING.zh-CN.md)
- [更新日志](CHANGELOG.zh-CN.md)
- [第三方声明](THIRD_PARTY_NOTICES.zh-CN.md)

本项目以 [DSH Archive Manager](https://github.com/MichengAI/dsh-archive-manager/tree/6b8babc7b7f8da44466c7bd611ad29e66408623c) 为研究参考。精确基线及保留、调整的设计见 [研究记录](docs/research.zh-CN.md)。
