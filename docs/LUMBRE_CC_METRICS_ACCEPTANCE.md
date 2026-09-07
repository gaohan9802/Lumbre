# Claude Code 额度与上下文卡：阶段 6 验收记录

日期：2026-09-07。分支：`codex/lumbre-cc-metrics`。开工基线：`55e96f2`。功能提交：`1d0a0c5`。

当前结论：阶段 6 已通过本地检查和真实 Claude Code 订阅预览验收。Chat 会话侧栏会显示 CC 线路状态和当前会话的真实上下文水位；安全后台模式拿不到的五小时/七天订阅额度明确显示“暂不可读”，没有估算或伪造倒计时。主站 `main` 未改动。

## 1. 实际完成

- CC 网关记录每次真实回复返回的 input、cache read、cache write 和模型，不读取完整 session id 到浏览器。
- Lumbre 通过已有的 secret-only 网关边界读取指标；浏览器仍只能经用户认证后的同源接口访问。
- 上下文水位按 Claude Code 官方口径计算：`input_tokens + cache_creation_input_tokens + cache_read_input_tokens`，不把 output 算入上下文。
- 新 CC 回复完成后自动刷新卡片，也可手动刷新；无真实回复时显示等待态。
- 只根据返回的实际模型确定已知的上下文上限，未知模型不猜。

## 2. 真实预览证据

- [x] Lumbre 预览与 CC 网关都运行功能提交 `1d0a0c5`。
- [x] 新鲜 CC 请求只回复 `CC_METRICS_OK`，没有调用任何工具。
- [x] 回复仍使用原会话指纹 `52c5b5bf1271`，标记为 `resume · ordinary_delta`，没有为了读数重建 session。
- [x] 回复后上下文卡自动从“等待首条 CC 回复”更新为 `36.8K / 1M`、`3.7%`，并显示真实模型 `claude-sonnet-5` 与本轮 cache write `36.8K`。
- [x] 额度卡显示“暂不可读”和“线路在线”，明确说明安全后台模式未开放五小时/七天额度，没有用本地倒计时充当真实额度。
- [x] 桌面预览：卡片固定在会话列表下方，不遮挡消息区或输入框。
- [x] 390×844 手机预览：会话列表可独立滚动，两张卡完整显示在抽屉底部，无横向溢出、截断或输入区遮挡。

## 3. 自动化与构建证据

- [x] `npx tsc --noEmit --incremental false`：通过。
- [x] `npm run test:cc-gateway`：24/24 通过。
- [x] `npm test`：162/162 通过，0 失败。
- [x] `npm run build`：隔离可写 `DATA_DIR` 的生产构建通过。
- [x] CC 网关 HTTP 集成测试：沙盒外 Unix socket 复测通过；沙盒内的 `listen EPERM` 仅是本地权限限制。
- [x] `git diff --check`：通过。

## 4. 边界与后续

- 当前固定的 Claude Code `2.1.236` 后台 `-p` 通道不会返回 Pro/Max 的完整五小时/七天 rate-limit snapshot；不为做卡片而开常驻交互终端，也不抓取私有账户接口。
- Claude Code 若未来向安全后台模式正式暴露额度字段，可在现有卡片数据契约上接入；当前不提前搭假数据层。
- 阶段 7 的正常唤醒、暖缓存和隐藏 fork 实验未提前开启；它们应基于本阶段真实 cache read/write 数据单独设计和验收。
- 真实 iOS PWA 后台/回前台仍留作实机检查；本阶段已完成精确手机视口验收。

## 5. 回退

阶段 6 的代码回退点为 `55e96f2`。回退时只移除指标采集、状态接口与两张卡，不删除聊天记录、CC session、网关卷、OAuth 凭据或 Lumbre `/persistent`。API 线路保持可用。
