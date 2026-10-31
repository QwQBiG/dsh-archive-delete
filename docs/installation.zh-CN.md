# 安装使用

简体中文 · [English](installation.md)

## 在 DSH 桌面端安装

需要官方 DSH Desktop **0.2.1-rc.3 / 0.2.1-rc.5**、JSONL 存储，以及 macOS 或 Windows。

打开 **插件 → 添加插件**，输入以下 URL 并启用：

```text
https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.0.2/qwqbig-dsh-archive-delete-0.0.2.tgz
```

Release 包已包含编译文件。提示重启时，macOS 使用 **⌘Q／退出**，Windows 使用 **退出**，驻留托盘时也从托盘菜单退出，再重新打开。

安装作用于所选 profile：Desktop 通常为 `desktop`，Web 通常为 `web`。数据路径来自该宿主的 `DSH_HOME`。

## 管理会话

打开插件详情中的 **管理归档、回收站与存储**，或已归档会话菜单中的 **移入回收站**。

| 界面 | 操作 |
| --- | --- |
| 已归档 | 选择会话，预览完整组并确认移入回收站 |
| 待重启处理 | 取消等待并重新核对新移动，或取消请求 |
| 回收站 | 恢复所选组，或确认永久清除 |
| 存储概览 | 扫描 DSH 或所选工作区 |

每批最多 100 个目标，全选作用于当前页；换页、切换页签或排序会清空选择。支持默认顺序和按大小降序。

闲置的宿主受管会话可立即移动。运行任务、待处理输入及外部写入器会使会话组保持待处理或阻止状态，结果会显示原因。**取消等待并重新核对** 会结束旧队列并打开新确认。

恢复后，会话回到原工作区的已归档状态；原工作区缺失时归入未分组。损坏记录在健康列表旁单独显示诊断。

永久清除移除所选回收站日志、专属子代理日志和恢复记录，无法撤销。共享附件、spill 和项目文件保留在各自位置。回收站不会自动过期。

## 存储概览

选择 **扫描 DSH 存储**，或选择一个已登记工作区后 **扫描所选工作区**。点击扫描按钮开始读取。**刷新工作区列表** 更新可选项，**取消扫描** 结束当前扫描。

紧凑的分类列表展示已测得的存储用量，详情提供大文件、顶层目录和扫描说明。文件类型根据目录名和扩展名归类：依赖、构建目录、版本控制数据、日志、媒体、压缩包、代码／配置、文档和其他文件；大文件显示对应的类型标签。

DSH 扫描使用宿主配置的位置，并排除已登记的项目目录；工作区扫描读取该工作区的项目目录。同范围重新扫描时，上次结果及时间继续显示；取消或失败后保留并标为旧结果，切换范围时清空。

大小为逻辑文件字节。主合计将已核实的重复路径和硬链接计一次，分类之间可能重叠。每次扫描最多 50,000 个条目、32 层目录和约 5 秒工作；达到上限或遇到访问问题时，显示部分结果和跳过项。文件类型描述文件布局，具体用途可结合文件判断。存储查看保持只读。

## 更新

从 **v0.0.1** 升级时，在 **插件 → 添加插件** 中输入本页顶部的 v0.0.2 URL，管理器会替换现有安装。后续升级使用版本栏。

版本栏提供 **检查更新**、**查看并升级** 和 **详情**。GitHub 每天检查一次，手动检查至少间隔一分钟；失败后至少一小时再试，并遵守 GitHub 更长的限流等待。

选择 **查看并升级**，阅读说明后 **确认升级**。插件校验安装包，再交给当前 profile 的 DSH 管理器替换。正在运行与已安装版本不同时，完整退出并重新打开 DSH。

结果不明确时使用 **核对安装状态** 或 **重新核对此次请求**。同请求读取当前安装状态，已记录的安装不会重复执行；仍未明确时，完整退出并重新打开 DSH 后再尝试。

已校验安装包保留在 `<DSH_HOME>/archive-delete/updates/packages/`，所以 profile 依赖可能使用 `file:` 来源。这些文件与 profile 一起保留，供重装使用。网络访问取决于启动时的运行环境，代理也在该环境配置。

手动升级可在同一 profile 的 **添加插件** 中输入新版 Release URL，包名相同，管理器会替换依赖。`pnpm update` 不会发现新的 Release URL。

## CLI 安装与 bundle 登记

日常安装使用 Desktop 界面。通过 CLI 管理 Desktop profile 时，先退出 DSH：

```sh
dsh plugin --profile desktop add https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.0.2/qwqbig-dsh-archive-delete-0.0.2.tgz
```

检查 `<DSH_HOME>/profiles/desktop/package.json`，`dsh.profile.bundles` 中应包含一次包名。CLI 仅安装依赖时，补上该条目并保留其他字段：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@qwqbig/dsh-archive-delete"]
    }
  }
}
```

启动 DSH 并打开管理弹窗。独立 CLI 若拒绝保留的 `desktop` profile，可改用 Desktop 管理器。

## 加载与 Doctor

插件组件应处于运行状态，管理弹窗应能响应。成功启动也会记录：

```text
[archive-delete] v0.0.2 loaded · target DSH 0.2.1-rc.3 / 0.2.1-rc.5 (host 0.2.1-rc.5) · trash "/absolute/path/to/dsh-home/archive-delete/trash"
```

Doctor 检查 profile 登记、包文件、宿主版本及存储访问。使用 Node 24+，替换为实际 home/profile/runtime：

```sh
ELECTRON_RUN_AS_NODE=1 \
  "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" --expose-internals \
  "$HOME/.dsh/profiles/desktop/node_modules/@qwqbig/dsh-archive-delete/lib/doctor.js" \
  --home "$HOME/.dsh" --profile desktop \
  --runtime "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh"
```

```powershell
& 'C:\path\to\node.exe' `
  "$HOME\.dsh\profiles\desktop\node_modules\@qwqbig\dsh-archive-delete\lib\doctor.js" `
  --home "$HOME\.dsh" --profile desktop `
  --runtime 'C:\path\to\dsh-runtime'
```

能从 profile 解析时可省略 `--runtime`。`--json` 输出结构化结果，`--lang en` 或 `--lang zh` 选择报告语言。Doctor 是离线只读检查，运行实例可通过本次加载日志和弹窗验证。

## 卸载

使用插件管理器的卸载操作。CLI 卸载时，先退出 DSH，再执行：

```sh
dsh plugin --profile desktop remove @qwqbig/dsh-archive-delete
```

相同 profile 的 `dsh.profile.bundles` 若仍有本包，移除该条目后重新打开 DSH。`<DSH_HOME>/archive-delete/` 会保留回收站、恢复记录和更新安装包，供以后重装使用。

## 下载校验

下载包旁保留配套的 [SHA-256 文件](https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.0.2/qwqbig-dsh-archive-delete-0.0.2.tgz.sha256)：

```sh
shasum -a 256 -c qwqbig-dsh-archive-delete-0.0.2.tgz.sha256
```

```powershell
Get-FileHash .\qwqbig-dsh-archive-delete-0.0.2.tgz -Algorithm SHA256
Get-Content .\qwqbig-dsh-archive-delete-0.0.2.tgz.sha256
```

## 排错

| 现象 | 处理 |
| --- | --- |
| 已安装包但没有管理按钮 | 检查当前 profile、bundle 条目和启动日志 |
| `skipping profile bundle … cannot resolve` | 重装依赖，或在卸载后移除残留 bundle 条目 |
| 宿主不受支持 | 使用 Desktop `0.2.1-rc.3` / `0.2.1-rc.5` 和 JSONL 存储；弹窗显示检测到的版本 |
| `ERR_PNPM_IGNORED_BUILDS` | 核对请求脚本的具体包；本 Release 包已预编译 |
| `duplicated mapping key` | 修复 profile 的 `pnpm-workspace.yaml` 中重复／无效的 `allowBuilds` 键，含 `:` 的键加引号 |
| 内部 Node 包装器报 `exec: : not found` | 使用 Desktop 管理器，开发／Doctor 使用真实 Node 24+ 可执行文件 |
| GitHub 检查失败或限流 | 检查运行时的网络／代理环境，按显示的等待时间再试 |
| 安装包校验失败 | 重新检查并核对当前发行版 |
| 已安装和正在运行版本不同 | 完整退出并重新打开 DSH |
| 损坏记录提示或转换失败 | 保留诊断，参照 [操作恢复](operations.zh-CN.md) |

[开发](../CONTRIBUTING.zh-CN.md) · [验证记录](acceptance.zh-CN.md)
