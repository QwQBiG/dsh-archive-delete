# 参与贡献

简体中文 · [English](CONTRIBUTING.md)

插件用于管理归档会话、回收站、存储查看和 GitHub 更新。模块划分见[架构](docs/architecture.zh-CN.md)，移动、恢复和删除的处理过程见[操作流程](docs/operations.zh-CN.md)。

## 环境与检查

使用 Node **24+** 和 `package.json` 中指定的 pnpm 版本。macOS 的 DSH Desktop 自带 Node，路径为 `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node`；将其目录加入 `PATH` 即可使用。

```sh
node --version
pnpm install --frozen-lockfile
pnpm verify
pnpm pack --pack-destination artifacts
node scripts/release-artifacts.mjs artifacts
node --import tsx scripts/check-update-package.mjs artifacts
node scripts/verify-package-lifecycle.mjs artifacts
```

`verify` 会检查类型、构建产物，并运行单元、原生集成、文档和安装包检查。修改源码时，一并重新生成 `lib/`。数据测试使用临时 DSH home/profile 和合成会话。

## 原生运行时

原生测试覆盖官方 DSH `0.2.1-rc.3`、`0.2.1-rc.5` 与 `0.2.2-rc.3`。macOS 默认使用已安装的 Desktop 运行时。如需指定其他运行时，填写包含 `package.json` 和 `node_modules` 的目录：

```sh
DSH_TEST_VERSION=0.2.1-rc.5 DSH_RUNTIME_ROOT=/absolute/path/to/isolated-runtime pnpm test:integration
```

```powershell
$env:DSH_TEST_VERSION = '0.2.1-rc.5'
$env:DSH_RUNTIME_ROOT = 'C:\path\to\isolated-runtime'
pnpm test:integration
```

`node scripts/prepare-native-runtime.mjs` 在本地使用既有运行时，在 CI 中可将指定版本的官方运行时安装到临时目录。集成测试覆盖 Cordis、JSONL、工作区登记、投影和原生写锁。

包生命周期脚本会将安装包加入临时 profile，检查 bundle 登记和 API 响应，再替换安装 URL。它也会卸载、重装插件，检查回收站是否保留。URL 测试使用本地 HTTP 服务。

## 宿主探测

在源码仓库中，用 Node 24+ 检查已安装的运行时：

```sh
node --import tsx scripts/probe-host.mts --runtime /absolute/path/to/installed-runtime
```

```powershell
node --import tsx scripts/probe-host.mts --runtime 'C:\path\to\installed-runtime'
```

```sh
ELECTRON_RUN_AS_NODE=1 \
  "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  --expose-internals --import tsx scripts/probe-host.mts \
  --runtime "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh"
```

最后一条命令通过已安装的 macOS Electron 可执行文件读取 ASAR。探测直接使用既有 DSH，在自建临时目录中运行官方服务，完成后清理目录。用户 profile 保持原样；由于没有创建会话，会话所有者检查会显示为未验证。JSON 报告包含检测到的版本、结构检查和计数。

退出码 0 表示版本、平台、基础能力及全部全局检查通过；1 表示检查失败，或版本／平台不在支持范围内；2 表示初始化或清理失败。全局检查为未验证时不能判为通过。CI 为每个宿主／平台组合保存报告，反馈问题时可附上报告和原因码。

## 回归覆盖

| 改动 | 验证内容 |
| --- | --- |
| 文件操作 | 原始字节、宿主登记、中断恢复与请求重放 |
| 关系与闲置释放 | 母会话／子代理成组、fork 保留、活动检查和完整的原生生命周期释放 |
| 存储 | 配置位置、文件类型规则、排除项、去重、限制、取消与文件变化 |
| 更新 | 固定的发行信息、校验和、安装包校验、当前 profile 替换及已安装／运行版本 |
| 界面 | 可见选择、键盘焦点、确认过期、较晚响应与逐项结果 |

反馈问题时，请提供插件与 DSH 版本、操作系统、操作步骤、结果，以及使用合成数据的复现方式。已完成的检查见[验证记录](docs/acceptance.zh-CN.md)。

## 发布

将版本对应的 `.tgz`、`.tgz.sha256`、默认 `.update.json` 和生成的所有宿主专用 `.dsh-<host>.update.json` 一起发布到 GitHub Releases。所有元数据指向同一个安装包。产物脚本校验包内容，检查脚本核对校验和、元数据与更新流程。安装包包含 `files` 中列出的文件，包括编译后的宿主、客户端和 Doctor 产物。

每次发布使用新的 tag 和资产 URL。更新器接受明确支持当前宿主的更高稳定版本。已校验安装包保留在 `updates/packages/`，供 profile 锁文件引用；安装由当前 profile 的 DSH 原生管理器完成。

提交前运行上述检查，并同步更新相关文档的中英文版本。安装和 Doctor 命令见[使用指南](docs/installation.zh-CN.md)。贡献采用 [Apache-2.0](LICENSE) 许可证。
