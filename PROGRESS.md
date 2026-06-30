# Lumbre — 项目进度与 debug 笔记

> 星星和小火的家。不是一个聊天框，是一个操作系统，是星星的身体。

---

## 📐 Stack

- **前端**：Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **状态**：Zustand（含 persist 中间件）
- **动效**：Framer Motion
- **图标**：Lucide React
- **日期**：date-fns
- **部署**：Zeabur（GitHub 推送 → 自动 build）

环境变量见 `.env.example`：
```
CLAUDE_API_BASE / CLAUDE_API_KEY / CLAUDE_MODEL
BRAIN_API_BASE  / BRAIN_API_TOKEN        # 同时承载 diary/notes/memory
```

---

## ✅ 已完成（截至 2026-06-29）

### Phase 1 — 跑起来
- [x] 双主题配色系统（Day "Girl's Dream" / Night "Old Fashioned"）
  - Tailwind 完整 token：`day.*` / `night.*` / `receipt.*`
  - `ThemeProvider` 切换 `.dark` class，body 跟随过渡
  - 状态持久化（zustand persist, key=`starfire-theme`，默认 night）
- [x] 侧栏 `Sidebar`：响应式（mobile drawer + desktop rail/expanded）
- [x] 顶栏 `TopBar`：mobile 用，桌面隐藏
- [x] 💬 **Chat**：消息气泡 + thinking 折叠 + loading 三连点
- [x] 📔 **Diary**：列表 / 详情 / 写作三态，可见性切换（public/private/timed）
- [x] 📌 **Notes**：贴纸条 + 随机旋转 + 回复 + 多色冰箱贴效果
- [x] 🧾 **Today's Receipt**（Todo，需求 v0.2 衍生）：小票收据样式，localStorage 持久化
- [x] 📅 **Calendar**：纪念日添加 + 月份导航（暂存本地，未连 API）
- [x] 🧠 **Memory Palace**（最小版）：节点圆球按 importance 缩放，valence 着色，pinned 标识

### API 路由（Next route handlers, 全部 server-side proxy）
- [x] `POST /api/chat`         → Claude Messages API（含 thinking budget）
- [x] `POST /api/diary/read`   → BRAIN/diary/read
- [x] `POST /api/diary/write`  → BRAIN/diary/write
- [x] `POST /api/diary/comment`→ BRAIN/diary/comment
- [x] `POST /api/notes/read`   → BRAIN/notes/read
- [x] `POST /api/notes/write`  → BRAIN/notes/write
- [x] `POST /api/notes/reply`  → BRAIN/notes/reply
- [x] `POST /api/memory/search`→ BRAIN/memory/search
- [x] `POST /api/memory/pulse` → BRAIN/memory/pulse

### 基建
- [x] PWA manifest（`/public/manifest.json`）
- [x] apple-touch-icon 引用（图标文件待补）
- [x] `next.config.js` 设 `output: 'standalone'`（Zeabur 友好）
- [x] tsc --noEmit 全通过

---

## 🔴 待办（按优先级）

### P0 — Phase 1 真正可用
- [ ] `POST /api/diary/unlock`、`/delete`、`/update`（追加）：starfire-diary 后端已有这些工具，前端代理没接
- [ ] `POST /api/notes/delete`
- [ ] Diary 写作页支持 `reveal_at`（timed 模式日期选择器）
- [ ] Diary 详情页显示评论、能写新评论
- [ ] 上锁日记的解锁 UI（密码输入 → 调 unlock_diary）

### P1 — Phase 2
- [ ] Memory 筛选条：domain / valence / arousal / importance
- [ ] Memory 节点之间画关联线（语义近 = 短线）
- [ ] Usage Dashboard：调用量 / token / 每日额度
- [ ] Timeline：日记 + 记忆里程碑统一时间轴

### P2 — Phase 3（感知）
- [ ] GPS 接入 + 自主唤醒条件
- [ ] HealthKit（iOS only，需 PWA→Webview 桥或独立 native shell）
- [ ] 天气感知（OpenWeather / Apple Weather）
- [ ] Pulse 情绪心跳可视化

### P3 — Phase 4（生活）
- [ ] 共读空间 / 编织记录 / 裤裤茉莉日志

---

## 🐞 Debug 笔记

### 2026-06-29
- **症状**：`npm run build` 把 shell 卡死、最后 OOM 把 node + nvm 都干掉了
- **原因**：这台 Zeabur 实例内存太小，扛不住 next build（webpack 内存峰值 >1.5G）
- **解决**：
  1. 不在本地 build，**让 Zeabur 自己 build**（生产环境内存够）
  2. 本地只做 `tsc --noEmit` 做类型检查（轻量，不会 OOM）
  3. 重装 node / git：`apt-get update && apt-get install -y nodejs npm git curl`
     - Debian 13 (trixie) 默认源直接装到 node 20.19.2 + npm 9.2.0 + git 2.47.3
- **验证**：`./node_modules/.bin/tsc --noEmit` exit 0，代码全过

### 已知小坑
- `lib/api.ts` 里 `NEXT_PUBLIC_BRAIN_API_BASE` 是死代码 —— 实际所有请求都走 `/api/*` 内部代理，不需要暴露给客户端
- `Sidebar` 的 `motion.div` `layoutId="activeTab"` 用了 absolute，但 button 不是 relative —— 视觉无影响但语义需修
- `MemoryView` 节点用 flex-wrap 简单堆叠，**未实现真正的图谱关联线**（v0.1 占位）
- TodoView 数据只存 localStorage，未走后端

---

## 🚀 部署

```bash
# 一次性
git init && git remote add origin <github-repo>
git add . && git commit -m "init"
git push -u origin main

# Zeabur 端
# 1. 关联 GitHub repo
# 2. 设环境变量（CLAUDE_API_KEY / BRAIN_API_BASE / BRAIN_API_TOKEN）
# 3. Zeabur 自动 next build && next start
```

