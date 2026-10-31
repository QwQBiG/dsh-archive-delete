# 参与贡献

简体中文 · [English](CONTRIBUTING.md)

## 范围

改动聚焦已归档会话的回收站、恢复、显式永久清除、原生界面、只读存储查看，以及经用户确认、通过当前 profile 原生插件管理器完成的 GitHub 更新；不包含搜索、OCR、自动过期、附件垃圾回收、项目文件删除或第三方云端删除。

修改数据变更代码前，请阅读 [架构](docs/architecture.zh-CN.md)、[操作恢复](docs/operations.zh-CN.md) 和 [验收场景](docs/acceptance.zh-CN.md)。

## 开发流程

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack --pack-destination artifacts
node scripts/release-artifacts.mjs artifacts
node --import tsx scripts/check-update-package.mjs artifacts
```

使用 **Node 24 或更新版本**和仓库固定的包管理器。即使 Desktop 自带 Node 24，系统 Node 22 仍不满足构建要求。macOS Desktop 安装可能在 `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node` 提供真实可执行文件，可将其目录加入 `PATH`，也可在任一平台单独安装 Node 24+。缺少所需 Desktop 环境时，不要单独运行 `runtime/bin/node`：它可能是依赖 `DSH_DESKTOP_NODE_EXECUTABLE` 的 Electron 包装脚本。安装预编译插件的用户无需配置这套构建环境。运行源码变动时重新生成并提交 `lib` 产物。GitHub 安装必须无需源码构建或依赖 `prepare` 钩子即可运行。

不要把开发版安装到主 DSH profile 中测试。使用临时 `DSH_HOME`、临时会话根目录和合成会话，测试目录不能是指向真实存储的符号链接。

原生集成已在 macOS 和 Windows CI 中通过精确目标宿主验证。macOS 默认加载已安装的官方 Desktop 运行时；在 Windows 上或需选择另一运行时时，设置 `DSH_RUNTIME_ROOT`，指向包含 `package.json` 和 `node_modules` 的精确 `0.2.1-rc.3` 运行时根目录。在 POSIX shell 中：

```sh
DSH_RUNTIME_ROOT=/absolute/path/to/isolated-runtime pnpm test:integration
```

在 PowerShell 中：

```powershell
$env:DSH_RUNTIME_ROOT = 'C:\path\to\isolated-runtime'
pnpm test:integration
```

`node scripts/prepare-native-runtime.mjs` 优先复用 `DSH_RUNTIME_ROOT` 指定的运行时，否则复用本机已安装的 Desktop 运行时，并核对精确版本；本地不会下载。仅在 `CI=true` 且没有可用的既有运行时时，脚本才关闭依赖安装脚本，将精确版本的官方 npm 运行时安装到可丢弃的临时目录。它不选择或修改用户 profile。在 GitHub Actions 中将 `DSH_RUNTIME_ROOT` 写入 `GITHUB_ENV`；本地则输出复用的路径，供上方命令使用。

`test/integration/host.test.ts` 使用实际 Cordis 上下文、JSONL 持久化、存储域、工作区登记、投影缓存及兼容宿主的原生写锁。会话均为合成数据；Agent 待交互边界使用受控状态夹具。单元夹具、原生集成及 Desktop 图形界面分别作为证据。

打包后，使用 Node 24 或更新版本，在另一个全新临时 home 中验证包管理生命周期：

```sh
node scripts/verify-package-lifecycle.mjs ./artifacts/qwqbig-dsh-archive-delete-0.0.2.tgz
```

此脚本复用选定的官方运行时和可用包管理器。包安装／重装／卸载检查使用离线缓存；单独的固定 URL 升级夹具通过本地 HTTP 提供安装包，不连接 GitHub 或公共包源。脚本通过普通模块解析加载打包后的宿主部分，并核对合成回收站内容保留。管理器会注册 bundle，CLI 启用行为取决于宿主构建及调用模式。仅安装依赖的调用仍可能遗漏登记，应核对清单，不能把依赖存在当作已启用；测试和报告中应区分这两条安装路径，手动使用命令行时按 [CLI 注册说明](docs/installation.zh-CN.md) 操作。评估结果时应核对报告的安装模式与诊断；不会安装到当前 Desktop profile。

## 发行包与诊断

将生成的 `.tgz` 作为固定版本 GitHub Release 资产发布，并附带 SHA-256 校验文件及 `.update.json` 元数据。继续通过 GitHub 分发，无需发布 npm。用户首选地址应指向安装包，不使用仓库归档。将打包文件清单与包白名单核对，包含宿主、浏览器和 Doctor 产物，排除源码、测试、锁文件及 CI 文件。新版本使用新 URL，不替换已发布资产，也不移动已发布 tag。

```sh
pnpm pack --pack-destination artifacts
node scripts/release-artifacts.mjs artifacts
node --import tsx scripts/check-update-package.mjs artifacts
```

产物脚本写入 `.tgz.sha256` 校验文件，并根据实际安装包字节生成对应 `.update.json`。元数据声明固定包名、稳定版本、精确 DSH 版本要求、支持平台，以及安装包名称／字节数／SHA-256。三个资产必须属于同一个 tag 的发行版。本地打包及 CI 都必须在生成元数据后、生命周期安装前通过 `check-update-package.mjs`；它用本地响应夹具调用实际来源模块，验证发行发现、固定身份、校验和及归档准入。更新器自动读取发行元数据，只有明确确认后才下载 `.tgz`；元数据或归档准入本身都不能证明插件能成功启用。

更新测试使用合成发行版、受控 HTTP 响应和隔离的原生管理器 profile。复用已安装 DSH 运行时，不向真实 profile 安装更新，单元测试不访问 GitHub。覆盖稳定版本／宿主／平台选择、响应与归档上限、重定向、发行 pin 变化、校验和、不安全 tar 条目、安装钩子／依赖、缓存时机、同请求重试，以及归档队列排空。原生集成须证明只替换当前 profile 中的同名 bundle、保留精确安装包引用，并正确区分已安装与正在运行的版本。原生拒绝测试验证清单／锁文件回滚，但不能据此承诺任意启用或热重载失败后的完整回滚。

已校验安装包保留在 `<DSH_HOME>/archive-delete/updates/packages/`，因为 profile 的 `file:` 依赖和锁文件可能仍引用它们。为可复现的重装保留这些共享安装包文件；仍可能被引用时，不得增加自动清理。检查与安装记录以 `updates/<profile-hash>.check.json` 和 `updates/<profile-hash>.installation.json` 按 profile 隔离，哈希取自服务端掌握的规范 profile 目录的 SHA-256，且独立于会话恢复回执。卸载当前插件实例时，必须取消更新检查，但不能等待已在替换本插件的原生安装任务：原生管理器可能正等待这次实例卸载完成。

按照 [Doctor 使用说明](docs/installation.zh-CN.md)，使用与测试宿主相同的隔离 home/profile。Doctor 必须保持只读，对无法确认的前置条件报告警告，不得把配置导出或残留目录等同于运行中插件。启动日志改动需证明恢复或 API 注册失败时不会输出加载成功信号。包生命周期检查应覆盖明确的新依赖来源、无重复注册、卸载 bundle 清理及回收站保留。

## 需要回归证据的改动

- 适配层改动需要验证精确支持的宿主，以及缺失能力时的拒绝行为。原生闲置释放变化须证明完整生命周期清理、无待处理输入的闲置准入、组外运行时子项保护，以及清理后、移动前的重新校验。只清理 scope 或手动删除登记不等于完整释放写所有权。
- 文件系统转换改动需要覆盖相应边界的故障注入、恢复和幂等性。
- 关系处理改动必须证明专属子代理成组处理、独立 fork 保留。
- 存储扫描必须由用户手动开始，限制工作量且只读元数据。验证数据目录以外的配置位置、排除项、跨分类路径／硬链接去重、未知位置、取消、文件变化及部分结果。工作区测试只使用登记 ID，复查成员资格与路径，并保留所有夹具字节；扫描结果不能成为清理授权或 AI 来源分类。
- 回收站大小／指纹变化需覆盖同次观察期间的漂移、部分清除后的实际剩余大小，以及持锁确认检查；不得由逻辑字节推断已释放物理空间，也不得自动丢弃幂等回执。
- 更新改动须保留显式确认、服务端 pin 的重新校验、当前 profile 原生管理器准入，以及独立安装日志。发现失败不能显示为当前版本已最新；安装结果不明时须保留请求 ID，在核对前阻止新升级。不得承诺升级无需重启或启用失败后可完整回滚。
- 界面改动必须保留清晰的选择范围、键盘操作、显式确认和逐项失败反馈。重试待处理记录须结束旧请求、要求新预览与确认、保留结果不明时的处理，并且不能在取消请求返回后重新打开已关闭弹窗。

测试应核对可观察的结果：原始日志字节、目录、宿主登记、回收站元数据及界面结果。仅模拟 `rename` 成功或 Promise 返回，不足以证明删除成功。

提交前运行验证并检查文档链接，在同一改动中同步对应语言文件。准确说明实际运行和未运行的检查。提交或问题报告中不得包含真实会话、凭据、私人路径或 `~/.dsh` 内的文件。

## 报告问题

请提供插件与 DSH 版本、平台、可见操作和结果，以及最小合成复现。明确区分 **待处理、失败、已移入、已清除**。不要通过手工修改运行中宿主存储来重试文件操作；保留恢复记录，提供脱敏诊断。

## 署名与许可

贡献代码采用 [Apache-2.0](LICENSE) 许可证。
