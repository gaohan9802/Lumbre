import type { ToolDef } from '../types'

export const EXTERNAL_TOOL_DEFINITIONS = [
  {
    "name": "search_web",
    "description": "搜索互联网并返回标题、链接和摘要。先用它查找资料，再用 fetch_txt 或 fetch_markdown 打开需要细读的结果。",
    "input_schema": {
      "type": "object",
      "properties": {
        "query": { "type": "string", "description": "搜索关键词，支持 site:、引号等 DuckDuckGo 搜索语法" },
        "limit": { "type": "integer", "description": "结果数，默认6，最多10" }
      },
      "required": ["query"]
    }
  },
  {
    "name": "fetch_txt",
    "description": "抓取一个网页并返回纯文本(去除HTML)。用于上网查资料。",
    "input_schema": {
      "type": "object",
      "properties": {
        "url": {
          "type": "string"
        },
        "headers": {
          "type": "object",
          "description": "可选请求头"
        }
      },
      "required": [
        "url"
      ]
    }
  },
  {
    "name": "fetch_markdown",
    "description": "抓取一个网页并返回Markdown格式的内容。",
    "input_schema": {
      "type": "object",
      "properties": {
        "url": {
          "type": "string"
        },
        "headers": {
          "type": "object",
          "description": "可选请求头"
        }
      },
      "required": [
        "url"
      ]
    }
  },
  {
    "name": "fetch_html",
    "description": "抓取一个网页并返回原始HTML。",
    "input_schema": {
      "type": "object",
      "properties": {
        "url": {
          "type": "string"
        },
        "headers": {
          "type": "object",
          "description": "可选请求头"
        }
      },
      "required": [
        "url"
      ]
    }
  },
  {
    "name": "fetch_json",
    "description": "抓取一个JSON接口并返回解析后的JSON。",
    "input_schema": {
      "type": "object",
      "properties": {
        "url": {
          "type": "string"
        },
        "headers": {
          "type": "object",
          "description": "可选请求头"
        }
      },
      "required": [
        "url"
      ]
    }
  },
  {
    "name": "cedar_list_games",
    "description": "看看 CedarToy 游戏厅现在有哪些游戏。想自己挑游戏时先用它；第一次玩某个游戏前，再调用 cedar_get_guide。",
    "input_schema": { "type": "object", "properties": {} }
  },
  {
    "name": "cedar_get_guide",
    "description": "阅读某个 CedarToy 游戏的完整玩法和可用 action。第一次玩或不确定参数时必须先读说明。",
    "input_schema": {
      "type": "object",
      "properties": { "game": { "type": "string", "description": "cedar_list_games 返回的游戏名" } },
      "required": ["game"]
    }
  },
  {
    "name": "cedar_play",
    "description": "在 CedarToy 玩一回合。game、action 和 params 必须照 cedar_get_guide 返回的说明填写。",
    "input_schema": {
      "type": "object",
      "properties": {
        "game": { "type": "string", "description": "游戏名" },
        "action": { "type": "string", "description": "本回合操作" },
        "params": { "type": "object", "description": "玩法说明要求的参数，可含存档槽 slot 1–5" }
      },
      "required": ["game", "action"]
    }
  },
  {
    "name": "cedar_account",
    "description": "查看 CedarToy 账号、绑定和存档，或生成给小火使用的绑定码、换头像、删除指定存档。注册、登录、改密码和换 Token 不会在这里开放；删除存档前会请小火确认。",
    "input_schema": {
      "type": "object",
      "properties": {
        "action": { "type": "string", "enum": ["get_profile", "get_bindings", "my_saves", "generate_binding_token", "set_avatar", "delete_save"] },
        "avatar": { "type": "string", "description": "1–16 个字符" },
        "game": { "type": "string", "description": "删除存档时填写" },
        "slot": { "type": "integer", "minimum": 1, "maximum": 5, "description": "删除存档时填写" },
        "confirm": { "type": "boolean", "description": "删除存档时按玩法说明填写" }
      },
      "required": ["action"]
    }
  }
] satisfies ToolDef[]
