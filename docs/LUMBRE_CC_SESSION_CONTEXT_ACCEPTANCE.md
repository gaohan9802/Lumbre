# Claude Code 会话与上下文桥：阶段 4 验收记录

日期：2026-09-06。分支：`codex/lumbre-cc-session-context`。开工基线：`013b0e7`。

当前结论：阶段 4 的本地实现与自动化验收已通过。Lumbre Chat 已能显式选择 API 或 CC 线路；CC 文字请求进入独立网关，同一 Lumbre 对话正常复用同一个 Claude Code session，并在从 API 切回 CC 时补齐 route gap。浏览器断线、刷新或 iOS 暂停不会授权取消后台任务；页面使用同一个 turn id 取回原 attempt。本阶段没有部署线上，也没有使用真实订阅做长对话或强制 compact 验收。

## 1. 本阶段实际完成

- Chat 的线路选择面板显示真实 CC 健康状态；未配置或离线时不可选择，不会伪造可用。
- `/api/chat` 明确分发 API 与 CC。CC 未配置、失败或后台唤醒未开放时明确报错，绝不偷偷改走 API。
- 只有 Lumbre 服务端持有网关 secret；浏览器不接触 OAuth、网关 secret 或完整 Claude session id。
- 首次 CC 轮以当前 Lumbre 系统提示、摘要/书签和选定历史建立 bootstrap；后续只发送 delta。
- CC 中间夹着 API 轮次时，route gap 会补入原 CC session；正常情况保持同一个 session id。
- Lumbre 消息仍是唯一正式历史。每条 CC 回复保存 attempt id、线路、模型、session 指纹、bootstrap/resume/rebase 原因、usage 与 compact 状态。
- 系统提示或已提交历史改变、回复锚点丢失、上个 attempt 失败/取消时，明确 rebase 到新 session 并记录原因；不静默复用不可信 session。
- 网关到 Lumbre 的 SSE 短断会按最后一个 durable event id 自动续接；连续无法续接时前端保留 pending 用户轮次，刷新或手动重试会取回同一个 attempt。
- 页面关闭/刷新只断开观看连接。只有用户点“停止生成”才调用取消接口；取消指令送不到时不假装任务已经停下。
- CC 仍以 `--tools ""`、空 MCP、`shell: false` 运行。没有给星星 Bash、Shell、源码读写或任意系统命令；生活工具桥属于阶段 5。

## 2. compact 后的保温设计

- 网关只读自己隔离 HOME 中本次新增的 Claude Code transcript 片段，识别结构化 `compact_boundary`；不让模型获得文件或命令工具。
- 确认上一轮发生 compact 后，下一条真实用户消息仍 resume 原 session；不会立刻制造一条隐藏“OK”，也不会把假消息写入 Lumbre。
- 下一次请求附带 compact 前最近 16 个用户轮次作为“已经发生的关系、语气与近况参考”，可通过 `CC_GATEWAY_REHYDRATE_TURNS` 在 10–20 内调整。
- 旧轮次与真正的新 delta 分开标记，明确禁止再次回答或当作新事件重演；只补一次。
- 如果 compact 后先走 API 再回 CC，API 轮次属于新 delta，不会再被重复放进旧历史块。
- Claude Code 官方说明 compact 会用摘要替换历史，并有意使对话层 prompt cache 失效；不变的 system/project 前缀仍可能命中。compact 摘要请求本身能读取旧缓存，但下一轮会为更短的新前缀重建缓存。因此“塞回旧 10–20 轮”不能当作免费 cache hit，最终轮数必须等阶段 6 的真实 cache read/create 与额度数据再调。

参考：<https://code.claude.com/docs/en/prompt-caching>、<https://code.claude.com/docs/en/context-window>、<https://code.claude.com/docs/en/sessions>。

## 3. 自动化证据

- [x] CC/Chat 定向测试：会话 bootstrap、同 session resume、API route gap、摘要/书签刷新、系统提示变化 rebase、失败/取消 rebase、compact 一次性保温、完整 session id 不下发、SSE 断线续接、幂等取回与主动取消。
- [x] `node --import tsx --test tests/integration/cc-gateway-http.integration.ts`：沙盒外临时 Unix socket 测试通过。
- [x] `npx tsc --noEmit --incremental false`：通过。
- [x] `npm test`：155/155 通过，0 失败。
- [x] `npm run build`：隔离临时 `DATA_DIR` 的生产构建通过，静态页面 38/38。
- [x] `git diff --check`：通过。

## 4. 容器与前端验收

- [x] `lumbre-cc-gateway:2.1.236` 镜像重新构建成功；build context 仍只含 `services/`。
- [x] 容器启动日志为 `CC_GATEWAY_READY port=8787`；`GET /healthz` 返回 `200` 与 Claude Code `2.1.236`。
- [x] 容器继续以非 root `uid=10001(ccgateway)` 运行；验收使用假 OAuth token，未提交真实 CC attempt。
- [x] 隔离临时数据目录 + 本地假网关完成桌面 Chat 验收：CC 健康状态、线路切换、文字发送、统一回复流、session 指纹与 usage 显示通过。
- [x] 刷新后同一条 CC 用户/助手消息、线路和 session 指纹仍在，没有重复回复。
- [x] 390×844 手机视口通过：消息、元数据、输入区与底部线路面板没有横向溢出或互相遮挡。
- [x] 临时预览、假网关与验收容器均已停止；没有改动生产数据或线上服务。

## 5. 本阶段没有提前宣称

- 尚未给 CC 接入 Lumbre 生活工具；阶段 5 接受控 MCP，Bash/Shell 仍永久禁止。
- 尚未制作侧栏额度卡与上下文水位卡；真实指标采集属于阶段 6。
- 尚未启用正常唤醒、暖缓存或隐藏 fork 实验；它们要在真实 session/usage 数据可见后，于阶段 7 单独设计和验收。
- 这次 compact 探测用结构化 fixture 验收，尚未用真实超长订阅 session 触发一次自动 compact；不能据此宣称真实缓存成本已经确定。
- CC 图片通道尚未开放；含图片的一轮会明确提示改走 API，不会丢图或静默去掉图片。
- 尚未部署、推送、合并到 `main`，也未消耗用户 Claude 订阅额度。

## 6. 下一步建议与回退

下一阶段只做生活工具桥：把现有 Lumbre 工具通过受控 MCP 交给 CC，并复用现有绿/黄/红权限、确认和审计；不给 Bash/Shell。额度、上下文卡与暖缓存不混进阶段 5。

阶段 4 的代码回退基线为 `013b0e7`。回退代码不应删除 Lumbre 聊天记录、`/persistent`、独立网关卷或用户 OAuth 凭据。若后续真实订阅验收发现 session/compact 行为与固定版本 fixture 不一致，先停用 CC 线路并保留 API，不清空正式聊天历史。
