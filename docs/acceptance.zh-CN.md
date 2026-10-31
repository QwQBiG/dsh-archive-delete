# 验证记录

简体中文 · [English](acceptance.md)

## 当前结果

安装包 `0.0.2`，官方 DSH Desktop `0.2.1-rc.3` / `0.2.1-rc.5`、JSONL 存储。本机运行时为 Node `24.21.0`、pnpm `11.28.5`。

| 检查 | 已记录结果 |
| --- | --- |
| 单元／客户端／服务套件 | 283 项中 276 项通过，macOS 普通 Node 跳过 3 项 Windows 和 4 项 Electron 专用测试 |
| 原生宿主集成 | 21 项中 20 项通过，macOS 跳过 1 项 Windows 专用测试 |
| 构建／类型、文档和包检查 | 通过 |
| 打包、校验和、更新元数据及更新器准入 | 通过 |
| 隔离安装、URL 替换、卸载／重装 | 通过，核对 bundle 登记和回收站保留 |
| 已安装 rc.5 ASAR／Electron | 宿主及 ASAR 清单检查共 27 项，26 项通过，1 项 Windows 专用跳过 |
| macOS Desktop 界面 | 已检查隔离加载、诊断显示及预览 |

数据测试使用临时 profile 和合成会话。完整移动／恢复／永久清除流程由原生集成验证。Windows Desktop 界面及真实整机断电恢复尚未验证。

## 覆盖范围

| 范围 | 检查行为 |
| --- | --- |
| 会话生命周期 | 移动、归档恢复、同进程永久清除、母会话／子代理组和 fork 保留 |
| 活动与写锁 | 闲置释放，活动／输入／维护拒绝，原生写锁争用 |
| 请求 | 预览单次使用、同 ID 重放、过期、取消、内容变化及批量混合结果 |
| 恢复 | 文件／登记边界失败、部分清除、bucket 缺失及请求中断 |
| 数据布局 | 损坏条目隔离、清单、未知文件、路径冲突、别名和符号链接 |
| 存储 | 配置／工作区位置、文件类型规则、路径／硬链接去重、限制、变化与取消 |
| 界面 | 选择／分页／排序、本地化时间、维护竞争和保留上次结果的重扫 |
| 更新 | 稳定版选择、原生 profile 归属、固定元数据、包检查和不明确结果 |
| 分发 | 编译产物、校验值一致、bundle 登记、替换及数据保留 |

本机 5,000 条回执样本中，首次索引查询约 24 ms，热查询中位数约 0.8 ms。启动仍需清点恢复记录。

## 复现

使用 Node 24+ 和已安装的官方运行时，运行时选择见 [参与贡献](../CONTRIBUTING.zh-CN.md)。

```sh
pnpm verify
pnpm pack --pack-destination artifacts
node scripts/release-artifacts.mjs artifacts
node --import tsx scripts/check-update-package.mjs artifacts
node scripts/verify-package-lifecycle.mjs ./artifacts/qwqbig-dsh-archive-delete-0.0.2.tgz
```

包生命周期命令使用另一个临时 profile 和本地 URL 样本。Desktop 界面检查与自动数据测试分别记录。

[架构](architecture.zh-CN.md) · [操作](operations.zh-CN.md) · [安装](installation.zh-CN.md)
