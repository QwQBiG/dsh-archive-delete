# 安装使用指南

简体中文 · [English](installation.md)

将已归档会话移入回收站、恢复，或确认后永久清除所选回收站内容，全部使用 DSH 现有桌面界面。

## 支持环境

**官方 DSH Desktop `0.2.1-rc.3` 与官方 JSONL 存储。** 支持 macOS 和 Windows，实际验证及图形界面限制见 [验收记录](acceptance.zh-CN.md)。回收站与会话必须位于同一磁盘卷。Windows 存储要求规范的本地驱动器绝对路径；不支持 UNC／网络路径、设备命名空间路径、目录 junction 及解析为其他路径的短名称别名，仅大小写不同的别名可以使用。所需宿主能力不满足时，运行检查会禁用操作。

## 推荐：在桌面界面安装

打开 **插件 → 添加插件**，粘贴固定版本的 Release 安装包地址：

```text
https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.1.6/qwqbig-dsh-archive-delete-0.1.6.tgz
```

1. **添加并启用。** 原生管理器会在当前 profile 安装依赖并注册 bundle；提示重启时，完全退出 DSH 再打开。
2. **选择已归档会话。** 先用 DSH 原有功能归档。从会话菜单选择 **移入回收站**，或打开插件详情 → **管理归档、回收站与存储** 批量处理。
3. **核对并确认。** 检查目标和专属子代理后确认。结果区分 **已移入回收站、待重启处理、已跳过、失败**；解决所示原因后再重试相应失败目标。

Release `.tgz` 资产仅包含包声明的可安装文件及预编译 `lib/` 产物。`codeload` 仓库归档还包含源码、测试、锁文件和 CI 配置，不是推荐安装包。安装无需源码构建、依赖 `prepare` 或安装钩子。这些版本暂不发布到 npm。

下载后，请保留配套的 [SHA-256 校验文件](https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.1.6/qwqbig-dsh-archive-delete-0.1.6.tgz.sha256)。两个文件位于同一目录时，macOS 可运行：

```sh
shasum -a 256 -c qwqbig-dsh-archive-delete-0.1.6.tgz.sha256
```

Windows PowerShell 中，将输出的哈希与校验文件比较：

```powershell
Get-FileHash .\qwqbig-dsh-archive-delete-0.1.6.tgz -Algorithm SHA256
Get-Content .\qwqbig-dsh-archive-delete-0.1.6.tgz.sha256
```

固定版本 URL 标识所选发行版，校验文件用于核对下载内容；不同版本不承诺固定字节大小。

## Profile 范围与完整重启

bundle 仅在登记它的 profile 中启用。Desktop 通常使用 `desktop`，`dsh web` 通常使用 `web`；安装到其中一个不会启用另一个。请使用宿主实际选中的 profile，自定义 home 时使用实际 `DSH_HOME`。数据路径来自运行中的宿主，profile 名称不代表独立的回收站。

关闭窗口不一定等于退出 DSH。macOS 使用 **⌘Q** 或应用菜单中的 **退出**；Windows 使用 DSH 的 **退出** 命令，如果应用仍驻留托盘，也需从托盘菜单退出。确认应用进程结束后再打开。安装、升级、卸载后若 DSH 要求重启，应按此方式完整退出。

## 页签操作

| 页签／状态 | 操作 | 结果 |
| --- | --- | --- |
| 已归档 | 将所选移入回收站 | 日志与专属子代理一起移动，独立 fork 保留 |
| 待重启处理 | 取消等待并重新核对、取消请求，或继续等待 | 重新核对会结束旧排队；只有新的确认才尝试安全立即移动，否则原日志保留 |
| 回收站 | 恢复所选 | 回到原工作区的已归档状态；工作区缺失时为未分组，不覆盖已有路径 |
| 回收站 | 永久清除 | 重新核对确认后立即移除所选回收站日志和恢复元数据，无需重启宿主 |
| 存储概览 | 开始 DSH 或所选工作区扫描 | 读取文件元数据并展示大小，不删除文件 |

每页／每批最多 100 个目标。**全选** 只作用于当前页，换页、切换页签或排序会清空选择；已归档与回收站支持默认顺序或按大小降序排列。待处理不会释放空间；内容变化、取消归档、重新活动或路径不安全时，需要重新核对。回收站不会自动过期。

### 无需重启地移动与清除

确认移动时，先核对完整母会话／子代理组。已归档组完全闲置，且固定版本的宿主提供可明确识别的原生生命周期清理时，插件通过该生命周期完成清理并释放写入器，再重新核对归档状态、成员、内容、活动及写锁后移动日志。释放期间内容变化时，要求重新预览。运行中的工作、维护操作、待处理输入、外部写占用、归属不明或缺少释放能力时，不会强行关闭。

已有 **待重启处理** 记录可选择 **取消等待并重新核对**：结束旧排队请求并打开新移动预览，不会立即执行移动。再次确认后才尝试当前处理；如果关闭或取消预览，旧排队保持取消，源日志仍在。结果显示 **已移入回收站** 后，即可在同一应用进程内选择该条目并确认 **永久清除**。无法安全释放时，移动可以继续待处理，不强制抢锁。

安装或升级时的重启提示用于加载新版插件包，与永久清除已进入回收站的内容是两回事。

共享附件、spill、项目文件、其他插件缓存及远端副本均不在永久清理范围内。确认框会说明范围，永久清理无法撤销。

## 存储概览

打开插件详情 → **管理归档、回收站与存储** → **存储概览**，选择 **扫描 DSH 存储**，或从已登记列表中选择一个工作区后点击 **扫描所选工作区**。打开窗口、进入页签或更换工作区都不会开始扫描，也不会在后台扫描所有项目。**刷新工作区列表** 只更新已登记的可选项，不更新已测得的大小；需要更新数字时，应重新扫描。**取消扫描**、关闭弹窗或切换页签会停止当前扫描，较晚返回的结果不会重新显示。

### 位置与分类

**DSH 存储** 使用运行中宿主配置的位置：会话日志；本插件的回收站、操作暂存、操作记录和回执；附件及附件缓存；其他 DSH 缓存；设置存储；插件环境；spill；配置的搜索索引文件；以及 DSH 数据目录中的其他文件。配置的会话、附件、spill 或设置位置可能在该数据目录之外。已知子分类会从父分类排除，避免同一子目录重复统计。有效的已登记项目目录也会从 DSH 扫描排除，包括位于数据目录内的项目；只有单独选择工作区扫描才会读取它们。内存搜索索引没有可统计文件；缺少服务、位置未确定、无法访问和目录不存在，均与确认测得的空目录分开显示。

**工作区** 读取 DSH 当前为所选工作区登记的项目目录。浏览器只提交工作区 ID，不提交路径。磁盘根目录、用户目录及其祖先、重定向路径及受保护 DSH 存储内的项目会被拒绝；合规项目内部的已知宿主数据子目录会被排除。登记或路径在扫描中变化时，需重新选择并扫描。项目目录不存在时仅报告，不会重建。

### 数字的含义

主合计是 **逻辑文件字节**，跨分类将已核实的重复路径和硬链接计一次；它不是独占物理占用，也不承诺删除后能释放多少空间。每个分类在内部去重，重叠分类不能直接相加。顶层目录按文件路径累计，包含硬链接别名，可能与主合计不同。无法确认文件身份时，结果会说明去重可能不完整。

分类按已测得的大小降序排列，未测量分类放在末尾。展开后可以查看最多 20 个测得的大文件、最多 20 个顶层目录合计和扫描说明。工作区文件来源为 **未知**：扫描不识别 AI 产物、不判断文件是否有用，也不授权删除。概览不提供附件、缓存、spill、插件环境、回执或项目文件的删除控件；永久清除仍只通过现有回收站操作，处理确认的会话日志与恢复元数据。

扫描只读取文件系统元数据，不读文件内容，不运行 Git、程序或项目命令。每次请求最多 50,000 个条目、32 层目录和约 5 秒扫描工作；跳过链接／junction、重定向路径、其他卷、特殊文件及无法读取的条目。达到上限、期间发生变化或跳过不安全／无法读取的条目时，结果标为部分统计并显示观察时间。数字反映扫描时段，不是固定快照；文件变化后应重新扫描。取消扫描不会撤销另行确认的归档操作。若上一次扫描仍在结束，请稍候再扫描；工作区变化或登记缺失时，刷新工作区列表并重新选择；项目路径不安全时，应更换路径，不要反复重试。

回收站行及其预览测量当前仍存在的所属文件，不沿用移入时保存的大小；部分永久清除后，重新列出时会显示剩余大小。行大小不含恢复元数据和锁文件，因此可能不同于存储概览中的整个回收站分类。恢复／永久清除仍在持有原生写锁时复查已确认的指纹，容量展示不授权对已变化内容进行操作。

## CLI 备选：核对 bundle 登记

CLI 适用于能自行核对 profile 并重启宿主的受管理或无人值守环境。普通桌面安装使用上方原生界面；两条路径在注册及包管理器环境处理上可能不同。从独立 CLI 修改 Desktop profile 前，请先完全退出 Desktop。

支持 Desktop profile 的 DSH CLI 可使用：

```sh
dsh plugin --profile desktop add https://github.com/QwQBiG/dsh-archive-delete/releases/download/v0.1.6/qwqbig-dsh-archive-delete-0.1.6.tgz
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

实际启动目标宿主，核对插件组件正在运行、详情中有 **管理归档、回收站与存储**，且弹窗可以响应。成功完成恢复和鉴权 API 注册后，本次启动会输出类似日志：

```text
[archive-delete] v0.1.5 loaded · target DSH 0.2.1-rc.3 (host 0.2.1-rc.3) · trash "/absolute/path/to/dsh-home/archive-delete/trash"
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

## 插件内更新

低于 `0.1.5` 的安装需先使用上方 Release 地址手动升级一次；旧版尚无更新控件。从 `0.1.5` 开始，可在插件详情或管理弹窗中打开 **插件更新**。

### 检查与确认

只有受支持的 DSH Desktop `0.2.1-rc.3`、可验证的当前 profile 安装归属及原生管理器都满足条件时，才启动自动检查。宿主不受支持时，原有兼容门禁仍有效，本更新器不是未来 DSH 版本上的自升级通道。DSH 运行期间，成功检查会缓存 24 小时；**检查更新** 最短间隔一分钟才会请求新结果，更早点击会使用已有记录。网络、限流或元数据失败仍显示错误，一小时后自动重试，不代表已安装版本就是最新。检查本身不下载完整安装包，也不安装任何内容。

只考虑 `QwQBiG/dsh-archive-delete` 中的稳定发行版，并要求精确匹配 DSH 版本、支持当前 macOS／Windows 平台。选择 **查看并升级** 阅读版本和纯文本更新说明，再点击 **确认升级**。发行内容发生变化时，必须重新检查并核对。浏览器只提交候选标识和请求标识，不提供 URL 或安装包路径。

安装通过 DSH 原生管理器，只替换当前 profile 中的同一个插件包，不安装到其他 profile，不删除会话历史或清空回收站。替换前暂停归档变更，并等待已接受的操作结束。已安装版本与正在运行版本不同时，请按提示完整退出并重开 DSH；插件内升级不承诺无需重启就立即生效。

### 已校验安装包与保留的缓存

委托安装前，插件会重新检查发行身份和元数据，下载已确认的包，核对精确大小与 SHA-256，再验证受限 gzip／tar 及包清单。必须符合预期包名／版本、精确 DSH 要求，并包含 bundle patch 和预编译文件；链接、不安全／重复归档路径、安装钩子、运行／可选／捆绑依赖，以及未经允许或非可选的 peer 都会拒绝。此校验阶段不解压写入文件，也不执行包代码。

已校验归档保存于私有路径 `<DSH_HOME>/archive-delete/updates/packages/<version>-<sha256>.tgz`。原生管理器安装该本地文件，因此 profile 依赖可能显示为 `file:` 来源，而不是 GitHub URL。GitHub 仍是唯一分发来源，本地文件只是保留的已校验安装包；请与 profile 一起保留，供包管理器重装／复现安装。目前不会自动清理缓存，存储概览也不提供这些安装包的删除操作。

`updates/<sha256(profileId)>.check.json` 保存检查时间与公开候选信息；`updates/<sha256(profileId)>.installation.json` 单独保存安装请求和结果。服务端从规范化 profile 目录推导 `profileId`，因此共享 DSH home 的 profile 各有更新记录，已校验安装包则共享 `packages` 目录。这些记录不是会话备份；卸载插件会将记录与安装包和回收站一起保留，不应把它们作为常规安装／卸载步骤删除。

### 失败、卸载生命周期与不确定结果

原生管理器不可用、安装属于内置／归属不明，或无法确认 profile 所有权时，使用下方手动 Release URL 路径。原生安装前的网络／完整性失败不会运行安装包。原生包管理失败已有清单／锁文件回滚覆盖，但新插件代码激活阶段失败，无法保证正在运行的应用完全回到旧状态；重试前请核对诊断与已安装／正在运行版本。

关闭弹窗不会取消已经确认的升级。插件卸载生命周期会停止自动检查，但不会取消或等待已委托给宿主的安装：替换本身可能卸载旧插件，此时等待会造成死锁。中断后，通过 **核对安装状态** 与已安装包对照；**重试同一次请求** 会保留请求身份，不另发第二次升级，也不把响应丢失当作成功。若结果仍未知，请完整退出并重开 DSH 对账。已安装／正在运行状态未确认或 DSH 尚未完整重启时，继续保护归档变更。

## 手动升级固定 URL

Release URL 和固定 Git tag 都会固定安装版本。`pnpm update` 不会发现在其他 URL 上发布的新资产；内容可变化的 `main` 归档 URL 也不是版本跟踪机制。选择已发布的新版本，在同一 profile 的插件管理器中添加它的 **新固定版本资产 URL**。包名仍为 `@qwqbig/dsh-archive-delete`，添加新来源会替换既有依赖规格，无需先卸载。

CLI 管理的环境使用上面的 `add` 命令，将 URL 路径及文件名中的版本都换成新版，核对已安装版本和 bundle 登记，再完全重启。保留回收站和恢复记录；不要覆盖某个版本的资产或移动已发布 tag 来模拟升级。本项目继续通过 GitHub Release 分发安装包，暂不发布 npm。

## 卸载并清理残留 bundle

优先使用插件管理器的卸载操作，按提示完整重启，再核对当前 profile 不再选择此 bundle。不同宿主构建／调用模式对 bundle 清理的处理可能不同。

仅安装依赖的 CLI 场景，先完全退出 Desktop，再移除依赖：

```sh
dsh plugin --profile desktop remove @qwqbig/dsh-archive-delete
```

打开相同 profile 的 `package.json`，若 `dsh.profile.bundles` 中仍有 `@qwqbig/dsh-archive-delete`，**只移除这个条目**，保留其他 bundle 和字段；保存为有效 JSON 后重新打开 DSH。移除依赖却未清理此条目，可能反复出现 `skipping profile bundle … cannot resolve` 启动诊断。不要通过包生命周期钩子自动修改正在使用的 profile。

卸载保留 `<DSH_HOME>/archive-delete/`，包括回收站、待处理／恢复记录、更新日志和缓存安装包。重新安装支持版本后可继续查看；备份时请与回收站和 profile 一起保存，不要在移除依赖时删除。开始另一次包替换或移除前，先核对正在进行或结果不明的升级。

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
| 更新检查失败或被限流 | GitHub／网络请求未完成 | 保留已安装版本，查看诊断并稍后检查；错误不代表“已是最新”，自动重试间隔为一小时。 |
| 发行或安装包校验失败 | 元数据、校验和、兼容性或归档发生变化 | 重新检查并核对当前兼容发行版，不安装未通过验证的文件，也不跳过确认。 |
| 原生更新器不可用 | 无支持的管理器，或 profile 安装归属不明 | 在当前 profile 的原生插件管理器中使用固定 Release URL 手动升级。 |
| 磁盘已装新版但仍运行旧版，或结果不明确 | 激活／重启要求或响应中断 | 按提示完整重启，或核对安装状态／重试同一次请求；保留更新记录和缓存。 |

失败时保留所示状态，只重试相应目标。报告问题时提供宿主／插件版本和脱敏合成复现，预期操作状态见 [恢复规则](operations.zh-CN.md)。

## 开发用本地安装包

使用 Node 24 或更新版本，以及只含合成会话的临时 home/profile。构建打包后，将生成的 `.tgz` 绝对路径安装到该隔离 profile：

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack --pack-destination artifacts
node scripts/release-artifacts.mjs artifacts
node --import tsx scripts/check-update-package.mjs artifacts
```

已安装 DSH CLI 时，创建全新测试 home，安装到其隔离 `web` profile。在 POSIX shell 中：

```sh
DSH_ARCHIVE_DELETE_TEST_HOME="$(mktemp -d)"
DSH_HOME="$DSH_ARCHIVE_DELETE_TEST_HOME" dsh plugin --profile web add "$PWD/artifacts/qwqbig-dsh-archive-delete-0.1.6.tgz"
```

按上文核对隔离 profile 的注册和启用。Windows 使用 [参与贡献](../CONTRIBUTING.zh-CN.md) 中的自动隔离包生命周期检查；手动启动该宿主时保留临时 home 路径。打包产物可避免开发依赖进入运行时，主历史不能作为测试材料。
