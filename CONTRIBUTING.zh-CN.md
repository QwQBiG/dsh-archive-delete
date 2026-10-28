# 参与贡献

简体中文 · [English](CONTRIBUTING.md)

## 范围

改动聚焦已归档会话的回收站、恢复、显式永久清除及这些操作的原生界面。首版不包含搜索、OCR、自动过期、附件垃圾回收或第三方云端删除。

修改数据变更代码前，请阅读 [架构](docs/architecture.zh-CN.md)、[操作恢复](docs/operations.zh-CN.md) 和 [验收场景](docs/acceptance.zh-CN.md)。

## 开发流程

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm pack
```

使用仓库固定的包管理器。运行源码变动时重新生成并提交 `lib` 产物。GitHub 安装必须无需源码构建或依赖 `prepare` 钩子即可运行。

不要把开发版安装到主 DSH profile 中测试。使用临时 `DSH_HOME`、临时会话根目录和合成会话，测试目录不能是指向真实存储的符号链接。

原生集成在 macOS 运行，默认加载已安装的官方 Desktop 运行时。可用 `DSH_RUNTIME_ROOT` 指向独立的精确 `0.2.1-rc.3` 运行时根目录，其中需有 `package.json` 和 `node_modules`：

```sh
DSH_RUNTIME_ROOT=/absolute/path/to/isolated-runtime pnpm test:integration
```

`node scripts/prepare-native-runtime.mjs` 优先复用 `DSH_RUNTIME_ROOT` 指定的运行时，否则复用本机已安装的 Desktop 运行时，并核对精确版本；本地不会下载。仅在 `CI=true` 且没有可用的既有运行时时，脚本才关闭依赖安装脚本，将精确版本的官方 npm 运行时安装到可丢弃的临时目录。它不选择或修改用户 profile。在 GitHub Actions 中将 `DSH_RUNTIME_ROOT` 写入 `GITHUB_ENV`；本地则输出复用的路径，供上方命令使用。

`test/integration/host.test.ts` 使用实际 Cordis 上下文、JSONL 持久化、存储域、工作区登记、投影缓存及原生 flock。会话均为合成数据；Agent 待交互边界使用受控状态夹具。单元夹具和原生集成分别作为证据。

打包后，使用 Node 24 或更新版本，在另一个全新临时 home 中验证包管理生命周期：

```sh
node scripts/verify-package-lifecycle.mjs ./qwqbig-dsh-archive-delete-0.1.0.tgz
```

此脚本离线使用选定的官方运行时和可用包管理器，通过普通模块解析加载打包后的宿主部分，记录安装／重装／卸载结果及合成回收站标记保留情况。评估结果时应核对它报告的安装模式与诊断；不会安装到当前 Desktop profile。

## 需要回归证据的改动

- 适配层改动需要验证精确支持的宿主，以及缺失能力时的拒绝行为。
- 文件系统转换改动需要覆盖相应边界的故障注入、恢复和幂等性。
- 关系处理改动必须证明专属子代理成组处理、独立 fork 保留。
- 界面改动必须保留清晰的选择范围、键盘操作、显式确认和逐项失败反馈。

测试应核对可观察的结果：原始日志字节、目录、宿主登记、回收站元数据及界面结果。仅模拟 `rename` 成功或 Promise 返回，不足以证明删除成功。

提交前运行验证并检查文档链接，在同一改动中同步对应语言文件。准确说明实际运行和未运行的检查。提交或问题报告中不得包含真实会话、凭据、私人路径或 `~/.dsh` 内的文件。

## 报告问题

请提供插件与 DSH 版本、平台、可见操作和结果，以及最小合成复现。明确区分 **待处理、失败、已移入、已清除**。不要通过手工修改运行中宿主存储来重试文件操作；保留恢复记录，提供脱敏诊断。

## 署名与许可

贡献代码采用 [Apache-2.0](LICENSE) 许可证。
