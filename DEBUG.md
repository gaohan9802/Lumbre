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
