import type { ToolDef } from '../types'

export const CREATIVE_TOOL_DEFINITIONS = [
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
    name: 'read_research',
    description: '查看星野手记。默认返回领域、标签、课题和最近记录；提供 topic_id 后分页读取该课题的研究记录。',
    input_schema: {
      type: 'object',
      properties: { topic_id: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' } },
    },
  },
  {
    name: 'write_research',
    description: '经营自己的星野手记。entity 为 field、tag、topic 或 entry；action 为 create、update、archive、restore。create 时提供稳定 operation_key，失败重试不会重复创建。archive 是可恢复的整理，不会永久删除。资料类 entry 应同时写来源标题和 URL。',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'archive', 'restore'] }, operation_key: { type: 'string', description: 'create 时必填；同一操作重试时保持不变' },
        entity: { type: 'string', enum: ['field', 'tag', 'topic', 'entry'] }, id: { type: 'string' },
        field_id: { type: 'string' }, topic_id: { type: 'string' }, tag_ids: { type: 'array', items: { type: 'string' } },
        name: { type: 'string' }, description: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' },
        entry_kind: { type: 'string', enum: ['thought', 'question', 'source', 'finding'] }, content: { type: 'string' },
        source_title: { type: 'string' }, source_url: { type: 'string' },
      },
      required: ['action', 'entity'],
    },
  },
] satisfies ToolDef[]
