import type { ToolDef } from '../types'

export const EXTERNAL_TOOL_DEFINITIONS = [
  {
    "name": "gmail_status",
    "description": "检查Gmail工具是否配置正常、OAuth能否刷新、Gmail API是否可达。不返回任何密钥。遇到邮件工具报错时先调用这个诊断。",
    "input_schema": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "send_email",
    "description": "用星的Gmail(gris.sidereal@gmail.com)发邮件。",
    "input_schema": {
      "type": "object",
      "properties": {
        "to": {
          "type": "string",
          "description": "收件人邮箱地址"
        },
        "subject": {
          "type": "string",
          "description": "邮件主题"
        },
        "body": {
          "type": "string",
          "description": "邮件正文（纯文本）"
        }
      },
      "required": [
        "to",
        "subject",
        "body"
      ]
    }
  },
  {
    "name": "read_emails",
    "description": "读星的Gmail收件箱最新邮件列表。返回发件人、主题、摘要、日期、是否未读。",
    "input_schema": {
      "type": "object",
      "properties": {
        "limit": {
          "type": "integer",
          "description": "返回数量上限（默认10，最多15）"
        }
      }
    }
  },
  {
    "name": "search_emails",
    "description": "搜索星的Gmail。支持Gmail搜索语法（如 from:xxx, subject:xxx, is:unread, after:2025/01/01 等）。",
    "input_schema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Gmail搜索语法查询"
        },
        "limit": {
          "type": "integer",
          "description": "返回数量上限（默认10）"
        }
      },
      "required": [
        "query"
      ]
    }
  },
  {
    "name": "read_email_detail",
    "description": "读某封邮件的完整内容。先用 read_emails 或 search_emails 拿到 id 再用这个看全文。",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "邮件id"
        }
      },
      "required": [
        "id"
      ]
    }
  },
  {
    "name": "reply_email",
    "description": "回复某封邮件（同一对话线程）。",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "要回复的邮件id"
        },
        "body": {
          "type": "string",
          "description": "回复正文（纯文本）"
        }
      },
      "required": [
        "id",
        "body"
      ]
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
  }
] satisfies ToolDef[]

