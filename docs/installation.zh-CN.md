# 安装使用指南

简体中文 · [English](installation.md)

将已归档会话移入回收站、恢复，或确认后永久清除所选回收站内容，全部使用 DSH 现有桌面界面。

## 支持环境

**官方 DSH Desktop `0.2.1-rc.3` 与官方 JSONL 存储。** 支持 macOS 和 Windows，实际验证及图形界面限制见 [验收记录](acceptance.zh-CN.md)。回收站与会话必须位于同一磁盘卷。Windows 存储要求规范的本地驱动器绝对路径；不支持 UNC／网络路径、设备命名空间路径、目录 junction 及解析为其他路径的短名称别名，仅大小写不同的别名可以使用。所需宿主能力不满足时，运行检查会禁用操作。

## 推荐：在桌面界面安装

打开 **插件 → 添加插件**，粘贴固定版本的 Release 安装包地址：

```text
https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.1.2/qwqbig-dsh-archive-delete-0.1.2.tgz
```

1. **添加并启用。** 原生管理器会在当前 profile 安装依赖并注册 bundle；提示重启时，完全退出 DSH 再打开。
2. **选择已归档会话。** 先用 DSH 原有功能归档。从会话菜单选择 **移入回收站**，或打开插件详情 → **管理归档与回收站** 批量处理。
3. **核对并确认。** 检查目标和专属子代理后确认。结果区分 **已移入回收站、待重启处理、已跳过、失败**；解决所示原因后再重试相应失败目标。

Release `.tgz` 资产仅包含包声明的可安装文件及预编译 `lib/` 产物。`codeload` 仓库归档还包含源码、测试、锁文件和 CI 配置，不是推荐安装包。安装无需源码构建、依赖 `prepare` 或安装钩子。这些版本暂不发布到 npm。

下载后，请保留配套的 [SHA-256 校验文件](https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.1.2/qwqbig-dsh-archive-delete-0.1.2.tgz.sha256)。两个文件位于同一目录时，macOS 可运行：

```sh
shasum -a 256 -c qwqbig-dsh-archive-delete-0.1.2.tgz.sha256
```

Windows PowerShell 中，将输出的哈希与校验文件比较：

```powershell
Get-FileHash .\qwqbig-dsh-archive-delete-0.1.2.tgz -Algorithm SHA256
Get-Content .\qwqbig-dsh-archive-delete-0.1.2.tgz.sha256
```

固定版本 URL 标识所选发行版，校验文件用于核对下载内容；不同版本不承诺固定字节大小。

## Profile 范围与完整重启

bundle 仅在登记它的 profile 中启用。Desktop 通常使用 `desktop`，`dsh web` 通常使用 `web`；安装到其中一个不会启用另一个。请使用宿主实际选中的 profile，自定义 home 时使用实际 `DSH_HOME`。数据路径来自运行中的宿主，profile 名称不代表独立的回收站。

关闭窗口不一定等于退出 DSH。macOS 使用 **⌘Q** 或应用菜单中的 **退出**；Windows 使用 DSH 的 **退出** 命令，如果应用仍驻留托盘，也需从托盘菜单退出。确认应用进程结束后再打开。安装、升级、卸载后若 DSH 要求重启，应按此方式完整退出。

## 两个页签的操作

| 页签／状态 | 操作 | 结果 |
| --- | --- | --- |
| 已归档 | 将所选移入回收站 | 日志与专属子代理一起移动，独立 fork 保留 |
| 待重启处理 | 取消待处理，或继续等待 | 原日志保留，直到启动复查允许移动 |
| 回收站 | 恢复所选 | 回到原工作区的已归档状态；工作区缺失时为未分组，不覆盖已有路径 |
| 回收站 | 永久清除 | 重新核对确认，仅移除选中的回收站日志和恢复元数据 |

每页／每批最多 100 个目标。**全选** 只作用于当前页，换页或切换页签会清空选择。待处理不会释放空间；内容变化、取消归档、重新活动或路径不安全时，需要重新核对。回收站不会自动过期。

共享附件、spill、项目文件、其他插件缓存及远端副本均不在永久清理范围内。确认框会说明范围，永久清理无法撤销。

## CLI 备选：核对 bundle 登记

CLI 适用于能自行核对 profile 并重启宿主的受管理或无人值守环境。普通桌面安装使用上方原生界面；两条路径在注册及包管理器环境处理上可能不同。从独立 CLI 修改 Desktop profile 前，请先完全退出 Desktop。

支持 Desktop profile 的 DSH CLI 可使用：

```sh
dsh plugin --profile desktop add https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.1.2/qwqbig-dsh-archive-delete-0.1.2.tgz
```

包管理器成功退出本身不代表已启用。经过管理器的 CLI 可自动注册 bundle，仅安装依赖的路径则可能遗漏。若独立 CLI 拒绝保留的 `desktop` profile，请使用 Desktop 管理器，不要改选其他 profile。

1. 打开 `<DSH_HOME>/profiles/desktop/package.json`。默认 macOS 路径为 `~/.dsh/profiles/desktop/package.json`，Windows 为 `$HOME\.dsh\profiles\desktop\package.json`；请替换成实际 home/profile。
2. 确认 `dsh.profile.bundles` 包含 `@qwqbig/dsh-archive-delete`，缺失时添加一次，保留所有其他条目和字段。以下片段只展示这个条目，不是替换文件：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@qwqbig/dsh-archive-delete"]
    }
  }
}
```

3. 保存为有效 JSON，启动 DSH，检查组件及管理弹窗。仅在 `node_modules` 中存在包不会加载 `cordis.patch.yml`，批准构建脚本也不能修复缺失的 bundle 注册。

## 检查插件是否加载

实际启动目标宿主，核对插件组件正在运行、详情中有 **管理归档与回收站**，且弹窗可以响应。成功完成恢复和鉴权 API 注册后，本次启动会输出类似日志：

```text
[archive-delete] v0.1.2 loaded · target DSH 0.2.1-rc.3 (host 0.2.1-rc.3) · trash "/absolute/path/to/dsh-home/archive-delete/trash"
```

应查看当前进程的新日志，并核对其中版本和路径；禁用或启动失败时不会输出此行。`--dump-config` 等配置导出可能在存在无法解析的 bundle 时仍成功，不能证明已启动或已启用。

受支持环境成功启动后，`<DSH_HOME>/archive-delete/` 下会有 `trash`、`staging`、`receipts` 和 `operations`。默认 macOS home 可运行：

```sh
ls ~/.dsh/archive-delete
```

默认 Windows home 的 PowerShell 命令为：

```powershell
Get-ChildItem "$HOME\.dsh\archive-delete"
```

自定义 home 时使用实际 `DSH_HOME`。先前运行和卸载后可能残留目录，因此目录存在本身不是当前已启用的证据。

## 只读 Doctor 自检

安装包包含 `lib/doctor.js` 和 `dsh-archive-delete-doctor` 可执行入口。Doctor 检查所选 profile 的依赖和 bundle 条目、已安装产物、解析出的宿主版本、四目录存储布局及回收站写入权限。它不编辑 profile、不创建目录、不修复存储、不获取会话锁，也不操作会话。离线报告通过不代表某个宿主进程已加载插件。

请使用 **真实 Node 24+ 可执行文件**。默认 macOS Desktop 安装可使用既有的内置 Node 和运行时：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" \
  "$HOME/.dsh/profiles/desktop/node_modules/@qwqbig/dsh-archive-delete/lib/doctor.js" \
  --home "$HOME/.dsh" --profile desktop \
  --runtime "/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh"
```

Windows PowerShell 请替换为既有 Node 24+ 可执行文件和运行时目录：

```powershell
& 'C:\path\to\node.exe' `
  "$HOME\.dsh\profiles\desktop\node_modules\@qwqbig\dsh-archive-delete\lib\doctor.js" `
  --home "$HOME\.dsh" --profile desktop `
  --runtime 'C:\path\to\dsh-runtime'
```

自定义 home/profile 时请替换为实际值。能通过 profile 解析宿主时，`--runtime` 可省略。未提供该参数且无法解析宿主时，Doctor 报告警告而不猜测；显式提供的运行时无效时，检查失败。`--json` 输出结构化结果，`--lang en`／`--lang zh` 选择报告语言，`--help` 列出支持的选项。数据目录缺失可能表示插件尚未启动，会作为警告报告；当前启用状态仍需核对上方的新加载日志及可响应的管理弹窗。Doctor 不会下载另一个运行时。

## 固定 URL 的升级方式

Release URL 和固定 Git tag 都会固定安装版本。`pnpm update` 不会发现在其他 URL 上发布的新资产；内容可变化的 `main` 归档 URL 也不是版本跟踪机制。选择已发布的新版本，在同一 profile 的插件管理器中添加它的 **新固定版本资产 URL**。包名仍为 `@qwqbig/dsh-archive-delete`，添加新来源会替换既有依赖规格，无需先卸载。

CLI 管理的环境使用上面的 `add` 命令，将 URL 路径及文件名中的版本都换成新版，核对已安装版本和 bundle 登记，再完全重启。保留回收站和恢复记录；不要覆盖某个版本的资产或移动已发布 tag 来模拟升级。本项目继续通过 GitHub Release 分发安装包，暂不发布 npm。

## 卸载并清理残留 bundle

优先使用插件管理器的卸载操作，按提示完整重启，再核对当前 profile 不再选择此 bundle。不同宿主构建／调用模式对 bundle 清理的处理可能不同。

仅安装依赖的 CLI 场景，先完全退出 Desktop，再移除依赖：

```sh
dsh plugin --profile desktop remove @qwqbig/dsh-archive-delete
```

打开相同 profile 的 `package.json`，若 `dsh.profile.bundles` 中仍有 `@qwqbig/dsh-archive-delete`，**只移除这个条目**，保留其他 bundle 和字段；保存为有效 JSON 后重新打开 DSH。移除依赖却未清理此条目，可能反复出现 `skipping profile bundle … cannot resolve` 启动诊断。不要通过包生命周期钩子自动修改正在使用的 profile。

卸载保留 `<DSH_HOME>/archive-delete/`，其中包括回收站及待处理／恢复记录。重新安装受支持版本后可检查。备份时将这些记录与回收站一起保留，不要在移除依赖时删除它们。

## 安装排错

| 现象 | 可能的边界 | 核对与处理 |
| --- | --- | --- |
| `ERR_PNPM_IGNORED_BUILDS` | 某个包的生命周期脚本被阻止 | 先从日志确认具体包名。本插件 Release 包无需安装构建，统一批准脚本不是本插件的修复方式；先核对相应包是否确需其脚本，再单独决定是否允许。 |
| `duplicated mapping key` | profile 的 `pnpm-workspace.yaml` 无效 | 先备份，再修复重复或格式错误的 `allowBuilds` 键，含 `:` 的键应加引号；保留无关策略，不要反复追加条目或整体删除策略来绕过。 |
| `skipping profile bundle … cannot resolve` | 已选择 bundle，但依赖缺失或无法解析 | 在该 profile 重新安装需要的依赖，或卸载后只删除残留 bundle 条目；随后实际启动 DSH。 |
| 包已存在，却没有管理按钮 | profile 不对、注册缺失或启动失败 | 检查真实 profile、bundle 数组、启动诊断和组件状态；配置导出或包目录存在本身不足以证明启用。 |
| 宿主／版本不受支持 | 运行时门禁拒绝 | 核对诊断与管理弹窗中的所需／当前版本，使用 Desktop `0.2.1-rc.3` 及受支持存储和能力；`engines.dsh` 是描述字段，不是 pnpm 安装门禁。 |
| 旧安装出现 peer 缺失警告 | 包元数据较旧或缺少运行时能力 | 当前宿主 peer 已标为可选；核对已安装插件版本及运行时诊断，不要在 profile 中额外安装另一套 Cordis／React／原生绑定。 |
| 内部 Node 包装脚本报 `exec: : not found` | 缺少 Desktop 启动环境 | 使用已安装的 DSH 命令或原生管理器；开发／诊断需要真实 Node 24+ 可执行文件，见 [参与贡献](../CONTRIBUTING.zh-CN.md)。 |

失败时保留所示状态，只重试相应目标。报告问题时提供宿主／插件版本和脱敏合成复现，预期操作状态见 [恢复规则](operations.zh-CN.md)。

## 开发用本地安装包

使用 Node 24 或更新版本，以及只含合成会话的临时 home/profile。构建打包后，将生成的 `.tgz` 绝对路径安装到该隔离 profile：

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack
```

已安装 DSH CLI 时，创建全新测试 home，安装到其隔离 `web` profile。在 POSIX shell 中：

```sh
DSH_ARCHIVE_DELETE_TEST_HOME="$(mktemp -d)"
DSH_HOME="$DSH_ARCHIVE_DELETE_TEST_HOME" dsh plugin --profile web add "$PWD/qwqbig-dsh-archive-delete-0.1.2.tgz"
```

按上文核对隔离 profile 的注册和启用。Windows 使用 [参与贡献](../CONTRIBUTING.zh-CN.md) 中的自动隔离包生命周期检查；手动启动该宿主时保留临时 home 路径。打包产物可避免开发依赖进入运行时，主历史不能作为测试材料。
