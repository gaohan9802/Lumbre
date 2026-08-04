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
