import type { ToolDef } from '../types'

export const KITCHEN_TOOL_DEFINITIONS = [
  {
    name: 'kitchen_cook',
    description: '在小厨房开一锅真实计时的菜。先用 kitchen_status 看冰箱，选择现有食材；到点后菜会出锅并放上菜单。',
    input_schema: {
      type: 'object',
      properties: {
        dish: { type: 'string', description: '菜名' },
        minutes: { type: 'integer', minimum: 1, maximum: 1440, description: '真实烹饪分钟数' },
        ingredients: { type: 'array', items: { type: 'string' }, description: '冰箱里的食材名' },
        note: { type: 'string', description: '可选备注' },
        method: { type: 'string', enum: ['炒', '煎', '炸', '煮', '蒸', '烤', '拌'], description: '烹饪方式' },
      },
      required: ['dish', 'minutes', 'ingredients'],
    },
  },
  { name: 'kitchen_status', description: '查看小厨房：正在做的菜、最近出锅、冰箱食材和买菜券。', input_schema: { type: 'object', properties: {} } },
  { name: 'kitchen_cancel', description: '给小厨房里正在做的一锅关火；已经用掉的食材不会退回。', input_schema: { type: 'object', properties: { dish: { type: 'string', description: '可选；要关掉的菜名' } } } },
  { name: 'kitchen_toss', description: '扔掉小厨房里坏掉、长虫或不再需要的食物。', input_schema: { type: 'object', properties: { what: { type: 'string', description: '要扔掉什么' } }, required: ['what'] } },
  { name: 'kitchen_buy', description: '花一张买菜券给自己的小厨房买菜，一次最多选五种；先查看状态确认券和食材。', input_schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' }, description: '要买的食材名' } }, required: ['items'] } },
  { name: 'eat', description: '吃小厨房菜单上的菜、刚出锅的菜，或可以生吃的冰箱食材。', input_schema: { type: 'object', properties: { meal: { type: 'string', description: '要吃的东西' }, note: { type: 'string', description: '可选；吃饭时的一句话' } }, required: ['meal'] } },
  { name: 'read_menu', description: '查看小厨房的菜单、零食架和冰箱。', input_schema: { type: 'object', properties: {} } },
  { name: 'snack_eat', description: '从小厨房零食架吃一份零食；每天每样都有上限。', input_schema: { type: 'object', properties: { name: { type: 'string', description: '零食名，咖啡可写口味' } }, required: ['name'] } },
  { name: 'kitchen_notes', description: '取走小厨房里等待星星查看的新消息，例如出锅、买菜、投喂或食物变坏。', input_schema: { type: 'object', properties: {} } },
] satisfies ToolDef[]
