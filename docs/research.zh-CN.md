# 参考研究与设计决策

简体中文 · [English](research.md)

## 固定基线与方法

主要参考：[MichengAI/dsh-archive-manager](https://github.com/MichengAI/dsh-archive-manager/tree/6b8babc7b7f8da44466c7bd611ad29e66408623c)，提交 **`6b8babc7b7f8da44466c7bd611ad29e66408623c`**，包版本 **1.1.18**，Apache-2.0。其 README 的说明版本仍写 1.1.17，包清单与更新日志为 1.1.18。研究固定于不可变提交，不跟随变化的分支。

研究清点完整的 `src`、`test`、`scripts`，梳理其契约与命名回归场景，并核对 README、更新日志、包清单、加载补丁和构建发布规则。基线包含 32 个 TypeScript 源模块（10,232 行）、43 个 JavaScript 测试／辅助／夹具模块（9,272 行）、9 个脚本（614 行），以及一个 TypeScript 契约夹具。静态可识别 320 处 `test`／`it` 声明；参数化实际执行数量可能不同。这些数字说明清点覆盖范围，不是测试通过证据。

行为阅读重点为持久化所有权、删除顺序、子代理关系、登记与缓存写入、原生界面生命周期、鉴权及故障测试。这不是独立安全审计，也未将上游测试作为本插件通过的证据。新实现有自己的 [验收记录](acceptance.zh-CN.md)。

同时检查了本机官方 macOS DSH Desktop `0.2.1-rc.3`：它提供原生会话行扩展槽位及归档／取消归档接口，但会话持久化没有公开删除操作；JSONL 写入使用真实会话目录写锁，界面闲置不等于写锁已经释放。

## 完整源码地图

固定基线中的全部源文件归入以下分组：

| 分组 | 模块 | 学习内容 |
| --- | --- | --- |
| 宿主入口与安装 | `index.ts`、`host-install.ts`、`host-compat.ts` | 单个 bundle 安装界面与宿主行为；精确接口和卸载恢复很重要。参考还包含本项目范围之外的更新器与自定义设置路由。 |
| 原生工作区生命周期 | `workspace.ts`、`session-move.ts`、`projcache.ts` | 删除、头部／路径索引、工作区记账、子代理级联、spill 清理、跨工作区重写及投影彼此关联。 |
| 共享与浏览器契约 | `contracts.ts`、`client-compat.ts`、`client-types.ts` | 校验线协议，把宿主版本差异限制在边界。 |
| 主界面与侧栏 | `client.ts`、`sidebar-entry.ts`、`directory-flow-slot.ts` | 原生槽位、设置挂载、释放、导航、菜单增强及第三方皮肤共存会显著扩大范围。 |
| 归档导航与整理 | `archive-experience.ts`、`archive-organizer.ts`、`archive-organizer-ui.ts` | 当前会话导航、收藏、闲置准入、串行批量、部分失败与临时撤回属于不同产品关注点。 |
| 搜索与预览 | `archive-discovery.ts`、`archive-discovery-ui.ts` | 成功或失败都应关闭只读句柄；参考只提取用户／助手文本，逐批扫描，不维护持久全文索引。 |
| 缓存修复 | `cache-rebuild.ts`、`cache-rebuild-contract.ts`、`cache-rebuild-client.ts` | 延后缓存写入需回读确认，超时不等于取消；修复写入必须与删除保持顺序。 |
| 设置与更新 | `plugin-settings.ts`、`plugin-updater.ts`、`plugin-update-model.ts`、`plugin-update-ui.ts`、`release-age.ts` | 设置写入、profile 包安装、发布年龄策略、更新界面与重启归属本身就是完整产品；本项目交由 DSH 更新。 |
| 界面原语与宿主 shim | `plugin-ui.ts`、`host-react-shim.ts`、`host-react-dom-shim.ts`、`host-jsx-shim.ts` | 复用宿主 React 避免第二套运行时；原生控件、portal、焦点及本地化均很重要。 |
| API 基址与系统目录 | `api-base.ts`、`explorer-path-policy.ts`、`native-explorer.ts` | 相对页面基址解析请求，并以宿主所有权验证路径；打开系统目录不属于本项目的窄生命周期。 |

参考源码：[完整源目录](https://github.com/MichengAI/dsh-archive-manager/tree/6b8babc7b7f8da44466c7bd611ad29e66408623c/src)。

下面明确映射影响本设计的生命周期函数。这些名称属于参考项目，不代表本项目暴露相同接口。

| 参考接口／函数 | 观察到的行为 | 本项目决策 |
| --- | --- | --- |
| `installArchiveWorkspace`、`bindArchiveManagerRemote` | 扩展既有注册表并登记远程描述符，卸载时清理 | 宿主耦合限制在适配层，使用简小的鉴权操作端点 |
| `archivedSessionMetadata`、`pruneUnknownArchivedSessionIds`、`sessionArtifactMissing` | 读取元数据时可能清理确证缺失的工件及标记 | 列表保持只读，读取失败保留为错误 |
| `deleteArchivedSessions`、`deleteSessionCore` | 串行删除批次；实时会话、缓存、登记和物理删除分别有失败点 | 预览完整组，再记录可恢复移动并逐项目标反馈 |
| `jsonlSessionDirectory`、`removeTranscriptDirectory` | 删除全部日志代际前证明目录所有权 | 只准入已验证的官方布局，同卷移动目录 |
| `deleteDescendants`、`cleanSpill` | 级联明确子代理、记录子项错误、清理 spill | 整组预检与恢复，保留 spill |
| `moveSessionToWorkspace` 及会话移动辅助函数 | 重写工作区关联与派生元数据 | 仅恢复原关联，不增加通用工作区迁移 |
| 缓存重建的回读辅助函数 | 区分已请求的异步写入与已观察到的持久记录 | 登记失败保持可见，需要恢复时不猜测成功 |

## 历史问题及证据边界

公开问题按一手报告阅读，并非在本插件中复现的故障。下列状态截至 2026-10-28 研究时，源码结论仍绑定固定提交。

| 报告 | 报告的问题及启示 |
| --- | --- |
| [#88](https://github.com/MichengAI/dsh-archive-manager/issues/88)，已关闭 | 移除旧缓存交接后，冷会话可能缺少官方标题。日志存在与原生投影完整是两件事，不应再建立标题镜像。 |
| [#90](https://github.com/MichengAI/dsh-archive-manager/issues/90)，已关闭 | 侧栏插入星标改变了其他皮肤依赖的子元素索引。优先使用扩展槽位，避免按 DOM 位置推断。 |
| [#92](https://github.com/MichengAI/dsh-archive-manager/issues/92)，已关闭 | 收藏星遮住了宿主的活动状态点。插件装饰必须保留宿主活动状态的可见性。 |
| [#94](https://github.com/MichengAI/dsh-archive-manager/issues/94)，未关闭 | 报告者发现删除会话后旧 v2 镜像仍留有条目。准确说明删除边界，永久清除时删除本插件的恢复标题。 |
| [#95](https://github.com/MichengAI/dsh-archive-manager/issues/95)，未关闭 | 报告者质疑旧镜像明文保留用户首句。避免首句副本，明确保留的共享及第三方数据。 |

报告中的测量与修复建议来自用户。本研究不将其变成独立验证的事实，也不以此获得清理其他插件文件的授权。

## 宿主与数据流结论

### 1. 归档不等于删除

归档是宿主拥有的集合成员变更，物理日志保留。原生归档已有活动检查与停止后归档行为；本插件以母会话已经归档为前提，不重复或绕过该流程。

参考在既有 `WorkspaceRegistry` 实例安装扩展方法并贡献 Typert Remote 描述符；兼容类型暴露了头部／路径映射和注册表写队列等内部字段。本项目将同类耦合集中在适配层，领域／服务代码不直接访问这些结构。

### 2. 必须确证“工件不存在”

参考的 `sessionArtifactMissing` 说明：`persistence.stat(id)` 可能因头部损坏或文件为空而返回无头部，这不代表目录不存在。它结合物理定位与目录证据，才清理孤儿引用。

本项目的列表与预览保持只读，不能因为头部读取失败就删除原生归档标记；错误保留可见、可重试。

### 3. 定位到一个文件不代表拥有父目录

参考的 `jsonlSessionDirectory` 校验官方后端、规范根目录、编码后的会话 ID、项目目录规则与日志代际文件名，才把父目录视为会话专属；也检查项目／会话符号链接。无法确认布局所有权时，参考退回只删一个工件。

本项目对无法确认的整组直接拒绝。所有日志代际需要一起保留和处理；仅删最新代际可能让旧代际重新被发现，表现为会话复活。

### 4. fork 与子代理必须区分

两者都可能指向母会话，仅有 `parentSession` 不足以区分。参考只沿明确的 `origin: "subagent"` 级联，保留独立 fork。

参考记录子会话删除失败后仍继续删除母会话，并明确级联不是事务。本项目在移动前检查整组，记录每个成员的位置，使不完整组仍可恢复。测试必须核对 fork 可读取，不能只检查目录存在。

### 5. 宿主保留、文件写锁与活动状态不同

参考永久删除时会刷新并分离实时会话，也包含冷会话移除通知路径。本项目明确不强制分离：当前宿主保留的闲置会话进入待处理，活动工作或外部占用则拒绝。

待处理请求绑定观察到的内容与归档状态。之后执行重新检查状态及写锁，不能把过去确认当作对变化数据永久有效的授权。

### 6. 派生存储不应变成第二份事实来源

参考历史 v2 投影镜像留下标题与用户首句文本。[#94](https://github.com/MichengAI/dsh-archive-manager/issues/94) 和 [#95](https://github.com/MichengAI/dsh-archive-manager/issues/95) 报告针对这类迁移残留；固定当前版本已经不再读取或生成旧镜像，但不会自动清除旧第三方缓存目录。

本项目仅在恢复需要时保留恢复元数据，不镜像用户首句，也不默默清扫其他插件历史。永久清除连同自己的关联元数据一起处理，共享附件和 spill 明确保留。

### 7. 原生入口比替换侧栏的维护边界更小

参考包含完整侧栏／浏览器体验，以及通过 DOM 辅助实现的菜单和皮肤共存逻辑。更新日志记录了状态点、星标对齐、设置 ID 和弹窗位置的回归。这些是真实维护成本，不能据此断定整个参考工程质量差。

本项目只使用归档会话菜单槽位、插件详情槽位和简洁原生弹窗，不复制侧栏、不依赖 DOM 子元素位置，不加入收藏、自定义日历、系统目录和插件更新器。

## 测试与发布研究

36 个顶层测试套件覆盖宿主生命周期、界面组合、资料检索、整理、工作区移动、更新／设置、停用恢复、类型／构建／包检查及问题 88／90／92 的回归。辅助与夹具创建隔离真实宿主、网关调用者、客户端存储及合成投影／会话。

`host.test.mjs` 中值得保留的思路包括编码 ID、cwd 改变后使用初始化根目录、父目录保留、符号链接拒绝、物理失败后保留可重试登记、冷子代理枚举和 fork 保留。组合／界面测试覆盖确认、重复提交、批量结果、卸载恢复、远程绑定和设置位置。

9 个构建／发布脚本的职责如下：

| 脚本 | 职责及本项目决策 |
| --- | --- |
| `build.mjs` | 暂存构建、复用宿主 React、补充打包声明后发布可运行 `lib`；保留生成产物原则。 |
| `check-generated.mjs` | 要求提交 `lib` 且无依赖 prepare 构建；保留 GitHub 安装边界。 |
| `check-package.mjs` | 检查包完整性；本项目采用更小的清单。 |
| `test-version-matrix.mjs` | 隔离安装精确宿主代际并检查混版；先支持一个实际验证过的版本。 |
| `test-latest-compatibility.mjs` | 创建全新精确宿主环境；保留独立集成证据。 |
| `host-test-dependencies.mjs` | 固定测试中的宿主传递依赖，避免核心混版。 |
| `release-control.mjs` | 核对 npm 精确版本／git head 与 GitHub 发布；尚无 npm 分发时不需要。 |
| `extract-release-notes.mjs` | 提取发布所需更新条目；保留发布说明预检。 |
| `release-preflight.ps1` | 根据发布策略冻结安装并验证；采用适合本平台的可重复预检。 |

## 保留与改变

保留：宿主 React、TypeScript 严格模式、共享校验契约、集中兼容层、串行批量、逐项失败、GitHub 生成产物和合成集成夹具。

改变：仅处理已归档会话；先入可恢复回收站；不强制分离实时会话；待处理状态明确；列表／预览只读；整组移动有日志；不建立第二份投影镜像；不替换侧栏、不自建更新器、不修复缓存、不自动清理、不删除共享资源。

这些差异不证明市场空白。本项目的目标，是用自己的测试验证一个范围窄、状态一致、原生操作顺手的实现。
