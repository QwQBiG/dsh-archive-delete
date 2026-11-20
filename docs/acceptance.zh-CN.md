# 验证记录

简体中文 · [English](acceptance.md)

## 0.0.6

macOS 上分别用官方 DSH `0.2.2-rc.3` 和 `0.2.1-rc.5` 跑完原生测试，两组各通过 22 项、各跳过 1 项 Windows 专用测试。原生宿主探测也通过。新版宿主的安装包测试从已有的不兼容插件开始，在同一 profile 原位替换，并检查回收站保留和接口加载。

[CI 矩阵](https://github.com/QwQBiG/dsh-archive-delete/actions/workflows/ci.yml)在 macOS 和 Windows 上验证声明支持的三个 DSH 版本。Doctor 测试使用示例目录检查运行时目录和 pnpm 入口缺失时的行为。

## 0.0.4

| 检查 | 本地结果 |
| --- | --- |
| Node 24.21.0 单元、客户端和服务测试 | 420 项通过，7 项因平台或运行时跳过，0 项失败 |
| 本机 macOS DSH `0.2.1-rc.5` 原生集成测试 | 22 项通过，1 项 Windows 专属测试跳过，0 项失败 |
| 存储被占用时读取已有删除历史 | 返回近期记录，过滤过期记录，历史文件逐字节一致 |
| 隔离宿主探测 | 通过，会话所有者相关检查标为尚未验证 |

[CI 矩阵](https://github.com/QwQBiG/dsh-archive-delete/actions/workflows/ci.yml)覆盖 macOS 和 Windows 上的 DSH `0.2.1-rc.3`、`0.2.1-rc.5`，包括原生测试、安装包及更新元数据校验，以及隔离安装、升级和卸载。

## 已发布版本 0.0.3

已发布的 `0.0.3` 安装包使用官方 DSH Desktop `0.2.1-rc.3` / `0.2.1-rc.5` 和 JSONL 存储验证。本机检查使用 Node `24.21.0`、pnpm `11.28.5`。

| 检查 | 已记录结果 |
| --- | --- |
| 单元、客户端与服务测试 | 294 项中 287 项通过，macOS 普通 Node 跳过 3 项 Windows 和 4 项 Electron 专用测试 |
| 原生宿主集成 | 22 项中 21 项通过，macOS 跳过 1 项 Windows 专用测试 |
| 构建／类型、文档和包检查 | 通过 |
| macOS / Windows × rc.3 / rc.5 | [CI 矩阵](https://github.com/QwQBiG/dsh-archive-delete/actions/workflows/ci.yml)通过，包含原生安装及包生命周期测试 |
| 打包、校验和、更新元数据及更新包校验 | 通过 |
| 隔离安装、URL 替换、卸载／重装 | 通过，核对 bundle 登记和回收站保留 |
| 已安装 rc.5 ASAR／Electron | 宿主及 ASAR 清单检查共 28 项，27 项通过，1 项 Windows 专用跳过 |
| macOS Desktop 界面 | 已检查隔离加载、诊断显示及预览 |

数据测试使用临时 profile 中的合成会话，原生集成测试覆盖完整的移动、恢复和永久清除流程。Windows Desktop 界面及真实整机断电后的恢复尚未验证。

## 覆盖范围

| 范围 | 检查行为 |
| --- | --- |
| 会话生命周期 | 移入回收站、恢复为已归档、同进程永久清除、母会话／子代理成组及 fork 保留 |
| 活动与写锁 | 闲置释放，活动／输入／维护拒绝，原生写锁争用 |
| 请求 | 预览单次使用、同 ID 重放、过期、取消、内容变化及批量混合结果 |
| 恢复 | 文件操作与宿主登记之间的失败、部分清除、bucket 缺失及请求中断 |
| 数据布局 | 损坏条目隔离、清单、未知文件、路径冲突、别名和符号链接 |
| 存储 | 配置／工作区位置、文件类型规则、路径／硬链接去重、限制、变化与取消 |
| 界面 | 选择、分页、排序、本地化时间、维护状态竞争及保留上次结果的重新扫描 |
| 更新 | 稳定版选择、原生 profile 归属、固定元数据、包检查和不明确结果 |
| 分发 | 编译产物、校验值一致、bundle 登记、替换及数据保留 |

本机使用 5,000 条回执样本测试，首次查询约 27 ms，缓存查询的中位数约 0.74 ms，索引到期后重建约 19 ms。启动时也会扫描恢复记录。

## 复现

使用 Node 24+ 和已安装的官方 DSH 运行时，选择方法见[参与贡献](../CONTRIBUTING.zh-CN.md)。

```sh
pnpm verify
pnpm pack --pack-destination artifacts
node scripts/release-artifacts.mjs artifacts
node --import tsx scripts/check-update-package.mjs artifacts
node scripts/verify-package-lifecycle.mjs artifacts
```

包生命周期命令使用独立的临时 profile 和本地测试 URL。Desktop 界面检查与自动数据测试分别记录。

[架构](architecture.zh-CN.md) · [操作](operations.zh-CN.md) · [安装](installation.zh-CN.md)
