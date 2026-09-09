# CC session 重建：HTTP UTF-8 分包解码

2026-09-09，基于 main `1a5020e` 排查。

## 线上证据

- 只读检查 CC 网关账本及其隔离 HOME 内的 transcript，没有向主聊天发送测试消息。
- 08:33:45Z 与 08:40:12Z 两轮均为 `rebase / history_changed`。
- 对照实际 bootstrap 输入，两条相同 ID 的旧 API assistant 消息只有正文不同；线路均为 `api`。
- 正文长度分别从 2029 → 2027、1533 → 1531；最小差异均为三个乱码替代字符恢复为一个正常字符。不是用户编辑的证据。
- 线上 `/opt/lumbre/services/cc-gateway/http-server.mjs` 的 `readBody` 使用 `text += chunk`，与本地一致。Buffer 在每次相加时独立解码，UTF-8 字符跨网络分包时被破坏。
- 损坏后的正文进入 `ContextBridge` 的消息哈希。下一轮分包位置变化，触发 `history_changed`，执行器收到新建计划而非 `--resume`。

## 修复与回归

- 请求体先按实际字节计数、保留原有大小上限，再合并 Buffer 并统一解码。不放宽历史编辑检测。
- `tests/safety/cc-http-utf8.test.ts` 驱动实际 HTTP handler → ContextBridge → ledger → runtime，使用模拟执行器避免付费调用。
- 三轮保持相同历史，分别整包、每字节、每两字节提交，覆盖中文和 emoji 跨包。旧实现第二轮出现 `rebase !== resume`；修复后连续三轮 session 相同、无乱码。
- 全套测试 182/182 通过；独立 HTTP 集成测试 1/1 通过；TypeScript、隔离数据目录生产构建（39/39 页面）及 `git diff --check` 通过。

## 发布与验收

本地修复不代表生产已恢复。必须重新构建、部署独立 CC 网关；仅部署 Next.js 主站不生效。保留现有网关数据卷及 CLI HOME。

部署后，在独立测试会话连续调用，检查后两轮 `resume`、相同 session fingerprint 和真实缓存指标。旧 session 曾接收的历史已损坏，首次收拢为正确历史时仍可能合理 rebase 一次。未授权修改主聊天记录或直接热改线上文件。
