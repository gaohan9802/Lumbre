# Claude Code 任务网关：阶段 3 验收记录

日期：2026-09-06。分支：`codex/lumbre-cc-gateway-attempt`。开工基线：`dc30f03`。

当前结论：阶段 3 的本地实现与自动化验收已通过。独立网关会先保存任务，再异步调用固定版本 Claude Code；网页断线不会杀掉任务，重复提交不会生成两次，最终结果先落盘再广播完成事件。本阶段没有接入 Lumbre Chat、没有发出真实模型请求，也没有部署线上。

## 1. 本阶段实际完成

- 新增独立 `services/cc-gateway` 容器，不复制 Lumbre 源码、聊天记录、环境文件或生产数据卷。
- 建立持久 attempt 账本：`queued → running → completed | failed | cancelled`。
- 创建请求必须带幂等键；同一个幂等键始终取回同一个 attempt。
- 每次状态与流式文本事件都带递增 event id；SSE 支持 `Last-Event-ID` / `?after=` 回放，轮询可随时取回状态和最终结果。
- 浏览器连接只负责观看，不拥有后台任务；浏览器关闭或刷新不会触发取消。
- 只有明确调用 cancel endpoint 才会取消任务；运行中的 Claude 子进程先收到 `SIGTERM`，必要时升级为 `SIGKILL`。
- 最终回复和 usage 先原子写入账本，再发出 `completed` 事件，避免页面先看到完成、刷新后却找不到结果。
- 网关重启后，尚未开始的 queued 任务重新排队；已经失去子进程的 running 任务明确失败为 `gateway_restarted`，不会伪装完成或偷偷切换 API。
- prompt 只在排队/运行期间暂存；完成、失败或取消后从主记录和最新恢复备份中清除。
- Claude Code 仍以空工具、无 Shell、无 MCP 运行；正式生活工具桥属于阶段 5。

## 2. 隔离与认证边界

- 网关只接受固定服务端 Bearer secret；除健康检查外，未认证请求返回 `401`。
- OAuth token 只通过容器 secret 注入 Claude 子进程，不进入 attempt 账本、HTTP 响应或日志。
- 子进程使用环境白名单、`shell: false`、固定参数、超时与总输出上限。
- 独立数据目录为 `/gateway-data`，代码明确拒绝 Lumbre 生产卷 `/persistent`。
- 容器以非 root 的 `uid=10001(ccgateway)` 运行。
- Claude Code 固定为 `2.1.236`，基础镜像也固定到 digest。
- 阶段 3 只允许单副本运行；多副本任务租约尚未实现，部署时不得自动横向扩容。

## 3. 自动化证据

- [x] `npm run test:cc-gateway`：9/9 通过。
- [x] 专项覆盖：HTTP 认证、SSE 断线与回放、轮询取回、幂等、防重复、结果先落盘、主动取消、服务重启、固定安全参数、生产卷拒绝、损坏账本失败关闭。
- [x] `npx tsc --noEmit --incremental false`：通过。
- [x] `npm test`：144/144 通过，0 失败。
- [x] `npm run build`：隔离临时 `DATA_DIR` 的生产构建通过，静态页面 37/37。
- [x] `git diff --check`：通过。

## 4. 容器验收

- [x] 最终镜像构建成功，build context 为 8.77 kB。
- [x] 容器启动日志为 `CC_GATEWAY_READY port=8787`。
- [x] `GET /healthz` 返回 `200`，并报告 Claude Code `2.1.236`。
- [x] 带正确服务端 secret 查询不存在任务返回 `404`；不带 secret 返回 `401`。
- [x] 容器身份为非 root `uid=10001(ccgateway)`。
- [x] 验收只使用假 OAuth token，未提交 attempt、未调用 Claude、未消耗订阅额度；临时容器已停止并自动移除。

## 5. 本阶段没有提前宣称

- 尚未把 `/api/chat` 接到网关，因此生产 Chat 仍只有现有 API 线路可真正发送。
- 尚未建立 conversation 与 Claude session 的绑定、resume/fork/rebase 规则；这是阶段 4。
- 尚未实现缓存暖场、正常唤醒合并、额度检测或上下文水位表。
- 尚未开放 Lumbre 生活工具；阶段 5 会走受控 MCP，Bash/Shell 仍永久禁止。
- 尚未做真实长窗口、真实订阅额度或线上断线恢复测试。
- 尚未部署或合并到 `main`。

## 6. 回退

阶段 3 只新增独立服务、测试和文档，没有修改现有 Chat 运行路径。需要回退时撤销本阶段提交即可；开工基线为 `dc30f03`。不得删除 Lumbre 聊天记录、生产 `/persistent` 或用户 OAuth 凭据作为回退手段。
