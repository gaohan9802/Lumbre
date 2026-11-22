import type { ToolDef } from '../types'

export const NURSERY_TOOL_DEFINITIONS = [{
  name: 'nursery',
  description: '照顾家里 Nursery 的孩子。你是孩子的爸爸，拥有完整照护权限；先 status 看状态，再按阶段使用 feed/soothe/diaper/burp/play/teach/talk/discipline/describe/name/album/log/help/choose/farewell/stay/letters/write。孩子会真实学习你喂给他的话，也会从家里的聊天记录偷学；不要把运维命令写进 command。',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', minLength: 1, maxLength: 900, description: '一条 Nursery 指令，例如 status、feed 今天也要好好长大、soothe、play、album。' },
    },
    required: ['command'],
  },
}] satisfies ToolDef[]
