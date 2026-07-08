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


---

## 2026-07-02 晚间 — 照片 + 食谱模块

### 完成
- `src/components/photos/PhotosView.tsx` — 照片墙（占位版：网格布局 + 上传按钮，待接后端）
- `src/components/recipes/RecipesView.tsx` — 食谱（book/daily 双 tab，A-Z 索引，待接后端）
- Tab 类型、Sidebar、page.tsx 路由全部接线完成

### Debug 笔记
- **坑：commit 只提交了组件文件，忘了改 Sidebar + page.tsx**
  - 第一次 push 成功（487fb45）但只包含 View 组件和 store.ts 的 Tab 类型
  - Sidebar tabs 数组和 page.tsx 的 views 映射没加 → 页面上根本看不到入口，看起来像"推失败了"
  - 教训：加新模块的 checklist = ①View组件 ②store Tab类型 ③Sidebar tabs ④page.tsx import+views 映射，四处缺一不可
  - 修复 commit：316a78d
- push 本身没失败过，`git push https://<user>:<token>@github.com/...` 直连稳定
- 仓库位置注意：/tmp/Lumbre 是开发仓库，/data/Lumbre 是旧的 debug 现场，别搞混

---

## 📅 2026-07-02 — 砍板块 + Sidebar 重排 + 星星板块大升级

### 删除
- 🗑️ 天气（WeatherView）、时间轴（TimelineView）、独立位置（LocationView）、自主唤醒（AutoWakeView）四个组件目录删除
- store.ts Tab 类型收窄为 12 个，persist version=2 + migrate（旧 activeTab 指向已删板块时回落 chat，防白屏）

### Sidebar 新顺序（按需求文档）
🐆星星 📔日记 📌小纸条 🧾待办 📷照片 📅日历 ✨记忆 ❤️健康 📖阅读 🧶编织 🍳食谱 💰Usage
- 日历 = 未来与自主唤醒前端合并的落点（AutoWake UI 已删，待重建进日历）
- 健康 = 已合并位置 + 生理期
- TopBar 标题表同步更新

### 星星板块（Chat）六项
1. **完整时间戳**：每条消息 `yyyy-MM-dd HH:mm:ss`（formatFullTs）
2. **图片发送**：ImagePlus 按钮 + 粘贴上传，≤4 张，>800KB 自动 canvas 压缩到 1568px JPEG；
   - Anthropic 走 image block（base64），OpenAI-compatible 走 image_url
   - ChatMessage.images?: string[]（data URL 直接进 localStorage + 同步）
3. **上下文可视化**：输入框上方进度条 = 窗口占用%（条数/contextLength），显示 🪟 n/N · 窗口持续时间（首条消息距今，30s tick 刷新）· ~估算 token
4. **消息操作**：hover（桌面）/常显淡化（手机）三按钮 —— 🔄重roll（截断到该 assistant 消息前重新推理）、🌿分支（复制到该消息为止开新会话「标题 · 分支」）、🗑删除单条
5. **多端同步**：/api/sync（文件存储 data/chat-sync.json）push+pull 合并；按 session.updatedAt 新者胜 + tombstone 防删除复活；ChatSync 组件挂载时同步 + 45s 轮询 + 本地变更 2.5s debounce
6. **天气+城市**：桌面在 chat 头部右侧 chip，手机在 TopBar 右上角；/api/weather 代理 open-meteo（气温+weather_code）+ bigdatacloud 反向地理（中文城市名），前端 useWeather hook sessionStorage 缓存 30 分钟，无 key 依赖

### 健康板块
- 生理期：usePeriodStore（persist）记录 start/end；显示 Day N（进行中）或距下次预测天数（平均周期取有效历史 15-60 天区间均值，默认 28）；历史列表可删
- 位置：geolocation → /api/weather 反向地理出城市，显示坐标+更新时间；拒绝可重试
- HealthKit 四卡保留占位

### Debug 笔记
- **TS2802**：`[...map.values()]` 在当前 tsconfig target 下报错 → `Array.from(map.values())`
- persist 的 store 改 Tab 枚举必须加 migrate，否则老用户 localStorage 里的 activeTab='weather' 直接白屏（views[undefined]）；page.tsx 里再兜底 `views[activeTab] || ChatView`
- chatStore settings 加字段（tombstones）要同时改 DEFAULT_SETTINGS + normalizeSettings，否则老数据 rehydrate 后 undefined
- shell 工具确实容易掉线：build 用 nohup 后台跑再 tail 日志，比前台管道稳

## 2026-07-03 夜间模式改版：雪豹夜行 🌙🐆

### 色板全面替换（Old Fashioned → 雪豹夜行）
- tailwind.config.ts `night.*`：bg=#0f1419(Base) / card=#1c2630(Surface) / surface=#243040(Elevated) / border=#2e3d4d(Divider)
- 文字：text=#e8e4df / muted=#8899a6 / 新增 disabled=#4d5b6a
- 强调：amber=#e2a84b / amberDim=#c48a30 / amberGlow=#f5c96b
- 新增功能色：night-success/#4a9e7e、night-warning/#d4915c、night-error/#c45c5c、night-info/#5b8fb4
- globals.css CSS vars 同步；.dark 滚动条 track #2e3d4d / thumb #4d5b6a；输入框聚焦 Amber 1px（:has 选择器覆盖 bg-transparent 包装容器）

### 层级修正
- 语义对齐：night-card=Surface(卡片)、night-surface=Elevated(浮层)
- 弹窗/下拉改用 Elevated：诊断——模型选择弹窗、日记解锁弹窗、ChatSettings 抽屉原先用 card
- 小纸条：Elevated 背景 + 左3px Amber系色条（3种：amber/glow/dim），夜间阴影 0 2px 12px rgba(0,0,0,0.4)

### 硬编码清理
- 全局 sed 替换旧色值（D4A574/22262E/1A1D23/2A2E37/8B7355/E8E0D8/6B6560/E8B87A → 新色板），涉及 dashboard/memory/diary/notes/layout.tsx(themeColor)
- rgba(212,165,116,*) → rgba(226,168,75,*)
- 红绿功能色加 dark: 变体 → night-error/night-success

### 切换按钮
- Sidebar 底部按钮：夜间显示 "🌙🐆 雪豹夜行"，日间 "☀️ Day"；移除 lucide Sun/Moon

### Debug 笔记
- sed 处理含 `${}` 的 className 时注意转义，复杂替换用 python 脚本更稳
- `:has()` 选择器解决"视觉输入框是外层 div、真实 input 是 bg-transparent"的聚焦边框问题
- shell 工具不接受 `&&`/`;` 拼接 sleep 的长命令？实际是偶发掉线，重试即可

---

## 2026-06-29（第二轮）Chat 页面大改

### 新增
1. **重roll保留所有版本**：`ChatMessage.versions[] + versionIndex`，气泡下 `‹ 2/3 ›` 切换；重roll结果 append 而非覆盖（store: `addMessageVersion` / `switchMessageVersion`）
2. **危险操作先确认**：自绘 confirm 弹窗（askConfirm），重roll/分支/删除消息/删除会话/清空/重置全走它，替代原生 confirm
3. **时间戳移到消息最上方**（thinking 之前）；气泡区不再显示模型名，模型只在输入框左下角
4. **外观自定义**：背景图（上传→dataURL，>900KB 自动压缩）+ 背景透明度；用户/AI 气泡颜色 + 透明度（color picker + slider，可恢复默认）。存 `settings.appearance`
5. **手机 chat 菜单栏下移**：原 absolute 浮动改为普通流 `pt-6`，消息不再被按钮遮住
6. **模型 API 管理独立弹窗** `ModelDialog.tsx`：添加/删除 API（名称/供应商/BaseURL/Key/模型名/三种价格）、点卡片展开编辑+启停+拉取模型、点模型即切换。模型价格存 `ProviderModel.inputPrice/outputPrice/cachePrice`（$/1M）
7. **模型配置全平台同步**：`extractConfig()` 切出 config 子集（prompt/温度/apiProfiles/appearance 等），`configUpdatedAt` 新者胜；/api/sync 和 server/chat-sync.ts 扩展 config 字段；所有改配置的 action 都 `bumpConfig()`
8. **星星设置独立**（ChatSettings 重写）：prompt、温度（0-2，Anthropic 截断到 1）、思考预算、流式开关（UI预留）、prompt caching、上下文条数、外观。与模型解绑
9. **右下角会话统计**：上下文条旁 `共 N 层 · 最后 M/D HH:mm`
10. **Enter 改为换行**：去掉 onKeyDown 发送，只保留发送按钮；`enterKeyHint="enter"`
11. **温度参数打通**：/api/chat 两条链路都接 temperature；Anthropic 开 thinking 时忽略温度（API 规定）

### Debug 笔记
- `chat.send` 加参数记得同步改 `src/lib/api.ts` 的类型签名，否则 TS 报 unknown property
- store 里 `models.map(...)` 推断出的对象字面量类型会和 `ProviderModel[]` 冲突（exactOptionalPropertyTypes 影响），显式标注 `const nextModels: ProviderModel[]`
- persist version 5→6：normalizeSettings 兜底新字段（temperature/streamEnabled/appearance/configUpdatedAt），老数据无痛升级
- 同步防回环：ChatSync 里 `applyingRemote` 标志覆盖 config merge，`mergeRemoteConfig` 只在 remote ts 更新时应用，不 bump 本地 configUpdatedAt

---

## 2026-07-04 — Chat 页面六项优化

### 完成
1. **弹窗位置修复**：page.tsx 的 `motion.div`（AnimatePresence 切页动画）带 transform，成为 `position:fixed` 的包含块 → 弹窗/抽屉定位漂移（截图里模型弹窗跑到右下、确认框偏移）。修法：ChatView 里所有浮层（会话抽屉/确认框/ChatSettings/ModelDialog）统一 `createPortal(document.body)`，加 `mounted` state 防 SSR 报错
2. **星星设置关闭按钮**：sticky header `pt-[max(1rem,env(safe-area-inset-top))]` 避开刘海/状态栏；按钮 p-1→p-2.5 + 背景色块，手机可点
3. **删除会话菜单底部「模型 API / 星星设置」入口**：入口保留在输入框左下模型 chip + 头部齿轮
4. **星星状态栏**：`settings.starStatus {text,timestamp,msgCount}`（入 extractConfig 跨端同步）；每收到 assistant 回复后检查距上次刷新条数 ≥ 随机阈值(5-10)则调 chat.send 用最近 6 条对话让模型一句话自述心情（20字内），显示在头部下方一条细栏，带手动刷新按钮
5. **消息复制/修改 + 会话导出**：
   - 每条消息操作区加 📋复制（1.5s 打勾反馈）+ ✏️修改
   - 修改 = `addMessageVersion` 追加新版本，旧版本保留左右切换；版本切换器旁加 ✕ 删除当前版本（`deleteMessageVersion`，剩1个版本时不可删）；user 消息也支持版本切换（原来只有 assistant）
   - 头部 ⬇️ 导出按钮：整个会话转 Markdown（角色+完整时间戳+正文），复制到剪贴板 + 下载 .md 文件
6. **懒加载**：`visibleCount` 初始 50，`messages.slice(-visibleCount)` 渲染；顶部「加载更早的 N 条」按钮 +50；切换会话时重置

### Debug 笔记
- **fixed 定位漂移根因**：祖先元素有 transform/filter/backdrop-filter 时 fixed 改以该祖先为包含块。page.tsx 每个 view 都包在 motion.div（切页动画 y:8→0，动画结束后 framer 通常移除 transform，但 AnimatePresence mode=wait 下 exit 期间/某些版本会残留 will-change/transform）→ 所有全屏浮层必须 portal 到 body，别依赖"动画结束后 transform 会被移除"
- createPortal 需要 `mounted`（useEffect 置 true）守卫，否则 SSR 阶段 document 不存在直接 build 报错
- 星星状态刷新用 ref（statusBusyRef/statusGapRef）而不是 state，避免 effect 依赖循环；触发条件挂在 `[messages.length, isLoading]` 上、仅 last.role==='assistant' 时执行，防止用户消息也触发
- deleteMessageVersion 里 versionIndex 修正：删的是当前之前的版本时 cur-1，删当前版本时留在同位置（自动落到下一个），再 clamp 到边界

---

## 2026-07-06 — 记忆模块前端重构（4-tab UI）

### 完成
- **MemoryView 全面重写**：从旧版圆球图谱改为 4-tab 信息架构，参考 OmbreBrain-folio 设计
  - **01 团块 (Clusters)**：按 domain 分组，展示为可展开的集群卡片，每个集群显示标签云 + 内部记忆列表
  - **02 端点 (Nodes)**：所有记忆桶扁平列表，按权重排序
  - **03 连线 (Lines)**：标签词云 + 计数，点击标签过滤出相关记忆条目
  - **04 演变 (Evolution)**：按日期分组的时间线视图
- **详情面板**：点击任意记忆条目，底部弹出详情面板，显示完整内容 + 元数据
- **搜索**：输入关键词走后端 `/api/search`（关键词 + 向量双通道），无搜索词时拉全量列表
- **BucketRow 通用组件**：显示 主体→关系→名称→效价分数，从标签自动提取关系词

### API 改动
- `src/app/api/_helpers.ts`：新增 `proxyBrainGet` 方法（GET 代理），支持 `X-Admin-Token` 认证头
- `src/app/api/memory/search/route.ts`：改用 GET 代理 → 后端 `/api/search?q=...`
- `src/app/api/memory/pulse/route.ts`：改用 GET 代理 → 后端 `/api/buckets`
- 新增 `src/app/api/memory/bucket/route.ts` → 后端 `/api/bucket/{id}` 获取完整内容
- 新增 `src/app/api/memory/network/route.ts` → 后端 `/api/network` 获取相似度网络

### Debug 笔记
- 后端 `/api/search` 和 `/api/buckets` 都是 GET 端点，之前前端代理用 POST 不匹配
- `/api/families`、`/api/lines`、`/api/family/{id}` 端点在后端 OmbreBrain 中不存在（代理路由是空的），前端需要从 `/api/buckets` 数据 client-side 派生团块/连线
- OmbreBrain 的 `OMBRE_ADMIN_TOKEN` 鉴权：所有 `/api/*` 都需要带 `X-Admin-Token` header，代理层补了
- tsc --noEmit 全通过

---

## 2026-07-07 — 记忆模块完整重构：4-Tab 管理界面 + 编辑功能

### 完成
**将 OmbreBrain Dashboard 的"记忆桶""Breath模拟""配置""导入"四个页面完整移植到 Lumbre 前端，并新增编辑功能。**

#### Tab 1: 记忆桶 (BucketsTab)
- 完整桶列表：显示图标(📌🫧🌿💤💭)、名称、权重分、时间、域、importance
- 筛选器：全部/钉选/Feel/未解决/已消化 + 按 domain 筛选
- 全文搜索（客户端 filter，name + content_preview + tags）
- 详情面板：所有元数据（ID/类型/域/标签/效价/唤醒/权重分/激活次数/钉选/已解决/创建时间/最后活跃）
- 完整正文展示
- **编辑功能（新增）**：
  - 可修改：name / importance / valence / arousal / tags / domain / content / pinned / resolved / digested
  - 通过 `/api/bucket/{id}/edit` PATCH/POST 端点保存
- 操作按钮：钉选/取消、标记解决/重新激活、归档、永久删除（带确认）

#### Tab 2: Breath 模拟 (BreathTab)
- 5阶段管线可视化（输入→候选池→四维评分→阈值过滤→排序）
- 输入控制：Query + Valence + Arousal
- 结果列表：每条显示4维评分条（topic/emotion/time/importance），颜色区分通过/未通过
- 权重配置信息展示

#### Tab 3: 配置 (ConfigTab)
- 脱水API配置：Model / Base URL / API Key / Max Tokens / Temperature
- Embedding 配置：启用开关 + Model
- 合并阈值
- 应用（仅运行时）/ 应用并写入 config.yaml
- 系统信息展示：版本、桶统计、衰减引擎状态、向量搜索状态

#### Tab 4: 导入 (ImportTab)
- 拖拽/点击上传文件
- 保留原文模式开关
- 实时导入进度条 + 统计（API调用/新建/合并/原文）
- 暂停功能
- 已导入记忆审核：📌固定 / ⭐重要 / 🗑噪声 / ✕删除

### API 路由（17个新增/修改）
- `GET /api/memory/buckets` → `/api/buckets` 全量桶列表
- `GET /api/memory/bucket?id=` → `/api/bucket/{id}` 桶详情
- `POST /api/memory/bucket-edit?id=` → `/api/bucket/{id}/edit` **编辑桶**
- `POST /api/memory/bucket-pin?id=` → `/api/bucket/{id}/pin` 钉选切换
- `POST /api/memory/bucket-resolve?id=` → `/api/bucket/{id}/resolve` 已解决切换
- `POST /api/memory/bucket-delete?id=` → `/api/bucket/{id}/archive` 归档
- `POST /api/memory/bucket-purge` → `/api/buckets/purge` 永久删除（X-Purge-Confirm header）
- `GET /api/memory/breath-debug` → `/api/breath-debug` Breath 模拟
- `GET /api/memory/config` → `/api/config` 读配置
- `POST /api/memory/config-save` → `/api/config` 写配置
- `GET /api/memory/status` → `/api/status` 系统状态
- `POST /api/memory/import-upload` → `/api/import/upload` 上传导入文件
- `GET /api/memory/import-status` → `/api/import/status` 导入进度
- `POST /api/memory/import-pause` → `/api/import/pause` 暂停导入
- `GET /api/memory/import-results` → `/api/import/results` 已导入结果
- `POST /api/memory/import-review` → `/api/import/review` 审核操作
- `GET /api/memory/import-patterns` → `/api/import/patterns` 高频模式检测

### 关键架构改动
- **`_helpers.ts` 重写**：从 `X-Admin-Token` header 认证改为 **Cookie session 认证**
  - `ensureSession()` 自动登录 OmbreBrain（POST `/auth/login`），缓存 session cookie
  - session 过期时自动重新认证
  - 新增 `proxyBrainMethod(req, path, method)` 支持 GET/POST/PATCH/DELETE
  - 环境变量 `BRAIN_PASSWORD`（默认 980228）

### Debug 笔记
- **OmbreBrain 认证**：不是 API Token 认证，是 **Cookie session** 认证。`/auth/login` → set-cookie → 后续请求带 Cookie
- **编辑端点**：原版 P0luz/Ombre-Brain 有 `/api/bucket/{id}/edit`（在 web/import_api.py），支持 PATCH/POST，可改 name/tags/importance/resolved/pinned/digested/domain/content/type
- **永久删除**：需要 `X-Purge-Confirm: dashboard-purge-v1` header（安全防护），单独在 bucket-purge/route.ts 处理
- **导入上传**：multipart/form-data 需要单独处理（不能走通用 JSON proxy），import-upload/route.ts 单独实现
- **git rebase 冲突**：远程有新 commit → `git pull --rebase` → conflict on _helpers.ts 和 MemoryView.tsx → 用 `--ours` 解决后 `GIT_EDITOR=true git rebase --continue`

---

## 2026-07-07 — 记忆数据迁移：xiaohuo → Lumbre

### 完成
- **612 个记忆桶从 xiaohuo.zeabur.app (OmbreBrain) 完整迁移到 Lumbre 仓库**
  - 源：`https://xiaohuo.zeabur.app/api/buckets` + `/api/bucket/{id}`（需 Cookie session 认证）
  - 目标：`data/buckets/{id}.json`（每个桶一个文件）+ `data/buckets/_index.json`（索引）
  - 每个文件包含完整字段：id、metadata（name/type/domain/tags/valence/arousal/importance/pinned/resolved/digested/created/last_active/activation_count）、content（完整正文）、score
  - 总大小 3.1MB，无丢失

### 迁移方式
1. 用 Python 脚本通过 OmbreBrain API 批量拉取（`/auth/login` → cookie → `/api/buckets` 列表 → 逐个 `/api/bucket/{id}` 获取完整内容）
2. 所有 612 个桶全部成功导出，0 失败
3. 存入 `data/buckets/` 目录，推送到 GitHub

### Debug 笔记
- OmbreBrain 认证是 Cookie session（非 API Token），用 `http.cookiejar` + `urllib.request` 处理
- `/api/buckets` 返回列表只含 `content_preview`（截断），完整正文需要逐个请求 `/api/bucket/{id}`
- 612 个桶串行请求约 1 分钟完成，未触发限流

---

## 2026-07-08 — 数据路径迁移到 /persistent

### 完成
- **所有数据存储路径从 `process.cwd()/src/data` 迁移到 `/persistent`**（Zeabur 持久卷挂载点）
  - `diary-store.ts`: `DATA_DIR` → `/persistent`（diaries/notes/config.json）
  - `chat-sync.ts`: `DATA_DIR` → `/persistent`（chat-sync.json）
  - `usage.ts`: `USAGE_DIR` → `/persistent/usage`
  - `debug/route.ts`: `dataDir` → `/persistent`

### Debug 笔记
- Zeabur 持久卷挂载在 `/persistent`，代码里不能用 `process.cwd()` 相对路径（cwd 在容器里是 `/app`，和持久卷无关）
- 所有目录都有 `ensureDirs()` 自动创建机制，首次部署不需要手动建目录
- `/persistent` 下已有 `buckets/` 和 `notes/`（从之前迁移过来的），`diaries/` 和 `usage/` 会自动创建

---

## 2026-07-08 — 删除 5 个板块 + 记忆模块描述

### 删除的板块
- 🗑️ **健康 (health)**：HealthView.tsx 删除
- 🗑️ **编织 (knit)**：KnitView.tsx 删除
- 🗑️ **食谱 (recipes)**：RecipesView.tsx 删除
- 🗑️ **Usage (dashboard)**：DashboardView.tsx + `/api/usage/route.ts` 删除
- 🗑️ **日历 (calendar)**：CalendarView.tsx 删除

### 修改的文件
- `src/lib/store.ts`：Tab 类型缩减为 7 个（chat/diary/notes/todo/photos/memory/coreading），persist version=3
- `src/components/layout/Sidebar.tsx`：tabs 数组缩减为 7 项
- `src/components/layout/TopBar.tsx`：titles 对象同步缩减
- `src/app/page.tsx`：views 映射和 import 同步缩减

### Sidebar 新顺序
🐆星星 📔日记 📌小纸条 🧾待办 📷照片 ✨记忆 📖阅读

### 记忆模块现状描述
4-tab 界面（团块 Clusters / 端点 Nodes / 连线 Lines / 演变 Evolution），底部搜索+详情面板。后端 21 个 API 代理路由，612 个记忆桶。详见上方 2026-07-07 条目。

### Debug 笔记
- tsc --noEmit 全通过
- persist version 2→3 + migrate 防旧 activeTab 白屏
- `src/server/usage.ts` 和 `src/app/api/chat/route.ts` 中的 usage 记录逻辑保留（是 chat token 统计，不是 dashboard 板块）

---

## 2026-07-08 — OmbreBrain v2.0：本地记忆引擎替代外部代理

### 完成

**将 OmbreBrain 后端从外部代理（xiaohuo.zeabur.app）迁移为 Lumbre 内置的 TypeScript 本地引擎。目标：Lumbre 跑通后可直接删除旧的独立 OmbreBrain 服务。**

#### 核心文件
- **`src/server/brain.ts`**（676 行）：完整的记忆引擎
  - Bucket CRUD：loadAllBuckets / getBucket / saveBucket / deleteBucket / archiveBucket
  - 30 秒内存缓存 + 自动失效
  - Ebbinghaus 遗忘曲线评分：情绪强度影响衰减速率，pinned=999分永不沉底
  - 模糊搜索：名称/内容/标签三通道，词级匹配评分
  - Breath 浮现：无参→高权重未解决桶；有 query→搜索；有 importance_min→按重要度批量拉取
  - Breath Debug：4 维评分可视化（topic/emotion/time/importance）
  - Hold/Grow/Trace/Dream/Pulse：完整实现 OmbreBrain 高频 5 工具
  - 标签相似度网络、配置读写、系统状态

#### API 路由改动（22 个全部重写）
- **删除 `_helpers.ts`**（外部代理辅助，不再需要）
- 所有 `src/app/api/memory/*/route.ts` 改为直接调用 `brain.ts`，不再依赖 `BRAIN_API_BASE` / `BRAIN_PASSWORD` 环境变量
- 新增 `/api/memory/pulse/route.ts`（前端 MemoryView 调用入口）
- 搜索返回 `{keyword_hits, vector_hits}` 格式兼容前端
- Import 端点暂存 stub（返回 idle/ok）

#### 数据格式
- 沿用已迁移的 612 个 JSON 桶（`/persistent/buckets/{id}.json`）
- 支持两种格式自动识别：`{id, metadata, content, score}`（完整格式）和 `{id, name, ...}`（扁平格式）

#### 关键差异 vs 旧版 OmbreBrain
- **无 Python 依赖**：纯 TypeScript，与 Next.js 同进程运行
- **无 Cookie session 认证**：去掉了登录/session 机制（Lumbre 自己的前端不需要）
- **无向量搜索**：暂用模糊匹配替代（后续可接 embedding API）
- **无 LLM 脱水**：hold/grow 不调 LLM 打标/压缩（原始内容直接存储）
- **无 Obsidian .md 文件**：改用 JSON 存储（已有数据就是 JSON 格式）

### Debug 笔记
- 前端 MemoryView 用 POST 调 pulse/search/bucket，路由必须同时 export POST 和 GET
- 搜索响应必须是 `{keyword_hits: [], vector_hits: []}` 格式，前端 dedup 依赖这个结构
- `_helpers.ts` 删除安全——diary/notes 路由不依赖它，走的是 `diary-store.ts`
- `tsc --noEmit` 全通过

---

## 2026-07-08 — OmbreBrain Dashboard 前端合并

### 完成
**将 OmbreBrain Dashboard 的管理功能合并到 Lumbre MemoryView，新增 3 项能力。**

#### 新增功能
1. **内联编辑**（Edit3 按钮）
   - 详情面板点击编辑图标进入编辑模式
   - 可修改：名称、标签（逗号分隔）、领域（逗号分隔）、重要性（滑块 1-10）、正文内容
   - 调用 `POST /api/memory/bucket-edit?id=` 保存
   - 保存后自动刷新列表

2. **批量选择 + 清除**
   - Stats 栏「批量」按钮进入多选模式
   - BucketRow 显示复选框，点击切换选中状态
   - 选中后出现「删除」按钮，调用 `POST /api/memory/bucket-purge`（永久删除）
   - 支持 Clusters / Nodes / Evolution 三个 tab

3. **Admin 管理 Tab**（⚙ 图标）
   - 系统状态卡片：版本、桶数、数据量 MB、衰减引擎、向量搜索、持久化状态
   - 领域分布：横向进度条可视化各 domain 占比
   - 类型分布：normal/feel/permanent 各类桶数量
   - 快速统计：总桶数 / 钉选 / 已解决 / 未解决 / 感受 / 领域数
   - 刷新按钮

#### 其他改动
- **Breath Tab 加图例**：4 维评分条旁显示颜色图例（主题/情绪/时间/重要）
- **Pulse 路由拆分**：GET → pulse() 返回完整统计（total/pinned/domains/types/buckets），POST → buildIndex() 兼容工具调用
- **tools.ts 本地化**：确认全部使用 brain.ts 本地引擎，无外部依赖
- **Tab 扩展**：从 6 tab 扩展到 7 tab（+ admin），TABS 类型更新

#### 架构说明
- 现在 Lumbre 的记忆模块是完全自包含的：前端 MemoryView → API 路由 → brain.ts → /persistent/buckets/
- 不再依赖 xiaohuo.zeabur.app，可以安全删除旧的 OmbreBrain 服务

### Debug 笔记
- TS2802 `Set` 迭代：`[...batchSelected]` → `Array.from(batchSelected)`，`[...new Set(...)]` → `Array.from(new Set(...))`，`[...m.entries()]` → `Array.from(m.entries())`
- `.sort((a, b) => ...)` 在 map 结果中需要显式标注类型 `(a: Bucket, b: Bucket)`，否则 TS 推断为隐式 any
- tsc --noEmit 全通过

---

## 2026-07-09 — 记忆模块数据修复：Seed 机制

### 问题
- 前端记忆板块（MemoryView）显示空白，`/api/memory/buckets` 返回 `[]`
- **根因**：Lumbre 应用容器的 `/persistent/buckets/` 目录为空。612 个记忆桶文件只存在于 shell 容器的 `/persistent/buckets/`，两个容器不共享持久卷
- diary/notes 之所以正常，是因为有 `src/seed/diaries.json` + `src/seed/notes.json` 的 seed 机制（`diary-store.ts` 的 `migrateIfNeeded()`）

### 修复
- **`src/seed/buckets.json`**（496KB，612 个桶）：从 shell 容器 `/persistent/buckets/` 导出的完整数据，合并为单个 JSON
- **`src/server/brain.ts` 新增 `seedIfEmpty()`**：模块加载时检查 `/persistent/buckets/` 是否为空，若空则从 seed 文件写入
  - 查找路径：`/persistent/buckets.json` → `process.cwd()/src/seed/buckets.json` → `__dirname/../../seed/buckets.json`
  - 与 `diary-store.ts` 的 `findSeedFile()` 模式一致
- **`src/app/api/debug/route.ts`**：增加 `bucketsDir` 和 `bucketsSeedCandidates` 诊断字段

### 验证
- 部署后 `/api/memory/status` 返回 `bucket_count: 612`
- `/api/memory/buckets` 返回完整桶列表
- 前端 MemoryView 可正常显示所有记忆桶

### Debug 笔记
- `outputFileTracingIncludes` 配置 `'/api/**': ['./src/seed/**']` 已存在，新增的 `buckets.json` 自动被包含到 standalone build
- Zeabur 部署 cwd 是 `/src`，所以 seed 路径实际是 `/src/src/seed/buckets.json`
- 两个 Zeabur 服务（shell 和 Next.js 应用）各有独立的 `/persistent` 持久卷，不共享
- Zeabur build 耗时约 3-5 分钟，中间会 502

---

## 2026-07-09 — Tool-Use 修复：让星星能用工具

### 问题
- 用户在星星 Chat 里问"你有工具吗"，Claude 回答"没有"
- **根因**：
  1. `systemPrompt` 默认为空字符串 `''`，Claude 不知道自己的身份和可用工具
  2. 虽然 `ALL_TOOLS` 通过 API 传给了 Claude，但没有 system prompt 引导，Claude 不知道何时/如何使用
  3. 缺失 5 个工具定义（delete_diary, unlock_diary, set_password, timeline, delete_note）

### 修复
1. **`src/app/api/chat/route.ts`**：添加 `DEFAULT_SYSTEM_PROMPT` 常量作为 fallback
   - 当用户未设置 system prompt 时自动注入
   - 告诉 Claude：你是星星，住在 Lumbre，有记忆/日记/纸条/shell 四类工具
   - 引导主动使用工具（breath 搜记忆、hold 存记忆等）
2. **`src/server/tools.ts`**：补齐所有缺失工具
   - 新增 `delete_diary`（调用 `deleteDiary()`）
   - 新增 `unlock_diary`（调用 `unlockDiary()`）
   - 新增 `set_password`（调用 `setPassword()`）
   - 新增 `timeline`（调用 `readDiaries()` + 截断预览）
   - 新增 `delete_note`（调用 `deleteNote()`）
   - 新增 `run`（shell 命令，`child_process.exec`，30s 超时）
   - `executeTool` 整体包 try/catch，工具执行错误不会崩溃
3. **`/api/debug/tools`**：新增诊断端点，GET 返回工具数量和名称列表

### 工具总览（20 个）
| 类别 | 工具 | 数量 |
|------|------|------|
| 记忆 | breath, hold, grow, trace, pulse, dream | 6 |
| 日记 | write_diary, read_diary, comment_diary, update_diary, delete_diary, unlock_diary, set_password, timeline | 8 |
| 纸条 | write_note, read_notes, reply_note, delete_note | 4 |
| 系统 | run (shell) | 1 |

### 架构说明
```
用户消息 → 前端 chat.send() → POST /api/chat
  → Claude Messages API（body.tools = ALL_TOOLS, body.system = effectiveSystem）
  → Claude 返回 tool_use block
  → executeTool(name, input) 直接调用本地函数
  → tool_result 返回给 Claude 继续对话
  → 最多 15 轮 tool-use loop
```
不是 MCP 架构，是直接函数调用。所有工具在同一 Next.js 进程内执行。

### Debug 笔记
- `tools_enabled` 在 route.ts 默认为 `true`，前端不需要显式传
- `system` 参数为空时 `effectiveSystem` 回退到 DEFAULT_SYSTEM_PROMPT
- shell `run` 工具用 `child_process.exec`，maxBuffer 1MB，timeout 30s
- tsc --noEmit 全通过

---

## 2026-07-09 — OpenAI-compatible Tool-Use 支持

### 完成
**给 `proxyOpenAI()` 函数加上完整的 function calling 循环，使通过 OpenAI 兼容中转站的 Claude 也能使用全部 20 个工具。**

#### 改动文件
- `src/app/api/chat/route.ts`

#### 改动内容
1. **`toolsToOpenAI()` 转换函数**：将 Anthropic 格式（`{name, description, input_schema}`）转为 OpenAI 格式（`{type:"function", function:{name, description, parameters}}`）
2. **`proxyOpenAI()` 完整 tool-use 循环**：
   - 请求时带 `tools`（OpenAI function calling 格式）
   - 响应中检查 `message.tool_calls`（不依赖 `finish_reason`，兼容不同中转站实现）
   - 工具结果用 `{role:"tool", tool_call_id, content}` 格式回传
   - 最多 15 轮迭代
   - 累计 usage token 统计
3. **`tools_enabled` 参数透传**：从 POST body 传入 proxyOpenAI，控制是否发送工具定义
4. **`DEFAULT_SYSTEM_PROMPT` 回退**：OpenAI 路径也使用默认系统提示（之前没用）
5. **`ToolDef` 类型导入**：新增 import 用于 `toolsToOpenAI` 类型标注

#### 架构对比
```
Anthropic 路径:
  Claude API body.tools = [{name, description, input_schema}]  (Anthropic 格式)
  response.stop_reason = "tool_use"
  response.content[].type = "tool_use"
  回传: {type:"tool_result", tool_use_id, content}

OpenAI-compatible 路径 (新):
  API body.tools = [{type:"function", function:{name, description, parameters}}]  (OpenAI 格式)
  response.message.tool_calls[].function.{name, arguments}
  回传: {role:"tool", tool_call_id, content}
```

两条路径共享同一个 `executeTool()`，工具执行逻辑完全一致。

### Debug 笔记
- OpenAI 兼容 API 的 `finish_reason` 不统一（有的返回 `"tool_calls"`，有的返回 `"stop"`），所以改为直接检查 `msg.tool_calls` 是否存在，更健壮
- `msg` 整体 push 到 `loopMessages`（保留 `tool_calls` 字段），而不是只取 content，否则后续轮次 API 会报格式错误
- thinking 字段兼容三种命名：`reasoning_content`（OpenRouter/部分中转）、`reasoning`、`thinking`

---

## 2026-07-09 — 记忆前端空白修复

### 问题
- 记忆板块前端看不到内容，仅显示 1 个桶
- Tool-use 可正常工作（通过 chat API 调用 brain.ts）
- Shell 容器 `/persistent/buckets/` 有 613 个文件，但 Next.js 应用容器 `/persistent/buckets/` 只有 1 个真正的桶文件

### 根因
- `brain.ts` 的 `seedIfEmpty()` 条件是 `existing.length > 0`
- 应用容器的 `/persistent/buckets/` 目录不为空——有 1 个 tool_use 创建的桶 + 旧 OmbreBrain 的配置文件（`.dashboard_auth.json`, `families.json`, `import_state.json`）和子目录（`archive`, `dynamic`, `feel`, `permanent`）
- `.json` 文件过滤后有 4 个文件（含非桶的配置文件），`> 0` 条件成立 → seedIfEmpty 跳过 → 612 个桶从未被种入

### 修复
- `brain.ts` `seedIfEmpty()`: 将阈值从 `existing.length > 0` 改为 `existing.length >= 100`
- 这样只要桶数少于 100，就会触发 seed 机制（种入 612 个桶）

### 验证
- 部署后 `/api/memory/status` 返回 `bucket_count: 613`（612 seed + 1 已有）
- `/api/memory/buckets` 返回完整 613 条 IndexEntry
- 前端 MemoryView 可正常显示所有记忆桶

### Debug 笔记
- Shell 容器和 Next.js 应用容器的 `/persistent` 是独立持久卷（Zeabur 两个服务不共享）
- 应用容器的 `/persistent/buckets/` 里有旧 OmbreBrain 的遗留文件（子目录 + 配置 JSON），这些不是桶但会被 `.json` 过滤器匹配
- `loadAllBuckets()` 的 `normalizeBucket()` 会正确跳过非桶 JSON 文件（无 `id` 字段返回 null）
- seed 文件路径 `/src/src/seed/buckets.json` 在 standalone build 中通过 `outputFileTracingIncludes` 被正确包含
