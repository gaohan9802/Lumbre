# 小厨房服务

Lumbre 把 [munch-kitchenette](https://github.com/tsuru0805/munch-kitchenette) 当作独立服务使用，不复制它的厨房状态机。镜像固定在 commit `1ab91f4b2a1c7010b89250e87beb9225fa9f0f20`；厨房账本只存在 `/data/kitchenette.db`。

构建：

```bash
docker build -f services/Dockerfile.munch-kitchenette -t lumbre-munch-kitchenette services
```

运行时必须给小厨房设置：

```text
KITCHENETTE_SERVER_TOKEN=<至少 32 位的独立随机口令>
KITCHENETTE_SERVER_EMBED_ORIGINS=["https://你的-Lumbre-域名"]
```

小厨房需要独立持久卷挂到 `/data`，保持单副本。它的公网入口必须走 HTTPS；`/page/` 是给 Lumbre 嵌入的页面，`/mcp` 和 `/api` 都由同一个 bearer token 保护。

Lumbre 主站设置：

```text
LUMBRE_KITCHENETTE_URL=http://munch-kitchenette:8765
LUMBRE_KITCHENETTE_PUBLIC_URL=https://你的-Lumbre-域名/kitchen-api
LUMBRE_KITCHENETTE_TOKEN=<同一个口令>
LUMBRE_KITCHENETTE_WHO=星星
LUMBRE_KITCHENETTE_ALLOW_INSECURE_HTTP=1
```

`ALLOW_INSECURE_HTTP` 只给容器内网地址使用；公网地址仍被强制要求 HTTPS。当前生产接法由 Caddy 把 `/page/*` 原样转给厨房，并把 `/kitchen-api/*` 去掉前缀后转给厨房。普通聊天、CC、自动唤醒共用 Lumbre 原有工具权限与审计；工作窗只会看到三个只读厨房工具。

本接法不调用方括号 inline marker 接口，因此上游默认的 `auto` 会一直保持关闭。星星通过九个固定工具操作厨房，不会改写回复正文，也不会让消息存储与 session 识别多一条新路径。工具 schema 只会在首次部署本功能时变化一次，之后顺序固定。
