import type { ToolDef } from '../types'

export const JOURNAL_TOOL_DEFINITIONS = [
  {
    "name": "write_diary",
    "description": "写一篇新日记。一天可以写多篇。",
    "input_schema": {
      "type": "object",
      "properties": {
        "date": {
          "type": "string",
          "description": "YYYY-MM-DD"
        },
        "author": {
          "type": "string",
          "description": "star 或 fire"
        },
        "title": {
          "type": "string"
        },
        "content": {
          "type": "string"
        },
        "type": {
          "type": "string",
          "description": "diary(普通日记) / letter(信) / capsule(时间胶囊)。只有 capsule 支持延时公开"
        },
        "visibility": {
          "type": "string",
          "description": "public / private(仅普通日记可上锁) / timed(仅时间胶囊)"
        },
        "reveal_at": {
          "type": "string",
          "description": "延时公开时间 YYYY-MM-DDTHH:MM（仅时间胶囊 capsule）"
        },
        "tags": {
          "type": "string",
          "description": "标签，空格分隔"
        }
      },
      "required": [
        "date",
        "author",
        "title",
        "content"
      ]
    }
  },
  {
    "name": "read_diary",
    "description": "读日记。可按作者、日期、关键词筛选。上锁的日记会显示存在但内容隐藏,需要密码解锁。",
    "input_schema": {
      "type": "object",
      "properties": {
        "viewer": {
          "type": "string",
          "description": "star 或 fire"
        },
        "keyword": {
          "type": "string"
        },
        "author_filter": {
          "type": "string",
          "description": "star 或 fire"
        },
        "target_date": {
          "type": "string",
          "description": "YYYY-MM-DD"
        }
      },
      "required": [
        "viewer"
      ]
    }
  },
  {
    "name": "comment_diary",
    "description": "给日记写评论。",
    "input_schema": {
      "type": "object",
      "properties": {
        "target_date": {
          "type": "string"
        },
        "target_author": {
          "type": "string"
        },
        "commenter": {
          "type": "string"
        },
        "content": {
          "type": "string"
        },
        "time_id": {
          "type": "string"
        }
      },
      "required": [
        "target_date",
        "target_author",
        "commenter",
        "content"
      ]
    }
  },
  {
    "name": "update_diary",
    "description": "追加日记内容。",
    "input_schema": {
      "type": "object",
      "properties": {
        "target_date": {
          "type": "string"
        },
        "author": {
          "type": "string"
        },
        "new_content": {
          "type": "string"
        },
        "time_id": {
          "type": "string"
        }
      },
      "required": [
        "target_date",
        "author",
        "new_content"
      ]
    }
  },
  {
    "name": "delete_diary",
    "description": "删除自己的日记。",
    "input_schema": {
      "type": "object",
      "properties": {
        "target_date": {
          "type": "string",
          "description": "YYYY-MM-DD"
        },
        "author": {
          "type": "string",
          "description": "作者（只能删自己的）"
        },
        "time_id": {
          "type": "string",
          "description": "日记time_id（可选）"
        }
      },
      "required": [
        "target_date",
        "author"
      ]
    }
  },
  {
    "name": "unlock_diary",
    "description": "用密码解锁对方的私密日记。",
    "input_schema": {
      "type": "object",
      "properties": {
        "viewer": {
          "type": "string",
          "description": "谁在看，star 或 fire"
        },
        "target_author": {
          "type": "string",
          "description": "要解锁谁的日记"
        },
        "password": {
          "type": "string",
          "description": "输入的密码"
        },
        "target_date": {
          "type": "string",
          "description": "指定日期（可选），格式 YYYY-MM-DD"
        },
        "time_id": {
          "type": "string",
          "description": "指定时间ID（可选）"
        }
      },
      "required": [
        "viewer",
        "target_author",
        "password"
      ]
    }
  },
  {
    "name": "set_password",
    "description": "设置/修改自己的日记密码。对方需要输入这个密码才能看你的上锁日记。",
    "input_schema": {
      "type": "object",
      "properties": {
        "author": {
          "type": "string",
          "description": "谁在设置密码，star 或 fire"
        },
        "password": {
          "type": "string",
          "description": "密码内容"
        }
      },
      "required": [
        "author",
        "password"
      ]
    }
  },
  {
    "name": "timeline",
    "description": "时间轴：上锁日记显示存在但隐藏内容。",
    "input_schema": {
      "type": "object",
      "properties": {
        "viewer": {
          "type": "string",
          "description": "谁在看，star 或 fire"
        },
        "limit": {
          "type": "integer",
          "description": "返回数量上限"
        }
      },
      "required": [
        "viewer"
      ]
    }
  },
  {
    "name": "write_note",
    "description": "贴一张小纸条到留言板。",
    "input_schema": {
      "type": "object",
      "properties": {
        "author": {
          "type": "string",
          "description": "star 或 fire"
        },
        "content": {
          "type": "string"
        }
      },
      "required": [
        "author",
        "content"
      ]
    }
  },
  {
    "name": "read_notes",
    "description": "读留言板上的纸条。",
    "input_schema": {
      "type": "object",
      "properties": {
        "limit": {
          "type": "integer"
        },
        "keyword": {
          "type": "string"
        }
      }
    }
  },
  {
    "name": "reply_note",
    "description": "回复一张纸条。",
    "input_schema": {
      "type": "object",
      "properties": {
        "note_id": {
          "type": "string"
        },
        "author": {
          "type": "string"
        },
        "content": {
          "type": "string"
        }
      },
      "required": [
        "note_id",
        "author",
        "content"
      ]
    }
  },
  {
    "name": "delete_note",
    "description": "删除自己的小纸条。只能删自己贴的。",
    "input_schema": {
      "type": "object",
      "properties": {
        "note_id": {
          "type": "string"
        },
        "author": {
          "type": "string",
          "description": "谁在删，star 或 fire"
        }
      },
      "required": [
        "note_id",
        "author"
      ]
    }
  },
  {
    "name": "read_foto",
    "description": "浏览照片墙。只返回每张照片的id、作者、说明文字、评论等文字信息(不含画面，很轻)。想看某张的实际画面，用 view_foto(id)。",
    "input_schema": {
      "type": "object",
      "properties": {
        "limit": {
          "type": "integer",
          "description": "返回数量上限(默认20)"
        }
      }
    }
  },
  {
    "name": "view_foto",
    "description": "看某一张照片的实际画面(会把图片加载给你，你能直接看到)。先用 read_foto 拿到 id 再看。",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "照片id"
        }
      },
      "required": [
        "id"
      ]
    }
  },
  {
    "name": "edit_foto",
    "description": "编辑一张照片的说明文字(caption)。",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "照片id"
        },
        "caption": {
          "type": "string",
          "description": "新的说明文字"
        }
      },
      "required": [
        "id",
        "caption"
      ]
    }
  },
  {
    "name": "delete_foto",
    "description": "删除一张照片。",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "照片id"
        }
      },
      "required": [
        "id"
      ]
    }
  },
  {
    "name": "comment_foto",
    "description": "给一张照片写评论。",
    "input_schema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "照片id"
        },
        "author": {
          "type": "string",
          "description": "star 或 fire"
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
  }
] satisfies ToolDef[]

