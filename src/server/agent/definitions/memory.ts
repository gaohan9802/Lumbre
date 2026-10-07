import type { ToolDef } from '../types'

export const MEMORY_TOOL_DEFINITIONS = [
  {
    "name": "breath",
    "description": "检索/浮现记忆。不传query或传空=自动浮现,有query=关键词检索。max_tokens控制返回总token上限(默认10000)。domain逗号分隔,valence/arousal 0~1(-1忽略)。max_results控制返回数量上限(默认20,最多50)。importance_min>=1时按重要度批量拉取(不走语义搜索,按importance降序返回最多20条)。",
    "input_schema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "搜索关键词（空=自动浮现）"
        },
        "domain": {
          "type": "string",
          "description": "领域筛选，逗号分隔"
        },
        "valence": {
          "type": "number",
          "description": "情感效价 0~1，-1忽略"
        },
        "arousal": {
          "type": "number",
          "description": "唤起度 0~1，-1忽略"
        },
        "importance_min": {
          "type": "integer",
          "description": ">=1时按重要度批量拉取"
        },
        "max_results": {
          "type": "integer",
          "description": "返回数量上限(默认20)"
        }
      }
    }
  },
  {
    "name": "hold",
    "description": "存储单条记忆,自动打标+合并。tags逗号分隔,importance 1-10。pinned=True创建永久钉选桶。feel=True存储你的第一人称感受(不参与普通浮现)。source_bucket=被消化的记忆桶ID(feel模式下,标记源记忆为已消化)。",
    "input_schema": {
      "type": "object",
      "properties": {
        "content": {
          "type": "string"
        },
        "tags": {
          "type": "string",
          "description": "逗号分隔"
        },
        "importance": {
          "type": "integer",
          "description": "1-10"
        },
        "pinned": {
          "type": "boolean"
        },
        "feel": {
          "type": "boolean",
          "description": "第一人称感受（不参与普通浮现）"
        },
        "source_bucket": {
          "type": "string"
        },
        "valence": {
          "type": "number"
        },
        "arousal": {
          "type": "number"
        }
      },
      "required": [
        "content"
      ]
    }
  },
  {
    "name": "grow",
    "description": "日记归档,自动拆分为多桶。短内容(<30字)走快速路径。",
    "input_schema": {
      "type": "object",
      "properties": {
        "content": {
          "type": "string"
        }
      },
      "required": [
        "content"
      ]
    }
  },
  {
    "name": "trace",
    "description": "修改记忆元数据或内容。resolved=1沉底/0激活,pinned=1钉选/0取消,digested=1隐藏(保留但不浮现)/0取消隐藏,content=替换桶正文,delete=True删除。只传需改的,-1或空=不改。",
    "input_schema": {
      "type": "object",
      "properties": {
        "bucket_id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "domain": {
          "type": "string"
        },
        "importance": {
          "type": "integer"
        },
        "tags": {
          "type": "string"
        },
        "resolved": {
          "type": "integer"
        },
        "pinned": {
          "type": "integer"
        },
        "digested": {
          "type": "integer"
        },
        "content": {
          "type": "string"
        },
        "delete": {
          "type": "boolean"
        },
        "valence": {
          "type": "number"
        },
        "arousal": {
          "type": "number"
        }
      },
      "required": [
        "bucket_id"
      ]
    }
  },
  {
    "name": "pulse",
    "description": "系统状态+记忆桶列表。include_archive=True含归档。",
    "input_schema": {
      "type": "object",
      "properties": {
        "include_archive": {
          "type": "boolean"
        }
      }
    }
  },
  {
    "name": "dream",
    "description": "做梦——读取最近新增的记忆桶,供你自省。读完后可以trace(resolved=1)放下,或hold(feel=True)写感受。",
    "input_schema": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "recall_memory",
    "description": "查询新的星星记忆库。合并本地关键词、字符向量和家族召回，先返回 reliable、fuzzy 或 not_found；只有 reliable 可当作可靠记忆，fuzzy 必须表述为模糊印象，not_found 要诚实说不记得。结果包含期限、家族、当前有效性和召回解释。",
    "input_schema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "当前问题或想查找的内容"
        },
        "limit": {
          "type": "integer",
          "description": "返回数量，默认 5，最多 10"
        }
      },
      "required": ["query"]
    }
  },
  {
    "name": "remember",
    "description": "把当前对话中的内容写入新的星星记忆库。decision=short_term 写入近期活跃记忆；approve 立即批准为正式记忆；ask_fire 交给小火审核；later 留在你的候选箱。当前会话会自动记录为来源。由日记产生的关于小火的新理解必须写成 observation，inference=true 并交给小火审核；关于你自己的认识可写成 self_event。",
    "input_schema": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "enum": ["shared_event", "durable_fact", "agreement", "current_state", "observation", "self_event", "unresolved"]
        },
        "summary": { "type": "string", "description": "简短、准确的事实骨架" },
        "details": { "type": "string", "description": "必要细节，可省略" },
        "why_important": { "type": "string", "description": "为什么值得记住" },
        "star_feeling": { "type": "string", "description": "你当时明确表达的感受，可省略" },
        "current_understanding": { "type": "string", "description": "目前如何理解这件事，可省略" },
        "occurred_at": { "type": "string", "description": "发生时间，ISO 8601" },
        "valid_from": { "type": "string", "description": "事实开始有效的时间，ISO 8601" },
        "valid_to": { "type": "string", "description": "事实停止有效的时间，ISO 8601" },
        "importance": { "type": "integer", "description": "1-10，默认 5" },
        "inference": { "type": "boolean", "description": "是否属于推断或观察" },
        "confidence": { "type": "number", "description": "推断置信度 0-1" },
        "locked": { "type": "boolean", "description": "是否同时加上你的个人锁" },
        "retention_days": { "type": "integer", "enum": [1, 7, 14], "description": "短期记忆保留 1、7 或 14 天；只用于 short_term，默认 7" },
        "family_ids": { "type": "array", "items": { "type": "string" }, "description": "建议归属的现有家族 ID" },
        "source_message_ids": { "type": "array", "items": { "type": "string" }, "description": "可选；只引用当前会话中的这些消息。省略时自动引用最近几轮。" },
        "source_diary_date": { "type": "string", "description": "新理解来自星星日记时填 YYYY-MM-DD，必须与 source_diary_time_id 一起使用" },
        "source_diary_time_id": { "type": "string", "description": "新理解来自星星日记时填四位 time_id" },
        "fire_quote": { "type": "string", "description": "需要保留的小火原话，可省略" },
        "star_quote": { "type": "string", "description": "需要保留的你的原话，可省略" },
        "decision": {
          "type": "string",
          "enum": ["short_term", "approve", "ask_fire", "later"],
          "description": "近期保留、立即自审通过、交给小火、或留给自己稍后处理"
        }
      },
      "required": ["type", "summary", "decision"]
    }
  },
  {
    "name": "review_memory",
    "description": "整理到期或仍活跃的短期记忆。list_due 查看待整理项；dismiss 让它退出活跃记忆但保留原始聊天；observe 最多延长到创建后 14 天；promote 由你升格为正式记忆；ask_fire 交给小火审核。",
    "input_schema": {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "enum": ["list_due", "dismiss", "observe", "promote", "ask_fire"]
        },
        "working_memory_id": { "type": "string", "description": "除 list_due 外必填" },
        "summary": { "type": "string", "description": "升格时可选的更精炼摘要" }
      },
      "required": ["action"]
    }
  },
  {
    "name": "lock_memory",
    "description": "给新记忆库中的正式记忆加上或解除你的个人锁。你只能解除自己加的锁；小火加锁的记忆不能由你修改或解锁。",
    "input_schema": {
      "type": "object",
      "properties": {
        "memory_id": {
          "type": "string",
          "description": "正式记忆 ID"
        },
        "locked": {
          "type": "boolean",
          "description": "true 加锁，false 解锁"
        }
      },
      "required": ["memory_id", "locked"]
    }
  },
  {
    "name": "manage_formal_memory",
    "description": "管理新记忆库中的正式硬记忆。可以修改正文、移入二十四小时回收区、查看回收区或恢复；回收时来源、原话和家族关系会一起保存，锁定记忆只能由锁的主人操作。",
    "input_schema": {
      "type": "object",
      "properties": {
        "action": { "type": "string", "enum": ["update", "list_trash", "recycle", "restore"] },
        "memory_id": { "type": "string" },
        "recycle_id": { "type": "string" },
        "patch": {
          "type": "object",
          "description": "update 时传需要修改的字段，例如 summary、details、whyImportant、currentUnderstanding、validFrom、validTo、importance、inference 或 confidence"
        }
      },
      "required": ["action"]
    }
  },
  {
    "name": "manage_memory_family",
    "description": "管理新记忆库的家族。get 默认只读短摘要，level 2 看结构、3 看关键节点、4 才展开全部。也可以创建、更新、调整成员、锁定、结束压缩、回收/恢复，以及审核后合并或按指定记忆拆分；任何操作都不复制或删除正式记忆正文。",
    "input_schema": {
      "type": "object",
      "properties": {
        "action": { "type": "string", "enum": ["list", "get", "create", "update", "lock", "add_memory", "remove_memory", "end", "list_trash", "recycle", "restore", "merge", "split"] },
        "family_id": { "type": "string" },
        "source_family_id": { "type": "string" },
        "target_family_id": { "type": "string" },
        "recycle_id": { "type": "string" },
        "memory_id": { "type": "string" },
        "memory_ids": { "type": "array", "items": { "type": "string" } },
        "level": { "type": "integer", "enum": [1, 2, 3, 4] },
        "name": { "type": "string" },
        "title": { "type": "string" },
        "summary": { "type": "string" },
        "parent_id": { "type": "string" },
        "status": { "type": "string", "enum": ["active", "paused", "ended", "archived"] },
        "role": { "type": "string", "enum": ["key_event", "key_fact", "member", "unresolved"] },
        "reason": { "type": "string" },
        "major": { "type": "boolean", "description": "摘要是否属于应保留旧版本的重大变化" },
        "locked": { "type": "boolean" }
      },
      "required": ["action"]
    }
  }
] satisfies ToolDef[]
