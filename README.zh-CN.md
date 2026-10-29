# dsh-archive-delete

简体中文 · [English](README.md)

直接在 DSH 桌面端，把已归档会话移入可恢复的回收站。需要时恢复；只有确认后，才永久清除选中的回收站记录。

`@qwqbig/dsh-archive-delete` · [Apache-2.0](LICENSE) · **DSH Desktop `0.2.1-rc.3` · 官方 JSONL 存储**

支持 **macOS 和 Windows**，两平台的原生宿主集成与安装验证均已通过；尚未目视验证 Windows Desktop 图形界面。详见 [验收记录](docs/acceptance.zh-CN.md)。

## 功能

- **原生入口：** 已归档会话菜单，以及 **已归档／回收站** 管理弹窗。
- **范围清楚：** 先预览选中会话及专属子代理，再逐项查看结果、重试失败目标。
- **可以恢复：** 回到原工作区的已归档状态；工作区缺失时归入未分组，始终不覆盖已有路径。
- **允许等待：** 闲置但仍被 DSH 持有的会话，可等待下次启动复查后移动，也可以取消请求。
- **操作熟悉：** 宿主语言、主题与原生控件。

回收站不会自动过期，卸载插件也会保留回收站。

## 三步安装使用

在 DSH 桌面端使用 **插件 → 添加插件**，输入固定版本的 Release 安装包地址：

```text
https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.1.2/qwqbig-dsh-archive-delete-0.1.2.tgz
```

1. **安装：** 输入上方地址并启用插件。需要重启时，请完全退出 DSH 再打开：macOS 使用 **⌘Q／退出**，Windows 使用应用的 **退出** 命令；仅关闭窗口可能仍保留进程。
2. **选择：** 使用 DSH 归档会话，再从原生菜单选择 **移入回收站**。批量处理时，打开插件详情中的 **管理归档与回收站**。
3. **核对：** 检查目标和子代理后确认；在 **回收站** 恢复所选会话组，或核对后 **永久清除**。

**待重启处理** 表示日志仍在原位置，尚未释放空间，可以在“已归档”选择 **取消待处理**。每页／每批最多 100 个目标，全选只作用于当前页；换页或切换页签会清空选择。

Release 安装包包含声明的可安装文件和预编译宿主／浏览器产物，不包含源码、测试、锁文件或 CI 配置，并提供对应的 [SHA-256 校验文件](https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.1.2/qwqbig-dsh-archive-delete-0.1.2.tgz.sha256)。用户无需 Git 或源码构建。

插件管理器会在当前 profile 安装包并注册 bundle。CLI 适用于受管理或无人值守的环境，需要核对注册状态。固定 URL 升级时，重新添加新版本的 Release 地址；`pnpm update` 不会跟踪新的 Release 资产。[安装使用指南](docs/installation.zh-CN.md) 包含升级、CLI 卸载后的 bundle 清理、profile 范围、完整重启及排错。

## 磁盘上的处理范围

插件移动选中母会话及明确专属的子代理日志目录，更新相应原生 DSH 登记；独立 fork 保持原位。活动工作、关联不明、路径不安全或其他进程持有写锁时，会阻止操作。

共享附件、spill、项目文件和其他插件缓存保持原样。**永久清除无法撤销：**它移除选中的回收站日志及恢复元数据，不承诺擦除所有本地或远端副本。

超出支持目标时，版本及能力门禁会禁用数据操作。版本不匹配会在启动时报告所需版本、当前版本和升级指引，管理弹窗中也能看到相同说明。实际验证与限制见 [验收记录](docs/acceptance.zh-CN.md)。

## 开发

使用 **Node 24 或更新版本**及仓库固定的 pnpm 版本。五项 peer 依赖由宿主提供，在包管理元数据中标为可选，启动时仍会检查宿主能力。测试仅使用临时 profile 与合成会话。

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack
```

GitHub 安装包含生成的 `lib` 产物，无需运行依赖的 `prepare` 构建；DSH 和 React 由宿主提供。

## 文档

- [架构](docs/architecture.zh-CN.md)
- [操作状态与恢复](docs/operations.zh-CN.md)
- [验收证据](docs/acceptance.zh-CN.md)
- [参与贡献](CONTRIBUTING.zh-CN.md) · [更新日志](CHANGELOG.zh-CN.md)
