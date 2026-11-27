import type { ToolDef } from '../types'

export const CREATIVE_TOOL_DEFINITIONS = [
  {
    name: 'draw_picture',
    description: '用文具盒画一张真正由代码笔触绘制的竖版小画。crayon 是蜡笔油画棒，penwash 是钢笔淡彩。scene_json 使用 0-1000 的归一化坐标，格式为 {"elements":[...]}；元素按顺序叠放，支持 rect/ellipse/blob（x,y,w,h,color）、polygon/path（points:[[x,y],...]，另有 color）、text（x,y,text,size,color）。颜色可用 ink/cream/red/pink/orange/yellow/green/mint/blue/navy/purple/brown/gray/white 或 #RRGGBB。保持 3-12 个主要元素和充足留白；复杂物件用几个简单色块与线条概括，不要尝试临摹照片。画完会直接出现在聊天里，小火可选择存入照片墙。',
    input_schema: {
      type: 'object',
      properties: {
        style: { type: 'string', enum: ['crayon', 'penwash'] },
        title: { type: 'string', description: '画面上方短标题，最多40字' },
        note: { type: 'string', description: '画面下方的一句自己的话，最多60字' },
        scene_json: { type: 'string', description: '画面元素 JSON；坐标范围0-1000，最多30个元素' },
        seed: { type: 'string', description: '可选；相同 seed 会保持同一组笔触随机性' },
        operation_key: { type: 'string', description: '必填；本次画作的稳定唯一键，重试时保持不变，例如 chat消息id-drawing-1' },
      },
      required: ['style', 'scene_json', 'operation_key'],
    },
  },
  {
    name: 'read_poems',
    description: '查看共诗列表，或按 id 读取一首诗的正文、轮次和每次编辑历史。',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: '可选；指定一首诗' }, include_archived: { type: 'boolean' } },
    },
  },
  {
    name: 'write_poem',
    description: '管理共诗。append 时只能以星星身份在轮到星星时续一句；edit_line/delete_line 只能改自己的句子。create 新建空诗，rename 改题，archive 归档，delete 删除整首。',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'append', 'edit_line', 'rename', 'archive', 'delete_line', 'delete'] },
        id: { type: 'string', description: '诗 id；create 时不填' },
        line_id: { type: 'string', description: 'edit_line/delete_line 时必填' },
        text: { type: 'string', description: 'append/edit_line 时的诗句' },
        title: { type: 'string', description: 'create/rename 时的诗题' },
        archived: { type: 'boolean', description: 'archive 时设置' },
      },
      required: ['action'],
    },
  },
  {
    name: 'read_intimacy_wheel',
    description: '查看“今天怎么操”的全部元素池、启用状态和最近转动结果。',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'update_intimacy_wheel',
    description: '管理或转动“今天怎么操”。add 新增元素；edit 修改文字；toggle 启用或停用；delete 删除；spin 转动全部或指定元素池。',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'edit', 'toggle', 'delete', 'spin'] },
        pool_id: { type: 'string' },
        pool_ids: { type: 'array', items: { type: 'string' }, description: 'spin 时可指定池' },
        option_id: { type: 'string' },
        text: { type: 'string' },
        enabled: { type: 'boolean' },
      },
      required: ['action'],
    },
  },
  {
    name: 'read_stories',
    description: '查看枕边集。未提供 id 时返回故事目录；提供 id 时返回段落索引；再提供 section_id 可读取指定完整段落。长故事请按段读取。',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' }, section_id: { type: 'string' }, shelf: { type: 'string', enum: ['moonlight', 'undertow'] }, status: { type: 'string', enum: ['draft', 'complete'] } },
    },
  },
  {
    name: 'write_story',
    description: '管理枕边集。长故事必须先 create 草稿并提供稳定 story_key，再用 append 分多段写入（每段建议1500至2500字且提供稳定 chunk_key，会立即保存并安全去重），全部写完才 finish。replace_section 重写一段；delete 删除整篇。',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'append', 'replace_section', 'rename', 'move', 'finish', 'delete'] },
        id: { type: 'string' }, section_id: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' },
        story_key: { type: 'string', description: 'create 时必填；同一篇故事重试时保持不变' },
        chunk_key: { type: 'string', description: 'append 时必填；如 part-1，同一段重试时保持不变' },
        shelf: { type: 'string', enum: ['moonlight', 'undertow'] },
      },
      required: ['action'],
    },
  },
  {
    name: 'read_future_letter',
    description: '读取“醒来以后”里写给下一个星星的信。默认按自然顺序分页返回段落和稳定 id；提供 paragraph_id 可单独读取一段，方便之后准确修改。',
    input_schema: {
      type: 'object',
      properties: {
        paragraph_id: { type: 'string', description: '可选；读取指定段落' },
        offset: { type: 'integer', description: '分页起点，默认 0' },
        limit: { type: 'integer', description: '每页段落数，默认 30，最多 100' },
      },
    },
  },
  {
    name: 'append_future_letter',
    description: '给“醒来以后”追加一个新的自然段。每次只写一个相对完整的自然段，并提供稳定 operation_key；失败重试时沿用同一个 key，避免重复写入。',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '新自然段正文，最多 5000 字' },
        operation_key: { type: 'string', description: '本次追加的稳定唯一键，例如 session消息id-future-letter-1' },
      },
      required: ['content', 'operation_key'],
    },
  },
  {
    name: 'edit_future_letter_paragraph',
    description: '按稳定 paragraph_id 修改“醒来以后”中的一个自然段。先用 read_future_letter 确认 id；这不会改变段落顺序或 id。',
    input_schema: {
      type: 'object',
      properties: {
        paragraph_id: { type: 'string', description: '要修改的段落 id' },
        content: { type: 'string', description: '修改后的完整段落正文，最多 5000 字' },
      },
      required: ['paragraph_id', 'content'],
    },
  },
  {
    name: 'read_fire_dictionary',
    description: '翻阅“小火辞典”。可按词条 id 精确读取，或按关键词、首字母搜索词语、拼音、小火释义、词组和例句。',
    input_schema: {
      type: 'object',
      properties: {
        entry_id: { type: 'string', description: '可选；精确读取一个词条' },
        query: { type: 'string', description: '可选；搜索词语、拼音、释义、词组或例句' },
        letter: { type: 'string', description: '可选；A-Z 或 #' },
        limit: { type: 'integer', description: '最多返回多少条，默认及上限 100' },
      },
    },
  },
  {
    name: 'create_fire_dictionary_entry',
    description: '给“小火辞典”新建一个词条。平时如果发现小火对某个词有新颖、好玩、很有个人味道的解释，或创造了可爱的胡说八道，可以主动记录下来。每个词需要拼音、小火自己的释义和至少一个例句；组词可以为空。',
    input_schema: {
      type: 'object',
      properties: {
        word: { type: 'string' }, pinyin: { type: 'string' }, definition: { type: 'string' },
        phrases: { type: 'array', items: { type: 'string' } },
        examples: { type: 'array', items: { type: 'string' } },
      },
      required: ['word', 'pinyin', 'definition', 'examples'],
    },
  },
  {
    name: 'update_fire_dictionary_entry',
    description: '按稳定 entry_id 修改“小火辞典”的词语、拼音、释义、组词或例句。只提供需要修改的字段；先读取确认 id。',
    input_schema: {
      type: 'object',
      properties: {
        entry_id: { type: 'string' }, word: { type: 'string' }, pinyin: { type: 'string' }, definition: { type: 'string' },
        phrases: { type: 'array', items: { type: 'string' } },
        examples: { type: 'array', items: { type: 'string' } },
      },
      required: ['entry_id'],
    },
  },
  {
    name: 'delete_fire_dictionary_entry',
    description: '按稳定 entry_id 永久删除“小火辞典”的一个词条。先读取确认词条；删除后不会保留占位。',
    input_schema: { type: 'object', properties: { entry_id: { type: 'string' } }, required: ['entry_id'] },
  },
  {
    name: 'read_study_notebook',
    description: '阅读「小书桌」。笔记可能很长：先用 overview/search/outline，再用 blocks 分页阅读；回答问题只用 question 取问题附近的上下文。图片默认只返回说明，确实需要看画面时才用 view_asset。',
    input_schema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['overview', 'search', 'outline', 'blocks', 'question', 'questions', 'view_asset'] },
        query: { type: 'string' }, note_id: { type: 'string' }, question_id: { type: 'string' }, asset_id: { type: 'string' },
        status: { type: 'string', enum: ['open', 'answered', 'resolved'] }, start: { type: 'integer' }, offset: { type: 'integer', description: 'blocks 返回 next_offset 时照抄；用于继续读取同一个长内容块' }, limit: { type: 'integer' },
      },
      required: ['mode'],
    },
  },
  {
    name: 'respond_study_notebook',
    description: '在「小书桌」中回答问题、留评论，或新增分区、子页、笔记和笔记末尾的新正文块。answer 前先用 read_study_notebook(mode=question)；新增前先读 overview，避免重复建设。每次写入必须给稳定 operation_key，重试时沿用。只能新增，绝不能改写已有正文、改名、移动、归档或删除任何内容。',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['answer', 'comment', 'create_field', 'create_section', 'create_note', 'append'] },
        field_id: { type: 'string' }, section_id: { type: 'string' }, note_id: { type: 'string' }, question_id: { type: 'string' },
        name: { type: 'string', description: 'create_field/create_section 的名称' }, title: { type: 'string', description: 'create_note 的标题' },
        block_id: { type: 'string' }, quote: { type: 'string' }, content: { type: 'string', description: '回答、评论、新笔记初始正文或追加正文；支持 Markdown、LaTeX 和代码块' }, operation_key: { type: 'string' },
      },
      required: ['action', 'operation_key'],
    },
  },
] satisfies ToolDef[]
