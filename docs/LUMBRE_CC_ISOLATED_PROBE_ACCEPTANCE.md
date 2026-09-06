# Claude Code 隔离探针：阶段 2 验收记录

日期：2026-09-06。分支：`codex/lumbre-cc-isolated-probe`。开工基线：`0676544`。

当前结论：隔离探针代码、容器边界和固定版本镜像已建立；真实 CLI 的离线 `inspect` 已通过。没有登录用户订阅或发出模型请求。只有用户确认部署与认证方式，并明确同意消耗少量订阅额度后，才运行真实 smoke。

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
- [ ] 用户授权后完成真实 fresh / resume / fork smoke

## 尚需用户决定

- 隔离服务放在哪里，并确认该平台支持私密 secret 与持久卷。
- 第一轮探针使用的 Claude 模型。
- 采用本机交互登录的持久认证目录，还是 `claude setup-token` 生成的部署 secret。

真实 smoke 不接 Lumbre 主站，不读取任何真实聊天，也不把探针镜像部署成公开 endpoint。
