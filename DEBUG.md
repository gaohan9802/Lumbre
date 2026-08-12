# Lumbre Debug Notes

## 2026-08-01 — 共读 v5

- **Chat 功能漂移**：旧共读聊天维护自己的 `ChatMsg/sendChat`，天然缺少版本、图片、工具块等能力。已改为嵌入 `ChatView`，只增加 embedded/context/onTurn 三个边界。
- **会话同步语义**：用户选择哪个 Chat 窗口，共读消息就直接写入哪个 session；默认书籍 session 仅在首次打开时确保存在，不强制抢走当前 Chat 会话，打开陪读面板时才激活选中会话。
- **双份记录**：Chat session 是可继续编辑的消息真源；`/persistent/coread/chats/*.json` 仅保留按书/章节讨论统计与阅读现场记录，不再反向驱动聊天 UI。
- **精确位置**：优先用 caret/range 把当前视口映射成正文字符 offset，回开章节后遍历 text node 恢复；失败才退化到滚动比例。
- **翻页布局**：CSS columns 必须放在固定高度正文容器中，外层横向 overflow；否则 column 会纵向增长，看起来仍像卷轴。
- **PDF**：PDF.js 通过 CDN ESM 动态加载，worker 版本必须与主模块一致（4.10.38）。
- **MOBI**：PalmDOC 反压缩只覆盖 compression=1/2；DRM/HUFF-CDIC 应明确报错，不能静默导入乱码。
- **TTS**：当前 profile 只有 OpenAI-compatible 时才尝试云端 `/audio/speech`，错误自动 fallback 系统语音。
- **验证**：TypeScript 与 whitespace check 通过；未本地执行 Next build。

## 2026-08-02 — 共读 v6 分页修复

- **文字断层根因**：旧实现让 CSS columns 自己分栏，却按 viewport.clientWidth 滚动；纸张内边距、columnWidth、80px columnGap 与滚动步长不相等，翻页会停在栏缝里。修复不是继续调 gap，而是让分页结果成为字符区间数组，每次只渲染一页。
- **分页算法**：离屏固定尺寸 DOM 使用与正文一致的字体/字号/行距/white-space，二分查找最大可容纳 endOffset，再向前寻找自然断句点。分页区间严格满足 `page[n].end === page[n+1].start`，所以不会丢字。
- **位置真源**：页码会随屏幕和字体变化，不能持久化为绝对页码；始终保存 charOffset，重排后查找包含该 offset 的新页面。
- **全书进度**：原实现用 `(章节下标 + 章节百分比) / 章节数`，章节长度差异越大误差越大；现改为 `(前序章节字符数 + 当前 offset) / totalChars`。
- **读取副作用**：`/api/coread/chapter` 原本 GET-like 读取时直接 `updateProgress`，只点开章节也会覆盖 lastChapter/lastOffset；已移除，进度只由阅读器保存路由写入。
- **重复批注**：`content.indexOf(originalText)` 无法区分重复句。新批注保存 startOffset/endOffset；老数据仅以首次匹配兼容展示。
- **目录页数**：粗略字数估算只用于后台实测尚未完成时的即时占位；每章随后使用同一 DOM 分页器计算真实页数组并缓存。页码明确属于当前设备/当前排版。
- **选择文本 trim 坑**：直接对 selection.toString() 做 trim 后仍用原 Range 起点，会让 offset 包含前导空白、end 却按 trim 后长度算，范围错位；现在把 `raw.length - raw.trimStart().length` 加回起点。
- **验证**：`./node_modules/.bin/tsc --noEmit` EXIT=0；`git diff --check` 通过；确认代码内已无 columnWidth/columnGap/横向 scrollBy 旧分页路径。按项目约定未在低内存环境执行 Next build。

## 2026-08-02 — Chat 偶发 `⚠️ terminated`

### 结论
- `terminated` 是 Node 20 内置 Undici 在上游 response body 尚未正常结束、远端 socket 被关闭时常见的读取异常文案。
- 异常发生在模型上游 SSE 的 `await reader.read()`，不是 HTTP 非 2xx，所以只检查 `res.ok` 无法捕获。
- 前端没有主动 abort Chat 请求；Lumbre → 浏览器已有 10 秒 SSE heartbeat，但 heartbeat 只能保活这一段，不能阻止“模型中转站 → Lumbre”断流。

### 常见触发条件
- 中转站瞬时不稳定、重启或负载过高。
- 长 thinking、长回复、上下文过大或带图片。
- 多轮工具调用：一次用户消息可能产生 2–15 次独立上游 completion，任一后续轮断流都会终止当前 turn。
- 若只在某个 baseUrl/model 组合出现，优先判断该模型渠道兼容性或稳定性。

### 本次处理
- Anthropic/OpenAI-compatible reader 分别捕获异常并分类成中文提示。
- 写入 `/persistent/chat-upstream-errors.jsonl`；不记录 Key、prompt、正文或请求 body。
- 日志字段：时间、provider、model、upstreamOrigin、iteration、hadOutput、toolCallCount、causeCode、socket 字节统计。
- 超过 1 MiB 自动轮转到 `.1`。
- 不自动重试已经开始输出的 turn：否则可能重复回答，写工具已经执行时还可能产生重复副作用。保留部分输出并让用户手动重 Roll更安全。

### 下次再现的排查命令
```sh
tail -20 /persistent/chat-upstream-errors.jsonl
```
重点对比 `upstreamOrigin`、`model`、`iteration`、`hadOutput`、`causeCode` 和 `bytesRead`。

---

## 2026-07-04 — Sidebar visual refresh
- Sidebar 呼吸光斑必须尊重 `prefers-reduced-motion`；动画只使用 transform/opacity。
- Tailwind 自定义 opacity 使用 `/[0.18]`，不要写未配置的 `/18`。
- active pill 的 `layoutId` 放在 button 内部的 absolute span，button 自身必须是 `relative`，避免旧版选中竖条相对错误祖先定位。

## 2026-08-03 — Timeline
- 正向计时不能把秒数持续写服务器；只保存 `start_at`，客户端和工具读取时动态计算 duration，避免每秒 I/O。
- 事件查询必须按 `[start,end)` 与查询区间是否重叠判断，不能只比较开始日期，否则跨午夜记录会丢。
- Chat 状态注入不写进历史 content，使用 bookmark_injections 附录，保证历史字节稳定和缓存命中。
- 星星工具只暴露 read_life_timeline；start/stop/update/delete 只留给前端 API。

## 2026-08-03 — Gmail 工具偶发卡住/失败
- 原 Gmail 封装没有 timeout、401 refresh retry、429/5xx backoff，Google 或 Zeabur 网络抖动时工具会长时间无返回。
- 同时调用多个 Gmail 工具会同时刷新 access token；现用单个 in-flight Promise 合并刷新。
- 读 10 封邮件原来是 1 次 list + 10 次串行 metadata；现并发并允许单封失败，不再整批报废。
- POST 发信遇到 socket 异常不自动重试，防止“服务端已发出、客户端没收到响应”导致重复邮件。
- 新增 `gmail_status`：先查配置/OAuth/API；不会输出 client secret、refresh token 或 access token。
- 若返回 `invalid_grant`：检查 refresh token 撤销/过期、Google OAuth 同意屏幕 Testing 的 7 天限制、client id 是否匹配。

- Chat 工具回灌层原先把所有普通工具结果统一截到 300 字；`read_emails/search_emails` 会得到半截 JSON，`read_email_detail` 只剩正文开头。现为 Gmail 读类工具设置 8k/14k 专用上限，当前轮可完整理解邮件，历史留痕仍保持 4k 上限防上下文膨胀。

## 2026-08-04 — 共读 / Intimacy 删除笔记
- 删除模块不能只删页面：需同步清理 Tab union/VALID_TABS、Sidebar、TopBar、page views、lib/api、server/tools 的 schema/import/executor，以及跨模块 helper。
- 共读曾向 chat-sync.ts 注入固定会话，删除 API 后仍需移除 appendCoreadChatMessage，避免遗留死代码和类型引用。
- jszip 仅由共读 EPUB 导入使用，模块删除后同步移除 package.json/yarn.lock 依赖。
- 持久卷数据未自动删除；代码删除与用户数据擦除应分开处理，防止误删后无法恢复。

---

## 2026-08-04 — 启动慢、刷新卡住、必须杀后台重开

### 关键根因
1. `page.tsx` 静态 import 全部模块，首屏 JS 包含 Chat/Memory/Diary/Photos 等所有大组件；不是“当前页面慢”，而是每次启动先加载整套应用。
2. ChatSync 的上传已增量，但下行仍全量：mount、45s tick、focus 后都会 GET 完整 chat-sync.json。会话越长，网络、服务端 JSON.parse、浏览器 JSON.parse、Zustand merge/localStorage persist 都线性变重。
3. 多个 focus/visibility/timer 事件可同时发起同步，没有 single-flight；后台恢复时容易叠请求。
4. 通用 API fetch 无 timeout/status check；半开连接让 loading 永远不结束。Diary load 无 finally，会把一次异常永久显示成加载状态。

### 修复策略
- 页面模块 `next/dynamic` 拆 chunk，首屏只加载当前模块。
- 同步协议分 manifest / selected sessions / POST delta 三层；默认不再返回全量归档。
- 客户端同步 single-flight + 分批拉取 + timeout；后台回前台仍立即同步，但不会并发轰炸。
- 服务端按 chat-sync.json mtime 缓存解析结果，未变更时直接复用。
- API client 统一 AbortController 超时、非 2xx 抛错；Diary loading 用 finally 收口。

### 后续观察点
- Zeabur 部署后重点看：冷启动到 Chat 可操作时间、900+ 层窗口恢复时间、focus 后是否还出现长时间白屏。
- 若 chat-sync.json 已到数十 MB，下一步应迁移为 `/persistent/chat/sessions/<id>.json + manifest.json`；本轮增量 API 可以保持不变，只替换服务端存储实现。
- Memory 仍是全量桶索引，桶数继续增长后需分页；Photos 元数据已轻量化为 raw URL，暂不是首屏主因。
- Chat store 还有一处隐藏放大：顶层 `messages` 是 active session 的镜像，却与 `settings.sessions` 一起被 persist，当前长会话会重复存一遍。已用 `partialize` 只落 `settings`；rehydrate 继续从 active session 重建 runtime mirror。

## 2026-08-04 — 深层性能优化 v2

### Chat 分片存储
- **为什么 manifest 不能调用 loadSyncState**：即使响应只返回元数据，只要先构造完整 state，服务端仍会读取/parse 每个大 session，优化等于只省网络、不省服务器。v2 manifest 必须成为独立真源。
- **迁移安全**：先逐 session 原子写入，再最后写 manifest；若中途进程退出，下次因 manifest 尚不存在会重跑迁移并覆盖相同 session 文件，不会让半迁移 manifest 对外可见。
- **文件名安全**：不能直接用 session id 拼路径。使用 `Buffer.from(id).toString('base64url')`，防 `/`、`..`、问号和 Unicode id。
- **删除语义**：POST delta 可能没有 session body，只有 tombstone；merge 必须遍历 manifest 并删除 tombstone 时间更新的文件，否则删除只从客户端消失、服务端文件永远残留。
- **备份策略**：单体文件时代每日快照会复制全部历史；分片后改为“变更会话每日首份快照 + 当前文件前一版 bak”，避免为一个小改动复制所有长会话。
- **并发边界**：当前 merge/read/write 都是同步临界段，单 Node 进程内不会 await 交错。若未来 Zeabur 横向扩成多副本并共享同一卷，需要再加跨进程文件锁或 SQLite。

### Memory 分页
- **过滤必须先于 slice**：若先取前 100 再在客户端筛 pinned/feel，会让用户误以为后续页没有匹配项；分页 API 在全索引上先 filter 再 cursor slice。
- **读取不应写盘**：原 `buildIndex()` 每次 GET 都写 `_index.json`。分页后请求次数增加，必须允许 `buildIndex(false)`，否则分页会放大磁盘 I/O。
- **stale-while-revalidate**：缓存只用于立即展示，网络成功仍覆盖；失败保留旧页并给重试，不再用空白/永久 loading 表示所有状态。

### 验证环境
- `/tmp/Lumbre` clone 后没有 node_modules，系统有 node 但无 npm；临时链接 `/data/Lumbre/node_modules` 完成 tsc，验证后立即移除链接，未提交依赖目录。
- 不能直接从另一项目路径运行 tsc 而不提供当前项目 node_modules：TypeScript 按当前文件目录解析包，会报大量虚假的 next/react/zustand 缺失。
- Memory 索引另加进程内 cache；bucket 写入/删除时失效。否则即使 bucket 文件读取有 30s cache，每个分页请求仍会重新 map/sort 全索引。
- Chat 首次批量迁移不为每个旧 session 生成“今天快照”，避免迁移瞬间把全历史再复制一遍；旧单体文件本身就是迁移前完整备份，日常增量写才生成分片快照。

## 2026-08-05 — 全屏目录 / PWA 图标
- 全屏导航不能只把旧 aside 宽度改成 `100vw`：桌面端原布局仍会给 Sidebar 分配 flex 宽度。正确做法是导航始终 `position: fixed`，页面根节点不再是左右 flex 布局，TopBar 成为所有尺寸的统一入口。
- 菜单打开时锁 `document.body.style.overflow`，关闭/卸载必须恢复；同时监听 Escape，避免桌面端只能点关闭按钮。
- 页面点击动画与关闭动画不要同一帧触发，否则按压反馈看不见；先切 tab，约 75ms 后关闭目录。
- iOS 主屏图标优先使用独立 180x180 `apple-touch-icon`；PWA manifest 同时保留 192/512，512 使用 `purpose: any maskable` 兼容 Android 自适应裁切。
- 当前 shell 无 Pillow/ImageMagick/sharp，图标用零依赖 Node PNG encoder 生成；后续若拿到用户原始上传文件，可直接替换同名 PNG，不需要改 manifest/layout。

## 2026-08-05 — 指定图片目录 / 子页面迁移
- 用户图片位于独立 `images` 分支，不能 merge 该分支（它包含一份完整且可能落后的项目）；只用 `git show origin/images:<file>` 精确取出 8 张目录图与 `logo-pwa.jpg`。
- 目录图原始尺寸均为 1036×275，保持原始 `aspect-ratio` 和 `object-cover`，不在代码中重绘、加字或改变图片内容。
- Tesis/Wishlist 不能只从 Sidebar 隐藏：还需从全局 Tab union、VALID_TABS、page views、TopBar 标题移除，并提高 persist version 做旧 activeTab 定向迁移。
- 子页面保留原设计最稳的方式是直接挂载原 `TesisView` / `WishlistView`，不复制组件、不改 API 和 store，避免数据或功能漂移。
- iOS 主屏图标直接引用用户提供的 `/logo-pwa.jpg`；manifest 同步声明 JPEG 的真实 1872×1872 尺寸。

## 2026-08-06 — 长 Chat 与唤醒断层
- 4000+ 层卡顿的前端主因是 Zustand persist 同步序列化完整 sessions，而不是 React 已有的 50 条可见消息懒渲染。修为 localStorage 仅存 100 条 warm tail，完整数据仍在 `/persistent/chat/sessions/`。
- 唤醒断层根因是 `autowake.ts` 仍直接读写旧 `/persistent/chat-sync.json`；分片迁移后该文件只是备份，不会继续更新。现统一使用 `loadSyncSessions/loadSyncManifest/mergeSyncDelta`。
- partial hydration 有发送竞态：后台拉全量前若产生新消息，不能让 partial 覆盖 full；按消息 id 合并本地新增尾部。
- Markdown 使用本地轻量 renderer，避免引入 react-markdown/remark 对 Chat chunk 和安装依赖的额外开销。

## 2026-08-06 — Web Push / Bookmark / Bubble debug
- iOS Push 的前提是 iOS 16.4+、HTTPS、已添加到主屏幕，并由用户手势触发 Notification permission；普通 Safari tab 不等价于 PWA。
- VAPID key 落 `/persistent/push/vapid.json`，避免 redeploy 后旧 subscription 因密钥变化失效。
- 星星新增/编辑 bookmark 走服务端 sync config + `configUpdatedAt`；不暴露 delete tool，删除只留前端。
- 自定义气泡不能对整个元素设 opacity，否则字也变淡；背景改 rgba，文字按背景亮度自动黑/白高对比。
- tsc --noEmit 与 git diff --check 通过；未跑 next build。

## 2026-08-07 — Chat 空气泡与自定义气泡文字颜色
- 空气泡有两条路径：content block 的 text 可能只有空白；legacy assistant 可能只有 thinking/tool_calls 而 `content` 为空。渲染条件必须使用 `trim()`，同时为纯图片消息保留例外。
- user 气泡此前用元素级 `opacity`，会连文字一起变透明；与星星气泡不一致。现统一把 alpha 写入 `backgroundColor: rgba(...)`，文字自身保持完全不透明。
- 文字对比不能只读取 color picker 的原始 hex：气泡半透明时，实际可见背景是“气泡色与页面底色混合”的结果。亮度判断现先按 alpha 混色，再选深棕或暖白。
- 浅色背景不再返回接近纯黑的颜色，统一使用 `#4a3428`；深色背景使用 `#f3e7dc`，兼顾对比度和柔和感。
- `ContentBlock.content` 是可选字段；在 TypeScript 中需先用 `typeof block.content === 'string'` 缩窄，再调用 `trim()`，否则 TS18048/TS2322。

## 2026-08-07 — Chat 美化细节
- 消息区柔雾应放在滚动容器外层、内容内层：外层 `relative` 承载绝对定位 blur overlay，内层 `h-full overflow-y-auto` 保持原滚动行为。若直接给滚动容器加 `backdrop-filter`，会让整块内容和滚动合成层更重。
- 全局 `:has(> textarea.bg-transparent:focus)` 会给输入框父容器再加一层 inset focus ring。自定义悬浮输入托盘时给 textarea 加 `no-frame`，避免全局规则与托盘自身 focus-within 边框叠加。
- 轻量 Markdown renderer 不应简单给每一行都制造独立大间距；连续普通行归成一个 prose block、保留 `<br>`，空行才承担段落分隔，能兼容模型常见的单换行输出。

## 2026-08-07 — 唤醒竞态与重复行为诊断（未修）
- 最危险的问题不是 prompt，而是 session 的“读旧整份 → 长请求 → 写回整份”竞态。唤醒写回必须在结束时重新加载最新版，并按 message id 追加；不能让旧 session 快照凭较新的 `updatedAt` 覆盖用户刚产生的消息。
- 2 分钟 tick + 结束时才写 `lastWakeAt` 会允许长唤醒重入；需要进程内 in-flight guard，并建议再加 `/persistent` 原子锁/lease 处理多 worker、多实例。
- 冷却应同时参考 `lastActivityAt` 与目标 session 最后一条 user 消息 timestamp，后者是会话数据真源，可兜底 activity 上报遗漏；是否让 `wake_me` 绕过冷却应做成明确策略，而不是隐藏例外。
- 防重复不能只记工具名。应持久化结构化 wake digest（工具名+关键 input+对象 id/URL+最终正文摘要+push），并把最近若干次 wake digest 注入下一次唤醒；必要时对相同动作指纹做服务器级去重。
- 唤醒 API 请求需检查 `res.ok`、错误字段和超时；日志应增加 startedAt/finishedAt、trigger kind、cooldown basis、session revision、write outcome，才能区分模型沉默、请求失败、写回冲突和客户端覆盖。

## 2026-08-07 — 星星气泡对齐
- 星星气泡存在历史消息、content block、流式 block 和等待加载四条渲染路径；调整对齐时必须同步修改，否则开始生成、生成中与生成完成后会发生宽度或位置跳动。
- 本次统一使用 `w-fit max-w-[80%] ml-auto rounded-br-md`，只改变星星正文气泡，不触碰外围消息容器和附属卡片。

## 2026-08-07 — Chat 左右对齐修正
- 工具调用与星星正文一样有 content block、legacy、streaming 三条路径；只改其中一条会导致历史消息和生成中界面不一致。本次三条路径统一为 `w-fit max-w-[80%] mr-auto`。
- 思考链与工具调用虽处于相邻分支，但需求只调整工具调用，不能给整个 assistant block 外层统一限宽，否则会连带改变思考链。
- user 操作按钮应按角色切换 `justify-end/justify-start`；其绝对定位的删除版本菜单也要同步切换 `right-0/left-0`，避免按钮靠右后菜单仍从消息区左侧弹出。

## 2026-08-07 — Chat 气泡宽度与 Markdown 间距
- “靠左占 87%”只适用于星星正文和同宽工具调用；不能全局替换所有 `max-w-[80%]`，否则会误把靠右的 user 气泡一起加宽。
- 段内行距由 Markdown 普通段落的 `leading-[1.8]` 控制，按 10% 缩减为 1.62；引用块有独立行高，需要同步按比例调整。
- 段间节奏同时由容器 `space-y` 和空行 spacer 控制；两者都按 20% 从 0.375rem 调到 0.3rem，避免只改一处导致空行段落仍显得过宽。

## 2026-07-16 — Timezone / summary
- UTC ISO is the storage format, not the user-facing timezone. Model-visible tool timestamps now pass through Madrid localization.
- Never parse offset-less datetime-local values with bare `new Date(value)` on Zeabur; use `parseMadridDateTime`.
- Never use `toISOString().slice(0,10)` for a Madrid calendar day.
- Auto-summary must skip partial sessions until full server hydration.

- Timeline 可视化不能用固定 86400000ms 当作 Madrid 的一天；DST 开始日是 23 小时，结束日是 25 小时。
- 摘要依赖源消息；删除/截断消息时若不失效相关摘要，会把用户已经删除的内容继续注入模型。
- `datetime-local` 落在春季 DST 不存在时段时必须报无效，不能自动挪到相邻小时。

## 2026-07-16 — 摘要倒序分段 debug
- 不能再用 `pending.slice(0, N*2)`：它天然从最早未覆盖处正序整理，也错误假设一轮永远只有 user+assistant 两条；工具过程、异常回复都会破坏这个假设。
- 新算法先按 user 消息构造完整轮次，再用摘要覆盖区间切成未覆盖组；每次选择最靠近当前的、长度足够的组末尾 N 轮。
- 自动补历史不能在摘要请求成功回调里依赖旧闭包继续递归，否则 `summaryGenerating=true` 的闭包会让下一次立即退出。改为由 session `updatedAt` 变化触发 effect，等 store 写入新摘要后再检查下一段。
- 摘要配置属于会话数据而不是全局 config；否则切换对话会共享开关、阈值和模型，违反“每个对话框彼此独立”。放进 session 后会自然随分片会话文件同步到 `/persistent/chat/sessions/`。
- 旧摘要只有 `coveredUntilMessageId`，倒序区间可能不连续，单端点不足以判断覆盖。新摘要记录完整 `sourceMessageIds`；旧数据以 `startAt/endAt` 兼容判断。
- “前端只留 5 张”不能真的从 session 数组删除旧摘要，否则永久记忆也丢失。正确做法只是 UI `slice(0, 5)`，服务端仍保存全量。

## 2026-07-16 — 分层摘要纠错与失效传播

- **阶段摘要不能只按数量缓存**：普通摘要被手动纠错后，旧阶段摘要虽然来源 ID 不变，但内容已经过期。处理方式是正文/情绪/结构字段变化时删除包含该来源 ID 的阶段摘要，让系统基于修正内容重新生成。
- **状态变化不应触发昂贵重建**：锁定和“待纠错”只是管理状态，不改变注入内容，因此 `updateSummary` 仅在 eventSummary/fireEmotion/starEmotion/structure 变化时使阶段摘要失效。
- **删除原消息的级联**：原消息删除或截断会先筛掉普通摘要，再按剩余普通摘要 ID 清理阶段摘要，避免高层摘要引用已不存在的底层记忆。
- **阶段生成失败重试风暴**：effect 依赖会话更新时间，失败后若不记录批次，任何状态更新都可能再次请求。增加批次 attempt key，同一页面生命周期内失败批次不重复自动调用；底层摘要集合改变后才形成新 key。
- **本地依赖环境**：当前工作目录无 node_modules，复用 `/root/Lumbre/node_modules` 做类型检查后只剩项目原有 `web-push` 模块类型缺失；本次新增文件未报告类型错误。临时软链已删除，未进入 git。

## 2026-08-05 — 4000 层对话摘要持续倒序补跑

- 根因：旧算法按“最新未覆盖块”持续向前扫描；长会话只要存在未覆盖历史，就会在每次 `updatedAt` 变化后继续自动补摘要，无法自然停止。
- 修复原则：摘要 v2 增加 per-session anchor。首次迁移时 `anchor = 当前最后消息`，历史直接封存；选段只允许读取 anchor 之后的消息。
- 自动开关关闭不能仅暂停 effect。若重新开启仍沿用旧 anchor，关闭期间积压会被补跑；因此 false→true 时必须把 anchor 更新到当前最后一层。
- anchor id 在删消息、截断、跨设备同步后可能找不到，所以同时保存 timestamp；找不到 id 时按 timestamp 过滤，禁止退回第 0 层。
- anchor 只能在摘要 API 成功并写入正文后推进；失败不推进，避免静默丢段。
- 阶段摘要与结构化字段不符合当前需求，继续保留只会增加 prompt/UI/失效传播复杂度；本次从类型、生成 effect、注入和界面一起删除，而非只隐藏。
- 开关 knob 使用 absolute + translate 容易受尺寸和样式变化影响；使用固定 track padding + layout spring 后，滑块始终被滑轨几何边界约束。

## 2026-07-06 — 摘要能力恢复 debug

- 摘要数据不应为了“前端只显示 10 张”而在 Zustand 中 `slice` 后覆盖；正确做法是在 `SummaryDialog` 计算 `visibleSummaries/visibleStages`，完整数组仍由 ChatSync 写进 `/persistent`。
- 普通摘要内容被编辑、重新生成或删除后，引用它的阶段摘要必须失效删除，否则阶段摘要会继续携带旧内容；store 的 `updateSummary/deleteSummary` 已联动清理，随后自动重新压缩。
- 锁定只阻止单张重新生成，不阻止手动查看、纠错标记和持久化。
- v2 封存游标必须保留；恢复高级功能不能重新启用“倒追 4000 多层旧历史”。
- 阶段摘要兼容旧字段：旧数据使用 `overview`，新数据使用纯正文 `content`；normalize 时兼容读取。

## 2026-08-08 — 摘要重复生成 / 游标语义 debug
- 根因一：摘要列表已经写入，但 pending 只按 anchor 后的轮数计算，不检查这些消息是否已被摘要的 `sourceMessageIds` 覆盖；摘要写入与 anchor 更新又是两次 store mutation，中间 effect 可重入，同一批消息会重复请求。
- 根因二：false→true 会把 anchor 直接推进到最后消息，相当于把关闭期间对话静默标成“已整理”，导致 UI、手动整理和自动整理三个标准不一致。
- 修复：anchor 只负责一次性封存升级前旧历史；封存后的实时整理进度完全由摘要来源 ID 推导。自动开关不得改 anchor。请求锁使用 ref 同步生效，避免 state 异步窗口。
- 锁定保护必须下沉到 Zustand action，不能只 disabled 按钮；否则其他调用方仍可修改/删除。原消息删除/截断的摘要失效清理也保留 locked 摘要，防止旁路删除。

## 2026-08-08 — 公网鉴权 P0
- 鉴权不能只做客户端遮罩；middleware 同时覆盖 HTML 与 `/api/*` 才能防止直接请求数据接口。
- 未配置密码必须 fail closed。当前要求 `LUMBRE_ACCESS_PASSWORD` 至少 12 位，否则业务页面重定向到配置提示，API 返回 503。
- Session Cookie 使用 HMAC 签名、HttpOnly、Secure（生产）、SameSite=Strict；服务端不保存明文 session 文件，适合 Zeabur 多次重启。
- `_next` 静态资源需公开以加载登录页；上传照片、聊天同步、日记等业务内容仍全部在受保护 API 后。

## 2026-08-08 — 自主唤醒可靠性 debug
- 闹钟遵守冷却时不能在“到点但仍冷却”这一 tick 删除 alarm；必须保持 pending，只有真正执行一次唤醒后才消费，否则闹钟会静默丢失。
- 只做原子 append 仍不足以保证聊天框永不丢唤醒：客户端可能持有 append 前的完整 session，稍后以更大 `updatedAt` 上传并覆盖。sync merge 必须显式保留 incoming 中缺少的服务器 `_wake` 消息。
- session 文件和 manifest 是两份关联状态；append 与普通 sync 都必须共用同一个 `/persistent/chat/.store-lock`，否则两个 worker 会各自读旧 manifest 后覆盖对方的 meta 更新。
- `/api/chat` 已受全站 middleware 保护，服务端 localhost fetch 不带浏览器 Cookie，会得到 401。内部调用必须使用专用 secret header，并且 middleware 只能按 secret 放行，不能仅信任 localhost Host/Origin。
- `lastActivityAt` 只是上报缓存，分片 session 最后一条 user 消息才是可复核真源；冷却判断和 UI 预计时间必须共用同一个 effective activity 算法。
- push 标签只有在 `pushEnabled` 且实际调用发送后才算“已做动作”；关闭 push 时模型输出的标签被剥离，但不应凭空生成“推送过”的防重复记录。
