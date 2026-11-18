# 安装使用

简体中文 · [English](installation.md)

## 在 DSH 桌面端安装

适用于 macOS 和 Windows 上的官方 DSH Desktop **0.2.1-rc.3 / 0.2.1-rc.5**，会话存储需使用 JSONL。

打开 **插件 → 添加插件**，输入以下 URL 并启用：

```text
https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.0.5/qwqbig-dsh-archive-delete-0.0.5.tgz
```

Release 安装包可直接使用。提示重启时，请完全退出 DSH 再重新打开：macOS 使用 **⌘Q／退出**，Windows 使用 **退出**。如果 DSH 仍驻留在 Windows 托盘，也要从托盘菜单退出。

请安装到你实际使用的 profile。Desktop 通常使用 `desktop`，Web 通常使用 `web`，各自加载所安装的插件。插件数据存放在宿主的 `DSH_HOME` 下。

## 管理会话

打开插件详情中的 **管理归档、回收站与存储**，或已归档会话菜单中的 **移入回收站**。

页签和刷新入口在弹窗顶部，本次操作结果和需要留意的提示显示在列表上方。

| 界面 | 操作 |
| --- | --- |
| 已归档 | 选择会话，核对专属子代理后确认移入回收站 |
| 待重启处理 | 重新核对并尝试立即移动，或取消请求 |
| 回收站 | 恢复所选会话，或选择 **永久清除** 后单独确认 |
| 存储概览 | 扫描 DSH 或所选工作区 |

每次可选择最多 100 个目标。全选只覆盖当前页，换页、切换页签或排序后会清空选择。可以保留默认顺序，也可以按大小从大到小排列。

DSH 可以释放自己持有的闲置会话，无需重启就能移入回收站。遇到运行中的任务、待处理输入或其他进程占用时，会话组可能需要等待或暂时无法处理，具体原因会显示在结果中。要再次尝试，选择 **取消等待并重新核对**，即可取消旧请求并打开新的确认。

恢复的会话会回到原工作区，并保持已归档状态。原工作区已不存在时，归入未分组。遇到损坏记录时，展开提示即可查看原因。

回收站内容会保留到你主动清除。永久清除会删除所选会话日志、专属子代理日志和恢复记录，无法撤销。共享附件、spill 文件和项目文件仍保留在各自位置。

## 存储概览

选择 **扫描 DSH 存储**，或选定一个已登记的工作区，再点击 **扫描所选工作区**。点击按钮后才开始扫描。需要更新可选工作区时，点击 **刷新工作区列表**；要停止扫描，点击 **取消扫描**。

结果始终显示已测得的总量，扫描不完整时也会提示。展开分类，或工作区结果里的 **文件类型**、**大文件** 和 **一级目录**，即可查看具体的空间占用。扫描说明收在 **统计详情** 中。

DSH 扫描覆盖宿主配置的存储位置，并排除已登记的项目目录。要查看项目文件，请选择对应的工作区。同一位置再次扫描时，上次结果及时间会保留到新结果返回；取消或失败后，上次结果仍会显示，并标明是较早的记录。切换扫描范围时会清空旧结果。

大小按文件长度计算，总计会将已核实的重复路径和硬链接只计一次。分类之间可能重叠，因此不能直接相加。每次扫描最多覆盖 50,000 个条目、32 层目录和约 5 秒工作；达到上限或遇到访问问题时，会标明结果不完整并列出跳过项。存储查看只读取数据。文件类型说明布局和格式，实际用途仍需结合内容判断。

## 更新

如果你还在使用 **v0.0.1**，请在 **插件 → 添加插件** 中输入上方 v0.0.5 URL，管理器会替换现有安装。之后即可通过版本栏升级。

在管理弹窗底部或插件详情中，都可以通过版本栏 **检查更新**、**查看并升级** 或查看 **详情**。插件每天检查一次 GitHub，手动检查需至少间隔一分钟。检查失败后至少等一小时再试。如果 GitHub 要求等得更久，就按它给出的时间执行。

选择 **查看并升级**，阅读更新说明后点击 **确认升级**。插件会校验安装包，再交给当前 profile 的 DSH 管理器替换。已安装版本与正在运行的版本不同时，完全退出并重新打开 DSH，即可加载。

结果不明确时，选择 **核对安装状态** 或 **重新核对此次请求**，读取当前状态，不会重复执行已记录的安装。如果仍无法确认，请完全退出并重新打开 DSH 后再试。

已校验的更新安装包存放在 `<DSH_HOME>/archive-delete/updates/packages/`，因此升级后，profile 可能显示 `file:` 依赖。请将这些文件与 profile 一起保留，供重装使用。更新使用启动 DSH 时所在环境的网络和代理设置。

手动升级时，在同一 profile 的 **添加插件** 中输入新版 Release URL，管理器会按包名替换依赖。通过 URL 安装的版本，每次升级都需要使用新 URL；`pnpm update` 无法自动找到它。

## CLI 安装与 bundle 登记

日常使用建议通过桌面端插件管理器安装。通过 CLI 管理 Desktop profile 时，请先退出 DSH：

```sh
dsh plugin --profile desktop add https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.0.5/qwqbig-dsh-archive-delete-0.0.5.tgz
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

安装后，打开管理弹窗，并在插件详情中确认组件处于运行状态。成功启动时，日志还会出现：

```text
[archive-delete] v0.0.5 loaded · target DSH 0.2.1-rc.3 / 0.2.1-rc.5 (host 0.2.1-rc.5) · trash "/absolute/path/to/dsh-home/archive-delete/trash"
```

插件无法加载时，可以用 Doctor 检查 profile 登记、包文件、宿主版本和存储访问。使用 Node 24+，并将路径替换为实际的 home、profile 和 runtime：

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

Doctor 能通过 profile 找到运行时时，可省略 `--runtime`。使用 `--json` 输出结构化结果，`--lang en` 或 `--lang zh` 选择语言。Doctor 读取配置和访问权限；要确认当前实例是否已加载插件，请查看启动日志和管理弹窗。

## 卸载

使用插件管理器的卸载操作。CLI 卸载时，先退出 DSH，再执行：

```sh
dsh plugin --profile desktop remove @qwqbig/dsh-archive-delete
```

相同 profile 的 `dsh.profile.bundles` 若仍有本包，移除该条目后重新打开 DSH。`<DSH_HOME>/archive-delete/` 会保留回收站、恢复记录和更新安装包，供以后重装使用。

## 下载校验

需要校验下载包时，将配套的 [SHA-256 文件](https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.0.5/qwqbig-dsh-archive-delete-0.0.5.tgz.sha256) 保存在安装包旁边，再执行：

```sh
shasum -a 256 -c qwqbig-dsh-archive-delete-0.0.5.tgz.sha256
```

```powershell
Get-FileHash .\qwqbig-dsh-archive-delete-0.0.5.tgz -Algorithm SHA256
Get-Content .\qwqbig-dsh-archive-delete-0.0.5.tgz.sha256
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

## 诊断与删除历史

展开列表下方的 **说明与诊断**，可查看宿主的即时释放检查、保留说明和既往操作结果。点击 **刷新** 可以重新检查宿主。当前没有加载会话时，会话相关检查会显示为「尚未验证」。

在 **回收站** 中展开 **最近永久删除**，可以查看会话 ID、确认时间和大小。这里显示近 30 天内最多 200 条记录，归档操作不可用时仍可查看。保留与恢复细节见[操作流程](operations.zh-CN.md)。

Doctor 也可以直接列出完整原因码表，无需检查 profile：

```sh
node lib/doctor.js --codes --lang en
node lib/doctor.js --codes --lang zh --json
```

在构建后的源码仓库中使用 Node 24+ 运行以上命令。需要生成隔离宿主报告时，可按[贡献指南](../CONTRIBUTING.zh-CN.md)操作。

[开发](../CONTRIBUTING.zh-CN.md) · [验证记录](acceptance.zh-CN.md)
