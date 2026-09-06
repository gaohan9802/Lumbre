# Lumbre CC Gateway（阶段 3–4）

这是一只独立于 Next.js 主站的任务邮局。它接收经过服务端认证的 CC 请求，先把任务落盘，再异步调用固定版本 Claude Code。浏览器或调用方断线不会取消任务；重新连接可以按 attempt id 查询状态或从最后一个 SSE event id 继续接收。

本阶段没有接入正式 Chat，也没有配置 MCP。CC 仍以 `--tools ""` 运行；生活工具桥属于阶段 5，Bash/Shell 和任意系统命令永不开放。

## 数据与状态

- 独立数据卷：`/gateway-data`，明确拒绝 `/persistent`。
- 每个 attempt 独立原子 JSON，权限为 `0600`，覆盖前保留 `.bak`。
- prompt 只在 queued/running 期间暂存；完成、失败或取消后立即从主账本及最新恢复备份清除。
- 状态：`queued → running → completed | failed | cancelled`。
- 同一个 `idempotency_key` 永远返回同一个 attempt，不会重复生成。
- 最终结果先写入账本，再广播 `completed` 事件。
- 服务重启时，未开始的 queued 任务重新排队；失去子进程的 running 任务明确标记 `gateway_restarted`，不伪装完成也不偷偷转 API。
- Claude Code 的 HOME 放在 `/gateway-data/claude-home`，CLI session 随独立卷保留；Lumbre 消息仍是唯一正式历史。

## 会话与 compact 保温

- 第一次走 CC 时以 Lumbre 当前选定上下文建立 session；之后只发送新增消息，并用 `--resume` 保留同一个 session id。
- 中途切去 API 再切回 CC 时，API 新增轮次作为 route gap 补给原 CC session，不另开聊天。
- Lumbre 历史被编辑、回复锚点丢失，或上次 CC 任务失败/取消时，才明确 rebase 到新 session，并记录原因。
- 网关只读自己隔离 HOME 内的 Claude Code transcript，记录本次成功调用是否出现结构化 `compact_boundary`；这不会给模型增加 Bash、Shell 或文件工具。
- 确认 compact 后，下一条真实用户消息仍 resume 原 session，同时补入 compact 前最近 16 个用户轮次（可用 `CC_GATEWAY_REHYDRATE_TURNS` 调为 10–20）。旧轮次标明为已发生的语气/关系参考，不能被当作新消息重演；只补一次，不产生隐藏聊天轮次。
- compact 会改变会话前缀，所以这批补入内容不能假定仍命中旧的对话层缓存。是否值得补 10、16 或 20 轮，要等真实 cache read/create 指标后决定。

## HTTP 契约

- `GET /healthz`：不含隐私的健康状态。
- `POST /v1/attempts`：创建或取回幂等任务。
- `GET /v1/attempts/:id`：轮询任务状态与最终结果。
- `GET /v1/attempts/:id/events`：SSE 回放与续接，支持 `Last-Event-ID` 或 `?after=`。
- `POST /v1/attempts/:id/cancel`：明确请求取消。
- `POST /v1/attempts/cancel-by-key`：在页面尚未收到 attempt id 时，仍可按幂等键明确取消。

除 `/healthz` 外全部要求 `Authorization: Bearer <LUMBRE_CC_GATEWAY_SECRET>`。这个 secret 只存在于 Lumbre 服务端与网关的部署 Secret 中，不能下发浏览器。OAuth token 同样只通过部署 Secret 注入。

## 构建边界

从仓库根目录执行，但把 build context 限定为 `services/`：

```bash
docker build -f services/cc-gateway/Dockerfile -t lumbre-cc-gateway:2.1.236 services
```

镜像只收到 CC probe 的固定 CLI 合同、系统级拒绝策略和 gateway 文件，不会收到 Lumbre 源码、聊天记录、`.env` 或生产卷。

当前只支持单副本网关；部署时必须保持 replicas = 1 且关闭自动横向扩容。多副本竞争同一任务要等后续改用数据库租约后才能开放。
