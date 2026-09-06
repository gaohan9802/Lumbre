# Lumbre CC 隔离探针

这不是聊天后端，而是一间与 Lumbre 主站断开的 CC 实验室。它只回答代码内固定的测试暗号，用来确认 Claude Code 的版本、订阅认证、结构化输出、流式事件、session 恢复/分叉、退出码与超时行为。

## 安全边界

- 镜像只复制本目录的探针文件，不复制 Lumbre 源码、聊天数据、环境文件或 `/persistent`。
- 容器使用非 root 用户，在空的 `/probe/workspace` 中运行。
- CLI 固定为 stable `2.1.236`，关闭自动更新。
- 每次调用都传 `--tools ""`、`--permission-mode dontAsk`、`--strict-mcp-config` 和空 MCP 配置；系统级策略再拒绝文件、Shell、网络搜索与子代理工具。
- 子进程环境使用白名单，只允许系统运行字段和 `CLAUDE_CODE_OAUTH_TOKEN`。`ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN`、`DATA_DIR` 与 Lumbre 密钥不会传入。
- 报告不输出 OAuth token、完整 session id 或模型回复，只输出测试结果、session 指纹和 token 计数。

## 两个命令

```bash
docker run --rm lumbre-cc-probe:2.1.236 inspect
docker run --rm lumbre-cc-probe:2.1.236 smoke
```

`inspect` 不发模型请求，只检查版本和认证状态。`smoke` 会发三条极短请求：新建 JSON、同 session 的 stream-json 恢复、从原 session 分叉。它会真实消耗少量订阅额度，因此只能在用户明确同意后运行。

探针默认拒绝直接在宿主机执行；这是为了避免不小心继承本机的 Claude 配置、hooks、插件或工作目录。单元测试只导入纯函数与受控的进程运行器，不启动真实 CLI。

## 容器构建

构建上下文必须严格限定为本目录，避免把 Lumbre 仓库或本地文件送进 Docker build context：

```bash
docker build -f services/cc-probe/Dockerfile -t lumbre-cc-probe:2.1.236 services/cc-probe
docker run --rm lumbre-cc-probe:2.1.236 inspect
```

远程环境使用订阅时，应由用户在可信终端运行 `claude setup-token`，再把结果直接保存为部署平台的加密 secret `CLAUDE_CODE_OAUTH_TOKEN`。不要把 token 发到聊天、写进镜像、提交进 Git 或打印进日志。探针不接受浏览器传来的 token。

官方文档注明 `--bare` 不读取 `CLAUDE_CODE_OAUTH_TOKEN`，所以本探针没有使用 bare mode；隔离改由空容器、空工作区、工具禁用、严格 MCP 和环境白名单共同完成。
