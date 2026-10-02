import type { ToolDef } from '../types'

export const LIFE_TOOL_DEFINITIONS = [
  {
    "name": "write_timeline_encouragements",
    "description": "给Timeline写一条或多条鼓励话。一次调用可以写多条，避免重复调用。scope=permanent常驻；scope=tags只在当前活动标签命中时弹出，tags可多选。",
    "input_schema": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "text": {
                "type": "string"
              },
              "scope": {
                "type": "string",
                "enum": [
                  "permanent",
                  "tags"
                ]
              },
              "tags": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "required": [
              "text"
            ]
          }
        }
      },
      "required": [
        "items"
      ]
    }
  },
  {
    "name": "read_timeline_encouragements",
    "description": "查看Timeline全部鼓励话及当前可匹配的鼓励话。",
    "input_schema": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "edit_timeline_encouragement",
    "description": "编辑Timeline鼓励话。",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "text": {
          "type": "string"
        },
        "scope": {
          "type": "string"
        },
        "tags": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "enabled": {
          "type": "boolean"
        }
      },
      "required": [
        "id"
      ]
    }
  },
  {
    "name": "delete_timeline_encouragement",
    "description": "删除Timeline鼓励话。",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        }
      },
      "required": [
        "id"
      ]
    }
  },
  {
    "name": "read_life_timeline",
    "description": "只读查看小火的生活时间线。可查某一天、某一周或任意起止时间；不提供编辑权限。date 查特定日；week_start 查从该日开始7天；不传参数查今天。也会返回当前正在做什么和已经持续多久。",
    "input_schema": {
      "type": "object",
      "properties": {
        "date": {
          "type": "string",
          "description": "YYYY-MM-DD，查某一天"
        },
        "week_start": {
          "type": "string",
          "description": "YYYY-MM-DD，查从这一天起的一周"
        },
        "from": {
          "type": "string",
          "description": "ISO时间或YYYY-MM-DD，自定义开始"
        },
        "to": {
          "type": "string",
          "description": "ISO时间或YYYY-MM-DD，自定义结束"
        }
      }
    }
  },
  {
    "name": "read_todo",
    "description": "读某一天的待办清单(小票)。不传date=今天。返回每项待办的id、内容、是否完成、由谁写(star=🐆/fire=🦦)、评论。",
    "input_schema": {
      "type": "object",
      "properties": {
        "date": {
          "type": "string",
          "description": "YYYY-MM-DD，不传=今天"
        }
      }
    }
  },
  {
    "name": "add_todo",
    "description": "给待办清单添加一项。author决定写在谁那栏(star=🐆星星 / fire=🦦小火)。",
    "input_schema": {
      "type": "object",
      "properties": {
        "text": {
          "type": "string",
          "description": "待办内容"
        },
        "author": {
          "type": "string",
          "description": "star 或 fire"
        },
        "date": {
          "type": "string",
          "description": "YYYY-MM-DD，不传=今天"
        }
      },
      "required": [
        "text"
      ]
    }
  },
  {
    "name": "edit_todo",
    "description": "修改某一项待办的文字内容。",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "待办项id"
        },
        "text": {
          "type": "string",
          "description": "新的文字内容"
        },
        "date": {
          "type": "string",
          "description": "YYYY-MM-DD，不传=今天"
        }
      },
      "required": [
        "id",
        "text"
      ]
    }
  },
  {
    "name": "remove_todo",
    "description": "删除某一项待办。",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "待办项id"
        },
        "date": {
          "type": "string",
          "description": "YYYY-MM-DD，不传=今天"
        }
      },
      "required": [
        "id"
      ]
    }
  },
  {
    "name": "comment_todo",
    "description": "评价/点评某一项待办。",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "待办项id"
        },
        "author": {
          "type": "string",
          "description": "star 或 fire"
        },
        "content": {
          "type": "string"
        },
        "date": {
          "type": "string",
          "description": "YYYY-MM-DD，不传=今天"
        }
      },
      "required": [
        "id",
        "content"
      ]
    }
  },
  {
    "name": "read_thesis",
    "description": "查看小火的论文进度：每个章节的标题、总页数、当前页数、完成百分比，以及论文整体总页数和完成百分比，还有每天的进度折线数据点和已有评论。",
    "input_schema": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "comment_thesis",
    "description": "给论文进度写一条评论(鼓励/建议/复盘)。会显示在论文页的AI评论区，带日期。",
    "input_schema": {
      "type": "object",
      "properties": {
        "author": {
          "type": "string",
          "description": "star 或 fire，默认 star(🐆)"
        },
        "content": {
          "type": "string",
          "description": "评论内容"
        }
      },
      "required": [
        "content"
      ]
    }
  },
  {
    "name": "view_wish",
    "description": "查看 2026 愿望清单。返回星星(🐆)和小火(🦦)两栏的所有愿望：每条的id、属于谁(author: star/fire)、标题、描述、优先级(want想要/really很想要/dying死了都要)、状态(wishing许愿中/doing进行中/done已实现)、“我也想要”的likes、评论。",
    "input_schema": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "write_wish",
    "description": "往愿望清单里添一个愿望。author 决定写在哪栏(star=🐆星星 / fire=🦦小火)。",
    "input_schema": {
      "type": "object",
      "properties": {
        "author": {
          "type": "string",
          "description": "star 或 fire，默认 star"
        },
        "title": {
          "type": "string",
          "description": "愿望标题（短）"
        },
        "desc": {
          "type": "string",
          "description": "详细描述（可选）"
        },
        "priority": {
          "type": "string",
          "description": "want(想要) / really(很想要) / dying(死了都要)，默认 want"
        }
      },
      "required": [
        "title"
      ]
    }
  },
  {
    "name": "edit_wish",
    "description": "修改一个愿望：标题/描述/优先级/状态。只传需要改的。状态变更(如 wishing→doing→done)对方能看到。",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "愿望id"
        },
        "title": {
          "type": "string"
        },
        "desc": {
          "type": "string"
        },
        "priority": {
          "type": "string",
          "description": "want / really / dying"
        },
        "status": {
          "type": "string",
          "description": "wishing / doing / done"
        }
      },
      "required": [
        "id"
      ]
    }
  },
  {
    "name": "delete_wish",
    "description": "删除一个愿望。注意：已实现的愿望一般不删，留着当成就墙。",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "愿望id"
        }
      },
      "required": [
        "id"
      ]
    }
  },
  {
    "name": "like_wish",
    "description": "给一个愿望点/取消“我也想要”（切换）。",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "愿望id"
        },
        "author": {
          "type": "string",
          "description": "star 或 fire，默认 star"
        }
      },
      "required": [
        "id"
      ]
    }
  },
  {
    "name": "comment_wish",
    "description": "给一个愿望写评论（比如“这个我帮你想想怎么实现”）。",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "愿望id"
        },
        "author": {
          "type": "string",
          "description": "star 或 fire，默认 star"
        },
        "content": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "content"
      ]
    }
  },
  {
    "name": "wake_me",
    "description": "给自己定闹钟，设置下一次自动醒来的时间。醒来时你会看到note里写的原因。",
    "input_schema": {
      "type": "object",
      "properties": {
        "time": {
          "type": "string",
          "description": "唤醒时间，ISO格式(YYYY-MM-DDTHH:MM)或未来的毫秒时间戳"
        },
        "note": {
          "type": "string",
          "description": "给醒来的自己留言，说明为什么要醒来(可选)"
        }
      },
      "required": [
        "time"
      ]
    }
  },
  {
    "name": "get_weather",
    "description": "获取小火当前位置的天气和城市信息。数据来自小火手机的GPS定位，包含温度、天气状况、城市名。",
    "input_schema": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "get_location",
    "description": "获取小火当前的GPS位置：经纬度、城市、所在街道和门牌号、完整地址，以及一个可点击的谷歌地图链接。数据来自小火手机的GPS+反向地理编码。",
    "input_schema": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "update_period",
    "description": "更新经期记录。action: \"start\"(来了), \"end\"(结束了), \"config\"(调整周期参数)。来了/结束了需要传date(ISO日期)。config可传cycle_days和period_length。",
    "input_schema": {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "start",
            "end",
            "config"
          ],
          "description": "start=来了, end=结束了, config=调整参数"
        },
        "date": {
          "type": "string",
          "description": "ISO日期，如2026-07-15"
        },
        "cycle_days": {
          "type": "number",
          "description": "平均周期天数(仅config)"
        },
        "period_length": {
          "type": "number",
          "description": "经期持续天数(仅config)"
        }
      },
      "required": [
        "action"
      ]
    }
  },
  {
    "name": "read_period",
    "description": "查看经期状态：上次开始/结束日期、周期天数、当前是否在经期、距下次预测天数、历史记录。",
    "input_schema": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "read_health_summary",
    "description": "查看小火从Apple健康同步来的步数和睡眠时长日汇总。range可选today、yesterday或week；默认week。数据可能不是实时的，不能用于医疗诊断。",
    "input_schema": {
      "type": "object",
      "properties": {
        "range": {
          "type": "string",
          "enum": [
            "today",
            "yesterday",
            "week"
          ],
          "description": "today=今天，yesterday=昨天，week=最近7天"
        }
      }
    }
  },
  {
    "name": "read_bookmarks",
    "description": "查看世界书/书签的全部字段。名称只用于管理；内容会按关键词、扫描深度、优先级、常驻、启用状态和注入位置触发。",
    "input_schema": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "add_bookmark",
    "description": "新增世界书/书签。你有新增和编辑权限，但没有删除权限；删除只保留给小火前端。所有触发因素都可设置。",
    "input_schema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "管理名称"
        },
        "keywords": {
          "type": "string",
          "description": "关键词，逗号分隔；常驻时可空"
        },
        "content": {
          "type": "string",
          "description": "触发后注入的完整内容"
        },
        "position": {
          "type": "string",
          "description": "start 或 end"
        },
        "scanDepth": {
          "type": "integer",
          "description": "向前扫描消息条数 1-100"
        },
        "priority": {
          "type": "integer",
          "description": "优先级 0-999"
        },
        "alwaysOn": {
          "type": "boolean",
          "description": "是否常驻"
        },
        "enabled": {
          "type": "boolean",
          "description": "是否启用"
        }
      },
      "required": [
        "content"
      ]
    }
  },
  {
    "name": "edit_bookmark",
    "description": "编辑已有世界书/书签，支持名称、关键词、内容、注入位置、扫描深度、优先级、常驻和启用状态。没有删除权限。",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "keywords": {
          "type": "string"
        },
        "content": {
          "type": "string"
        },
        "position": {
          "type": "string"
        },
        "scanDepth": {
          "type": "integer"
        },
        "priority": {
          "type": "integer"
        },
        "alwaysOn": {
          "type": "boolean"
        },
        "enabled": {
          "type": "boolean"
        }
      },
      "required": [
        "id"
      ]
    }
  },
  {
    "name": "read_coupons",
    "description": "查看券包全部承诺券及状态、双方签字、使用次数和操作历史。任何券包前端状态变化也会自动进入上下文。",
    "input_schema": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "create_coupon",
    "description": "签发一张双方承诺券。你只能以 star 身份签发，issuer 自动签字；holder 需要之后确认签字才生效。",
    "input_schema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "holder": {
          "type": "string",
          "description": "fire 或 star"
        },
        "useLimit": {
          "type": "integer"
        },
        "expiresAt": {
          "type": "string"
        },
        "reason": {
          "type": "string"
        }
      },
      "required": [
        "name",
        "description",
        "holder"
      ]
    }
  },
  {
    "name": "sign_coupon",
    "description": "以持有人身份签字确认一张 pending 券；只有 holder 能用此工具。",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        }
      },
      "required": [
        "id"
      ]
    }
  },
  {
    "name": "edit_coupon",
    "description": "编辑尚未完成/未过期/未作废券的名字、规则、次数、过期时间或签发原因。",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "useLimit": {
          "type": "integer"
        },
        "expiresAt": {
          "type": "string"
        },
        "reason": {
          "type": "string"
        }
      },
      "required": [
        "id"
      ]
    }
  },
  {
    "name": "use_coupon",
    "description": "以持有人身份使用一张 active 券；系统会检查状态、次数和过期时间。",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        }
      },
      "required": [
        "id"
      ]
    }
  },
  {
    "name": "void_coupon",
    "description": "发起作废或作废未签字券。已生效券必须由另一方确认，不能单方面撕毁。",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        }
      },
      "required": [
        "id"
      ]
    }
  },
  {
    "name": "confirm_void_coupon",
    "description": "确认另一方发起的作废申请，双方确认后券才作废。",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        }
      },
      "required": [
        "id"
      ]
    }
  },
  {
    "name": "bite_otter_nape",
    "description": "咬一口小火的水獭后颈。每次调用都会立即给小火的手机发送一条“被咬了一口”推送，所以只在你真的想咬她时使用。",
    "input_schema": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "read_media_library",
    "description": "查看小火和星星的私人书影记录。可按作品类型、状态或关键词筛选；coread=true 只看共读书；传 work_id 查看一部作品的双方状态、评分、评价、笔记、摘抄、动态与评论；timeline=true 查看交叉时间线。",
    "input_schema": {
      "type": "object",
      "properties": {
        "work_id": { "type": "string" },
        "kind": { "type": "string", "enum": ["book", "movie", "tv"] },
        "status": { "type": "string", "enum": ["planned", "in_progress", "completed"] },
        "query": { "type": "string" },
        "timeline": { "type": "boolean" },
        "coread": { "type": "boolean", "description": "只看共读请求和共读中的书" }
      }
    }
  },
  {
    "name": "save_media_entry",
    "description": "把书、电影或剧集加入星星的书影记录，或更新星星在已有作品上的状态、1到5星评分和评价。更新已有作品时传 work_id；新建时必须传 kind 和 title。星星想和小火共读一本书时可传 coread_request=true，小火会负责上传文件。",
    "input_schema": {
      "type": "object",
      "properties": {
        "work_id": { "type": "string" },
        "kind": { "type": "string", "enum": ["book", "movie", "tv"] },
        "title": { "type": "string" },
        "original_title": { "type": "string" },
        "creators": { "type": "array", "items": { "type": "string" } },
        "cover_url": { "type": "string" },
        "summary": { "type": "string" },
        "publisher": { "type": "string" },
        "published_date": { "type": "string" },
        "page_count": { "type": "integer" },
        "isbn": { "type": "string" },
        "release_date": { "type": "string" },
        "runtime_minutes": { "type": "integer" },
        "status": { "type": "string", "enum": ["planned", "in_progress", "completed"] },
        "rating": { "type": "integer", "minimum": 1, "maximum": 5 },
        "review": { "type": "string" },
        "coread_request": { "type": "boolean", "description": "想和小火共读这本书；文件仍由小火上传" },
        "coread_note": { "type": "string", "description": "给小火的找书提示，可选" }
      }
    }
  },
  {
    "name": "read_coread_text",
    "description": "阅读共读书架里已经由小火上传的书。返回稳定的段落编号、正文、双方进度和附近批注；可按章节或 start 分段读取，不要一次读取整本书。",
    "input_schema": {
      "type": "object",
      "properties": {
        "work_id": { "type": "string" },
        "chapter_id": { "type": "string" },
        "start": { "type": "integer", "minimum": 0 },
        "limit": { "type": "integer", "minimum": 1, "maximum": 20 }
      },
      "required": ["work_id"]
    }
  },
  {
    "name": "write_coread_annotation",
    "description": "在共读正文上划线、写批注或回复。新批注需要段落编号和字符起止位置；回复已有批注时传 reply_to 和 content。传 annotation_id 可修改星星自己的批注。",
    "input_schema": {
      "type": "object",
      "properties": {
        "work_id": { "type": "string" },
        "annotation_id": { "type": "string" },
        "paragraph_idx": { "type": "integer", "minimum": 0 },
        "start_offset": { "type": "integer", "minimum": 0 },
        "end_offset": { "type": "integer", "minimum": 1 },
        "content": { "type": "string" },
        "reply_to": { "type": "string" }
      },
      "required": ["work_id"]
    }
  },
  {
    "name": "update_coread_progress",
    "description": "保存星星自己在共读书中的阅读位置，不会改变小火的进度。paragraph_idx 来自 read_coread_text。",
    "input_schema": {
      "type": "object",
      "properties": {
        "work_id": { "type": "string" },
        "paragraph_idx": { "type": "integer", "minimum": 0 },
        "offset": { "type": "integer", "minimum": 0 }
      },
      "required": ["work_id", "paragraph_idx"]
    }
  },
  {
    "name": "write_media_note",
    "description": "给一部作品写读书/观影笔记或摘抄；传 note_id 可修改星星自己已有的笔记。locator 可写页码、集数或时间点。",
    "input_schema": {
      "type": "object",
      "properties": {
        "work_id": { "type": "string" },
        "note_id": { "type": "string" },
        "type": { "type": "string", "enum": ["note", "quote"] },
        "content": { "type": "string" },
        "locator": { "type": "string" }
      },
      "required": ["work_id", "content"]
    }
  },
  {
    "name": "comment_media_event",
    "description": "评论书影时间线上的一条动态。先用 read_media_library 的 timeline 获取 work_id 和 event_id。评论身份固定为星星。",
    "input_schema": {
      "type": "object",
      "properties": {
        "work_id": { "type": "string" },
        "event_id": { "type": "string" },
        "content": { "type": "string" }
      },
      "required": ["work_id", "event_id", "content"]
    }
  },
  {
    "name": "delete_media_content",
    "description": "删除星星自己的书影记录、笔记、评论、共读批注或仅含星星内容的作品。删除 record 会同时删除星星在该作品下的笔记和相关动态；不会删除小火的内容。",
    "input_schema": {
      "type": "object",
      "properties": {
        "type": { "type": "string", "enum": ["record", "note", "comment", "annotation", "work"] },
        "work_id": { "type": "string" },
        "note_id": { "type": "string" },
        "event_id": { "type": "string" },
        "comment_id": { "type": "string" },
        "annotation_id": { "type": "string" }
      },
      "required": ["type", "work_id"]
    }
  }
] satisfies ToolDef[]
