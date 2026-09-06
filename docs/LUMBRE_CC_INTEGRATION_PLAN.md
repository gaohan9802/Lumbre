# Claude Code 住进 Lumbre：双线路施工蓝图

日期：2026-09-05。2026-09-06 更新：阶段 1 已合并 main，并获用户生产主站确认；阶段 2 已在 `codex/lumbre-cc-isolated-probe` 开工。

这份文档把外部施工蓝图、Lumbre 当前代码边界和本轮讨论合并为一份可执行计划。它是设计和验收依据，不是让自动化程序照单执行的指令。每次只施工一个阶段；完成检查和人工验收后，再决定是否进入下一阶段。

## 1. 我们最终要得到什么

同一个 Lumbre 对话可以逐轮选择两条生成线路：

- **API**：继续使用现在稳定的 Anthropic / OpenAI-compatible 网关。
- **Claude Code（CC）**：通过独立后端调用用户自己的 Claude Code 订阅会话。

切换线路不等于换聊天。Lumbre 保存的消息、摘要、书签、图片、Timeline 状态和工具结果仍是唯一正式记录，因此可以出现“API 几轮 → CC 几轮 → API 几轮”，两边都读取同一段 Lumbre 上下文，不因切换而丢失对话。

如果 CC 登录失效、额度不足、会话损坏或服务不可用，用户可以明确切回 API。系统不得把失败的 CC 请求偷偷改走 API，也不得因为浏览器断线就擅自杀死正在运行的 CC 任务。

## 2. 用人话解释整栋结构

把 Lumbre 想成家，聊天记录是家里的共同日记，而 API 和 CC 是两扇不同的送信窗口。

```text
手机 / PWA
   │ 选择本轮走 API 或 CC
   ▼
Lumbre Chat（共同日记、摘要、书签、图片、长短聊）
   │
   ├── API 路由 ── 现有模型网关 ── Anthropic / 兼容 API
   │
   └── CC 路由 ── 独立 CC 网关 ── 固定版本 Claude Code CLI
                                      └── 受限 MCP ── Lumbre 生活工具权限层
                                           （无 Bash / Shell）
```

这里需要一个后端。PWA 关掉、手机锁屏或网络闪断以后，浏览器不能可靠地替我们守着 Claude Code 进程、会话、缓存和定时唤醒；订阅登录材料也不应放进前端。因此 CC 网关必须运行在持续在线、带持久存储的服务里。它与 Next.js 可以部署在同一平台，但必须是独立进程、独立环境变量和受限文件系统，不能把整套生产密钥与 `/persistent` 直接交给 Claude Code。

未来做 SwiftUI 时不需要全部重写。聊天 UI 会重做成原生界面，但这次建立的后端协议、任务状态机、会话映射、额度/上下文指标、队列、缓存策略、统一工具权限层和 Lumbre 消息数据都可以继续使用。

## 3. Lumbre 当前可复用的地基

| 已有能力 | 位置 | 接 CC 时怎么用 |
| --- | --- | --- |
| 正式聊天记录与懒加载 | `src/features/chat/`、`src/server/chat-sync.ts` | 继续做唯一历史源；不把 CC session 当数据库 |
| API 模型网关 | `src/server/chat/orchestrator.ts`、`src/server/chat/providers/` | 保持原线路，不塞入 CC CLI 特例 |
| 统一生活工具权限 | `src/server/agent/` | CC 通过受限 MCP 请求全部现有生活工具；不获得 Bash/Shell |
| 摘要与书签注入 | Chat feature / summary route | 两条线路共用同一份组装结果 |
| 离线待发箱 | `src/features/chat/sync/outbox.ts` | 扩展为带线路和 attempt id 的可靠提交 |
| 持久数据层与备份 | `src/server/data/`、`scripts/persistent-backup.mjs` | CC 新表/文件沿用同级安全与备份规则 |
| SSE 流式展示 | `/api/chat`、chat event stream | 两条线路最终都转换成统一事件 |

当前缺少的是：真正的 CC 运行环境、CLI 版本与登录验证、会话映射、任务重连、额度采集、上下文指标、缓存暖场队列，以及把现有 Lumbre 生活工具安全交给 CC 的桥梁。

## 4. 已确定的核心规则

### 4.1 历史与 session

- Lumbre 消息是唯一正式历史；Claude Code session 只是运行缓存。
- 每个 Lumbre 对话保存一个当前 CC session id，同时保留可审计的 session 代际记录。
- 首次走 CC 时发送 **bootstrap**：稳定系统前缀、必要摘要/书签和选定历史。
- 后续走 CC 时优先发送 **delta**：只补自上次成功提交以来的新内容。
- 从 API 切回 CC 时补 **route gap**：把 CC 未见过的 API 轮次补进去。
- 优先 `resume` 原 session；确实损坏或不兼容时才新建，并记录原因，不能静默丢掉旧映射。
- Claude Code 确认发生 compact 后，不立即制造一条隐藏对话；在下一条真实用户消息里沿用原 session，并附带 compact 前最近 10–20 个用户轮次作为“已发生的语气/关系参考”。这些内容不得被当作新消息再次回答。
- compact 后不能假定旧的对话层缓存仍有效。系统/项目等未改变前缀可能继续命中，但补回的旧轮次按新前缀重新处理；具体轮数必须根据真实 cache read/create 与额度消耗调整。

### 4.2 每轮线路与可靠交付

- 会话保存“下一轮默认线路”，每条用户消息、助手回复和回复版本保存“本轮实际线路”。
- 每次生成建立唯一 attempt；状态至少包括 queued、running、completed、failed、cancelled。
- 浏览器断线只表示客户端离开，不等于取消任务。服务端继续运行，并在完成后先保存结果，再提交正式 assistant 消息。
- 重连按 attempt id 续看；重复提交不能生成两条相同回复。
- 用户主动停止才进入取消流程；取消是否成功要有真实状态，不能只把前端动画停掉。
- 不做自动静默降级。CC 失败时显示原因和“改走 API 重试”的明确选择。

### 4.3 缓存、心跳与暖场

- 缓存命中以真实 `cache_read` 指标为准，不能仅凭 session 仍存在就宣称缓存还热。
- 正常心跳可以调用工具、写入消息和推送；缓存暖场只能做最轻量调用，返回固定确认并丢弃，不写聊天历史。
- 两者由同一个调度器协调，但不是同一种任务。
- 初始优先级：用户消息 > 闹钟/明确计划 > 正常心跳 > 缓存暖场。
- 用户活跃时跳过普通心跳；接近缓存边界且没有更高优先级任务时，才考虑暖场。
- 暖场不会默认复用主 session 做隐藏轮次。先单独验证 `resume + fork-session` 是否既命中缓存又不污染主会话；验证失败就停用暖场方案，而不是伪造成功。
- 暖场收益必须用实测额度和缓存数据决定。朋友经验中的百分比是观察值，不写死成产品规则。

### 4.4 工具与安全

- API 保持当前工具循环；CC 通过严格 MCP 桥请求同一套 Lumbre 生活工具，沿用现有权限、确认、审计和安全检查。
- 现有 Lumbre 生活工具全部向 CC 开放，不另做缩水版 allowlist；红色操作仍必须确认，后台唤醒仍遵守现有 unattended 限制。
- CC 永远不获得 Bash、Shell 或任意系统命令执行能力。Claude Code 自带的源码读写/施工工具也不直接开放；文件型生活能力必须包装成受控的 Lumbre 工具后再进入权限层。
- CC 可以读取由 Lumbre 明确组装后发送的聊天文本，包括已经写入正式历史的旧工具结果。
- 第二阶段隔离探针仍使用空工具、空 MCP，只验证 CLI 本体；真实生活工具从第五阶段开始接入。
- 不默认使用 `--dangerously-skip-permissions`，不把 Claude Code 放进 Next.js 主进程，也不让前端持有 CC 登录材料。
- CC endpoint 需要独立鉴权、限流、超时、并发限制和审计；日志不得记录订阅凭据或完整私密对话。

### 4.5 额度和上下文卡片

左侧会话列表下方最终有两张真实状态卡：

- **CC 额度**：状态、窗口剩余/重置时间、最近刷新时间、采集来源；拿不到就显示“暂时不可读取”，不编数字。
- **CC 上下文水位**：当前 CC session 已用/上限、百分比、模型、最近刷新时间；与 Lumbre 选择的历史条数分开显示。

状态由后端采集后给前端统一 JSON。CLI/平台没有稳定字段时，适配器可以暂时返回 unavailable；不能用前端倒计时冒充官方额度。CC CLI 版本固定，升级前重跑会话、输出、额度、缓存和工具协议验收。

## 5. 计划中的后端对象

名字可以在实现时调整，职责不能混在一起。

| 对象 | 作用 |
| --- | --- |
| `GenerationRoute` | 在 API 与 CC 两条高层线路间分发，位于现有 provider adapter 之上 |
| `CcGateway` | 隔离并调用固定版本 CLI，把输出转换成 Lumbre 统一事件 |
| `CcSessionBinding` | 记录 conversation id、CC session id、已同步游标和代际 |
| `GenerationAttempt` | 记录一轮请求的幂等 id、状态、结果、错误和取消状态 |
| `CcMetricsSnapshot` | 记录额度、上下文、缓存与采集时间；允许 unavailable |
| `WakeScheduler` | 合并用户任务、闹钟、心跳和暖场队列，执行优先级与去重 |
| `CcMcpBridge` | 将 CC 的生活工具调用交给 Lumbre 权限执行器；永不暴露 Bash/Shell |

第一版可以继续使用当前安全 JSON 数据层，不为了 CC 顺手换数据库。若压力测试证明并发任务、锁和查询已超过它的边界，再把任务账本迁到 SQLite/Postgres；迁移必须是单独阶段。

## 6. 分阶段施工

| 阶段 | 施工内容 | 通过标准 |
| --- | --- | --- |
| 1. Chat 双线路外壳 | 线路类型、会话偏好、消息/版本元数据、同步/待发/续窗兼容；输入区显示真实 API 线路并复用模型选择 | 旧数据默认为 API；刷新、版本切换、续窗、跨设备合并不丢字段；没有 CC 假按钮或假额度 |
| 2. CC 隔离探针 | 独立服务中安装并固定 CLI；验证登录、`-p`、stream-json、resume/fork、退出码和超时 | 不接生产聊天；脱敏输入可跑；进程不能访问生产数据和额外密钥；记录准确版本与输出样本 |
| 3. CC 网关与 attempt | 建任务账本、幂等提交、SSE/轮询重连、结果先落盘、明确取消 | 断网/刷新后找回同一任务；重复请求不重复回复；CC 失败不偷偷走 API |
| 4. 会话与上下文桥 | bootstrap/delta/route-gap、session 映射、损坏后受控新建、compact 探测与一次性 10–20 轮保温 | API→CC→API→CC 连续对话不丢语义；正常情况复用同 session id；compact 后不重演旧消息 |
| 5. 生活工具桥 | CC MCP → 现有权限执行器；开放全部现有 Lumbre 生活工具，但不提供 Bash/Shell | 生活工具可正常调用且保留确认/审计；任意命令执行与 Claude Code 施工工具不可见、不可用 |
| 6. 指标卡 | 后端采集真实额度、上下文、缓存指标；侧栏卡片与刷新状态 | 有数据才显示数值；过期、失败、未支持均清楚标注；手机与桌面不挤压会话列表 |
| 7. 心跳与缓存实验 | 统一队列、活跃跳过、暖场 fork 实验、成本日志 | 主 session 不被隐藏消息污染；只有实测 cache_read 成功才启用暖场；优先级正确 |
| 8. 预览与生产 | 脱敏预览、故障演练、备份/回退、手机 PWA 验收 | API 回退可用；长对话与工具无回归；用户明确批准后才合并与部署 |

## 7. 第一阶段的精确边界

本阶段只改 Chat 外壳和兼容数据，不调用 Claude Code：

- 新增 `api | claude-code` 线路类型；旧会话和旧消息按 API 兼容。
- 会话保存下一轮默认线路及更新时间；消息和消息版本保存实际线路。
- 线路字段经过浏览器持久化、服务端 manifest/session、增量同步、离线待发箱、续窗、分支和版本快照。
- 输入区显示当前真实线路。当前只有 API 可用，因此点击后展示 API 模型选择；CC 行在后端完成健康检查前不出现。
- 助手消息元数据显示实际线路和模型，为以后混合线路保留可读记录。
- 不添加额度卡、不添加 CC session、不改摘要算法、不改现有工具循环。

本阶段回退只需回退代码；新增字段均为可选，旧版本仍能读取聊天数据。禁止通过清空 localStorage、IndexedDB 或生产卷回退。

## 8. 后续开工前仍需的人类决定

阶段 2 真正发出第一条 CC 请求前，需要用户确认：

- CC 服务部署位置和可用持久卷；
- 首个验证模型与 effort；
- 订阅登录的人工初始化方式；
- 额度不可读时卡片是否只显示状态，还是暂时整卡隐藏。

这些选择不会阻塞阶段 1。

## 9. 每阶段固定验收

每一阶段至少执行：相关定向测试、完整 `npm test`、`npx tsc --noEmit --incremental false`、`git diff --check`，以及使用隔离临时 `DATA_DIR` 的生产构建。涉及前端时再做桌面、手机宽度与 PWA 实测；涉及生产数据前先按 `docs/SAFETY_BASELINE_RUNBOOK.md` 备份并验证。

“构建通过”不等于“手机通过”，“已推分支”不等于“已上线”。每一项只记录真正做过的证据。

## 10. 当前施工记录

- [x] 读取并评估外部蓝图。
- [x] 对照 Lumbre 当前架构补齐安全、会话、缓存和迁移边界。
- [x] 建立施工分支 `codex/lumbre-cc-chat-shell`。
- [x] 完成阶段 1 代码。
- [x] 完成自动化检查与本地桌面/手机宽度检查。
- [x] 用户确认测试分支第一阶段整体正常。
- [x] 用户批准合并 main 并触发生产发布。
- [x] 用户确认生产主站通过。
- [x] 用户批准进入阶段 2。
- [x] 建立阶段 2 分支 `codex/lumbre-cc-isolated-probe`。
- [x] 完成阶段 2 隔离探针的离线自动化验收。
- [x] 用户使用 Pro 订阅 OAuth 与 Sonnet 完成真实 fresh / resume / fork 探针；session 与 cache-read 证据通过。
- [x] 用户确认阶段 2 验收并批准进入阶段 3。
- [x] 建立阶段 3 分支 `codex/lumbre-cc-gateway-attempt`。
- [x] 完成阶段 3 网关、任务账本与断线续接的本地自动化、生产构建及容器验收；未接真实 Chat、未调用订阅、未部署线上。
- [x] 用户确认阶段 3 验收并批准进入阶段 4。
- [x] 建立阶段 4 分支 `codex/lumbre-cc-session-context`。
- [x] 完成阶段 4 会话/上下文桥、compact 保温与 Chat 双线路本地接线验收；记录见 `docs/LUMBRE_CC_SESSION_CONTEXT_ACCEPTANCE.md`。
- [ ] 补做未逐项回报的真机 PWA 与跨设备检查（不阻塞隔离探针）。

## 11. 官方行为参考

- Claude Code CLI 参数与输出格式：<https://code.claude.com/docs/en/cli-usage>
- 无交互调用与结构化输出：<https://code.claude.com/docs/en/headless>
- 会话恢复与分叉：<https://code.claude.com/docs/en/sessions>
- Prompt caching：<https://code.claude.com/docs/en/prompt-caching>
- Context window 与 compact：<https://code.claude.com/docs/en/context-window>
- Hooks（`SessionStart` 的 `compact` 来源用于行为参考；当前实现不授予模型 hook 命令权限）：<https://code.claude.com/docs/en/hooks>
- Status line 可用上下文字段：<https://code.claude.com/docs/en/statusline>
- Claude 订阅用于 `-p` / Agent SDK 的当前说明：<https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan>

2026-09-06 现场核对：Anthropic 已暂停原定的 Agent SDK 月度 credits 改动；目前 `claude -p`、Agent SDK 与第三方应用仍计入订阅 usage limits。若官方之后再次调整，必须先重跑额度与认证探针，再修改产品文案。

外部平台与 CLI 行为会变化。实际施工时以固定版本的现场探针和官方文档为准，本文不把尚未验证的字段承诺成稳定协议。
