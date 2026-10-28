# 安装使用指南

简体中文 · [English](installation.md)

将已归档会话移入回收站、恢复，或确认后永久清除所选回收站内容，全部使用 DSH 现有桌面界面。

## 支持环境

**官方 DSH Desktop `0.2.1-rc.3` 与官方 JSONL 存储。** macOS 已支持，`0.2.0` 的 Windows 验证进行中。回收站与会话必须位于同一磁盘卷；Windows 存储必须使用规范的本地驱动器绝对路径；不支持 UNC／网络路径、设备命名空间路径、目录 junction 及会解析为其他路径的短名称别名，仅大小写不同的别名可以使用。宿主能力不满足时，运行检查会禁用操作。

## 三步使用

`v0.2.0` 发布后，从 GitHub 安装：

```text
github:QwQBiG/dsh-archive-delete#v0.2.0
```

1. **添加并启用。** 在 Desktop 的 **插件 → 添加插件** 粘贴地址，按 DSH 提示重启。使用实际 Desktop profile；装到 `web` 不会改变 `desktop`。
2. **选择已归档会话。** 先用 DSH 原有功能归档；从会话菜单选择 **移入回收站**，或打开插件详情 → **管理归档与回收站** 批量处理。
3. **核对并确认。** 检查目标和专属子代理后确认。结果区分 **已移入回收站、待重启处理、已跳过、失败**；解决原因后单独重试失败目标。

每页、每批最多 100 个目标。**全选** 只作用于当前页；换页或切换页签会清空选择，不会把隐藏选择带入另一项操作。

## 两个页签的操作

| 页签／状态 | 操作 | 结果 |
| --- | --- | --- |
| 已归档 | 将所选移入回收站 | 日志与专属子代理一起移动，独立 fork 保留 |
| 待重启处理 | 取消待处理，或继续等待 | 原日志保留，直到启动复查允许移动 |
| 回收站 | 恢复所选 | 回到原工作区的已归档状态；工作区缺失时为未分组，不覆盖已有路径 |
| 回收站 | 永久清除 | 重新核对确认，仅移除选中的回收站日志和恢复元数据 |

待处理不会释放磁盘空间；内容变化、取消归档、重新活动或不安全的目标，不能使用旧确认移动。回收站不会自动过期。

共享附件、spill、项目文件、其他插件缓存及远端副本均不在永久清理范围内。确认框会说明范围；永久清理无法撤销。

## 可选命令行方式：核对 bundle 登记

优先使用 **插件 → 添加插件**，DSH 插件管理器会安装包并注册 bundle。支持 Desktop profile 的 DSH 命令行工具可使用：

```sh
dsh plugin --profile desktop add github:QwQBiG/dsh-archive-delete#v0.2.0
```

包管理器成功退出本身不代表已启用。CLI 构建及调用模式可能不同：经过管理器的路径可自动登记 bundle，仅安装依赖的路径则可能遗漏。若独立 CLI 拒绝保留的 `desktop` profile，请使用 Desktop 插件管理器，不要换到其他 profile。检查实际 profile 清单；需要修改时先退出 Desktop：

1. 打开 `<DSH_HOME>/profiles/desktop/package.json`。默认 home 下，macOS 为 `~/.dsh/profiles/desktop/package.json`，Windows 为 `$HOME\.dsh\profiles\desktop\package.json`；如果更改过 `DSH_HOME`，使用应用实际的 home。
2. 确认现有 `dsh.profile.bundles` 数组包含 `@qwqbig/dsh-archive-delete`；缺失时添加一次。保留所有已有 bundle 和其他字段；以下片段只说明要添加的条目，不可用来替换整个文件。
3. 保存为有效 JSON，启动 Desktop，检查插件组件状态及管理按钮。

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@qwqbig/dsh-archive-delete"]
    }
  }
}
```

只安装依赖而不添加此条目时，文件虽已在磁盘上，`cordis.patch.yml` 仍不会加载。不要通过增加安装钩子或批准构建脚本来解决注册缺失。宿主与浏览器产物均已包含，GitHub 安装无需构建／prepare 脚本。

## 检查插件是否加载

检查插件组件正在运行，详情中包含 **管理归档与回收站**，点击后管理弹窗能够响应。在受支持环境中成功启动后，`<DSH_HOME>/archive-delete/` 下会有 `trash`、`staging`、`receipts` 和 `operations` 四个目录。

macOS 使用默认 home 时：

```sh
ls ~/.dsh/archive-delete
```

Windows PowerShell 使用默认 home 时：

```powershell
Get-ChildItem "$HOME\.dsh\archive-delete"
```

自定义 home 时请使用实际 `DSH_HOME`。先前运行或卸载后可能残留目录，因此目录存在本身不能证明当前插件正在运行。

## 安装排错

- **包已安装，却没有管理按钮：**检查当前 profile、上面的 bundle 注册步骤及 DSH 组件诊断；`node_modules` 中有包不代表已启用。
- **宿主不受支持：**启动诊断与管理弹窗会说明所需和当前 DSH 版本。将 Desktop 更新至 `0.2.1-rc.3` 后重启插件。包中的 `engines.dsh` 仅用于描述，pnpm 安装时不会强制检查该字段。
- **Peer 依赖：**Cordis、app boot、home paths、原生系统绑定及 React 均由 DSH 提供，在包管理元数据中标为可选；不要为了消除警告在 profile 中再装一套。运行时缺少能力仍会禁用操作。
- **安装前出现 YAML 重复键错误：**检查 `<DSH_HOME>/profiles/desktop/pnpm-workspace.yaml`。损坏的 `allowBuilds` 映射会阻止任何插件安装。先备份，再修正重复或格式错误的键，含 `:` 的键应加引号；不要重复追加 allow-build 条目，也无需为本包启用构建脚本。
- **Node 包装脚本提示 `exec: : not found`：**内部 Desktop 包装脚本可能依赖应用启动环境中的 `DSH_DESKTOP_NODE_EXECUTABLE`。请使用已安装的 `dsh` 命令或插件管理器；开发时使用真实 Node 24+ 可执行文件，见 [参与贡献](../CONTRIBUTING.zh-CN.md)。

## 开发用本地安装包

使用 Node 24 或更新版本，以及只含合成会话的临时 home/profile。构建打包后，将生成的 `.tgz` 绝对路径安装到该隔离 profile：

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack
```

已安装 DSH 命令行工具时，创建全新测试 home，安装到它的隔离 `web` profile。在 POSIX shell 中：

```sh
DSH_ARCHIVE_DELETE_TEST_HOME="$(mktemp -d)"
DSH_HOME="$DSH_ARCHIVE_DELETE_TEST_HOME" dsh plugin --profile web add "$PWD/qwqbig-dsh-archive-delete-0.2.0.tgz"
```

按上文核对隔离 profile 的 bundle 登记及启用情况。也可通过该隔离宿主的插件管理器安装本地包。Windows 开发者可使用 [参与贡献](../CONTRIBUTING.zh-CN.md) 中的自动隔离安装／重装／卸载检查。手动启动该宿主时请保留测试 home 路径；这不会安装到当前 Desktop profile。打包产物可避免开发依赖进入宿主运行时，主历史不能作为测试材料。

## 更新或卸载

使用 DSH 插件管理器，按其提示重启。卸载保留回收站与待处理／恢复记录；重新安装受支持版本后可检查。备份时将这些记录与回收站一起保留。

失败时保留反馈状态，只重试相应目标。报告问题时提供宿主／插件版本及脱敏合成复现。预期状态见 [操作恢复](operations.zh-CN.md)。
