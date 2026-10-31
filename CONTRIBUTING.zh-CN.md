# 参与贡献

简体中文 · [English](CONTRIBUTING.md)

项目包含归档会话回收站、恢复、永久清除、存储查看和 GitHub 更新。可先阅读 [架构](docs/architecture.zh-CN.md) 与 [操作流程](docs/operations.zh-CN.md)。

## 环境与检查

使用 Node **24+** 和仓库固定的 pnpm 版本。macOS Desktop 提供 Node 可执行文件 `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node`，可将其目录加入 `PATH`。

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack --pack-destination artifacts
node scripts/release-artifacts.mjs artifacts
node --import tsx scripts/check-update-package.mjs artifacts
node scripts/verify-package-lifecycle.mjs ./artifacts/qwqbig-dsh-archive-delete-0.0.2.tgz
```

`verify` 执行类型／构建、单元、原生集成、文档和包检查。源码变化时一并生成 `lib/`。数据测试使用临时 home/profile 和合成会话。

## 原生运行时

测试目标为官方 DSH `0.2.1-rc.3` / `0.2.1-rc.5`。macOS 默认复用已安装的 Desktop 运行时。也可指定包含 `package.json` 和 `node_modules` 的运行时目录：

```sh
DSH_TEST_VERSION=0.2.1-rc.5 DSH_RUNTIME_ROOT=/absolute/path/to/isolated-runtime pnpm test:integration
```

```powershell
$env:DSH_TEST_VERSION = '0.2.1-rc.5'
$env:DSH_RUNTIME_ROOT = 'C:\path\to\isolated-runtime'
pnpm test:integration
```

`node scripts/prepare-native-runtime.mjs` 在本地复用既有运行时，在 CI 中可向临时目录准备精确版本的官方运行时。集成测试覆盖 Cordis、JSONL、工作区登记、投影和原生写锁。

包生命周期脚本将打包产物安装到临时 profile，检查 bundle 登记及 API 响应，替换来源 URL，并验证保留回收站的卸载／重装。URL 测试使用本地 HTTP 服务。

## 回归覆盖

| 改动 | 验证内容 |
| --- | --- |
| 文件转换 | 原始字节、宿主登记、中断恢复与请求重放 |
| 关系与闲置释放 | 母会话／子代理成组、fork 保留、活动检查和完整原生清理 |
| 存储 | 配置位置、文件类型规则、排除项、去重、限制、取消与文件变化 |
| 更新 | 发行身份、校验和、包准入、当前 profile 替换及已安装／运行状态 |
| 界面 | 可见选择、键盘焦点、确认过期、较晚响应与逐项结果 |

测试数据应独立于真实历史。问题报告包含插件／宿主版本、系统、操作、结果和合成复现，验证状态见 [验收记录](docs/acceptance.zh-CN.md)。

## 发布

将固定版本 `.tgz`、`.tgz.sha256` 及对应 `.update.json` 一起发布到 GitHub Releases。产物脚本校验包内容，检查脚本验证校验和、元数据与更新流程。安装包使用 `files` 白名单，包含编译后的宿主、客户端和 Doctor 文件。

每个版本使用新的 tag 和资产 URL。更新器接受符合精确宿主要求的更高稳定版本。已校验安装包保留在 `updates/packages/`，供 profile 锁文件引用；安装由当前 profile 的 DSH 原生管理器完成。

提交前运行上述命令，在同一次改动中更新相关文档及对应语言文件。安装和 Doctor 命令见 [使用指南](docs/installation.zh-CN.md)。贡献使用 [Apache-2.0](LICENSE)。
