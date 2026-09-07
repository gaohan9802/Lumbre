# Lumbre CC 唤醒与暖缓存：阶段 7 验收记录

日期：2026-09-07  
分支：`codex/lumbre-cc-wake-cache`  
起点：`cc4bd93`

## 本阶段完成

- “现实”页增加四个独立开关：日间 09:00–24:00、夜间 00:00–09:00、每日随机 N 次、静默 N 小时后醒来看一眼。每项可单独设置和关闭。
- 随机唤醒的当日时刻会持久化，重启不变；中途开启时仍在当天剩余时间排满 N 次，不补放已错过的时刻。
- 普通唤醒跟随当前对话的 API / CC 线路，共用正式历史、阶段摘要、近期摘要与书签；CC 失败不会偷偷改走 API。
- CC 普通唤醒可调用现有生活工具，但仍处于 `unattended-wake` 权限：不能看见或执行删除、发信等无人值守危险操作；Bash / Shell 仍然不存在。
- `wake_me` 是强制闹钟：跳过普通开关、30 分钟活跃冷却和普通失败退避。若闹钟到点时正在生成，立即消耗该闹钟并写入 `[CANCELLED_BUSY]` 记录，不顺延。
- 暖缓存在最后一次真实 CC 活动约 50 分钟后执行 `resume + fork-session`；无工具，回复不进聊天，临时 transcript 随即删除，主 session 不变。只有真实 `cache_read_input_tokens > 0` 才标记为保温成功；超过 60 分钟不冒充热缓存。
- 用户真实消息优先于暖缓存，会中止正在进行的临时 fork。静默 CC 唤醒不写入假消息，下一条真实消息仍续上同一个 session。

## 安全与回退

- 暖缓存 endpoint、忙碌状态和 CC attempt 仍只允许 Lumbre 服务端用网关 secret 访问；浏览器不获得 OAuth token、网关 secret 或完整 CC session id。
- 新设置默认全部关闭。旧版心跳原本开启时，升级后保留“日间每 1 小时 / 夜间每 3 小时”的原行为；不删历史闹钟或唤醒记录。
- 回退只需回退本分支代码。配置是兼容 JSON，不清空 `/persistent`、聊天、CC HOME 或任何用户数据。

## 本地验收证据

- TypeScript：`npx tsc --noEmit --incremental false` 通过。
- 定向测试：33/33 通过，覆盖独立规则、随机时刻、静默期去重、忙碌取消闹钟、无人值守工具权限、fork 暖缓存、临时 transcript 清理和静默后 session 续接。
- CC 网关契约与 Unix socket HTTP 集成测试：27/27 通过，包括鉴权、忙碌状态、暖场 endpoint、断线续接与事件回放。
- 完整回归：169/169 通过。
- 隔离 `DATA_DIR` 生产构建通过，`git diff --check` 通过。
- 桌面宽度与 390px 手机宽度的夜间 UI 已检查；主对话选择、日间开关和频率修改在隔离预览中实际保存成功，测试开关随后关闭。

## 待分支预览验收

- 推送本分支，确认 Lumbre 与 CC 网关两个预览服务的部署回执。
- 用一条无副作用的真实 CC 消息建立热缓存，再直接调用暖场 endpoint，确认有 `cache_read_input_tokens > 0`、fork session 不同于主 session，且临时 transcript 已删除。
- 未经用户确认，不合并 `main`，不在生产开启任何唤醒规则。

## 明确延后

- 每条消息的 cache in / out 详情面板本阶段不做。消息数据已保留 input、output、cache read 与 cache creation 字段；等用户提供模板后只做展示层。
