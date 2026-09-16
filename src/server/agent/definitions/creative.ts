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
] satisfies ToolDef[]
