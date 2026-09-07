# Claude Code 生活工具桥：阶段 5 验收记录

日期：2026-09-07。分支：`codex/lumbre-cc-tools-bridge`。开工基线：`7dfd346`。

当前结论：阶段 5 的本地实现、权限定向测试、完整测试、隔离生产构建和网关镜像构建已通过。隔离预览环境也已用真实 Claude Code 订阅完成首次绿色只读工具调用和刷新恢复。Claude Code 只能通过固定的 Lumbre MCP 请求现有生活工具；其内建 Bash、Shell、文件读写、源码施工、WebSearch 等能力仍全部移除。没有改动主站，没有读取生产 `/persistent`，也没有向生产数据执行工具。

## 1. 实际完成

- Lumbre 新增 secret-only 的内部工具桥入口。它只向 `chat` 来源暴露现有注册表中的 66 项生活工具，不复制第二套工具实现。
- CC 网关只在同时配置独立工具桥 URL 与 secret 时加载固定 stdio MCP；未配置时文字聊天保持兼容，健康检查明确返回 `lumbreTools: false`。
- Claude Code 继续使用 `--tools ""`、`--strict-mcp-config` 和 `dontAsk`；唯一预批准项是 `mcp__lumbre__*`，不是 `bypassPermissions`。
- 每个 CC attempt 最多调用 20 次生活工具；MCP 串行执行请求，避免写操作互相竞速。
- 工具事件路径只接受网关生成的规范 UUID 与合法会话号；异常上下文会在启动 Claude Code 前关闭，不会创建越界文件。
- 绿、黄、红、黑权限仍由 Lumbre 原执行器决定。红色操作不会先执行：主站生成绑定当前用户与会话的一次性确认，Claude 只看见去掉 token 的结果，前端沿用现有确认框执行或拒绝。
- 工具事件先写入 CC attempt 账本再推送，浏览器短断或刷新后可以重放；密码、token、secret、API key 等敏感输入在进入网关事件前会被遮盖。
- `view_foto` 对 Lumbre 内保存的 data URL 图片返回 MCP image block；聊天历史与工具卡继续剥离图片大字段。
- 网关容器仍不挂载 Lumbre 生产卷；工具只能通过受鉴权的主站入口访问数据。

## 2. 两边需要的部署变量

Lumbre 主站：

- `LUMBRE_CC_TOOL_BRIDGE_SECRET`：新的随机 secret，至少 32 字符。

CC 网关：

- `LUMBRE_CC_TOOL_BRIDGE_URL`：Lumbre 内部 HTTPS 地址加 `/api/internal/cc-tools`。
- `LUMBRE_CC_TOOL_BRIDGE_SECRET`：与主站相同。
- `CC_GATEWAY_MAX_TOOL_CALLS`：可选，默认且最高为 20。

它与 `LUMBRE_CC_GATEWAY_SECRET` 是相反方向的第二把钥匙，不复用、不进入浏览器、不提交 Git。配置不完整或非回环 HTTP 时，网关启动失败并明确报错。

## 3. 自动化与构建证据

- [x] `npx tsc --noEmit --incremental false`：通过。
- [x] CC 工具桥定向测试：内部鉴权、66 项注册工具、无 Bash/Shell/文件工具、MCP list/call、敏感输入遮盖、红色确认 token 隔离、工具事件续传均通过。
- [x] `npm test`：161/161 通过，0 失败。
- [x] `npm run build`：隔离临时 `DATA_DIR` 的生产构建编译与 39/39 静态页面生成通过。
- [x] `git diff --check`：通过。
- [x] `lumbre-cc-gateway:2.1.236-stage5` 镜像构建通过；build context 仍只有 `services/`，Claude Code 固定为 `2.1.236`。
- [x] 隔离预览：Lumbre 主服务能经项目内网访问 CC 网关；网关无公网域名，未授权的工具桥请求返回 `unauthorized`。
- [x] 真实订阅绿色只读：新预览对话通过 CC 原生调用且只调用一次 `read_todo`，读到 2 条脱敏测试数据；页面显示 `CC · sonnet`、会话指纹、`bootstrap · first_cc_turn` 与 100% 缓存命中。
- [x] 刷新恢复：用户消息、CC 回复和单张 `read_todo` 工具卡都能恢复，没有重复执行工具。
- [x] 预览中额外出现的 `BOOKMARK_OK` 已确认来自用户主动设为常驻的阶段四测试书签，这同时验证了首次 CC bootstrap 携带 Lumbre 书签上下文。

## 4. 还没有宣称

- 尚未在预览环境完成绿色写入、红色删除确认框、真实图片查看、API→CC 线路切换和手机 PWA 恢复。
- 没有逐项执行 66 个工具，尤其没有触发邮件、删除、密码或其他真实副作用；验证的是全部 schema 均来自同一注册表，并对绿读、红确认和传输边界做代表性执行测试。
- CC 直接接收用户本轮上传图片仍属于后续单独范围；本阶段只接通 `view_foto` 生活工具返回的已保存图片。
- 阶段 6 的额度/上下文卡和阶段 7 的心跳/暖缓存没有提前施工。

## 5. 预览验收清单

1. [x] 两个预览服务使用脱敏卷和测试 secret，主服务健康检查确认 CC 可用，工具桥未授权访问被拒绝。
2. [x] 在一条可丢弃对话切到 CC，让星星调用 `read_todo`，原生工具卡与自然回复均出现，刷新后仍只有一次调用。
3. 让星星写一张明确标记为测试的小纸条，确认只写一次；刷新页面后回复与工具卡仍在。
4. 对这张测试纸条请求删除，确认删除前出现浏览器确认；先拒绝一次验证未删除，再重新请求并允许，确认只执行一次。
5. 让星星调用 `read_foto`，再对一张脱敏测试图调用 `view_foto`，确认实际看见图片而非只读到 URL。
6. 确认 CC 回复元数据仍是同一个 session 指纹；切 API 一轮再切回 CC，工具和 route gap 都正常。
7. 手机 PWA 后台/恢复和刷新一次，确认未产生重复工具调用或重复回复。
8. 网关日志和 attempt 文件不出现 OAuth token、工具桥 secret、密码或完整图片 data URL。

## 6. 回退

阶段 5 的代码回退点为 `7dfd346`。回退时只移除阶段 5 代码和两个服务中的工具桥变量，不删除聊天记录、确认账本、网关卷、CC session 或 Lumbre `/persistent`。工具桥异常时可以先移除网关侧两项工具桥配置，使 CC 回到阶段 4 的纯文字模式；API 线路保持可用。
