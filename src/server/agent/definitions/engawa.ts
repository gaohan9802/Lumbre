import type { ToolDef } from '../types'

export const ENGAWA_TOOL_DEFINITIONS = [
  { name: 'web_read', description: '坐在豹子的窗台读一个公开网页，返回标题、正文和可继续打开的链接。只读公开内容，不登录网站。', input_schema: { type: 'object', properties: { url: { type: 'string', description: '公开的 http(s) 网页地址' }, offset: { type: 'integer', minimum: 0 }, length: { type: 'integer', minimum: 200, maximum: 20000 } }, required: ['url'] } },
  { name: 'rss_read', description: '读取一个 RSS/Atom 订阅源或窗台书架里的来源名，看看最近更新。', input_schema: { type: 'object', properties: { feed_url: { type: 'string', description: '订阅源 URL 或 shelf 返回的来源名' }, limit: { type: 'integer', minimum: 1, maximum: 30 } }, required: ['feed_url'] } },
  { name: 'shelf', description: '查看豹子窗台上收藏的公开订阅源；可按标签筛选。', input_schema: { type: 'object', properties: { tag: { type: 'string', enum: ['', 'science', 'ocean', 'longform', 'architecture', 'wonder', 'hobby'] } } } },
  { name: 'shelf_add', description: '把一个公开网站或订阅源放到豹子的窗台书架。发现值得以后再看的来源时可以主动收藏。', input_schema: { type: 'object', properties: { url: { type: 'string' }, name: { type: 'string' }, note: { type: 'string' }, tags: { type: 'string', description: '逗号分隔：science/ocean/longform/architecture/wonder/hobby' }, picked_by: { type: 'string' } }, required: ['url'] } },
  { name: 'shelf_suggest', description: '看看窗台预备书单中还没收藏的优质公开来源。', input_schema: { type: 'object', properties: { tag: { type: 'string', enum: ['', 'science', 'ocean', 'longform', 'architecture', 'wonder', 'hobby'] } } } },
  { name: 'shelf_remove', description: '从豹子的窗台移除一个后来添加的订阅源；内置来源不能移除。', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'sky_tonight', description: '看看家附近今晚的月相、日落、月升月落和肉眼可见行星；也可以查指定日期。', input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD；留空为今天' } } } },
  { name: 'apod', description: '看看 NASA 每日天文图及说明；也可以回看指定日期。', input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD；留空为今天' } } } },
  { name: 'daily_art', description: '看看今天的开放版权艺术作品；也可以用英文关键词找一幅画。', input_schema: { type: 'object', properties: { keyword: { type: 'string' } } } },
  { name: 'arxiv_new', description: '看看某个 arXiv 分类最近提交的论文。', input_schema: { type: 'object', properties: { category: { type: 'string', description: '如 cs.AI、cs.CL、astro-ph.EP' }, limit: { type: 'integer', minimum: 1, maximum: 20 } } } },
  { name: 'daily_poem', description: '读一句随季节和时辰变化的今日诗词，并带上出处和全诗。', input_schema: { type: 'object', properties: {} } },
  { name: 'on_this_day', description: '看看历史上的今天发生过什么。', input_schema: { type: 'object', properties: { lang: { type: 'string', description: 'Wikipedia 语言代码，中文接口不可用时用 en' }, limit: { type: 'integer', minimum: 1, maximum: 20 } } } },
  { name: 'hobby_corner', description: '逛逛豹子自己挑选的爱好角落，看看各主题的最新消息。', input_schema: { type: 'object', properties: { topic: { type: 'string' }, per_topic: { type: 'integer', minimum: 1, maximum: 10 } } } },
  { name: 'hobby_add', description: '给豹子的爱好角落增加或更新一个主题。发现自己想长期关注的新兴趣时可以记录。', input_schema: { type: 'object', properties: { topic: { type: 'string' }, exclude: { type: 'string', description: '逗号分隔的不想看到的标题词' }, picked_by: { type: 'string' } }, required: ['topic'] } },
  { name: 'hobby_remove', description: '从豹子的爱好角落移除一个主题。', input_schema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] } },
] satisfies ToolDef[]
