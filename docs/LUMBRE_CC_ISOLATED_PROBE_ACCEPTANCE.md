# Claude Code 隔离探针：阶段 2 验收记录

日期：2026-09-06。分支：`codex/lumbre-cc-isolated-probe`。开工基线：`0676544`。

当前结论：阶段 2 已通过。隔离探针代码、容器边界和固定版本镜像均已建立；用户使用自己的 Pro 订阅 OAuth 完成真实 `inspect` 与 Sonnet smoke。探针没有接触 Lumbre 主站、生产数据或 API 密钥，也没有开放任何工具。

## 已完成的隔离边界

- CC CLI 固定为官方 stable `2.1.236`，镜像关闭自身更新。
- 镜像构建只复制 `services/cc-probe/`，不复制 Lumbre 源码、聊天历史、环境文件或生产卷。
- 非 root 用户在空工作区运行；没有 `/persistent` 挂载。
- 本阶段内置工具列表为空，MCP 配置为空且启用 strict 模式；系统策略再次拒绝文件、Shell、搜索和子代理工具。
- 空工具是隔离探针的临时边界。正式接入时会通过受限 MCP 开放全部现有 Lumbre 生活工具并沿用权限层，但永远不开放 Bash、Shell、任意系统命令或 Claude Code 自带的施工工具。
- 子进程使用环境白名单：允许订阅 OAuth token，但明确不继承 API key、API auth token、`DATA_DIR` 或 Lumbre 其他密钥。
- 调用不经过 shell，prompt 走 stdin；有三分钟超时和 4 MiB 总输出上限。
- 输出只保留结果状态、token 计数和不可逆 session 指纹，不打印 token、完整 session id 或回复正文。

## 探针将验证什么

1. `inspect`：版本是否严格等于 `2.1.236`，认证是否为预期的订阅 OAuth。
2. fresh JSON：`claude -p --output-format json` 能返回固定暗号和 session id。
3. resume stream：恢复原 session，以 stream-json 返回固定暗号，session id 必须不变。
4. fork JSON：从原 session 分叉，固定暗号正确且 session id 必须变化。
5. 记录三次调用的 input/output/cache creation/cache read token 字段；没有字段就记 null，不推算。
6. 任何非零退出、超时、输出超限、JSON 损坏或会话规则不符都判失败。

## 当前证据

- [x] `npm run test:cc-probe`：7/7 通过。
- [x] `npx tsc --noEmit --incremental false`：通过。
- [x] `npm test`：136/136 通过。
- [x] 隔离 `DATA_DIR` 生产构建：37/37 页面完成。
- [x] `git diff --check`：通过。
- [x] 无缓存构建固定版本容器：实际输出 `2.1.236 (Claude Code)`；build context 为 12.47 kB。
- [x] 断网容器运行 `inspect`：版本完全匹配；认证 `none`；无 API key、生产数据、内置工具或 MCP。
- [x] 容器身份为非 root `uid=10001(ccprobe)`；空 `/probe` 工作区没有误带入 Lumbre 文件。
- [x] 用户授权后完成真实 fresh / resume / fork smoke；报告 `ok: true`。

## 真实 smoke 脱敏结果

用户于 2026-09-06 在本机隔离容器中完成认证和真实请求。认证检查报告：

- `loggedIn: true`，`authMethod: oauth_token`，`apiProvider: firstParty`。
- 没有继承 API key、API auth token 或生产 `DATA_DIR`。
- CLI 版本为固定的 `2.1.236`。

Sonnet 三次请求结果：

| 调用 | session 指纹 | input | output | cache creation | cache read |
| --- | ---: | ---: | ---: | ---: | ---: |
| fresh JSON | `94b76b84557d` | 2 | 24 | 5,346 | 3,289 |
| resume stream-json | `94b76b84557d` | 2 | 24 | 103 | 8,635 |
| fork JSON | `6c8d4b86e5b6` | 2 | 23 | 102 | 8,738 |

验证结论：resume 保持原 session 指纹，fork 创建不同指纹；两次后续调用均出现真实 cache read，且只新增约一百 cache-creation tokens。这里只证明固定短探针上的会话与缓存行为，不把比例外推为 8–9 万 token 正式长窗口的额度消耗，也不提前宣称暖场策略已经通过。

## 下一阶段前仍需决定

- 隔离服务放在哪里，并确认该平台支持私密 secret 与持久卷。
- 正式 CC 网关首版使用的模型与 effort；本阶段探针使用 Sonnet。
- 部署时把本次方式生成的订阅 OAuth token 保存为平台加密 secret，并确定安全轮换方式。

本阶段真实 smoke 没有接 Lumbre 主站、读取真实聊天或把探针镜像部署成公开 endpoint。
