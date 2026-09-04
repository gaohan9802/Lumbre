# Lumbre 第三块验收单：模型调用管道

分支：`codex/lumbre-03-model-gateway`

## 已完成

- `/api/chat` 从 1175 行缩为 10 行轻量入口；公共编排迁入 `src/server/chat/orchestrator.ts`。
- Anthropic 与 OpenAI-compatible 分别成为独立适配器，共用一套工具循环、调用上限、事件、重试、超时和错误处理。
- 文本、思考、工具调用、用量、完成和错误统一为同一组上层事件。
- 浏览器聊天、摘要和模型列表请求只提交渠道 ID 与模型 ID，不再提交 API Key 或 Base URL。
- 旧同步配置会在服务端首次读取时自动迁移：API Key 加密保存到 `/persistent/model-gateway/credentials.json`，同步配置随后原子改写为无密钥版本。
- 浏览器存储版本升至 v10：旧明文凭据只在页面进程内短暂排队上传，成功后清空；localStorage 与 IndexedDB 不保存模型凭据。
- 上游只允许 HTTPS、公网 DNS/IP，阻止本机、内网、保留地址和跨站重定向。
- 保留迁移兼容：已注册渠道的旧请求格式会改用服务器凭据；紧急情况下可短时设置 `LUMBRE_MODEL_GATEWAY_LEGACY_INGEST=1`，但不得长期启用。
- 预留统一适配器接口；本阶段没有接入 Claude Code，也没有改聊天视觉或数据格式。

## 本地验证

- `npx tsc --noEmit --incremental false`：通过。
- `npm test`：92/92 通过。
- `DATA_DIR=/tmp/lumbre-stage3-build-data npm run build`：生产构建通过，静态生成 37/37，并包含新增的 `/api/model-profiles` 动态入口。
- `git diff --check`：通过。
- 测试覆盖 Anthropic/OpenAI 普通与流式响应、图片、工具往返、思考与用量、429 重试、服务端密钥、浏览器升级、同步清理、旧入口兼容和摘要调用。

## 预览环境验收

1. 将预览服务 Source 改为 `codex/lumbre-03-model-gateway` 并等待 Running。
2. 登录后打开“模型 API 管理”。脱敏预览数据里的占位 key 不会被迁移，因此请选择一个测试渠道，输入真实 Base URL 与 API Key，点击“保存凭据到服务器”。
3. 确认渠道卡片显示“服务器已配置”，但页面不显示 key；刷新后仍显示已配置。
4. 分别验证普通聊天、流式聊天、图片消息、一个只读工具，以及一个会弹确认框的红色工具（先取消，再用临时数据批准一次）。
5. 验证自动摘要或手动重生成一张可丢弃摘要；确认模型列表“拉取”仍可用。
6. 在预览服务终端运行 `npm run verify:model-gateway`。期望：
   - `MODEL_GATEWAY_SYNC_FORBIDDEN_FIELDS 0`
   - `MODEL_GATEWAY_PLAINTEXT_FIELDS 0`
   - `MODEL_GATEWAY_CREDENTIAL_RECORDS` 与 `MODEL_GATEWAY_ENCRYPTED_RECORDS` 相等，且至少为 1。
7. 手机与电脑各刷新一次，确认旧会话、摘要、书签、模型名称和选择仍在；新消息可跨设备同步。

## 回退

- 预览异常时，把预览 Source 切回 `main`；不要把预览服务绑定到正式卷。
- 正式环境合并前保留当前备份。正式部署后若模型网关异常，优先回滚代码并保留 `/persistent/model-gateway/credentials.json`；不得把备份里的明文 API Key 重新开放给同步接口或浏览器。
- 旧请求兼容默认只使用已迁移的服务器凭据。仅为处理未刷新的旧标签页时，才可临时打开 `LUMBRE_MODEL_GATEWAY_LEGACY_INGEST=1`，完成迁移后立即删除该变量并重启。

## 当前结论

本地实现和自动化验证已通过；仍需在隔离预览服务使用真实上游完成验收，并按计划观察稳定性。未授权合并或正式部署。
