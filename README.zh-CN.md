# dsh-archive-delete

简体中文 · [English](README.md)

在 DeepSeek Harness 中管理归档会话、回收站和存储用量。

`@qwqbig/dsh-archive-delete` · **v0.0.2** · macOS / Windows · DSH Desktop **0.2.1-rc.3 / 0.2.1-rc.5**、JSONL 存储 · [Apache-2.0](LICENSE)

## 安装

打开 DSH 桌面端的 **插件 → 添加插件**，粘贴：

```text
https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.0.2/qwqbig-dsh-archive-delete-0.0.2.tgz
```

安装包已包含编译产物，可直接安装。[安装指南](docs/installation.zh-CN.md)

## 功能

- 将归档会话和专属子代理移入回收站，闲置会话可立即处理。
- 恢复到原工作区，或确认后永久清除所选回收站记录。
- 批量选择、按大小排序、逐项结果与重试。
- 查看 DSH 和所选工作区的存储分类、文件类型、大文件与目录大小。
- 在插件内检查 GitHub 更新并确认升级。

## 使用

1. 在 DSH 中归档会话，从菜单选择 **移入回收站**。批量处理可打开插件详情中的 **管理归档、回收站与存储**。
2. 核对目标后确认。**回收站** 提供恢复和永久清除操作；记录一直保留到你主动清除，卸载插件也会保留。
3. 打开 **存储概览**，开始 DSH 或工作区扫描。分类和文件类型展示测得的大小；同范围重新扫描时，上次结果会保留到新结果返回。

待处理记录留在 **已归档**，可选择 **取消等待并重新核对** 再次尝试。永久清除会移除选中的回收站日志和恢复记录，无法撤销。

## 更新

版本栏每天检查 GitHub。选择 **查看并升级**，再 **确认升级**；提示重启时，完整退出 DSH 后重新打开，加载已安装版本。手动升级可在同一插件管理器中添加新版 Release URL。

## 开发

使用 Node 24+ 和仓库固定的 pnpm 版本：

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack --pack-destination artifacts
node scripts/release-artifacts.mjs artifacts
node --import tsx scripts/check-update-package.mjs artifacts
```

[参与贡献](CONTRIBUTING.zh-CN.md) · [架构](docs/architecture.zh-CN.md) · [操作恢复](docs/operations.zh-CN.md) · [验证记录](docs/acceptance.zh-CN.md) · [更新日志](CHANGELOG.zh-CN.md)
