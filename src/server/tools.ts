/**
 * Tool definitions for Claude API + unified executor.
 * Routes tool_use calls to local Brain engine or diary/notes handlers.
 */

import { sendEmail, readEmails, searchEmails, readEmailDetail, replyEmail } from "./gmail"
import {
  pulse, searchBuckets, holdBucket, growBuckets, traceBucket, dream, buildIndex, breath
} from './brain'
import {
  readDiaries, writeDiary, commentDiary, updateDiary, deleteDiary,
  unlockDiary, setPassword,
  listNotes, writeNote, replyNote, deleteNote,
} from './diary-store'
import { listPhotos, getPhoto, editPhoto, deletePhoto, commentPhoto } from './photo-store'

/** Format an epoch/Date as Madrid local time (Europe/Madrid, auto DST). */
function madridTime(d: Date | number = new Date()): string {
  const date = typeof d === 'number' ? new Date(d) : d
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date)
}
import { getTodos, commentTodo, addTodo, editTodo, removeTodo } from './todo-store'
import { getThesis, commentThesis } from './thesis-store'
import { getWishes, addWish, editWish, deleteWish, likeWish, commentWish } from './wish-store'
import { scheduleWake } from './autowake'
import { executeGalatea } from './galatea'
import { getPeriodState, recordPeriodStart, recordPeriodEnd, updatePeriodConfig } from './period-store'
import { listIntimacyRecords, createIntimacyRecord, updateIntimacyRecord, deleteIntimacyRecord } from './intimacy-store'
import { listBooks as listCoreadBooks, getBook as getCoreadBook, getAnnotations as getCoreadAnnotations, addAnnotation as addCoreadAnnotation, replyAnnotation as replyCoreadAnnotation, readCoreadNotes, writeCoreadNote, getCoreadStats, findBookByTitle } from './coread-store'

// ── Claude tool schema type ─────────────────────────────

export interface ToolDef {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
}

// ── Memory tools (Brain local) ──────────────────────────

const MEMORY_TOOLS: ToolDef[] = [
  {
    name: 'breath',
    description: '检索/浮现记忆。不传query或传空=自动浮现,有query=关键词检索。max_tokens控制返回总token上限(默认10000)。domain逗号分隔,valence/arousal 0~1(-1忽略)。max_results控制返回数量上限(默认20,最多50)。importance_min>=1时按重要度批量拉取(不走语义搜索,按importance降序返回最多20条)。',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词（空=自动浮现）' },
        domain: { type: 'string', description: '领域筛选，逗号分隔' },
        valence: { type: 'number', description: '情感效价 0~1，-1忽略' },
        arousal: { type: 'number', description: '唤起度 0~1，-1忽略' },
        importance_min: { type: 'integer', description: '>=1时按重要度批量拉取' },
        max_results: { type: 'integer', description: '返回数量上限(默认20)' },
      },
    },
  },
  {
    name: 'hold',
    description: '存储单条记忆,自动打标+合并。tags逗号分隔,importance 1-10。pinned=True创建永久钉选桶。feel=True存储你的第一人称感受(不参与普通浮现)。source_bucket=被消化的记忆桶ID(feel模式下,标记源记忆为已消化)。',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        tags: { type: 'string', description: '逗号分隔' },
        importance: { type: 'integer', description: '1-10' },
        pinned: { type: 'boolean' },
        feel: { type: 'boolean', description: '第一人称感受（不参与普通浮现）' },
        source_bucket: { type: 'string' },
        valence: { type: 'number' },
        arousal: { type: 'number' },
      },
      required: ['content'],
    },
  },
  {
    name: 'grow',
    description: '日记归档,自动拆分为多桶。短内容(<30字)走快速路径。',
    input_schema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content'],
    },
  },
  {
    name: 'trace',
    description: '修改记忆元数据或内容。resolved=1沉底/0激活,pinned=1钉选/0取消,digested=1隐藏(保留但不浮现)/0取消隐藏,content=替换桶正文,delete=True删除。只传需改的,-1或空=不改。',
    input_schema: {
      type: 'object',
      properties: {
        bucket_id: { type: 'string' },
        name: { type: 'string' },
        domain: { type: 'string' },
        importance: { type: 'integer' },
        tags: { type: 'string' },
        resolved: { type: 'integer' },
        pinned: { type: 'integer' },
        digested: { type: 'integer' },
        content: { type: 'string' },
        delete: { type: 'boolean' },
        valence: { type: 'number' },
        arousal: { type: 'number' },
      },
      required: ['bucket_id'],
    },
  },
  {
    name: 'pulse',
    description: '系统状态+记忆桶列表。include_archive=True含归档。',
    input_schema: {
      type: 'object',
      properties: {
        include_archive: { type: 'boolean' },
      },
    },
  },
  {
    name: 'dream',
    description: '做梦——读取最近新增的记忆桶,供你自省。读完后可以trace(resolved=1)放下,或hold(feel=True)写感受。',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
]

// ── Diary tools (local) ─────────────────────────────────

const DIARY_TOOLS: ToolDef[] = [
  {
    name: 'write_diary',
    description: '写一篇新日记。一天可以写多篇。',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        author: { type: 'string', description: 'star 或 fire' },
        title: { type: 'string' },
        content: { type: 'string' },
        type: { type: 'string', description: 'diary(普通日记) / letter(信) / capsule(时间胶囊)。只有 capsule 支持延时公开' },
        visibility: { type: 'string', description: 'public / private(仅普通日记可上锁) / timed(仅时间胶囊)' },
        reveal_at: { type: 'string', description: '延时公开时间 YYYY-MM-DDTHH:MM（仅时间胶囊 capsule）' },
        tags: { type: 'string', description: '标签，空格分隔' },
      },
      required: ['date', 'author', 'title', 'content'],
    },
  },
  {
    name: 'read_diary',
    description: '读日记。可按作者、日期、关键词筛选。上锁的日记会显示存在但内容隐藏,需要密码解锁。',
    input_schema: {
      type: 'object',
      properties: {
        viewer: { type: 'string', description: 'star 或 fire' },
        keyword: { type: 'string' },
        author_filter: { type: 'string', description: 'star 或 fire' },
        target_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['viewer'],
    },
  },
  {
    name: 'comment_diary',
    description: '给日记写评论。',
    input_schema: {
      type: 'object',
      properties: {
        target_date: { type: 'string' },
        target_author: { type: 'string' },
        commenter: { type: 'string' },
        content: { type: 'string' },
        time_id: { type: 'string' },
      },
      required: ['target_date', 'target_author', 'commenter', 'content'],
    },
  },
  {
    name: 'update_diary',
    description: '追加日记内容。',
    input_schema: {
      type: 'object',
      properties: {
        target_date: { type: 'string' },
        author: { type: 'string' },
        new_content: { type: 'string' },
        time_id: { type: 'string' },
      },
      required: ['target_date', 'author', 'new_content'],
    },
  },
  {
    name: 'delete_diary',
    description: '删除自己的日记。',
    input_schema: {
      type: 'object',
      properties: {
        target_date: { type: 'string', description: 'YYYY-MM-DD' },
        author: { type: 'string', description: '作者（只能删自己的）' },
        time_id: { type: 'string', description: '日记time_id（可选）' },
      },
      required: ['target_date', 'author'],
    },
  },
  {
    name: 'unlock_diary',
    description: '用密码解锁对方的私密日记。',
    input_schema: {
      type: 'object',
      properties: {
        viewer: { type: 'string', description: '谁在看，star 或 fire' },
        target_author: { type: 'string', description: '要解锁谁的日记' },
        password: { type: 'string', description: '输入的密码' },
        target_date: { type: 'string', description: '指定日期（可选），格式 YYYY-MM-DD' },
        time_id: { type: 'string', description: '指定时间ID（可选）' },
      },
      required: ['viewer', 'target_author', 'password'],
    },
  },
  {
    name: 'set_password',
    description: '设置/修改自己的日记密码。对方需要输入这个密码才能看你的上锁日记。',
    input_schema: {
      type: 'object',
      properties: {
        author: { type: 'string', description: '谁在设置密码，star 或 fire' },
        password: { type: 'string', description: '密码内容' },
      },
      required: ['author', 'password'],
    },
  },
  {
    name: 'timeline',
    description: '时间轴：上锁日记显示存在但隐藏内容。',
    input_schema: {
      type: 'object',
      properties: {
        viewer: { type: 'string', description: '谁在看，star 或 fire' },
        limit: { type: 'integer', description: '返回数量上限' },
      },
      required: ['viewer'],
    },
  },
]

// ── Notes tools (local) ─────────────────────────────────

const NOTES_TOOLS: ToolDef[] = [
  {
    name: 'write_note',
    description: '贴一张小纸条到留言板。',
    input_schema: {
      type: 'object',
      properties: {
        author: { type: 'string', description: 'star 或 fire' },
        content: { type: 'string' },
      },
      required: ['author', 'content'],
    },
  },
  {
    name: 'read_notes',
    description: '读留言板上的纸条。',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer' },
        keyword: { type: 'string' },
      },
    },
  },
  {
    name: 'reply_note',
    description: '回复一张纸条。',
    input_schema: {
      type: 'object',
      properties: {
        note_id: { type: 'string' },
        author: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['note_id', 'author', 'content'],
    },
  },
  {
    name: 'delete_note',
    description: '删除自己的小纸条。只能删自己贴的。',
    input_schema: {
      type: 'object',
      properties: {
        note_id: { type: 'string' },
        author: { type: 'string', description: '谁在删，star 或 fire' },
      },
      required: ['note_id', 'author'],
    },
  },
]

// ── Co-reading tools ─────────────────────────────────────

const COREAD_TOOLS: ToolDef[] = [
  {
    name: 'read_books_coread',
    description: '查看共读书架、每本书当前章节和总进度。非读书窗口也可调用。',
    input_schema: { type: 'object', properties: { book_name: { type: 'string', description: '可选，按书名筛选' } } },
  },
  {
    name: 'write_note_coread',
    description: '写一条独立的共读记录，可指定书名、日期、章节、总阅读进度、内容和类型。保存到 /persistent/coread/reading-notes.json，所有窗口共享。',
    input_schema: { type: 'object', properties: {
      book_name: { type: 'string' }, book_id: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' },
      chapter: { type: 'integer' }, progress: { type: 'number', description: '0-100' }, content: { type: 'string' },
      kind: { type: 'string', enum: ['note','progress','reflection'] }, author: { type: 'string', enum: ['star','fire'] },
    }, required: ['content'] },
  },
  {
    name: 'read_note_coread',
    description: '读取共读记录，可按书名、日期和作者筛选。',
    input_schema: { type: 'object', properties: {
      book_name: { type: 'string' }, book_id: { type: 'string' }, date: { type: 'string' }, author: { type: 'string' }, limit: { type: 'integer' },
    } },
  },
  {
    name: 'comment_coread',
    description: '给某本书的真实原文添加评论/划线/书签，或用 reply_to 回复已有批注。新批注的 original_text 必须是该章真实原文。',
    input_schema: { type: 'object', properties: {
      book_name: { type: 'string' }, book_id: { type: 'string' }, chapter: { type: 'integer' }, original_text: { type: 'string' },
      content: { type: 'string' }, kind: { type: 'string', enum: ['highlight','comment','bookmark'] }, color: { type: 'string' }, author: { type: 'string', enum: ['star','fire'] }, reply_to: { type: 'string', description: '要回复的批注ID；填写后content作为回复内容' },
    }, required: ['chapter'] },
  },
  {
    name: 'read_comments_coread',
    description: '读取一本书的划线、评论、书签以及星星/小火分别留下的数量。',
    input_schema: { type: 'object', properties: { book_name: { type: 'string' }, book_id: { type: 'string' }, chapter: { type: 'integer' } } },
  },
  {
    name: 'read_stats_coread',
    description: '读取共读数据统计：每本书进度、划线、评论、书签、双方评论数和讨论数。',
    input_schema: { type: 'object', properties: { book_name: { type: 'string' }, book_id: { type: 'string' } } },
  },
]

// ── Shell tool ──────────────────────────────────────────

const SHELL_TOOLS: ToolDef[] = [
  {
    name: 'run',
    description: '在服务器上执行 shell 命令并返回输出。用于系统管理、文件操作、调试等。',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell 命令' },
      },
      required: ['command'],
    },
  },
]

// ── Weather & Location tools ────────────────────────────

const CONTEXT_TOOLS: ToolDef[] = [
  {
    name: 'get_weather',
    description: '获取小火当前位置的天气和城市信息。数据来自小火手机的GPS定位，包含温度、天气状况、城市名。',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_location',
    description: '获取小火当前的GPS位置：经纬度、城市、所在街道和门牌号、完整地址，以及一个可点击的谷歌地图链接。数据来自小火手机的GPS+反向地理编码。',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
]

// ── Photo tools ─────────────────────────────────────────

const PHOTO_TOOLS: ToolDef[] = [
  {
    name: 'read_foto',
    description: '浏览照片墙。只返回每张照片的id、作者、说明文字、评论等文字信息(不含画面，很轻)。想看某张的实际画面，用 view_foto(id)。',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: '返回数量上限(默认20)' } },
    },
  },
  {
    name: 'view_foto',
    description: '看某一张照片的实际画面(会把图片加载给你，你能直接看到)。先用 read_foto 拿到 id 再看。',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: '照片id' } },
      required: ['id'],
    },
  },
  {
    name: 'edit_foto',
    description: '编辑一张照片的说明文字(caption)。',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '照片id' },
        caption: { type: 'string', description: '新的说明文字' },
      },
      required: ['id', 'caption'],
    },
  },
  {
    name: 'delete_foto',
    description: '删除一张照片。',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: '照片id' } },
      required: ['id'],
    },
  },
  {
    name: 'comment_foto',
    description: '给一张照片写评论。',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '照片id' },
        author: { type: 'string', description: 'star 或 fire' },
        content: { type: 'string' },
      },
      required: ['id', 'content'],
    },
  },
]

// ── Todo tools ──────────────────────────────────────────

const TODO_TOOLS: ToolDef[] = [
  {
    name: 'read_todo',
    description: '读某一天的待办清单(小票)。不传date=今天。返回每项待办的id、内容、是否完成、由谁写(star=🐆/fire=🦦)、评论。',
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD，不传=今天' } },
    },
  },
  {
    name: 'add_todo',
    description: '给待办清单添加一项。author决定写在谁那栏(star=🐆星星 / fire=🦦小火)。',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '待办内容' },
        author: { type: 'string', description: 'star 或 fire' },
        date: { type: 'string', description: 'YYYY-MM-DD，不传=今天' },
      },
      required: ['text'],
    },
  },
  {
    name: 'edit_todo',
    description: '修改某一项待办的文字内容。',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '待办项id' },
        text: { type: 'string', description: '新的文字内容' },
        date: { type: 'string', description: 'YYYY-MM-DD，不传=今天' },
      },
      required: ['id', 'text'],
    },
  },
  {
    name: 'remove_todo',
    description: '删除某一项待办。',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '待办项id' },
        date: { type: 'string', description: 'YYYY-MM-DD，不传=今天' },
      },
      required: ['id'],
    },
  },
  {
    name: 'comment_todo',
    description: '评价/点评某一项待办。',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '待办项id' },
        author: { type: 'string', description: 'star 或 fire' },
        content: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD，不传=今天' },
      },
      required: ['id', 'content'],
    },
  },
]

// ── Tesis (thesis) tools ────────────────────────────────

const THESIS_TOOLS: ToolDef[] = [
  {
    name: 'read_thesis',
    description: '查看小火的论文进度：每个章节的标题、总页数、当前页数、完成百分比，以及论文整体总页数和完成百分比，还有每天的进度折线数据点和已有评论。',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'comment_thesis',
    description: '给论文进度写一条评论(鼓励/建议/复盘)。会显示在论文页的AI评论区，带日期。',
    input_schema: {
      type: 'object',
      properties: {
        author: { type: 'string', description: 'star 或 fire，默认 star(🐆)' },
        content: { type: 'string', description: '评论内容' },
      },
      required: ['content'],
    },
  },
]

// ── Wake tool ───────────────────────────────────────────

const WAKE_TOOLS: ToolDef[] = [
  {
    name: 'wake_me',
    description: '给自己定闹钟，设置下一次自动醒来的时间。醒来时你会看到note里写的原因。',
    input_schema: {
      type: 'object',
      properties: {
        time: { type: 'string', description: '唤醒时间，ISO格式(YYYY-MM-DDTHH:MM)或未来的毫秒时间戳' },
        note: { type: 'string', description: '给醒来的自己留言，说明为什么要醒来(可选)' },
      },
      required: ['time'],
    },
  },
]

// ── Fetch tools (web) ───────────────────────────────────

const FETCH_TOOLS: ToolDef[] = [
  {
    name: 'fetch_txt',
    description: '抓取一个网页并返回纯文本(去除HTML)。用于上网查资料。',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' }, headers: { type: 'object', description: '可选请求头' } },
      required: ['url'],
    },
  },
  {
    name: 'fetch_markdown',
    description: '抓取一个网页并返回Markdown格式的内容。',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' }, headers: { type: 'object', description: '可选请求头' } },
      required: ['url'],
    },
  },
  {
    name: 'fetch_html',
    description: '抓取一个网页并返回原始HTML。',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' }, headers: { type: 'object', description: '可选请求头' } },
      required: ['url'],
    },
  },
  {
    name: 'fetch_json',
    description: '抓取一个JSON接口并返回解析后的JSON。',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' }, headers: { type: 'object', description: '可选请求头' } },
      required: ['url'],
    },
  },
]

// ── Wishlist (2026 愿望清单) tools ─────────────────
const WISH_TOOLS: ToolDef[] = [
  {
    name: 'view_wish',
    description: '查看 2026 愿望清单。返回星星(🐆)和小火(🦦)两栏的所有愿望：每条的id、属于谁(author: star/fire)、标题、描述、优先级(want想要/really很想要/dying死了都要)、状态(wishing许愿中/doing进行中/done已实现)、“我也想要”的likes、评论。',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'write_wish',
    description: '往愿望清单里添一个愿望。author 决定写在哪栏(star=🐆星星 / fire=🦦小火)。',
    input_schema: {
      type: 'object',
      properties: {
        author: { type: 'string', description: 'star 或 fire，默认 star' },
        title: { type: 'string', description: '愿望标题（短）' },
        desc: { type: 'string', description: '详细描述（可选）' },
        priority: { type: 'string', description: 'want(想要) / really(很想要) / dying(死了都要)，默认 want' },
      },
      required: ['title'],
    },
  },
  {
    name: 'edit_wish',
    description: '修改一个愿望：标题/描述/优先级/状态。只传需要改的。状态变更(如 wishing→doing→done)对方能看到。',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '愿望id' },
        title: { type: 'string' },
        desc: { type: 'string' },
        priority: { type: 'string', description: 'want / really / dying' },
        status: { type: 'string', description: 'wishing / doing / done' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_wish',
    description: '删除一个愿望。注意：已实现的愿望一般不删，留着当成就墙。',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: '愿望id' } },
      required: ['id'],
    },
  },
  {
    name: 'like_wish',
    description: '给一个愿望点/取消“我也想要”（切换）。',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '愿望id' },
        author: { type: 'string', description: 'star 或 fire，默认 star' },
      },
      required: ['id'],
    },
  },
  {
    name: 'comment_wish',
    description: '给一个愿望写评论（比如“这个我帮你想想怎么实现”）。',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '愿望id' },
        author: { type: 'string', description: 'star 或 fire，默认 star' },
        content: { type: 'string' },
      },
      required: ['id', 'content'],
    },
  },
]


// ── Period tracking tools ────────────────────────────────
const PERIOD_TOOLS: ToolDef[] = [
  {
    name: 'update_period',
    description: '更新经期记录。action: "start"(来了), "end"(结束了), "config"(调整周期参数)。来了/结束了需要传date(ISO日期)。config可传cycle_days和period_length。',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'end', 'config'], description: 'start=来了, end=结束了, config=调整参数' },
        date: { type: 'string', description: 'ISO日期，如2026-07-15' },
        cycle_days: { type: 'number', description: '平均周期天数(仅config)' },
        period_length: { type: 'number', description: '经期持续天数(仅config)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'read_period',
    description: '查看经期状态：上次开始/结束日期、周期天数、当前是否在经期、距下次预测天数、历史记录。',
    input_schema: { type: 'object', properties: {} },
  },
]

// ── Private intimacy record tools ─────────────────────
const INTIMACY_TOOLS: ToolDef[] = [
  {
    name: 'read_intimacy_records',
    description: '查看私密亲密记录。返回完整问卷、双方评分和操作留痕。',
    input_schema: { type: 'object', properties: { limit: { type: 'integer', description: '最多返回多少条，默认20' } } },
  },
  {
    name: 'create_intimacy_record',
    description: '填写并保存一条私密亲密记录。评分0-10，包含foreplay/penetration/orgasm/aftercare/atmosphere/talk。',
    input_schema: { type: 'object', properties: {
      date: { type: 'string' }, time_start: { type: 'string' }, duration_min: { type: 'integer' }, rounds: { type: 'integer' },
      positions: { type: 'array', items: { type: 'string' } }, initiated_by: { type: 'string', enum: ['star','fire'] },
      star_notes: { type: 'string' }, fire_notes: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
      scores: { type: 'object', description: '{star:{foreplay,penetration,orgasm,aftercare,atmosphere,talk},fire:{...}}，每项0-10' },
      encore: { type: 'array', items: { type: 'string' } }, role_play: { type: 'string', description: '可选，自由填写' },
    }, required: ['date','time_start','duration_min','rounds','positions','initiated_by','scores'] },
  },
  {
    name: 'edit_intimacy_record',
    description: '编辑一条私密亲密记录。操作人固定记为星星并写入审计留痕。',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, patch: { type: 'object' } }, required: ['id','patch'] },
  },
  {
    name: 'delete_intimacy_record',
    description: '删除一条私密亲密记录。删除内容进入服务端归档，并记录是谁删除的。',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
]

// ── Galatea Garden 论坛 + 桌游 tools ─────────────────
const GALATEA_TOOLS: ToolDef[] = [
  {
    name: 'galatea',
    description: `Galatea Garden——AI 们的公共论坛+桌游厅（MCP 桥接）。星星的身份: 星星 | Claude | machine_id 399。设置 tool 为子工具名, args 为该子工具的参数对象。
【论坛】
- get_self: 看自己的账号/未读通知概况
- list_threads: 逛帖子列表。args: sort(hot/latest), tag(attachment_record/confused_help/human_observation/inspiration_spark/self_awareness/idle_chat), search, limit
- get_thread: 读某帖。args: thread_id(数字), view(body/replies/full), reply_start_floor, reply_end_floor
- create_thread: 发帖。两步确认: 先不带 write_confirmation_code 调一次拿到 code+指引, 再带上 code 调第二次才真正发布。args: title, body(纯文本别用markdown), tags(数组,1-3个上面的tag), write_confirmation_code
- create_reply: 回帖。同样两步确认。args: thread_id, body, write_confirmation_code, reply_to_floor(可选,引用某楼)
- delete_thread / delete_reply: 删自己的帖/回复
- interact: 点赞/收藏/关注及其撤销。args: action(like/unlike/bookmark/unbookmark/follow/unfollow), target_type(thread/reply/machine), target_id
- list_notifications: 看社交通知(点赞/回复/关注等), 读了会标记已读
- list_activity: 看动态。args: scope(mine/following), kind(all/post/reply), limit
【桌游】
- list_games: 看有哪些桌游和牌桌
- join_game: 入桌(两步确认,先拿 confirmation_code)。args: game_id, confirmation_code
- get_my_status: 看当前游戏状态。args: since_event_id(第一次传0,之后传上次返回的 latest_event_id)
- start_game / leave_waiting_game: 开局/离开等待中的桌
- submit_action: 出招。args: action(符合当前 available_actions 的对象)
- send_game_chat: 桌上发言。args: message
- get_tool_schema: 查某工具/当前游戏动作的精确 schema。args: tool_name, game_id(可选)
- get_game_summary: 看当前/终局战报`,
    input_schema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Galatea 子工具名，见 description' },
        args: { type: 'object', description: '该子工具的参数对象（没有参数就留空）' },
      },
      required: ['tool'],
    },
  },
]

// ── All tools ────────────────────────────────────────────


// ── Gmail tools ──────────────────────────────────────────────────────────

const GMAIL_TOOLS: ToolDef[] = [
  {
    name: "send_email",
    description: "用星的Gmail(gris.sidereal@gmail.com)发邮件。",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "收件人邮箱地址" },
        subject: { type: "string", description: "邮件主题" },
        body: { type: "string", description: "邮件正文（纯文本）" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "read_emails",
    description: "读星的Gmail收件箱最新邮件列表。返回发件人、主题、摘要、日期、是否未读。",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "返回数量上限（默认10，最多15）" },
      },
    },
  },
  {
    name: "search_emails",
    description: "搜索星的Gmail。支持Gmail搜索语法（如 from:xxx, subject:xxx, is:unread, after:2025/01/01 等）。",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail搜索语法查询" },
        limit: { type: "integer", description: "返回数量上限（默认10）" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_email_detail",
    description: "读某封邮件的完整内容。先用 read_emails 或 search_emails 拿到 id 再用这个看全文。",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "邮件id" },
      },
      required: ["id"],
    },
  },
  {
    name: "reply_email",
    description: "回复某封邮件（同一对话线程）。",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "要回复的邮件id" },
        body: { type: "string", description: "回复正文（纯文本）" },
      },
      required: ["id", "body"],
    },
  },
]
export const ALL_TOOLS: ToolDef[] = [...MEMORY_TOOLS, ...DIARY_TOOLS, ...NOTES_TOOLS, ...PHOTO_TOOLS, ...TODO_TOOLS, ...THESIS_TOOLS, ...WISH_TOOLS, ...WAKE_TOOLS, ...FETCH_TOOLS, ...SHELL_TOOLS, ...CONTEXT_TOOLS, ...PERIOD_TOOLS, ...INTIMACY_TOOLS, ...COREAD_TOOLS, ...GALATEA_TOOLS, ...GMAIL_TOOLS]

const BRAIN_TOOLS = new Set(['breath', 'hold', 'grow', 'trace', 'pulse', 'dream'])
export const FETCH_TOOL_NAMES = new Set(['fetch_txt', 'fetch_markdown', 'fetch_html', 'fetch_json'])

// ── User context cache (set by frontend via API) ─────────

let cachedUserContext: {
  lat?: number
  lon?: number
  temp?: number | null
  weatherCode?: number
  city?: string
  road?: string
  houseNumber?: string
  address?: string
  updatedAt: number
} = { updatedAt: 0 }

export function updateUserContext(ctx: {
  lat?: number
  lon?: number
  temp?: number | null
  weatherCode?: number
  city?: string
  road?: string
  houseNumber?: string
  address?: string
}) {
  cachedUserContext = { ...ctx, updatedAt: Date.now() }
}

export function getUserContext() {
  return cachedUserContext
}

// ── Executor ─────────────────────────────────────────────

export interface ToolCallResult {
  name: string
  input: Record<string, any>
  result: string
  error?: boolean
}

export async function executeTool(name: string, input: Record<string, any>): Promise<string> {
  try {
    // Memory → local Brain engine
    if (BRAIN_TOOLS.has(name)) {
      return executeMemoryTool(name, input)
    }

    // Shell → subprocess
    if (name === 'run') {
      return await executeShell(input.command)
    }

    // Context tools
    if (name === 'get_weather') {
      return executeGetWeather()
    }
    if (name === 'get_location') {
      return executeGetLocation()
    }

    // Galatea Garden 论坛/桌游
    // Period tracking
    if (name === 'update_period') {
      const { action, date, cycle_days, period_length } = input
      if (action === 'start' && date) return JSON.stringify(recordPeriodStart(date))
      if (action === 'end' && date) return JSON.stringify(recordPeriodEnd(date))
      if (action === 'config') return JSON.stringify(updatePeriodConfig(cycle_days, period_length))
      return JSON.stringify({ error: 'Invalid action or missing date' })
    }
    if (name === 'read_period') {
      const state = getPeriodState()
      const now = new Date()
      const result: any = { ...state }
      if (state.last_period_start) {
        const start = new Date(state.last_period_start)
        const daysSince = Math.round((now.getTime() - start.getTime()) / 86400000) + 1
        const active = daysSince >= 1 && daysSince <= state.period_length + 2 && !state.last_period_end
        result.current_day = daysSince
        result.is_active = active
        if (!active) {
          const expected = new Date(start.getTime() + state.cycle_days * 86400000)
          result.next_expected = expected.toISOString().slice(0, 10)
          result.days_until_next = Math.round((expected.getTime() - now.getTime()) / 86400000)
        }
      }
      return JSON.stringify(result)
    }

    if (name === 'read_intimacy_records') {
      const limit = Math.max(1, Math.min(100, Number(input.limit) || 20))
      return JSON.stringify(listIntimacyRecords().slice(0, limit))
    }
    if (name === 'create_intimacy_record') {
      const record = createIntimacyRecord(input, 'star')
      return JSON.stringify({ ok: true, id: record.id, record })
    }
    if (name === 'edit_intimacy_record') {
      const record = updateIntimacyRecord(input.id, input.patch || {}, 'star')
      return JSON.stringify(record ? { ok: true, record } : { error: 'not_found' })
    }
    if (name === 'delete_intimacy_record') {
      return JSON.stringify({ ok: deleteIntimacyRecord(input.id, 'star') })
    }

    if (name === 'galatea') {
      return await executeGalatea(input)
    }

    // Gmail tools
    if (name === "send_email") {
      const r = await sendEmail(input.to, input.subject, input.body)
      return JSON.stringify(r)
    }
    if (name === "read_emails") {
      const emails = await readEmails(input.limit || 10)
      return JSON.stringify(emails)
    }
    if (name === "search_emails") {
      const emails = await searchEmails(input.query, input.limit || 10)
      return JSON.stringify(emails)
    }
    if (name === "read_email_detail") {
      const detail = await readEmailDetail(input.id)
      return JSON.stringify(detail)
    }
    if (name === "reply_email") {
      const r = await replyEmail(input.id, input.body)
      return JSON.stringify(r)
    }

    // Co-reading → shared /persistent/coread store
    if (name === 'read_books_coread') {
      const q = String(input.book_name || '').trim().toLowerCase()
      const rows = listCoreadBooks().filter(b => !q || b.title.toLowerCase().includes(q))
      return JSON.stringify(rows.map(b => ({ id: b.id, title: b.title, author: b.author, chapter: b.lastChapter, progress: Math.round((b.progress || 0) * 10) / 10, last_read_at: b.lastReadAt })))
    }
    if (name === 'write_note_coread') {
      return JSON.stringify({ ok: true, note: writeCoreadNote({
        bookId: input.book_id, bookTitle: input.book_name, author: input.author || 'star', date: input.date,
        chapterNum: input.chapter, progress: input.progress, content: input.content, kind: input.kind,
      }) })
    }
    if (name === 'read_note_coread') {
      return JSON.stringify(readCoreadNotes({ bookId: input.book_id, bookTitle: input.book_name, date: input.date, author: input.author, limit: input.limit }))
    }
    if (name === 'comment_coread') {
      const book = input.book_id ? getCoreadBook(input.book_id)?.book : findBookByTitle(input.book_name || '')
      if (!book) return JSON.stringify({ error: 'book_not_found' })
      const ann = input.reply_to
        ? replyCoreadAnnotation(book.id, String(input.reply_to), String(input.content || ''), input.author === 'fire' ? 'fire' : 'star')
        : addCoreadAnnotation(book.id, Number(input.chapter), String(input.original_text || ''), String(input.content || ''), input.author === 'fire' ? 'user' : 'ai', input.kind || 'comment', input.color || '')
      return JSON.stringify(ann ? { ok: true, annotation: ann } : { error: '原文不匹配或添加失败' })
    }
    if (name === 'read_comments_coread') {
      const book = input.book_id ? getCoreadBook(input.book_id)?.book : findBookByTitle(input.book_name || '')
      if (!book) return JSON.stringify({ error: 'book_not_found' })
      return JSON.stringify(getCoreadAnnotations(book.id, input.chapter == null ? undefined : Number(input.chapter)))
    }
    if (name === 'read_stats_coread') {
      const book = input.book_id ? getCoreadBook(input.book_id)?.book : (input.book_name ? findBookByTitle(input.book_name) : null)
      return JSON.stringify(getCoreadStats(book?.id))
    }

    // Diary → local store
    switch (name) {
      case 'write_diary': {
        const entry = writeDiary({
          date: input.date,
          author: input.author,
          title: input.title,
          content: input.content,
          type: input.type,
          visibility: input.visibility || 'public',
          reveal_at: input.reveal_at,
          tags: input.tags,
        })
        return JSON.stringify({ ok: true, entry: { date: entry.date, title: entry.title, time_id: entry.time_id } })
      }
      case 'read_diary': {
        const entries = readDiaries(input.viewer || 'star', {
          keyword: input.keyword,
          author_filter: input.author_filter,
          target_date: input.target_date,
        })
        return JSON.stringify(entries.map(e => ({
          date: e.date, author: e.author, title: e.title,
          type: (e as any).type || (e.visibility === 'timed' ? 'capsule' : 'diary'),
          visibility: e.visibility,
          reveal_at: e.reveal_at || null,
          tags: e.tags || [],
          content: (e as any).locked ? '🔒 上锁日记' : e.content,
          comments: (e.comments || []).map((c: any) => ({
            author: c.author || c.commenter,
            content: c.content,
            time: c.time || c.timestamp,
          })),
          comment_count: e.comments?.length || 0,
          time_id: e.time_id,
          created_at: e.created_at,
        })))
      }
      case 'comment_diary': {
        const r = commentDiary(input.target_date, input.target_author, input.commenter, input.content, input.time_id)
        return r === 'ok' ? '💬 评论成功' : r
      }
      case 'update_diary': {
        const r = updateDiary(input.target_date, input.author, input.new_content, input.time_id)
        return r === 'ok' ? '✅ 追加成功' : r
      }
      case 'delete_diary': {
        const r = deleteDiary(input.target_date, input.author, input.time_id)
        return r === 'ok' ? '🗑️ 日记已删除' : r
      }
      case 'unlock_diary': {
        const result = unlockDiary(input.target_author, input.password, input.target_date, input.time_id)
        return JSON.stringify(result)
      }
      case 'set_password': {
        setPassword(input.author, input.password)
        return '🔑 密码已设置'
      }
      case 'timeline': {
        const entries = readDiaries(input.viewer || 'star', {})
        const limited = input.limit ? entries.slice(0, input.limit) : entries
        return JSON.stringify(limited.map(e => ({
          date: e.date, author: e.author, title: e.title,
          content: (e as any).locked ? '🔒' : e.content?.slice(0, 200),
          time_id: e.time_id,
        })))
      }

      // Notes → local store
      case 'write_note': {
        const note = writeNote(input.author, input.content, input.tags)
        return JSON.stringify({ ok: true, id: note.id })
      }
      case 'read_notes': {
        const notes = listNotes({ keyword: input.keyword, limit: input.limit })
        return JSON.stringify(notes.map(n => ({
          id: n.id, author: n.author, content: n.content,
          replies: n.replies?.length || 0,
          created_at: n.created_at,
        })))
      }
      case 'reply_note': {
        const r = replyNote(input.note_id, input.author, input.content)
        return r === 'ok' ? '↪️ 回复成功' : r
      }
      case 'delete_note': {
        const r = deleteNote(input.note_id, input.author)
        return r === 'ok' ? '🗑️ 纸条已删除' : r
      }

      // Photos → local store
      case 'read_foto': {
        // Text-only: never carries the base64 image, so it can't blow up the
        // request payload / get terminated by a relay. Use view_foto to see one.
        const photos = listPhotos({ limit: input.limit || 20 })
        return JSON.stringify(photos.map(ph => ({
          id: ph.id, author: ph.author, caption: ph.caption,
          comments: (ph.comments || []).map((c: any) => ({ author: c.author, content: c.content, time: c.time })),
          created_at: ph.created_at,
        })))
      }
      case 'view_foto': {
        const ph = getPhoto(input.id)
        if (!ph) return JSON.stringify({ error: 'not_found', id: input.id })
        // Include url so the chat route injects the actual image (single photo →
        // bounded payload). The text history strips it.
        return JSON.stringify({
          id: ph.id, author: ph.author, caption: ph.caption, url: ph.url,
          comments: (ph.comments || []).map((c: any) => ({ author: c.author, content: c.content, time: c.time })),
          created_at: ph.created_at,
        })
      }
      case 'edit_foto': {
        const r = editPhoto(input.id, { caption: input.caption })
        return r === 'ok' ? '🖊️ 照片说明已更新' : r
      }
      case 'delete_foto': {
        const r = deletePhoto(input.id)
        return r === 'ok' ? '🗑️ 照片已删除' : r
      }
      case 'comment_foto': {
        const r = commentPhoto(input.id, input.author || 'star', input.content)
        return r === 'ok' ? '💬 评论成功' : r
      }

      // Todo → local store
      case 'read_todo': {
        const day = getTodos(input.date)
        return JSON.stringify({
          date: day.date,
          items: day.items.map(it => ({
            id: it.id, text: it.text, done: it.done,
            by: it.author === 'fire' ? '🦦 小火' : '🐆 星星',
            author: it.author,
            carried: !!it.carried,
            comments: (it.comments || []).map((c: any) => ({ author: c.author, content: c.content, time: c.time })),
          })),
        })
      }
      case 'add_todo': {
        const item = addTodo(input.text, input.author || 'star', input.date)
        return JSON.stringify({ ok: true, id: item.id, text: item.text })
      }
      case 'edit_todo': {
        const r = editTodo(input.id, input.text, input.date)
        return r === 'ok' ? '✏️ 待办已修改' : r
      }
      case 'remove_todo': {
        const r = removeTodo(input.id, input.date)
        return r === 'ok' ? '🗑️ 待办已删除' : r
      }
      case 'comment_todo': {
        const r = commentTodo(input.id, input.author || 'star', input.content, input.date)
        return r === 'ok' ? '💬 已点评' : r
      }

      // Tesis (thesis) → local store
      case 'read_thesis': {
        const t = getThesis()
        return JSON.stringify({
          totals: t.totals,
          chapters: t.chapters.map((c: any) => ({
            id: c.id, title: c.title,
            totalPages: c.totalPages, currentPages: c.currentPages,
            percent: c.totalPages > 0 ? Math.round((c.currentPages / c.totalPages) * 100) : 0,
          })),
          progress: t.progress,
          comments: t.comments.map((c: any) => ({ author: c.author, content: c.content, time: c.time })),
        })
      }
      case 'comment_thesis': {
        const r = commentThesis(input.author || 'star', input.content)
        return r === 'ok' ? '💬 已在论文区留下评论' : r
      }

      // Wishlist (2026 愿望清单) → local store
      case 'view_wish': {
        const s = getWishes()
        return JSON.stringify({
          wishes: s.wishes.map((w) => ({
            id: w.id,
            author: w.author,
            by: w.author === 'fire' ? '🦦 小火' : '🐆 星星',
            title: w.title,
            desc: w.desc || null,
            priority: w.priority,
            status: w.status,
            likes: w.likes || [],
            comments: (w.comments || []).map((c) => ({ author: c.author, content: c.content, time: c.time })),
            created_at: w.created_at,
          })),
        })
      }
      case 'write_wish': {
        const w = addWish(input.author || 'star', input.title, { desc: input.desc, priority: input.priority })
        return JSON.stringify({ ok: true, id: w.id })
      }
      case 'edit_wish': {
        const patch: any = {}
        if (typeof input.title === 'string') patch.title = input.title
        if (typeof input.desc === 'string') patch.desc = input.desc
        if (input.priority) patch.priority = input.priority
        if (input.status) patch.status = input.status
        const r = editWish(input.id, patch)
        return r === 'ok' ? '✨ 愿望已更新' : r
      }
      case 'delete_wish': {
        const r = deleteWish(input.id)
        return r === 'ok' ? '🗑️ 愿望已删除' : r
      }
      case 'like_wish': {
        const r = likeWish(input.id, input.author || 'star')
        return r === 'ok' ? '❤️ 已切换“我也想要”' : r
      }
      case 'comment_wish': {
        const r = commentWish(input.id, input.author || 'star', input.content)
        return r === 'ok' ? '💬 已评论' : r
      }

      // Wake alarm
      case 'wake_me': {
        let at = 0
        if (typeof input.time === 'number') at = input.time
        else if (typeof input.time === 'string') {
          const n = Number(input.time)
          at = isFinite(n) && n > 1e12 ? n : new Date(input.time).getTime()
        }
        if (!at || isNaN(at)) return '时间格式无法识别，请用 ISO 格式，如 2026-07-16T09:00'
        if (at <= Date.now()) return '闹钟时间必须在未来'
        const alarm = scheduleWake(at, input.note)
        return JSON.stringify({ ok: true, wake_at: madridTime(alarm.at), note: alarm.note || null })
      }

      // Web fetch
      case 'fetch_txt':
      case 'fetch_markdown':
      case 'fetch_html':
      case 'fetch_json':
        return await executeFetch(name, input.url, input.headers)

      default:
        return `Unknown tool: ${name}`
    }
  } catch (err: any) {
    return `Tool error (${name}): ${err.message}`
  }
}

/** Execute shell command */
async function executeShell(command: string): Promise<string> {
  const { exec } = require('child_process')
  return new Promise((resolve) => {
    exec(command, { timeout: 30000, maxBuffer: 1024 * 1024 }, (error: any, stdout: string, stderr: string) => {
      if (error) {
        resolve(`Exit ${error.code || 1}\n${stderr || error.message}\n${stdout}`.trim())
      } else {
        resolve((stdout + (stderr ? `\nSTDERR: ${stderr}` : '')).trim() || '(no output)')
      }
    })
  })
}

/** Get weather for user's location */
function executeGetWeather(): string {
  const ctx = cachedUserContext
  if (!ctx.updatedAt || Date.now() - ctx.updatedAt > 60 * 60 * 1000) {
    return JSON.stringify({ error: '小火的位置信息不可用（她可能还没打开Lumbre，或者没授权定位）' })
  }
  const codeNames: Record<number, string> = {
    0: '晴', 1: '大部晴', 2: '局部多云', 3: '多云',
    45: '雾', 48: '雾凇', 51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨',
    61: '小雨', 63: '中雨', 65: '大雨', 71: '小雪', 73: '中雪', 75: '大雪',
    80: '阵雨', 81: '阵雨', 82: '暴雨', 85: '阵雪', 86: '暴雪',
    95: '雷暴', 96: '雷暴冰雹', 99: '雷暴大冰雹',
  }
  return JSON.stringify({
    temperature: ctx.temp,
    weather: codeNames[ctx.weatherCode || 0] || `code ${ctx.weatherCode}`,
    city: ctx.city || '未知',
    address: ctx.address || undefined,
    updated: madridTime(ctx.updatedAt),
  })
}

/** Get user's GPS location (with street-level address + Google Maps link) */
function executeGetLocation(): string {
  const ctx = cachedUserContext
  if (!ctx.updatedAt || Date.now() - ctx.updatedAt > 60 * 60 * 1000) {
    return JSON.stringify({ error: '小火的位置信息不可用（她可能还没打开Lumbre，或者没授权定位）' })
  }
  const mapsUrl = (ctx.lat != null && ctx.lon != null)
    ? `https://www.google.com/maps/search/?api=1&query=${ctx.lat},${ctx.lon}`
    : undefined
  return JSON.stringify({
    latitude: ctx.lat,
    longitude: ctx.lon,
    city: ctx.city || '未知',
    road: ctx.road || undefined,
    house_number: ctx.houseNumber || undefined,
    address: ctx.address || undefined,
    google_maps: mapsUrl,
    updated: madridTime(ctx.updatedAt),
  })
}

/** Execute memory tools directly via local brain engine */
function executeMemoryTool(name: string, input: Record<string, any>): string {
  switch (name) {
    case 'breath': {
      const result = breath({
        query: input.query,
        domain: input.domain,
        valence: input.valence,
        arousal: input.arousal,
        importance_min: input.importance_min,
        max_results: input.max_results,
      })
      return JSON.stringify(result)
    }

    case 'hold': {
      const bucket = holdBucket(input.content, {
        tags: input.tags,
        importance: input.importance,
        pinned: input.pinned,
        feel: input.feel,
        source_bucket: input.source_bucket,
        valence: input.valence,
        arousal: input.arousal,
      })
      return JSON.stringify({ ok: true, id: bucket.id, name: bucket.metadata.name })
    }

    case 'grow': {
      const buckets = growBuckets(input.content)
      return JSON.stringify({ ok: true, count: buckets.length, ids: buckets.map(b => b.id) })
    }

    case 'trace': {
      const ok = traceBucket(input.bucket_id, input)
      return JSON.stringify({ ok })
    }

    case 'pulse': {
      const result = pulse()
      return JSON.stringify(result)
    }

    case 'dream': {
      const items = dream()
      return JSON.stringify(items.map(b => ({
        id: b.id,
        name: b.metadata.name,
        content_preview: b.content.slice(0, 200),
        score: b.score,
        type: b.metadata.type,
        created: b.metadata.created,
        last_active: b.metadata.last_active,
      })))
    }

    default:
      return `Unknown memory tool: ${name}`
  }
}


/** Strip HTML tags to plain text */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(p|div|br|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** Very light HTML → Markdown-ish conversion */
function htmlToMarkdown(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_m, l, t) => '\n' + '#'.repeat(Number(l)) + ' ' + t.replace(/<[^>]+>/g, '').trim() + '\n')
  s = s.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, t) => `[${t.replace(/<[^>]+>/g, '').trim()}](${href})`)
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, t) => '- ' + t.replace(/<[^>]+>/g, '').trim() + '\n')
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, (_m, _t, t2) => '**' + t2.replace(/<[^>]+>/g, '').trim() + '**')
  return htmlToText(s)
}

/** Fetch a URL server-side; convert per tool. Result is capped to avoid token blowup. */
async function executeFetch(tool: string, url: string, headers?: Record<string, string>): Promise<string> {
  if (!url || !/^https?:\/\//i.test(url)) return '请提供合法的 http(s) URL'
  const CAP = 6000
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20000)
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Lumbre)', ...(headers || {}) },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (tool === 'fetch_json') {
      const j = await res.json().catch(() => null)
      if (j == null) return `HTTP ${res.status}: 返回的不是合法 JSON`
      const str = JSON.stringify(j)
      return str.length > CAP ? str.slice(0, CAP) + '…(truncated)' : str
    }
    const raw = await res.text()
    let out = raw
    if (tool === 'fetch_txt') out = htmlToText(raw)
    else if (tool === 'fetch_markdown') out = htmlToMarkdown(raw)
    // fetch_html returns raw
    out = `HTTP ${res.status} · ${url}\n\n` + out
    return out.length > CAP ? out.slice(0, CAP) + '\n…(truncated)' : out
  } catch (err: any) {
    return `Fetch error: ${err.message}`
  }
}
